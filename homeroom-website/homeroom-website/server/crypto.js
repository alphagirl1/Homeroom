// Passwords for Homeroom accounts are hashed (scrypt). Saved school-site passwords are encrypted
// (AES-256-GCM) with a key made from the HOMEROOM_SECRET setting, so the database alone can't reveal them.
import crypto from 'node:crypto';

export const b64u = buf => Buffer.from(buf).toString('base64url');
export const unb64u = s => Buffer.from(String(s), 'base64url');
export const token = (bytes = 24) => b64u(crypto.randomBytes(bytes));
export const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
export const hmac = (key, msg) => crypto.createHmac('sha256', String(key)).update(String(msg)).digest('hex');
export const uuid = () => crypto.randomUUID();
export function safeEqual(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }

const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(String(pw).normalize('NFKC'), salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => e ? rej(e) : res(k)));
export async function hashPassword(pw) { const salt = crypto.randomBytes(16); return 's1$' + b64u(salt) + '$' + b64u(await scrypt(pw, salt)); }
export async function verifyPassword(pw, stored) {
  const [v, salt, h] = String(stored || '').split('$');
  if (v !== 's1' || !salt || !h) return false;
  const got = await scrypt(pw, unb64u(salt));
  return crypto.timingSafeEqual(got, unb64u(h));
}

export function sealer(secret) {
  if (!secret || String(secret).length < 16) return null;
  const key = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(String(secret)), Buffer.from('homeroom-v1'), Buffer.from('saved-logins'), 32));
  return {
    seal(obj, aad = '') {
      const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
      c.setAAD(Buffer.from(aad));
      const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final(), c.getAuthTag()]);
      return 'v1.' + b64u(iv) + '.' + b64u(ct);
    },
    open(s, aad = '') {
      const [v, iv, ct] = String(s || '').split('.');
      if (v !== 'v1') return null;
      const buf = unb64u(ct), d = crypto.createDecipheriv('aes-256-gcm', key, unb64u(iv));
      d.setAAD(Buffer.from(aad)); d.setAuthTag(buf.subarray(buf.length - 16));
      return JSON.parse(Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString('utf8'));
    },
  };
}
