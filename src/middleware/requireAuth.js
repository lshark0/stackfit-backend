const { verifySessionToken } = require('../auth');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token ? verifySessionToken(token) : null;
  if (!payload) return res.status(401).json({ error: '로그인이 필요합니다.' });
  // 비밀번호 변경 전에 발급된 토큰·탈퇴한 계정의 토큰은 거부합니다(src/tokenRevocation.js).
  // db 초기화 순서와 엮이지 않도록 사용할 때 불러옵니다.
  require('../tokenRevocation').isTokenActive(payload).then((ok) => {
    if (!ok) return res.status(401).json({ error: '로그인이 만료됐어요. 다시 로그인해 주세요.', code: 'TOKEN_REVOKED' });
    req.user = payload; // { id, role, email }
    next();
  }, next);
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) {
      return res.status(403).json({ error: `${role === 'company' ? '기업' : '프리랜서'} 계정만 이용할 수 있어요.` });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
