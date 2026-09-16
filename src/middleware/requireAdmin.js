// 관리자 판별: 별도 회원 유형을 만들지 않고, 지정된 이메일만 관리자 화면(신고 처리 등)에 접근하게 합니다.
// ADMIN_EMAILS 환경변수(콤마 구분)로 목록을 바꿀 수 있고, 없으면 운영자 계정 하나만 기본 관리자입니다.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '454145@hanmail.net')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function isAdminEmail(email) {
  return !!email && ADMIN_EMAILS.includes(String(email).toLowerCase());
}

function requireAdmin(req, res, next) {
  if (!isAdminEmail(req.user && req.user.email)) {
    return res.status(403).json({ error: '관리자만 이용할 수 있어요.' });
  }
  next();
}

module.exports = { requireAdmin, isAdminEmail };
