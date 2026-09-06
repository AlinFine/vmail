import { Hono } from 'hono';
import { serveStatic } from 'hono/cloudflare-workers';
import { cors } from 'hono/cors';
// 导入数据库相关的模块
import { deleteEmails, findEmailById, getEmailsByMessageTo, insertEmail, deleteExpiredEmails, insertApiKey, getSiteStats, incrementEmailsReceived, incrementApiKeysCreated, incrementAddressesCreated, incrementDailyAddressesCreated, incrementDailyEmailsReceived, incrementDailyApiKeysCreated, getMailboxMetaByAddress, incrementAndGetApiRateWindowCount, findMailboxByAddress, insertMailbox, makeMailboxPermanent, setMailboxPassword } from './database/dao';
import { getD1DB } from './database/db';
import { InsertEmail, insertEmailSchema } from './database/schema';
import { nanoid } from 'nanoid/non-secure';
import PostalMime from 'postal-mime';
import { EmailMessage } from 'cloudflare:email';
// 导入加解密工具函数
import { decrypt, hashMailboxPassword, verifyMailboxPassword } from './utils';
// 导入 v1 API
import v1Api from './api/v1';
import { isOpenApiEnabled, requireOpenApi } from './openapi';
import {
  buildCloudflareMimeMessage,
  buildMailChannelsPayload,
  buildResendPayload,
  createMailboxToken,
  getBearerToken,
  getConfiguredSendChannel,
  getMailboxTokenSecret,
  isAllowedMailboxAddress,
  sendRequestSchema,
  verifyMailboxToken,
} from './sender';


// 定义 Cloudflare 绑定和环境变量的类型
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  // 从 wrangler.toml 中传入的环境变量
  EMAIL_DOMAIN: string;
  COOKIES_SECRET: string;
  TURNSTILE_KEY: string;
  TURNSTILE_SECRET: string;
  PASSWORD?: string;
  RESEND_API_KEY?: string;
  MAILCHANNELS_API_KEY?: string;
  MAILBOX_TOKEN_SECRET?: string;
  SENDER_EMAIL?: string;
  SEND_RATE_LIMIT_PER_MINUTE?: string;
  SEND_IP_RATE_LIMIT_PER_MINUTE?: string;
  API_RATE_LIMIT_PER_MINUTE?: string;
  SHOW_AFF?: string;
  ENABLE_OPENAPI?: string;
  SEND_CHANNEL?: string;
  SEND_EMAIL?: SendEmail;
}

// 初始化 Hono 应用
const app = new Hono<{ Bindings: Env }>();

