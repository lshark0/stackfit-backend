// 보안 로그와 계정별 로그인 잠금
// - 로그인 성공·실패·잠금, 관리자 작업을 security_events에 남깁니다 (6개월 보관).
// - 같은 이메일로 15분 안에 5번 틀리면 15분 동안 그 이메일의 로그인을 막습니다.
//   IP별 제한(server.js)만으로는 여러 IP에서 나눠 시도하는 대입 공격을 막기 어렵기 때문입니다.
//   존재하지 않는 이메일도 똑같이 잠가서, 잠금 여부로 가입 여부를 알 수 없게 합니다.
const { run, get, all } = require('./db');

const LOCK_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const RETENTION_MS = 180 * 24 * 3600 * 1000;

const clean = (v, max) => String(v == null ? '' : v).slice(0, max);

async function logEvent(event, { email = '', userId = null, ip = '', detail = '' } = {}) {
  try {
    await run(
      'INSERT INTO security_events (event, email, user_id, ip, detail, ts) VALUES (?,?,?,?,?,?)',
      [clean(event, 40), clean(email, 200).toLowerCase(), userId, clean(ip, 64), clean(detail, 300), Date.now()]
    );
  } catch (e) {
    console.warn('[보안로그] 기록 실패:', e.message);
  }
}

// 최근 15분(마지막 로그인 성공 이후) 실패 횟수
async function recentFailures(email) {
  const since = Date.now() - LOCK_WINDOW_MS;
  const lastOk = await get(
    "SELECT MAX(ts) AS ts FROM security_events WHERE email = ? AND event = 'login_success'",
    [email]
  );
  const from = Math.max(since, Number(lastOk && lastOk.ts) || 0);
  const row = await get(
    "SELECT COUNT(*) AS n FROM security_events WHERE email = ? AND event = 'login_failed' AND ts > ?",
    [email, from]
  );
  return Number(row ? row.n : 0);
}

async function isLoginLocked(email) {
  if (!email) return false;
  return (await recentFailures(email)) >= MAX_FAILURES;
}

// 실패를 기록하고, 이번 실패로 잠기게 되면 잠금 이벤트도 남깁니다.
async function recordLoginFailure(email, ip, userId = null) {
  await logEvent('login_failed', { email, ip, userId });
  if ((await recentFailures(email)) === MAX_FAILURES) {
    await logEvent('login_locked', { email, ip, userId, detail: `${MAX_FAILURES}회 실패로 15분 잠금` });
  }
}

async function purgeOldSecurityEvents() {
  await run('DELETE FROM security_events WHERE ts < ?', [Date.now() - RETENTION_MS]);
}

async function listSecurityEvents(limit = 200) {
  const rows = await all('SELECT * FROM security_events ORDER BY ts DESC LIMIT ?', [Math.min(500, Math.max(1, limit))]);
  return rows.map((r) => ({ ...r, ts: Number(r.ts) }));
}

const clientIp = (req) => String(req.ip || '').replace(/^::ffff:/, '');

module.exports = {
  logEvent, isLoginLocked, recordLoginFailure, purgeOldSecurityEvents, listSecurityEvents, clientIp,
  MAX_FAILURES, LOCK_WINDOW_MS,
};
