const express = require('express');
const { get } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');
const { getReviewDetail } = require('../ratings');

// 회원이 받은 평가 요약(공개된 평가만): 프리랜서 프로필·공고(기업) 상세의 '평가' 칸에 씁니다.
const router = express.Router();
wrapAllRoutes(router);

router.get('/:userId/summary', requireAuth, async (req, res) => {
  const id = Number(req.params.userId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '올바르지 않은 회원이에요.' });
  const u = await get('SELECT id, role FROM users WHERE id = ?', [id]);
  if (!u) return res.status(404).json({ error: '회원을 찾을 수 없어요.' });
  res.json({ role: u.role, ...(await getReviewDetail(id, u.role)) });
});

module.exports = router;