app.onError((error, c) => {
  console.error('Unhandled request error:', error);
  const message = error instanceof Error ? error.message : String(error);
  if (/no such (?:table|column)/i.test(message)) {
    return c.json({
      code: 'DATABASE_MIGRATION_REQUIRED',
      message: '数据库未完成升级，请重新运行部署',
    }, 503);
  }
  return c.json({ code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试' }, 500);
});

// 配置 CORS
app.use('/api/v1/*', cors());

const SITE_AUTH_COOKIE = 'vmail_site_auth';

function isTurnstileEnabled(env: Env): boolean {
  return Boolean(env.TURNSTILE_KEY && env.TURNSTILE_SECRET);
}

function parseRateLimitPerMinute(env: Env): number {
  const parsed = Number.parseInt(env.API_RATE_LIMIT_PER_MINUTE ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 100;
  }
  return parsed;
}

function parsePositiveLimit(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, 1000);
}

function getMailboxTokenTtlSeconds(): number {
  return 24 * 60 * 60;
}

function getPermanentMailboxTokenTtlSeconds(): number {
  return 30 * 24 * 60 * 60;
}

function normalizeMailboxAddress(address: string): string {
  return address.trim().toLowerCase();
}

function isValidMailboxLocalPart(localPart: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/.test(localPart);
}

async function authorizeMailboxAccess(
  c: any,
  address: string,
  bodyToken?: string,
): Promise<{ allowed: true; mailbox: any } | { allowed: false; response: Response }> {
  const normalizedAddress = normalizeMailboxAddress(address);
  const db = getD1DB(c.env.DB);
  const mailbox = await findMailboxByAddress(db, normalizedAddress);

  // Existing temporary mailboxes remain public for compatibility. A temporary
  // mailbox with a custom password and every permanent mailbox require a token.
  if (!mailbox || (!mailbox.isPermanent && !mailbox.passwordHash)) {
    return { allowed: true, mailbox };
  }

  const token = getBearerToken(c.req.header('Authorization')) || bodyToken || null;
  const tokenSecret = getMailboxTokenSecret(c.env);
  const authorizedAddress = token && tokenSecret
    ? await verifyMailboxToken(token, tokenSecret)
    : null;
  if (authorizedAddress !== normalizedAddress) {
    return {
      allowed: false,
      response: c.json({ code: 'MAILBOX_UNAUTHORIZED', message: '请先登录该固定邮箱' }, 401),
    };
  }

  return { allowed: true, mailbox };
}

function isSiteUnlocked(request: Request, env: Env): boolean {
  if (!env.PASSWORD) {
    return true;
  }

  const cookie = request.headers.get('cookie') ?? '';
  return cookie.split(';').some((part) => {
    const [key, value] = part.trim().split('=');
    return key === SITE_AUTH_COOKIE && value === '1';
  });
}

function shouldBypassSiteGate(pathname: string): boolean {
  if (pathname === '/' || pathname === '/index.html') {
    return true;
  }
  if (pathname.startsWith('/api/') || pathname === '/config') {
    return true;
  }
  if (pathname === '/auth/unlock' || pathname === '/auth/logout' || pathname === '/auth/status') {
    return true;
  }
  if (pathname.startsWith('/assets/')) {
    return true;
  }
  if (pathname === '/favicon.ico' || pathname.endsWith('.map')) {
    return true;
  }
  return false;
}

function withNoStoreHtml(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, max-age=0');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// fix: 增强请求体验证逻辑。
// 此前的实现方式在请求体解析失败时会静默处理，导致后续处理流程因缺少数据而返回一个模糊的400错误。
// 新的实现方式会严格校验请求体，如果解析为JSON失败（例如请求体为空或格式错误），将立即返回一个明确的400错误，从而阻止无效请求继续执行。
const turnstile = async (c, next) => {
  let body: any;
  try {
    const rawBody = await c.req.text();
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch (e) {
    // 捕获异常，记录错误日志，并返回一个清晰的错误响应。
    console.error("请求体解析为JSON时出错:", e);
    return c.json({ message: '错误的请求：请求体无效或为空。' }, 400);
  }

  // 将解析后的 body 存入上下文，以便下游处理器直接使用，避免重复解析。
  c.set('parsedBody', body);

  if (!isTurnstileEnabled(c.env)) {
    await next();
    return;
  }

  const token = body.token || c.req.header('cf-turnstile-token');
  const ip = c.req.header('CF-Connecting-IP');

  if (!token) {
    return c.json({ message: '缺少 turnstile token' }, 400);
  }

  // fix: 切换到 application/x-www-form-urlencoded 格式来发送验证请求。
  // 这可以提高兼容性，并可能解决由 FormData 编码引起的边界问题。
  const params = new URLSearchParams();
  params.append('secret', c.env.TURNSTILE_SECRET);
  params.append('response', token);
  if (ip) {
    params.append('remoteip', ip);
  }

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const data = await res.json();
  if (!data.success) {
    // feat: 增加详细的错误日志，方便调试
    console.error("Turnstile 验证失败:", data['error-codes']);
    return c.json({ message: 'token 无效' }, 400);
  }

  await next();
};

// API 路由组
const api = app.basePath('/api');

// feat: 新增一个专门用于人机验证的接口。
// 前端应在生成邮箱地址前先调用此接口。
api.post('/verify', turnstile, async (c) => {
  const body = c.get('parsedBody') as { domain?: string; password?: string };
  const domain = body?.domain?.trim().toLowerCase();
  const password = typeof body?.password === 'string' ? body.password : '';
  const tokenSecret = getMailboxTokenSecret(c.env);
  if (!domain || !isAllowedMailboxAddress(`mailbox@${domain}`, c.env.EMAIL_DOMAIN)) {
    return c.json({
      code: 'INVALID_MAILBOX',
      message: 'Mailbox domain is not configured',
    }, 400);
  }
  if (!password) {
    return c.json({ code: 'PASSWORD_REQUIRED', message: '创建邮箱时必须设置密码' }, 400);
  }
  if (password.length < 8 || password.length > 128) {
    return c.json({ code: 'INVALID_PASSWORD', message: '密码长度需为 8-128 位' }, 400);
  }
  if (!tokenSecret) {
    return c.json({ code: 'AUTH_UNAVAILABLE', message: '邮箱认证未配置' }, 503);
  }
  const mailbox = `${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}@${domain}`;

  const db = getD1DB(c.env.DB);
  const passwordData = await hashMailboxPassword(password);
  const now = new Date();
  await insertMailbox(db, {
    id: nanoid(),
    address: mailbox,
    domain,
    expiresAt: new Date(Date.now() + getMailboxTokenTtlSeconds() * 1000),
    apiKeyId: 'web',
    isPermanent: false,
    passwordHash: passwordData.hash,
    passwordSalt: passwordData.salt,
    verifiedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await incrementAddressesCreated(db);
  await incrementDailyAddressesCreated(db);

  const mailboxToken = tokenSecret
    ? await createMailboxToken(
        mailbox,
        tokenSecret,
        Date.now(),
        getMailboxTokenTtlSeconds(),
      )
    : undefined;

  return c.json({
    success: true,
    bypassed: !isTurnstileEnabled(c.env),
    mailbox,
    mailboxToken,
  });
});

// Create a persistent mailbox and save its password in the same operation.
api.post('/permanent-mailboxes', turnstile, async (c) => {
  const tokenSecret = getMailboxTokenSecret(c.env);
  if (!tokenSecret) {
    return c.json({ code: 'AUTH_UNAVAILABLE', message: '固定邮箱认证未配置' }, 503);
  }
  const body = c.get('parsedBody') as { localPart?: string; domain?: string; password?: string };
  const localPart = body?.localPart?.trim().toLowerCase() || '';
  const domain = body?.domain?.trim().toLowerCase() || '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!isValidMailboxLocalPart(localPart)) {
    return c.json({ code: 'INVALID_MAILBOX', message: '邮箱名称需为 3-64 位字母、数字或 ._- 符号' }, 400);
  }
  if (!domain || !isAllowedMailboxAddress(`mailbox@${domain}`, c.env.EMAIL_DOMAIN)) {
    return c.json({ code: 'INVALID_MAILBOX', message: '邮箱域名未配置' }, 400);
  }
  if (!password) {
    return c.json({ code: 'PASSWORD_REQUIRED', message: '创建固定邮箱时必须设置密码' }, 400);
  }
  if (password.length < 8 || password.length > 128) {
    return c.json({ code: 'INVALID_PASSWORD', message: '密码长度需为 8-128 位' }, 400);
  }

  const address = `${localPart}@${domain}`;
  const db = getD1DB(c.env.DB);
  const existing = await findMailboxByAddress(db, address);
  if (existing) {
    return c.json({
      code: 'MAILBOX_EXISTS',
      message: existing.isPermanent && existing.passwordHash
        ? '该固定邮箱已存在，请直接登录'
        : '该邮箱地址已存在',
      address,
      hasPassword: Boolean(existing.passwordHash),
    }, 409);
  }

  const now = new Date();
  const passwordData = await hashMailboxPassword(password);
  try {
    await insertMailbox(db, {
      id: nanoid(),
      address,
      domain,
      expiresAt: null,
      apiKeyId: 'web',
      isPermanent: true,
      passwordHash: passwordData.hash,
      passwordSalt: passwordData.salt,
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (!/unique constraint/i.test(errorMessage)) {
      throw error;
    }
    return c.json({
      code: 'MAILBOX_EXISTS',
      message: '该邮箱地址已存在，请直接登录',
      address,
    }, 409);
  }

  await incrementAddressesCreated(db);
  await incrementDailyAddressesCreated(db);

  const mailboxToken = await createMailboxToken(
    address,
    tokenSecret,
    Date.now(),
    getPermanentMailboxTokenTtlSeconds(),
  );
  return c.json({ success: true, address, permanent: true, hasPassword: true, mailboxToken }, 201);
});

// Set or change the password for a persistent mailbox.
api.post('/permanent-mailboxes/password', async (c) => {
  const tokenSecret = getMailboxTokenSecret(c.env);
  if (!tokenSecret) {
    return c.json({ code: 'AUTH_UNAVAILABLE', message: '固定邮箱认证未配置' }, 503);
  }
  let body: { address?: string; password?: string; currentPassword?: string; token?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 'INVALID_REQUEST', message: '请求格式无效' }, 400);
  }

  const address = normalizeMailboxAddress(body.address || '');
  const password = typeof body.password === 'string' ? body.password : '';
  if (!address || !password) {
    return c.json({ code: 'INVALID_REQUEST', message: '邮箱和密码不能为空' }, 400);
  }
  if (password.length < 8 || password.length > 128) {
    return c.json({ code: 'INVALID_PASSWORD', message: '密码长度需为 8-128 位' }, 400);
  }

  const db = getD1DB(c.env.DB);
  const mailbox = await findMailboxByAddress(db, address);
  if (!mailbox) {
    return c.json({ code: 'MAILBOX_NOT_FOUND', message: '邮箱不存在，请重新创建' }, 404);
  }

  const token = getBearerToken(c.req.header('Authorization')) || body.token || null;
  const tokenAddress = token ? await verifyMailboxToken(token, tokenSecret) : null;
  if (tokenAddress !== address) {
    return c.json({ code: 'MAILBOX_UNAUTHORIZED', message: '请先登录该固定邮箱' }, 401);
  }

  const passwordData = await hashMailboxPassword(password);
  // Mailboxes created by older versions may not have is_permanent set. A valid
  // mailbox token proves ownership, so upgrade those records while saving.
  const updated = await makeMailboxPermanent(db, address, passwordData.hash, passwordData.salt);
  if (!updated) {
    return c.json({ code: 'MAILBOX_UPDATE_FAILED', message: '邮箱密码保存失败，请重试' }, 500);
  }

  const mailboxToken = await createMailboxToken(address, tokenSecret, Date.now(), getPermanentMailboxTokenTtlSeconds());
  return c.json({ success: true, address, permanent: true, mailboxToken });
});

api.post('/permanent-login', async (c) => {
  let body: { address?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 'INVALID_REQUEST', message: '请求格式无效' }, 400);
  }

  const address = normalizeMailboxAddress(body.address || '');
  const password = body.password || '';
  const tokenSecret = getMailboxTokenSecret(c.env);
  const db = getD1DB(c.env.DB);
  const mailbox = await findMailboxByAddress(db, address);
  if (!mailbox || !mailbox.passwordHash || !mailbox.passwordSalt) {
    return c.json({ code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' }, 401);
  }
  if (mailbox.expiresAt && mailbox.expiresAt.getTime() <= Date.now()) {
    return c.json({ code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' }, 401);
  }

  const passwordCheck = await verifyMailboxPassword(password, mailbox.passwordHash, mailbox.passwordSalt);
  if (!passwordCheck.valid) {
    return c.json({ code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' }, 401);
  }
  if (!tokenSecret) {
    return c.json({ code: 'AUTH_UNAVAILABLE', message: '邮箱认证未配置' }, 503);
  }

  if (passwordCheck.needsRehash) {
    const passwordData = await hashMailboxPassword(password, mailbox.passwordSalt);
    await setMailboxPassword(db, address, passwordData.hash, passwordData.salt);
  }
  const ttlSeconds = mailbox.isPermanent
    ? getPermanentMailboxTokenTtlSeconds()
    : getMailboxTokenTtlSeconds();
  const mailboxToken = await createMailboxToken(address, tokenSecret, Date.now(), ttlSeconds);
  return c.json({
    success: true,
    address,
    mailboxToken,
    permanent: Boolean(mailbox.isPermanent),
    expiresAt: mailbox.expiresAt ? mailbox.expiresAt.toISOString() : null,
  });
});

api.post('/mailbox-token/refresh', async (c) => {
  const tokenSecret = getMailboxTokenSecret(c.env);
  if (!tokenSecret) {
    return c.json({ code: 'SEND_UNAVAILABLE', message: 'Email sending is unavailable' }, 503);
  }

  const token = getBearerToken(c.req.header('Authorization'));
  const mailbox = token
    ? await verifyMailboxToken(token, tokenSecret)
    : null;
  if (!mailbox || !isAllowedMailboxAddress(mailbox, c.env.EMAIL_DOMAIN)) {
    return c.json({ code: 'SEND_UNAUTHORIZED', message: 'Mailbox authorization is invalid or expired' }, 401);
  }

  const db = getD1DB(c.env.DB);
  const mailboxRecord = await findMailboxByAddress(db, mailbox);
  const ttlSeconds = mailboxRecord?.isPermanent
    ? getPermanentMailboxTokenTtlSeconds()
    : getMailboxTokenTtlSeconds();

  return c.json({
    mailboxToken: await createMailboxToken(
      mailbox,
      tokenSecret,
      Date.now(),
      ttlSeconds,
    ),
  });
});

// Unified, authenticated email sending endpoint.
api.post('/send', async (c) => {
  const sendChannel = getConfiguredSendChannel(c.env);
  const tokenSecret = getMailboxTokenSecret(c.env);
  if (!sendChannel || !tokenSecret || !c.env.SENDER_EMAIL) {
    return c.json({ code: 'SEND_UNAVAILABLE', message: 'Email sending is unavailable' }, 503);
  }

  const token = getBearerToken(c.req.header('Authorization'));
  const mailbox = token
    ? await verifyMailboxToken(token, tokenSecret)
    : null;
  if (!mailbox || !isAllowedMailboxAddress(mailbox, c.env.EMAIL_DOMAIN)) {
    return c.json({ code: 'SEND_UNAUTHORIZED', message: 'Mailbox authorization is invalid or expired' }, 401);
  }

  let requestBody: unknown;
  try {
    requestBody = await c.req.json();
  } catch {
    return c.json({ code: 'INVALID_SEND_REQUEST', message: 'Invalid JSON request body' }, 400);
  }

  const parsedRequest = sendRequestSchema.safeParse(requestBody);
  if (!parsedRequest.success) {
    return c.json({ code: 'INVALID_SEND_REQUEST', message: 'Invalid email fields' }, 400);
  }

  const db = getD1DB(c.env.DB);
  const windowStartEpochSec = Math.floor(Date.now() / 60_000) * 60;
  const mailboxLimit = parsePositiveLimit(c.env.SEND_RATE_LIMIT_PER_MINUTE, 3);
  const ipLimit = parsePositiveLimit(c.env.SEND_IP_RATE_LIMIT_PER_MINUTE, 10);
  const clientIp = c.req.header('CF-Connecting-IP') || 'unknown';
  const mailboxCount = await incrementAndGetApiRateWindowCount(
    db,
    `send-mailbox:${mailbox}`,
    windowStartEpochSec,
  );
  const ipCount = await incrementAndGetApiRateWindowCount(
    db,
    `send-ip:${clientIp}`,
    windowStartEpochSec,
  );

  c.header('X-RateLimit-Limit', `${mailboxLimit}`);
  c.header('X-RateLimit-Remaining', `${Math.max(mailboxLimit - mailboxCount, 0)}`);
  if (mailboxCount > mailboxLimit || ipCount > ipLimit) {
    c.header('Retry-After', '60');
    return c.json({ code: 'SEND_RATE_LIMITED', message: 'Email sending rate limit exceeded' }, 429);
  }

  const outgoingEmail = {
    ...parsedRequest.data,
    replyTo: mailbox,
  };

  try {
    if (sendChannel === 'resend') {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${c.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildResendPayload(outgoingEmail, c.env.SENDER_EMAIL)),
      });
      if (!response.ok) {
        console.error('Resend send failed:', response.status, await response.text());
        return c.json({ code: 'SEND_PROVIDER_ERROR', message: 'Email provider rejected the message' }, 502);
      }
    } else if (sendChannel === 'mailchannels') {
      const response = await fetch('https://api.mailchannels.net/tx/v1/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': c.env.MAILCHANNELS_API_KEY!,
        },
        body: JSON.stringify(buildMailChannelsPayload(outgoingEmail, c.env.SENDER_EMAIL)),
      });
      if (!response.ok) {
        console.error('MailChannels send failed:', response.status, await response.text());
        return c.json({ code: 'SEND_PROVIDER_ERROR', message: 'Email provider rejected the message' }, 502);
      }
    } else {
      const emailMessage = new EmailMessage(
        c.env.SENDER_EMAIL,
        outgoingEmail.receiverEmail,
        buildCloudflareMimeMessage(outgoingEmail, c.env.SENDER_EMAIL),
      );
      await c.env.SEND_EMAIL!.send(emailMessage);
    }

    return c.json({ success: true, channel: sendChannel });
  } catch (error) {
    console.error('Email send failed:', error);
    return c.json({ code: 'SEND_PROVIDER_ERROR', message: 'Email provider is unavailable' }, 502);
  }
});

// 生成 API Key 的函数
function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'vmail_';
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

// 创建 API Key 接口（需要 Turnstile 验证）
api.post('/api-keys', requireOpenApi, turnstile, async (c) => {
  const db = getD1DB(c.env.DB);
  const body = c.get('parsedBody') as { name?: string };

  const now = new Date();
  const apiKey = generateApiKey();
  const keyPrefix = apiKey.substring(0, 12) + '...';

  const newApiKey = {
    id: nanoid(),
    key: apiKey,
    keyPrefix: keyPrefix,
    name: body?.name || null,
    rateLimit: 100,
    isActive: true,
    lastUsedAt: null,
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await insertApiKey(db, newApiKey);
    // 增加 API Key 创建计数
    await incrementApiKeysCreated(db);
    await incrementDailyApiKeysCreated(db);
    // 只返回一次完整的 API Key，之后无法再获取
    return c.json({
      data: {
        id: newApiKey.id,
        key: apiKey,  // 完整的 API Key，只展示这一次
        keyPrefix: keyPrefix,
        name: newApiKey.name,
        createdAt: now.toISOString(),
      },
      message: 'API Key created successfully. Please save it now, it will not be shown again!'
    }, 201);
  } catch (e: any) {
    console.error('Create API Key error:', e);
    return c.json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to create API Key',
      }
    }, 500);
  }
});

// fix: 移除获取邮件列表接口的 turnstile 验证。
// 这个接口现在是公开的，刷新收件箱时可以直接调用，不再需要重复验证。
api.post('/emails', async (c) => {
  const db = getD1DB(c.env.DB);
  let body: any;
  try {
    body = await c.req.json();
  } catch (e) {
    return c.json({ message: '错误的请求：请求体无效或为空。' }, 400);
  }
  const address = body?.address;
  const limit = Number.parseInt(body?.limit ?? '', 10);

  if (!address) {
    return c.json({ message: 'address is required' }, 400);
  }
  const authorization = await authorizeMailboxAccess(c, address as string, body?.token);
  if (!authorization.allowed) {
    return authorization.response;
  }
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 50;
  const emails = await getEmailsByMessageTo(db, address as string, safeLimit);
  return c.json(emails);
});

api.post('/emails/meta', async (c) => {
  const db = getD1DB(c.env.DB);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ message: '错误的请求：请求体无效或为空。' }, 400);
  }

  const address = body?.address;
  if (!address) {
    return c.json({ message: 'address is required' }, 400);
  }

  const authorization = await authorizeMailboxAccess(c, address as string, body?.token);
  if (!authorization.allowed) {
    return authorization.response;
  }

  const meta = await getMailboxMetaByAddress(db, address as string);
  return c.json(meta);
});


