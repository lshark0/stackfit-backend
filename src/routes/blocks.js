const express = require('express');
const { get } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');
const { listMyBlocks, addBlock, removeBlock } = require('../blocks');
const { isAdminEmail } = require('../middleware/requireAdmin');

// 상대 회원 차단(개선-018): 내 차단 목록 보기·차단·해제
const router = express.Router();
wrapAllRoutes(router);

router.get('/', requireAuth, async (req, res) => {
  res.json({ blocks: await listMyBlocks(req.user.id) });
});

router.post('/:userId', requireAuth, async (req, res) => {
  const target = Number(req.params.userId);
  if (!Number.isInteger(target)) return res.status(400).json({ error: '올바르지 않은 사용자 ID입니다.' });
  if (target === Number(req.user.id)) return res.status(400).json({ error: '나 자신은 차단할 수 없어요.' });
  const user = await get('SELECT id, email FROM users WHERE id = ?', [target]);
  // 관리자 계정은 운영 안내·문의 답변을 위해 차단 대상에서 뺍니다.
  if (!user || isAdminEmail(user.email)) return res.status(404).json({ error: '회원을 찾을 수 없습니다.' });
  await addBlock(req.user.id, target);
  res.json({ ok: true });
});

router.delete('/:userId', requireAuth, async (req, res) => {
  const target = Number(req.params.userId);
  if (!Number.isInteger(target)) return res.status(400).json({ error: '올바르지 않은 사용자 ID입니다.' });
  await removeBlock(req.user.id, target);
  res.json({ ok: true });
});

module.exports = router;
