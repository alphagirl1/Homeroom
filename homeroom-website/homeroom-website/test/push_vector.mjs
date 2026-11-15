// Checks the push encryption against the worked example in RFC 8291 (Appendix A),
// and checks that a VAPID signature verifies with the public key.
import crypto from 'node:crypto';
import { encryptPush, vapidAuth, makeVapidKeys } from '../server/push.js';
import { b64u, unb64u } from '../server/crypto.js';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };

const sub = { keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' } };
const body = encryptPush('When I grow up, I want to be a watermelon', sub, { asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', salt: 'DGv6ra1nlYgDCS1FRnbzlw' });
const expected = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';
ok(b64u(body) === expected, 'push encryption matches RFC 8291 Appendix A');

// Decrypt it the way a browser would, as an independent check of the steps.
const uaPriv = 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94';
const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
const ua = crypto.createECDH('prime256v1'); ua.setPrivateKey(unb64u(uaPriv));
const secret = ua.computeSecret(asPub);
const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, unb64u(sub.keys.auth), Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32));
const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
ok(pt.subarray(0, pt.length - 1).toString() === 'When I grow up, I want to be a watermelon' && pt[pt.length - 1] === 2, 'a browser-side decryption reads the message back');

const keys = makeVapidKeys();
const auth = vapidAuth('https://fcm.googleapis.com/fcm/send/abc', keys, 'https://homeroom.example');
const [, jwt] = auth.match(/^vapid t=([^,]+), k=/);
const [h, p, s] = jwt.split('.');
const claims = JSON.parse(unb64u(p).toString());
const pub = unb64u(keys.publicKey);
const pubKey = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) } });
ok(crypto.verify('sha256', Buffer.from(h + '.' + p), { key: pubKey, dsaEncoding: 'ieee-p1363' }, unb64u(s)), 'VAPID signature verifies');
ok(claims.aud === 'https://fcm.googleapis.com' && claims.exp > Date.now() / 1000 && claims.sub === 'https://homeroom.example', 'VAPID claims: audience, expiry, contact');

console.log(bad ? `\n${bad} check(s) failed` : '\nPush checks passed.');
process.exit(bad ? 1 : 0);
