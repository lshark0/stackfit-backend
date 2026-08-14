const { verifyToken } = require('../auth');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: '로그인이 필요합니다.' });
  req.user = payload; // { id, role, email }
  next();
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
