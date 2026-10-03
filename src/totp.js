// 관리자 2단계 인증용 TOTP (RFC 6238 — Google Authenticator 등 OTP 앱과 호환)
// 30초마다 바뀌는 6자리 코드. 외부 서비스 없이 서버에서 직접 계산합니다.
const crypto = require('crypto');
const { deriveKey } = require('./auth');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of String(str).replace(/[\s=]/g, '').toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

const generateSecret = () => base32Encode(crypto.randomBytes(20));

function hotp(secretB32, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(buf).digest();
  const off = h[h.length - 1] & 15;
  const num = (h.readUInt32BE(off) & 0x7fffffff) % 1e6;
  return String(num).padStart(6, '0');
}

// 코드가 맞으면 사용된 시간 구간(counter)을, 틀리면 null을 돌려줍니다.
// 앞뒤 30초까지 허용하고, 이미 쓴 구간(lastCounter 이하)의 코드는 재사용으로 보고 거부합니다.
function verifyTotp(secretB32, code, lastCounter = 0, now = Date.now()) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const cur = Math.floor(now / 1000 / STEP);
  for (const d of [0, -1, 1]) {
    const counter = cur + d;
    if (counter <= Number(lastCounter || 0)) continue;
    const expected = hotp(secretB32, counter);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return counter;
  }
  return null;
}

function otpauthUrl(secretB32, account, issuer = 'IT Free') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;
}

// DB에는 비밀값을 암호화(AES-256-GCM)해서 저장합니다.
const KEY = () => deriveKey('totp-secret');
function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}
function decryptSecret(stored) {
  const [v, iv, tag, enc] = String(stored || '').split(':');
  if (v !== 'v1') return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', KEY(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
  } catch (e) {
    return null;
  }
}

// 휴대폰을 잃어버렸을 때 쓰는 일회용 백업 코드 (8자리, 저장은 해시로)
const BACKUP_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateBackupCodes(n = 8) {
  return Array.from({ length: n }, () =>
    Array.from(crypto.randomBytes(8), (b) => BACKUP_CHARS[b % BACKUP_CHARS.length]).join(''));
}
const hashBackupCode = (code) =>
  crypto.createHmac('sha256', deriveKey('totp-backup')).update(String(code).replace(/[\s-]/g, '').toUpperCase()).digest('hex');

module.exports = {
  generateSecret, verifyTotp, otpauthUrl, encryptSecret, decryptSecret,
  generateBackupCodes, hashBackupCode, hotp, base32Encode, base32Decode,
};
