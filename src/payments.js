// 요금제 결제 (포트원 V2 + KG이니시스 일반결제)
// - 결제창은 프론트에서 열고, 서버는 주문(금액)을 먼저 만들어 두었다가 포트원 API로 결제 내역을 다시 조회해
//   상태가 PAID이고 금액이 주문과 같을 때만 이용권을 켭니다(화면에서 금액을 바꿔도 이용권이 켜지지 않음).
// - PORTONE_PAYMENT_CHANNEL_KEY(결제 채널)와 PORTONE_API_SECRET이 모두 있어야 결제가 켜집니다.
//   없으면 요금제 화면은 기존처럼 '사전 신청'만 받습니다.
// - 이용권은 1개월 단위이며 자동 연장(정기결제)은 없습니다. 환불·취소 규정은 public/refund.html.
const crypto = require('crypto');
const { get, run } = require('./db');

const STORE_ID = process.env.PORTONE_STORE_ID || 'store-92737231-2460-48ed-85c9-16ee322b5b24';
const CHANNEL_KEY = (process.env.PORTONE_PAYMENT_CHANNEL_KEY || '').trim();
const API_SECRET = (process.env.PORTONE_API_SECRET || '').trim();

const paymentEnabled = () => !!(CHANNEL_KEY && API_SECRET);
const publicConfig = () => (paymentEnabled() ? { storeId: STORE_ID, channelKey: CHANNEL_KEY } : null);

class PaymentError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// 실제 결제 금액: 기업 요금은 부가세 별도로 안내하므로 10%를 더하고, 프리랜서 프리미엄은 부가세 포함 가격 그대로입니다.
const amountFor = (plan) => (plan.vatIncluded ? plan.price : Math.round(plan.price * 1.1));

const toDbTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const nowStr = () => toDbTime(Date.now());
// 결제 시각부터 1개월 뒤(같은 날짜, 다음 달에 그 날짜가 없으면 말일)
function plusOneMonth(ms) {
  const d = new Date(ms);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + 1);
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d.getTime();
}

const newPaymentId = () => 'pay-' + crypto.randomUUID();
const isPaymentId = (v) => typeof v === 'string' && /^pay-[A-Za-z0-9-]{8,80}$/.test(v);

async function fetchPayment(paymentId) {
  const url = `https://api.portone.io/payments/${encodeURIComponent(paymentId)}?storeId=${encodeURIComponent(STORE_ID)}`;
  let resp;
  try {
    resp = await fetch(url, { headers: { Authorization: `PortOne ${API_SECRET}` }, signal: AbortSignal.timeout(10000) });
  } catch (e) {
    throw new PaymentError(502, '결제 서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요.');
  }
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 404) return null; // 결제창을 열기만 하고 진행하지 않은 주문
  if (!resp.ok) {
    console.warn('[김프리] 포트원 결제 조회 실패:', resp.status, data && (data.type || data.message));
    throw new PaymentError(502, '결제 내역을 확인하지 못했어요. 잠시 후 다시 시도해주세요.');
  }
  return data;
}

// 포트원의 결제 상태를 주문에 반영합니다. 결제 완료 확인, 웹훅, 관리자 콘솔에서의 취소가 모두 이 함수를 거칩니다.
async function syncOrder(order) {
  if (!paymentEnabled()) throw new PaymentError(503, '결제 기능이 아직 설정되지 않았어요.');
  const p = await fetchPayment(order.payment_id);
  if (!p) return order;
  const total = p.amount && Number(p.amount.total);
  if (p.status === 'PAID') {
    if (total !== order.amount || p.currency !== 'KRW') {
      console.warn('[김프리] 결제 금액 불일치:', order.payment_id, total, order.amount);
      await run("UPDATE plan_orders SET status = 'mismatch' WHERE id = ? AND status = 'ready'", [order.id]);
    } else if (order.status === 'ready') {
      const paidMs = Date.parse(p.paidAt) || Date.now();
      await run("UPDATE plan_orders SET status = 'paid', paid_at = ?, starts_at = ?, ends_at = ? WHERE id = ? AND status = 'ready'",
        [toDbTime(paidMs), toDbTime(paidMs), toDbTime(plusOneMonth(paidMs)), order.id]);
    }
  } else if (p.status === 'CANCELLED' || p.status === 'PARTIAL_CANCELLED') {
    // 환불(전액·일부)하면 이용권은 그 시점에 끝납니다.
    const cancelled = Number((p.amount && p.amount.cancelled) || 0);
    await run("UPDATE plan_orders SET status = 'cancelled', cancelled_amount = ?, cancelled_at = COALESCE(cancelled_at, ?), ends_at = CASE WHEN ends_at IS NULL OR ends_at > ? THEN ? ELSE ends_at END WHERE id = ?",
      [cancelled, nowStr(), nowStr(), nowStr(), order.id]);
  } else if (p.status === 'FAILED' && order.status === 'ready') {
    await run("UPDATE plan_orders SET status = 'failed' WHERE id = ?", [order.id]);
  }
  return get('SELECT * FROM plan_orders WHERE id = ?', [order.id]);
}

// 지금 이용 중인 이용권(결제 완료이고 기간이 남은 것)
const activeOrder = (userId) => get(
  "SELECT * FROM plan_orders WHERE user_id = ? AND status = 'paid' AND ends_at > ? ORDER BY ends_at DESC LIMIT 1",
  [userId, nowStr()],
);

const orderView = (o) => o && ({
  paymentId: o.payment_id, planId: o.plan_id, amount: o.amount, status: o.status,
  paidAt: o.paid_at, startsAt: o.starts_at, endsAt: o.ends_at, cancelledAmount: o.cancelled_amount || 0,
});

module.exports = {
  paymentEnabled, publicConfig, amountFor, newPaymentId, isPaymentId, syncOrder, activeOrder, orderView, nowStr, PaymentError,
};
