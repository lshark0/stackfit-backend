// 연락처(휴대폰·전화·이메일) 입력값 검증과 공개 범위 처리를 한곳에서 담당합니다.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 휴대폰 번호: 숫자만 추려 010-1234-5678 형태로 맞춥니다. 형식이 틀리면 null.
function normalizeMobile(v) {
  const digits = String(v || '').replace(/\D/g, '');
  if (!/^01[016789]\d{7,8}$/.test(digits)) return null;
  return digits.length === 11
    ? `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
    : `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// 일반 전화(회사 대표번호 등): 02-123-4567, 031-123-4567, 1588-1234 등을 허용합니다.
function normalizePhone(v) {
  const raw = String(v || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 12) return null;
  if (!/^[\d\s\-()+]+$/.test(raw)) return null;
  // 사용자가 하이픈을 넣었다면 그대로 존중하고, 숫자만 입력했다면 흔한 형태로 맞춰줍니다.
  if (raw.includes('-')) return raw.replace(/\s+/g, '');
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  if (digits.startsWith('02')) {
    return digits.length === 9
      ? `02-${digits.slice(2, 5)}-${digits.slice(5)}`
      : `02-${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return digits.length === 10
    ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
    : `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function normalizeEmail(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return '';
  return EMAIL_RE.test(s) && s.length <= 120 ? s : null;
}

// 기업에게 프리랜서 정보를 보여줄 때 사용합니다.
// 연락처(휴대폰·이메일)는 여기서는 절대 내려주지 않습니다 — 프리랜서가 그 기업의
// 제안을 실제로 수락하기 전에는 인재풀 탐색만으로 연락처를 알 수 없어야 하기 때문입니다.
// 필요한 곳(수락된 제안 목록 등)에서는 contactFields()로 별도 계산해 덧붙입니다.
// 파일 원본(resume_data) 같은 무거운/민감한 값도 응답에서 제외합니다.
function publicTalent(t) {
  if (!t) return t;
  // eslint-disable-next-line no-unused-vars
  const { phone, email, resume_data, share_phone, share_email, ...rest } = t;
  const accepting = Number(t.accept_proposals ?? 1) === 1;
  return {
    ...rest,
    accept_proposals: accepting ? 1 : 0,
    contact_phone: null,
    contact_email: null,
  };
}

// 프리랜서가 이 기업의 제안을 수락한 경우에만 실제 연락처를 계산해 돌려줍니다.
// accepted가 false면 프리랜서의 공개 설정과 무관하게 항상 null입니다.
function contactFields(t, accepted) {
  if (!t || !accepted) return { contact_phone: null, contact_email: null };
  const accepting = Number(t.accept_proposals ?? 1) === 1;
  return {
    contact_phone: accepting && Number(t.share_phone) === 1 && t.phone ? t.phone : null,
    contact_email: accepting && Number(t.share_email) === 1 && t.email ? t.email : null,
  };
}

module.exports = { normalizeMobile, normalizePhone, normalizeEmail, publicTalent, contactFields, EMAIL_RE };
