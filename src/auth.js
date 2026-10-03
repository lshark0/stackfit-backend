const crypto = require('crypto');

const DEFAULT_SECRET = 'stackfit-dev-secret-change-me';
const SECRET = process.env.JWT_SECRET || DEFAULT_SECRET;

// 운영 서버(Render)에서 비밀키가 없으면 누구나 토큰을 위조할 수 있으므로 아예 시작하지 않습니다.
if (SECRET === DEFAULT_SECRET && (process.env.RENDER || process.env.NODE_ENV === 'production')) {
  throw new Error('[IT Free] JWT_SECRET 환경변수가 없어 서버를 시작하지 않습니다.');
}
if (SECRET === DEFAULT_SECRET) {
  console.warn(
    '[IT Free] 경고: JWT_SECRET 환경변수가 설정되지 않아 기본값을 사용 중입니다. ' +
    '운영 배포 시 반드시 무작위 값으로 설정하세요 (토큰이 위조될 수 있습니다).'
  );
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(check);
  const b = Buffer.from(hash);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlDecode(input) {
  input = input.replace(/-/g, '+').replace(/_/g, '/');
  while (input.length % 4) input += '=';
  return Buffer.from(input, 'base64').toString('utf8');
}

// 경량 JWT 유사 토큰: header.payload.signature (HMAC-SHA256)
// 서명 비교는 타이밍 공격 방지를 위해 timingSafeEqual을 사용합니다.
function signToken(payload, expiresInSec = 60 * 60 * 24 * 7) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + expiresInSec };
  const h = base64url(JSON.stringify(header));
  const p = base64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

function verifyToken(token) {
  const parts = (token || '').split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;

  let expected;
  try {
    expected = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  } catch (e) {
    return null;
  }

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(base64urlDecode(p));
  } catch (e) {
    return null;
  }
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
  return payload;
}

// 로그인 세션 토큰만 통과시킵니다. 파일 열람·소셜 가입 대기·본인인증·2단계 인증 대기 같은
// 다른 용도로 발급한 토큰은 같은 비밀키로 서명돼 있어도 로그인 세션으로 쓸 수 없습니다.
function verifySessionToken(token) {
  const p = verifyToken(token);
  if (!p || p.purpose || p.typ || p.pending) return null;
  if (!Number.isInteger(p.id) || !['freelancer', 'company'].includes(p.role)) return null;
  return p;
}

// 용도별 암호화 키 (예: 2단계 인증 비밀값 암호화). 서명 비밀키에서 파생하므로 별도 환경변수가 필요 없습니다.
function deriveKey(label) {
  return crypto.createHash('sha256').update(`${label}:${SECRET}`).digest();
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, verifySessionToken, deriveKey };
