const express = require('express');
const { all } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');
const { ensureReferralCode } = require('../attribution');

const router = express.Router();
wrapAllRoutes(router);

// 초대한 친구 이름은 개인정보라 가운데를 가립니다 (예: 이지영 → 이*영, 홍길 → 홍*)
function maskName(name) {
  const s = String(name || '').trim();
  if (!s) return '회원';
  if (s.length === 1) return s;
  if (s.length === 2) return s[0] + '*';
  return s[0] + '*'.repeat(s.length - 2) + s[s.length - 1];
}

// PC 전용 카카오톡 공유에 쓰는 JavaScript 키(공개용 키라 화면에 내려줘도 됨). 설정 전이면 null → 화면은 '복사해서 보내기'로 대체
router.get('/share-config', (req, res) => {
  res.json({ kakaoJsKey: process.env.KAKAO_JS_KEY || null });
});

// 내 초대 코드와 내가 초대해 가입한 친구 목록
router.get('/me', requireAuth, async (req, res) => {
  const code = await ensureReferralCode(req.user.id);
  const rows = await all(
    `SELECT u.role, u.created_at, f.name AS freelancer_name, c.name AS company_name
     FROM users u
     LEFT JOIN freelancer_profiles f ON f.user_id = u.id
     LEFT JOIN companies c ON c.user_id = u.id
     WHERE u.referred_by = ?
     ORDER BY u.created_at DESC, u.id DESC`,
    [req.user.id]
  );
  res.json({
    code,
    invited: rows.map((r) => ({
      role: r.role,
      name: maskName(r.role === 'company' ? r.company_name : r.freelancer_name),
      created_at: r.created_at,
    })),
  });
});

module.exports = router;