// 获取单封邮件详情
api.get('/emails/:id', async (c) => {
  const db = getD1DB(c.env.DB);
  const { id } = c.req.param();
  // 函数调用修正：使用 findEmailById 函数
  const email = await findEmailById(db, id);
  if (!email) {
    return c.json({ message: 'Email not found'}, 404);
  }
  const authorization = await authorizeMailboxAccess(c, email.messageTo);
  if (!authorization.allowed) {
    return authorization.response;
  }
  return c.json(email);
});

// fix: 删除邮件接口不再需要 turnstile 验证，因为通常这是在已知邮箱上下文中操作的。
api.post('/delete-emails', async (c) => {
    const db = getD1DB(c.env.DB);
    const body = await c.req.json();
    const ids = body?.ids;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return c.json({ message: 'ids are required' }, 400);
    }
    if (body?.address) {
      const authorization = await authorizeMailboxAccess(c, body.address, body?.token);
      if (!authorization.allowed) {
        return authorization.response;
      }
      const mailboxEmails = await Promise.all(ids.map((id: string) => findEmailById(db, id)));
      if (mailboxEmails.some((email) => !email || normalizeMailboxAddress(email.messageTo) !== normalizeMailboxAddress(body.address))) {
        return c.json({ code: 'MAILBOX_UNAUTHORIZED', message: '不能删除其他邮箱的邮件' }, 403);
      }
    }
    const result = await deleteEmails(db, ids as string[]);
    return c.json(result);
});

