// worker/src/utils.ts
/**
 * 使用密钥对文本进行简单的 XOR 加密。
 * @param text 要加密的文本。
 * @param secret 加密密钥。
 * @returns 加密后的 Base64 编码字符串。
 */
export function encrypt(text: string, secret: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    // 对每个字符的 ASCII 码与密钥中对应位置的字符 ASCII 码进行异或操作
    result += String.fromCharCode(text.charCodeAt(i) ^ secret.charCodeAt(i % secret.length));
  }
  // 将加密后的结果转换为 Base64 编码，使其更安全地传输
  return btoa(result);
}

/**
 * 使用密钥对 Base64 编码的加密文本进行解密。
 * @param encryptedText 加密后的 Base64 编码字符串。
 * @param secret 解密密钥。
 * @returns 解密后的原始文本。
 */
export function decrypt(encryptedText: string, secret: string): string {
  // 首先对 Base64 编码的字符串进行解码
  const text = atob(encryptedText);
  let result = '';
  for (let i = 0; i < text.length; i++) {
    // 同样进行异或操作来还原原始字符
    result += String.fromCharCode(text.charCodeAt(i) ^ secret.charCodeAt(i % secret.length));
  }
  return result;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export async function hashMailboxPassword(password: string, salt?: string) {
  const saltBytes = salt ? base64UrlToBytes(salt) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const digest = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );
  return {
    salt: bytesToBase64Url(saltBytes),
    hash: bytesToBase64Url(new Uint8Array(digest)),
  };
}

export function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}
