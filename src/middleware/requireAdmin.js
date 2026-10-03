// 관리자 판별: 별도 회원 유형을 만들지 않고, 지정된 이메일만 관리자 화면(신고 처리 등)에 접근하게 합니다.
// 관리자 이메일은 공개 저장소에 노출되지 않도록 코드에 적지 않고 ADMIN_EMAILS 환경변수(콤마 구분)로만 지정합니다.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
if (!ADMIN_EMAILS.length) console.warn('[IT Free] ADMIN_EMAILS 환경변수가 없어 관리자 계정이 지정되지 않았습니다.');

function isAdminEmail(email) {
  return !!email && ADMIN_EMAILS.includes(String(email).toLowerCase());
}

// 보안 로그: 관리자 권한이 없는 접근 시도와, 관리자가 실행한 변경 작업(조회 제외)을 남깁니다.
function requireAdmin(req, res, next) {
  const securityLog = require('../securityLog'); // db 초기화 순서와 엮이지 않도록 사용할 때 불러옵니다
  const email = req.user && req.user.email;
  const target = `${req.method} ${req.baseUrl}${req.path}`;
  if (!isAdminEmail(email)) {
    securityLog.logEvent('admin_denied', { email, userId: req.user && req.user.id, ip: securityLog.clientIp(req), detail: target });
    return res.status(403).json({ error: '관리자만 이용할 수 있어요.' });
  }
  // 관리자 기능은 2단계 인증을 통과한 세션에서만 쓸 수 있습니다.
  // (비상시 ADMIN_MFA_REQUIRED=false 환경변수로 잠시 끌 수 있음)
  if (process.env.ADMIN_MFA_REQUIRED !== 'false' && !req.user.mfa) {
    return res.status(403).json({ error: '관리자 기능은 2단계 인증 후 이용할 수 있어요.', code: 'MFA_REQUIRED' });
  }
  if (req.method !== 'GET') {
    res.on('finish', () => {
      if (res.statusCode < 400) {
        securityLog.logEvent('admin_action', { email, userId: req.user.id, ip: securityLog.clientIp(req), detail: target });
      }
    });
  }
  next();
}

module.exports = { requireAdmin, isAdminEmail };
