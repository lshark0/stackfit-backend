const { get, run } = require('./db');

// 무료 회원(기업)의 월간 제안 횟수 제한.
// 한도는 관리자 화면에서 정하고 app_settings에 저장합니다. 0이면 제한 없음(기본값).
// 보낸 횟수는 proposal_sends에 따로 기록해, 제안을 취소하고 다시 보내도 횟수가 되돌아가지 않게 합니다.
const KEY = 'free_proposal_monthly_limit';
const MAX_LIMIT = 1000;

const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

// 한국시간 기준 이번 달 1일 0시(UTC 문자열)와 다음 달 1일 0시
function kstMonthRange(now = Date.now()) {
  const k = new Date(now + 9 * 3600 * 1000);
  const start = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 1) - 9 * 3600 * 1000;
  const next = Date.UTC(k.getUTCFullYear(), k.getUTCMonth() + 1, 1) - 9 * 3600 * 1000;
  const fmt = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  return { start: fmt(start), next: fmt(next), nextKstDate: new Date(next + 9 * 3600 * 1000).toISOString().slice(0, 10) };
}

async function getLimit() {
  const row = await get('SELECT value FROM app_settings WHERE key = ?', [KEY]);
  const n = row ? Number(row.value) : 0;
  return Number.isInteger(n) && n > 0 ? n : 0;
}

async function setLimit(n) {
  const v = String(n);
  if (await get('SELECT key FROM app_settings WHERE key = ?', [KEY])) {
    await run('UPDATE app_settings SET value = ? WHERE key = ?', [v, KEY]);
  } else {
    await run('INSERT INTO app_settings (key, value) VALUES (?,?)', [KEY, v]);
  }
}

async function usedThisMonth(companyId) {
  const { start } = kstMonthRange();
  const row = await get('SELECT COUNT(*) AS c FROM proposal_sends WHERE company_id = ? AND created_at >= ?', [companyId, start]);
  return Number((row && row.c) || 0);
}

// { limit: 0이면 무제한, used, remaining(무제한이면 null), resetsOn: 'YYYY-MM-DD' (한국 날짜) }
async function quotaFor(companyId) {
  const limit = await getLimit();
  const used = await usedThisMonth(companyId);
  return { limit, used, remaining: limit ? Math.max(0, limit - used) : null, resetsOn: kstMonthRange().nextKstDate };
}

async function recordSend(companyId, freelancerId) {
  await run('INSERT INTO proposal_sends (company_id, freelancer_id, created_at) VALUES (?,?,?)', [companyId, freelancerId, nowStr()]);
}

module.exports = { getLimit, setLimit, quotaFor, recordSend, kstMonthRange, MAX_LIMIT };
