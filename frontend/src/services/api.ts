// refactor: 将导入从 'database' 包更改为本地的类型定义文件
import type { Email } from "../database_types";

const API_BASE_URL = "/api";

// fix: 移除不再需要的 ApiPayload 接口定义

// 获取邮件列表
// fix: 移除 getEmails 函数中的 token 参数，因为后端已不再需要它
export async function getEmails(
  address: string,
  limit: number = 50,
  mailboxToken?: string,
): Promise<Email[]> {
  const response = await fetch(`${API_BASE_URL}/emails`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(mailboxToken ? { Authorization: `Bearer ${mailboxToken}` } : {}),
    },
    // fix: 请求体中只发送 address
    body: JSON.stringify({ address, limit, ...(mailboxToken ? { token: mailboxToken } : {}) }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || "获取邮件失败");
  }
  return response.json();
}

export interface MailboxMeta {
  count: number;
  latestEmailCreatedAt: string | null;
}

export async function getMailboxMeta(address: string, mailboxToken?: string): Promise<MailboxMeta> {
  const response = await fetch(`${API_BASE_URL}/emails/meta`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(mailboxToken ? { Authorization: `Bearer ${mailboxToken}` } : {}),
    },
    body: JSON.stringify({ address, ...(mailboxToken ? { token: mailboxToken } : {}) }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || "获取邮箱信息失败");
  }
  return response.json();
}

// feat: 新增函数，用于在创建邮箱前验证人机校验token
export interface MailboxAuthorizationResponse {
  success: boolean;
  bypassed?: boolean;
  mailbox: string;
  mailboxToken?: string;
}

export async function verifyTurnstile(
  domain: string,
  password: string,
  token?: string,
): Promise<MailboxAuthorizationResponse> {
  const response = await fetch(`${API_BASE_URL}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      domain,
      ...(token ? { token } : {}),
      ...(password ? { password } : {}),
    }),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || "Turnstile verification failed");
  }
  return response.json();
}

// feat: 添加获取单封邮件详情的函数
export async function getEmailById(id: string, mailboxToken?: string): Promise<Email> {
  const response = await fetch(`${API_BASE_URL}/emails/${id}`, {
    headers: mailboxToken ? { Authorization: `Bearer ${mailboxToken}` } : undefined,
  });
  if (!response.ok) {
    throw new Error("Failed to fetch email");
  }
  return response.json();
}

// 删除邮件
// fix: 移除 deleteEmails 函数中的 token 参数
export async function deleteEmails(
  ids: string[],
  address?: string,
  mailboxToken?: string,
): Promise<{ count: number }> {
  const response = await fetch(`${API_BASE_URL}/delete-emails`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(mailboxToken ? { Authorization: `Bearer ${mailboxToken}` } : {}),
    },
    // fix: 请求体中只发送 ids
    body: JSON.stringify({ ids, ...(address ? { address } : {}), ...(mailboxToken ? { token: mailboxToken } : {}) }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || "删除邮件失败");
  }
  return response.json();
}

// feat: 添加密码登录函数
// fix: 移除 token 参数，因为登录流程不再需要人机验证
export async function loginByPassword(password: string, address?: string): Promise<{
  address: string;
  mailboxToken?: string;
  permanent?: boolean;
  expiresAt?: string | null;
}> {
  const response = await fetch(`${API_BASE_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, ...(address ? { address } : {}) }),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || "Login failed");
  }
  return response.json();
}

export interface PermanentMailboxResponse {
  success: boolean;
  address: string;
  mailboxToken?: string;
  permanent?: boolean;
  hasPassword?: boolean;
  expiresAt?: string | null;
}

export async function createPermanentMailbox(
  localPart: string,
  domain: string,
  password: string,
  token?: string,
): Promise<PermanentMailboxResponse> {
  const response = await fetch(`${API_BASE_URL}/permanent-mailboxes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      localPart,
      domain,
      ...(password ? { password } : {}),
      ...(token ? { token } : {}),
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "固定邮箱创建失败");
  }
  return data;
}

export async function setPermanentMailboxPassword(
  address: string,
  password: string,
  mailboxToken?: string,
): Promise<PermanentMailboxResponse> {
  const response = await fetch(`${API_BASE_URL}/permanent-mailboxes/password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(mailboxToken ? { Authorization: `Bearer ${mailboxToken}` } : {}),
    },
    body: JSON.stringify({ address, password, ...(mailboxToken ? { token: mailboxToken } : {}) }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "密码设置失败");
  }
  return data;
}

export async function loginPermanentMailbox(
  address: string,
  password: string,
): Promise<PermanentMailboxResponse> {
  const response = await fetch(`${API_BASE_URL}/permanent-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, password }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "邮箱或密码错误");
  }
  return data;
}

export async function refreshMailboxToken(
  mailboxToken: string,
): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/mailbox-token/refresh`, {
    method: "POST",
    headers: { Authorization: `Bearer ${mailboxToken}` },
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(
      errorData.message || "Failed to refresh mailbox authorization",
    );
  }
  const data = (await response.json()) as { mailboxToken: string };
  return data.mailboxToken;
}

// 站点统计数据类型
export interface StatsSnapshot {
  totalAddressesCreated: number;
  totalEmailsReceived: number;
  totalApiCalls: number;
  totalApiKeysCreated: number;
}

export interface SiteStats {
  totals: StatsSnapshot;
}

// 获取站点统计数据
export async function getSiteStats(): Promise<SiteStats> {
  const response = await fetch(`${API_BASE_URL}/stats`);
  if (!response.ok) {
    throw new Error("Failed to fetch site stats");
  }
  return response.json();
}

export interface UnlockStatusResponse {
  unlocked: boolean;
  sitePasswordEnabled: boolean;
}

export async function getUnlockStatus(): Promise<UnlockStatusResponse> {
  const response = await fetch("/auth/status");
  if (!response.ok) {
    throw new Error("Failed to fetch unlock status");
  }
  return response.json();
}

export async function unlockSite(
  password: string,
): Promise<{ success: boolean }> {
  const response = await fetch("/auth/unlock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || "Invalid password");
  }

  return response.json();
}
