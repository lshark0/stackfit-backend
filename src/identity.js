// 포트원(PortOne) V2 휴대폰 본인인증 연동
// - 프론트에서 포트원 인증창으로 본인인증을 마치면 identityVerificationId만 서버로 넘어옵니다.
// - 서버는 그 ID로 포트원 API를 직접 다시 조회해, 포트원이 확인해준 이름·생년월일·성별·휴대폰·CI/DI만 믿습니다.
//   (클라이언트가 보낸 이름/생일 값은 위조될 수 있으므로 절대 사용하지 않습니다.)
// - PORTONE_API_SECRET 환경변수가 없으면 본인인증 기능은 꺼진 상태(기존 직접 입력 방식)로 동작합니다.
const { signToken, verifyToken } = require('./auth');
const { normalizeMobile, normalizeBirthDate } = require('./contact');

const STORE_ID = process.env.PORTONE_STORE_ID || 'store-92737231-2460-48ed-85c9-16ee322b5b24';
const CHANNEL_KEY = process.env.PORTONE_CHANNEL_KEY || 'channel-key-2b1babd5-5a20-4372-b634-aebaeb79db1c';
const API_SECRET = (process.env.PORTONE_API_SECRET || '').trim();
const IV_TOKEN_TTL_SEC = 30 * 60; // 인증 후 30분 안에 가입을 마쳐야 함
const MIN_AGE = 14;

const identityEnabled = () => !!API_SECRET;
const publicConfig = () => ({ enabled: identityEnabled(), storeId: STORE_ID, channelKey: CHANNEL_KEY });

class IdentityError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function ageFrom(birthDate /* YYYY-MM-DD */) {
  const [y, m, d] = birthDate.split('-').map(Number);
  const now = new Date(Date.now() + 9 * 3600 * 1000); // 한국 시간 기준
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age -= 1;
  return age;
}

// 포트원에서 본인인증 결과를 조회하고, 가입에 쓸 값만 정리해서 돌려줍니다.
async function fetchVerifiedCustomer(identityVerificationId) {
  if (!identityEnabled()) throw new IdentityError(503, '본인인증 기능이 아직 설정되지 않았어요.');
  if (typeof identityVerificationId !== 'string' || !/^iv-[A-Za-z0-9-]{8,80}$/.test(identityVerificationId)) {
    throw new IdentityError(400, '본인인증 정보가 올바르지 않아요.');
  }
  const url = `https://api.portone.io/identity-verifications/${encodeURIComponent(identityVerificationId)}?storeId=${encodeURIComponent(STORE_ID)}`;
  let resp;
  try {
    resp = await fetch(url, { headers: { Authorization: `PortOne ${API_SECRET}` }, signal: AbortSignal.timeout(10000) });
  } catch (e) {
    throw new IdentityError(502, '본인인증 서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요.');
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.warn('[IT Free] 포트원 본인인증 조회 실패:', resp.status, data && (data.type || data.message));
    if (resp.status === 401 || resp.status === 403) throw new IdentityError(503, '본인인증 설정(API Secret)을 확인해주세요.');
    throw new IdentityError(400, '본인인증 내역을 찾을 수 없어요. 다시 인증해주세요.');
  }
  if (data.status !== 'VERIFIED' || !data.verifiedCustomer) {
    throw new IdentityError(400, '본인인증이 완료되지 않았어요. 다시 인증해주세요.');
  }
  const c = data.verifiedCustomer;
  const name = String(c.name || '').trim().slice(0, 60);
  const phone = normalizeMobile(c.phoneNumber);
  const birthDate = normalizeBirthDate(c.birthDate);
  const gender = c.gender === 'MALE' ? '남자' : c.gender === 'FEMALE' ? '여자' : '';
  if (!name || !phone || !birthDate) {
    throw new IdentityError(400, '본인인증 결과에 필요한 정보가 없어요. 다시 인증해주세요.');
  }
  if (ageFrom(birthDate) < MIN_AGE) {
    throw new IdentityError(403, `만 ${MIN_AGE}세 미만은 가입할 수 없어요.`);
  }
  return { ivId: identityVerificationId, name, phone, birthDate, gender, ci: c.ci || null, di: c.di || null };
}

const issueIvToken = (v) => signToken({ typ: 'iv', ...v }, IV_TOKEN_TTL_SEC);
function readIvToken(token) {
  const p = verifyToken(token);
  if (!p || p.typ !== 'iv' || !p.name || !p.phone) return null;
  return p;
}

// 이미 가입한 사람에게 어떤 이메일로 가입했는지 힌트만 보여줍니다. (예: ab***@gmail.com)
function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!domain) return '';
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(3, local.length - 2))}@${domain}`;
}

module.exports = { identityEnabled, publicConfig, fetchVerifiedCustomer, issueIvToken, readIvToken, maskEmail, IdentityError };
