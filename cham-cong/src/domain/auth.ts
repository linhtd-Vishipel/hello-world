// Băm mật khẩu bằng PBKDF2-SHA256 (WebCrypto). Không lưu mật khẩu dạng văn bản thuần.
const ITERATIONS = 120_000;

function toHex(buf: ArrayBuffer | Uint8Array): string {
  return Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function hashPassword(password: string, saltHex?: string, iterations = ITERATIONS) {
  const salt = saltHex ? fromHex(saltHex) : globalThis.crypto.getRandomValues(new Uint8Array(16));
  const key = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await globalThis.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return { passwordHash: toHex(bits), salt: toHex(salt), iterations };
}

export async function verifyPassword(password: string, user: { passwordHash: string; salt: string; iterations: number }) {
  const { passwordHash } = await hashPassword(password, user.salt, user.iterations);
  // So sánh độ dài cố định
  let diff = passwordHash.length ^ user.passwordHash.length;
  for (let i = 0; i < passwordHash.length; i++) diff |= passwordHash.charCodeAt(i) ^ (user.passwordHash.charCodeAt(i) || 0);
  return diff === 0;
}

export function validatePassword(pw: string): string | null {
  if (pw.length < 8) return 'Mật khẩu tối thiểu 8 ký tự.';
  return null;
}
