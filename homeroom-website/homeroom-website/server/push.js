// Web push notifications (the standard every browser uses), with no extra packages:
// VAPID sign-in (RFC 8292) and "aes128gcm" message encryption (RFC 8291 / RFC 8188).
import crypto from 'node:crypto';
import { b64u, unb64u } from './crypto.js';

export function makeVapidKeys() {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

export function vapidAuth(endpoint, keys, subject, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const unsigned = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' })) + '.' + b64u(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const pub = unb64u(keys.publicKey);
  const key = crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${b64u(sig)}, k=${keys.publicKey}`;
}

/** Encrypts one push message for one browser subscription. `fixed` is only for the RFC test vector. */
export function encryptPush(plaintext, sub, fixed = {}) {
  const uaPub = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const ecdh = crypto.createECDH('prime256v1');
  if (fixed.asPrivate) ecdh.setPrivateKey(unb64u(fixed.asPrivate)); else ecdh.generateKeys();
  const asPub = ecdh.getPublicKey(), secret = ecdh.computeSecret(uaPub);
  const salt = fixed.salt ? unb64u(fixed.salt) : crypto.randomBytes(16);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([c.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head, 0); head.writeUInt32BE(4096, 16); head.writeUInt8(asPub.length, 20);
  return Buffer.concat([head, asPub, ct]);
}

/** Sends {title, body, url, tag}. Returns {ok, gone} — gone means the browser unsubscribed, so forget it. */
export async function sendPush(sub, message, keys, subject, fetchImpl = fetch) {
  try {
    const body = encryptPush(JSON.stringify(message).slice(0, 3000), sub);
    const res = await fetchImpl(sub.endpoint, {
      method: 'POST', body,
      headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: message.urgent ? 'high' : 'normal', Authorization: vapidAuth(sub.endpoint, keys, subject) },
    });
    return { ok: res.status < 300, gone: res.status === 404 || res.status === 410, status: res.status };
  } catch (e) { return { ok: false, gone: false, error: String(e.message || e) }; }
}
