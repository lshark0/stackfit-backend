const { all } = require('./db');

// 운영 지표: 합계 숫자만 계산해 서버 로그에 한 줄로 남깁니다(이메일·이름·연락처는 담지 않음).
// 무료 플랜 서버는 잠들 수 있어 타이머 대신 "한국 시간 기준 그날 첫 헬스체크 때" 한 번 계산합니다.

const KST_OFFSET_MS = 9 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

// DB 종류에 따라 created_at이 Date(PostgreSQL) 또는 UTC 문자열(SQLite)로 오므로 같은 시각(ms)으로 맞춥니다.
function toMs(v) {
  if (v instanceof Date) return v.getTime();
  const s = String(v || '');
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
  return Number.isNaN(ms) ? null : ms;
}
function kstDay(ms) {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

// 목록에서 기준 구간(어제·최근 7일)에 든 행 수를 셉니다. 기준일 = 한국 시간 '오늘' 0시.
function countRows(rows, now) {
  const today = kstDay(now);
  const todayStart = Date.parse(today + 'T00:00:00+09:00');
  const out = { total: rows.length, yesterday: 0, last7: 0 };
  for (const r of rows) {
    const ms = toMs(r.created_at);
    if (ms === null) continue;
    if (ms >= todayStart - DAY_MS && ms < todayStart) out.yesterday++;
    if (ms >= todayStart - 7 * DAY_MS && ms < todayStart) out.last7++;
  }
  return out;
}

async function computeMetrics(now = Date.now()) {
  const day = kstDay(now);
  const users = await all('SELECT role, created_at, signup_source, signup_medium, signup_campaign, referred_by FROM users');
  const byRole = (role) => countRows(users.filter((u) => u.role === role), now);
  const jobs = await all('SELECT status, created_at FROM jobs');
  const applications = await all('SELECT created_at FROM applications');
  const proposals = await all('SELECT created_at FROM proposals');
  const projects = await all('SELECT created_at FROM projects');

  // 유입 경로별 가입 수(utm_source/utm_campaign, 친구 초대는 source='referral'로 기록됨). 경로 없는 가입은 'direct'.
  const sources = {};
  const campaigns = {};
  let invited = 0;
  for (const u of users) {
    const s = u.signup_source || 'direct';
    sources[s] = (sources[s] || 0) + 1;
    if (u.signup_campaign) campaigns[u.signup_campaign] = (campaigns[u.signup_campaign] || 0) + 1;
    if (u.referred_by) invited++;
  }

  return {
    date: day, // 한국 시간 기준 기록일. 어제·최근7일은 이 날짜 0시 이전 구간
    users: { company: byRole('company'), freelancer: byRole('freelancer') },
    signupSources: sources,
    signupCampaigns: campaigns,
    invitedSignups: invited,
    jobs: { ...countRows(jobs, now), open: jobs.filter((j) => j.status === 'open').length },
    applications: countRows(applications, now),
    proposals: countRows(proposals, now),
    projects: countRows(projects, now),
  };
}

let lastLoggedDay = null;
// 그날(한국 시간) 첫 호출 때만 지표를 로그로 남깁니다. 실패해도 헬스체크에는 영향을 주지 않습니다.
async function logDailyMetricsOnce(now = Date.now()) {
  const day = kstDay(now);
  if (lastLoggedDay === day) return false;
  lastLoggedDay = day; // 계산 중 중복 호출을 막으려고 먼저 표시
  try {
    const m = await computeMetrics(now);
    console.log('[김프리] 운영 지표 ' + JSON.stringify(m));
    return true;
  } catch (err) {
    lastLoggedDay = null; // 실패하면 다음 호출에서 다시 시도
    console.error('[김프리] 운영 지표 계산 실패:', err.message);
    return false;
  }
}

module.exports = { computeMetrics, logDailyMetricsOnce };