// 修复：移除登录接口的 turnstile 中间件，使其不再需要人机验证。
api.post('/login', async (c) => {
  // 修复：由于移除了 turnstile 中间件，现在需要在此处直接解析请求体。
  const body = await c.req.json();
  const password = typeof body?.password === 'string' ? body.password : '';
  const requestedAddress = typeof body?.address === 'string'
    ? normalizeMailboxAddress(body.address)
    : '';

  if (!password) {
    return c.json({ message: 'Password is required' }, 400);
  }

  // Custom passwords are stored against the mailbox address. Keep the old
  // encrypted-password path below for legacy temporary mailboxes.
  if (requestedAddress) {
    const tokenSecret = getMailboxTokenSecret(c.env);
    if (!tokenSecret) {
      return c.json({ code: 'AUTH_UNAVAILABLE', message: '邮箱认证未配置' }, 503);
    }
    const db = getD1DB(c.env.DB);
    const mailbox = await findMailboxByAddress(db, requestedAddress);
    if (!mailbox || !mailbox.passwordHash || !mailbox.passwordSalt) {
      return c.json({ code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' }, 401);
    }
    if (mailbox.expiresAt && mailbox.expiresAt.getTime() <= Date.now()) {
      return c.json({ code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' }, 401);
    }
    const passwordCheck = await verifyMailboxPassword(password, mailbox.passwordHash, mailbox.passwordSalt);
    if (!passwordCheck.valid) {
      return c.json({ code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' }, 401);
    }
    if (passwordCheck.needsRehash) {
      const passwordData = await hashMailboxPassword(password, mailbox.passwordSalt);
      await setMailboxPassword(db, requestedAddress, passwordData.hash, passwordData.salt);
    }
    const ttlSeconds = mailbox.isPermanent
      ? getPermanentMailboxTokenTtlSeconds()
      : getMailboxTokenTtlSeconds();
    const mailboxToken = await createMailboxToken(
      requestedAddress,
      tokenSecret,
      Date.now(),
      ttlSeconds,
    );
    return c.json({
      success: true,
      address: requestedAddress,
      mailboxToken,
      permanent: Boolean(mailbox.isPermanent),
      expiresAt: mailbox.expiresAt ? mailbox.expiresAt.toISOString() : null,
    });
  }

  try {
    // 解密密码以获取邮箱地址
    const address = decrypt(password, c.env.COOKIES_SECRET);

    // 可选：添加一个简单的邮箱地址格式校验，增加健壮性
    // 例如，检查是否包含 '@' 符号
    if (!address || typeof address !== 'string' || !address.includes('@')) {
        console.error("解密后的地址格式无效:", address);
        return c.json({ message: 'Invalid password' }, 400); // 地址格式不对也视为密码无效
    }

    // Legacy passwords are client-derived and therefore cannot prove send ownership.
    return c.json({ address });
  } catch (e) {
    console.error("Login error:", e);
    // 如果解密失败或发生其他错误，返回无效密码错误
    return c.json({ message: 'Invalid password' }, 400);
  }
});


// 前端配置接口
app.get('/config', (c) => {
  // feat: 将 emailDomain 拆分为数组以支持多域名
  const emailDomain = c.env.EMAIL_DOMAIN ? c.env.EMAIL_DOMAIN.split(',').map(d => d.trim()) : [];
  const turnstileEnabled = isTurnstileEnabled(c.env);
  const openApiEnabled = isOpenApiEnabled(c.env);

  const sendChannel = getConfiguredSendChannel(c.env);
  const enabledSenders = sendChannel ? [sendChannel] : [];

  return c.json({
    emailDomain: emailDomain, // 返回域名数组
    turnstileKey: c.env.TURNSTILE_KEY,
    turnstileEnabled,
    cookiesSecret: c.env.COOKIES_SECRET,
    sitePasswordEnabled: Boolean(c.env.PASSWORD),
    apiRateLimitPerMinute: parseRateLimitPerMinute(c.env),
    openApiEnabled,
    showAff: c.env.SHOW_AFF === 'true',
    enabledSenders,
    sendChannel: sendChannel || '',
    senderEmail: sendChannel ? c.env.SENDER_EMAIL : '',
  });
});

// 站点统计数据接口（公开）
api.get('/stats', async (c) => {
  const cache = caches.default;
  const cacheKey = new Request(c.req.url, c.req.raw);
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  const db = getD1DB(c.env.DB);
  const stats = await getSiteStats(db);

  const totals = {
    totalAddressesCreated: stats?.totalAddressesCreated ?? 0,
    totalEmailsReceived: stats?.totalEmailsReceived ?? 0,
    totalApiCalls: stats?.totalApiCalls ?? 0,
    totalApiKeysCreated: stats?.totalApiKeysCreated ?? 0,
  };

  const response = c.json({
    totals,
  });

  response.headers.set('Cache-Control', 'public, max-age=300');
  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
});

app.post('/auth/unlock', async (c) => {
  if (!c.env.PASSWORD) {
    return c.json({ success: true, bypassed: true });
  }

  let body: { password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ message: 'Invalid request body' }, 400);
  }

  if (body.password !== c.env.PASSWORD) {
    return c.json({ message: 'Invalid password' }, 401);
  }

  c.header(
    'Set-Cookie',
    `${SITE_AUTH_COOKIE}=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400; Secure`,
  );

  return c.json({ success: true });
});

app.get('/auth/status', (c) => {
  const unlocked = isSiteUnlocked(c.req.raw, c.env);
  return c.json({
    unlocked,
    sitePasswordEnabled: Boolean(c.env.PASSWORD),
  });
});

app.post('/auth/logout', (c) => {
  c.header(
    'Set-Cookie',
    `${SITE_AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,
  );
  return c.json({ success: true });
});

// 挂载 v1 API 路由
app.route('/api/v1', v1Api);

// 修正: 确保 serveStatic 正确指向静态文件目录
// Hono v4 中 serveStatic 默认处理根路径，我们需要确保它指向正确的子目录
app.get('/*', serveStatic({ root: './' }))
app.get('/assets/*', serveStatic({ root: './' }))


// Worker 主处理逻辑
export default {
  // 邮件处理逻辑
  async email(message: ForwardableEmail, env: Env, ctx: ExecutionContext) {
    try {
      const db = getD1DB(env.DB);
      // 将原始邮件流转换为文本
      const raw = await new Response(message.raw).text();
      // 使用 postal-mime 解析邮件
      const mail = await new PostalMime().parse(raw);
      const now = new Date();

      // **关键修复**：显式地从解析结果中映射字段，而不是使用对象展开(...)
      // 这样可以避免属性覆盖和类型不匹配的问题
      const newEmail: InsertEmail = {
        id: nanoid(),
        messageFrom: message.from,
        messageTo: message.to,
        headers: mail.headers || [], // 确保 headers 存在
        from: mail.from,
        sender: mail.sender,
        replyTo: mail.replyTo,
        deliveredTo: mail.deliveredTo,
        returnPath: mail.returnPath,
        to: mail.to,
        cc: mail.cc,
        bcc: mail.bcc,
        subject: mail.subject,
        messageId: mail.messageId, // messageId 在数据库中是必需的
        inReplyTo: mail.inReplyTo,
        references: mail.references,
        date: mail.date,
        html: mail.html,
        text: mail.text,
        createdAt: now,
        updatedAt: now,
      };

      // 验证待插入的数据是否符合 schema
      const email = insertEmailSchema.parse(newEmail);
      // 插入数据库
      await insertEmail(db, email);
      // 增加邮件接收计数
      await incrementEmailsReceived(db);
      await incrementDailyEmailsReceived(db);
    } catch (e: any) {
      // **关键修复**：向 Cloudflare 发出拒绝信号
      // 当发生任何错误时，调用 message.setReject() 告知 Cloudflare 处理失败。
      // 这会让 Cloudflare 尝试重新投递邮件，而不是直接删除。
      console.error('处理邮件失败:', e);
      message.setReject(`邮件处理失败: ${e.message}`);
    }
  },

  // HTTP 请求处理逻辑
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (!shouldBypassSiteGate(url.pathname) && !isSiteUnlocked(request, env)) {
      return new Response(JSON.stringify({ message: 'Site is locked' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    // API 路由
    if (url.pathname.startsWith('/api/') || url.pathname === '/config' || url.pathname.startsWith('/auth/')) {
      return app.fetch(request, env, ctx);
    }

    // 静态资源请求
    const response = await env.ASSETS.fetch(request);

    // SPA 路由回退：如果静态资源返回 404，则返回 index.html
    // 这样可以支持直接访问 /api-docs 等前端路由
    if (response.status === 404) {
      const indexRequest = new Request(new URL('/', request.url).toString(), request);
      return withNoStoreHtml(await env.ASSETS.fetch(indexRequest));
    }

    return url.pathname === '/' || url.pathname === '/index.html'
      ? withNoStoreHtml(response)
      : response;
  },

  // 定时任务 (清理过期邮件)
  async scheduled(event, env, ctx) {
      const db = getD1DB(env.DB);
      // 修复：将清理时间从1小时修改为24小时（1天）
      const oneDayAgo = new Date(Date.now() - 1000 * 60 * 60 * 24);
      await deleteExpiredEmails(db, oneDayAgo);
      console.log(`已清理 ${oneDayAgo.toISOString()} 之前的过期邮件`); // 添加日志
  },
};
