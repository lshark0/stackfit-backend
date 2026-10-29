const express = require('express');
const { run, get, all } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { wrapAllRoutes } = require('../middleware/asyncHandler');
const { PLANS, planById } = require('../plans');
const payments = require('../payments');

// 요금제 안내·결제(1개월 이용권). 결제 설정(payments.paymentEnabled)이 없으면 사전 신청(출시 알림)만 받습니다.
const router = express.Router();
wrapAllRoutes(router);

const sendPaymentError = (res, e) => {
  if (e instanceof payments.PaymentError) return res.status(e.status).json({ error: e.message });
  throw e;
};

// 내 회원 유형의 요금제 + 내가 사전 신청한 요금제 + 이용 중인 이용권
router.get('/', requireAuth, async (req, res) => {
  const rows = await all('SELECT plan_id FROM plan_interests WHERE user_id = ?', [req.user.id]);
  const launched = payments.paymentEnabled();
  const recent = await all("SELECT * FROM plan_orders WHERE user_id = ? AND status IN ('paid','cancelled') ORDER BY id DESC LIMIT 10", [req.user.id]);
  res.json({
    launched,
    payment: payments.publicConfig(),
    plans: PLANS.filter((p) => p.role === req.user.role).map((p) => ({ ...p, amount: payments.amountFor(p) })),
    myInterests: rows.map((r) => r.plan_id),
    active: payments.orderView(await payments.activeOrder(req.user.id)),
    orders: recent.map(payments.orderView),
  });
});

// 결제 주문 만들기: 금액은 서버가 정하고, 결제창에 넘길 값을 돌려줍니다.
router.post('/:planId/order', requireAuth, async (req, res) => {
  if (!payments.paymentEnabled()) return res.status(503).json({ error: '아직 결제를 받지 않아요. 사전 신청해 두시면 출시 때 알려드려요.' });
  const plan = planById(req.params.planId);
  if (!plan || plan.role !== req.user.role) return res.status(404).json({ error: '요금제를 찾을 수 없어요.' });
  const active = await payments.activeOrder(req.user.id);
  if (active) return res.status(409).json({ error: '이미 이용 중인 이용권이 있어요. 이용 기간이 끝난 뒤 다시 구매해주세요.' });

  const user = await get('SELECT email FROM users WHERE id = ?', [req.user.id]);
  const who = req.user.role === 'company'
    ? await get("SELECT COALESCE(NULLIF(contact_person, ''), name) AS name, COALESCE(NULLIF(phone, ''), company_phone) AS phone FROM companies WHERE user_id = ?", [req.user.id])
    : await get('SELECT name, phone FROM freelancer_profiles WHERE user_id = ?', [req.user.id]);
  const phone = String((who && who.phone) || '').replace(/[^0-9]/g, '');
  if (!who || !who.name || !/^0\d{8,10}$/.test(phone)) {
    return res.status(400).json({ error: '결제하려면 프로필에 이름과 휴대폰 번호를 먼저 입력해주세요.', code: 'NEED_CONTACT' });
  }

  const paymentId = payments.newPaymentId();
  const amount = payments.amountFor(plan);
  await run('INSERT INTO plan_orders (payment_id, user_id, plan_id, amount) VALUES (?,?,?,?)', [paymentId, req.user.id, plan.id, amount]);
  res.json({
    ...payments.publicConfig(),
    paymentId,
    orderName: `김프리 ${plan.name} 1개월 이용권`,
    totalAmount: amount,
    customer: { fullName: who.name, phoneNumber: phone, email: user.email },
  });
});

// 결제창이 닫힌 뒤(또는 모바일에서 돌아온 뒤) 결제 결과 확인
router.post('/orders/:paymentId/complete', requireAuth, async (req, res) => {
  const { paymentId } = req.params;
  if (!payments.isPaymentId(paymentId)) return res.status(400).json({ error: '결제 정보가 올바르지 않아요.' });
  const order = await get('SELECT * FROM plan_orders WHERE payment_id = ? AND user_id = ?', [paymentId, req.user.id]);
  if (!order) return res.status(404).json({ error: '주문을 찾을 수 없어요.' });
  try {
    const synced = await payments.syncOrder(order);
    if (synced.status !== 'paid') {
      const msg = synced.status === 'mismatch' ? '결제 금액이 주문과 달라 이용권을 켜지 못했어요. 고객센터로 문의해주세요.' : '결제가 완료되지 않았어요.';
      return res.status(400).json({ error: msg, order: payments.orderView(synced) });
    }
    res.json({ ok: true, order: payments.orderView(synced) });
  } catch (e) { sendPaymentError(res, e); }
});

// 포트원 웹훅: 본문은 믿지 않고 paymentId로 포트원 API를 다시 조회해 반영합니다(콘솔에서 환불한 경우 등).
router.post('/webhook', async (req, res) => {
  const paymentId = req.body && req.body.data && req.body.data.paymentId;
  if (payments.isPaymentId(paymentId) && payments.paymentEnabled()) {
    const order = await get('SELECT * FROM plan_orders WHERE payment_id = ?', [paymentId]);
    if (order) await payments.syncOrder(order).catch((e) => console.warn('[김프리] 웹훅 결제 반영 실패:', paymentId, e.message));
  }
  res.json({ ok: true });
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

// 관리자: 요금제별 사전 신청 수(가격·수요 검증용)와 결제 완료 건수
router.get('/admin/summary', requireAuth, requireAdmin, async (req, res) => {
  const rows = await all('SELECT plan_id, COUNT(*) AS n FROM plan_interests GROUP BY plan_id');
  const counts = Object.fromEntries(rows.map((r) => [r.plan_id, Number(r.n)]));
  const paidRows = await all("SELECT plan_id, COUNT(*) AS n FROM plan_orders WHERE status = 'paid' GROUP BY plan_id");
  const paid = Object.fromEntries(paidRows.map((r) => [r.plan_id, Number(r.n)]));
  res.json({ plans: PLANS.map((p) => ({ id: p.id, role: p.role, name: p.name, price: p.price, count: counts[p.id] || 0, paid: paid[p.id] || 0 })) });
});

module.exports = router;
