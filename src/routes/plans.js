const express = require('express');
const { run, get, all } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { wrapAllRoutes } = require('../middleware/asyncHandler');
const { PLANS, planById } = require('../plans');

// 요금제 안내와 사전 신청(출시 알림). 결제는 정식 출시 후에 붙입니다.
const router = express.Router();
wrapAllRoutes(router);

// 내 회원 유형의 요금제 + 내가 사전 신청한 요금제
router.get('/', requireAuth, async (req, res) => {
  const rows = await all('SELECT plan_id FROM plan_interests WHERE user_id = ?', [req.user.id]);
  res.json({
    launched: false,
    plans: PLANS.filter((p) => p.role === req.user.role),
    myInterests: rows.map((r) => r.plan_id),
  });
});

// 사전 신청 / 취소 (내 회원 유형의 요금제만)
router.post('/:planId/interest', requireAuth, async (req, res) => {
  const plan = planById(req.params.planId);
  if (!plan || plan.role !== req.user.role) return res.status(404).json({ error: '요금제를 찾을 수 없어요.' });
  if (!(await get('SELECT id FROM plan_interests WHERE user_id = ? AND plan_id = ?', [req.user.id, plan.id]))) {
    await run('INSERT INTO plan_interests (user_id, plan_id) VALUES (?, ?)', [req.user.id, plan.id]);
  }
  res.json({ ok: true });
});
router.delete('/:planId/interest', requireAuth, async (req, res) => {
  await run('DELETE FROM plan_interests WHERE user_id = ? AND plan_id = ?', [req.user.id, String(req.params.planId)]);
  res.json({ ok: true });
});

// 관리자: 요금제별 사전 신청 수(가격·수요 검증용)
router.get('/admin/summary', requireAuth, requireAdmin, async (req, res) => {
  const rows = await all('SELECT plan_id, COUNT(*) AS n FROM plan_interests GROUP BY plan_id');
  const counts = Object.fromEntries(rows.map((r) => [r.plan_id, Number(r.n)]));
  res.json({ plans: PLANS.map((p) => ({ id: p.id, role: p.role, name: p.name, price: p.price, count: counts[p.id] || 0 })) });
});

module.exports = router;
