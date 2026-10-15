const { all, get } = require('./db');
const { pairScore } = require('./recommend');
const { CATEGORIES, matchesCategory } = require('./stackCatalog');

// 관리자 성과 지표: '기능이 있다'가 아니라 '실제로 거래가 이뤄지는지'를 숫자로 보여줍니다.
//  - 매칭 퍼널: 공고 → 지원·제안 → 인터뷰 → 매칭(합격·수락) → 계약 체결 → 완료
//  - 소요 시간: 공고 등록 → 첫 반응, 첫 접촉(지원·제안) → 계약 체결
//  - 추천 점수 구간별 성사율: 추천 점수가 높을수록 실제로 매칭·계약이 잘 되는지(매칭 정확도 근거)
//  - 재이용률: 두 번 이상 계약한 기업·프리랜서 비율
//  - 분야별 성과: 어느 기술 분야에서 계약이 나오는지(집중할 분야 찾기)
//  - 신뢰·직접 거래 방지: 경력 검증 현황, 매칭 전 연락처 공유 시도
// 데이터 양이 크지 않아 DB(SQLite·PostgreSQL) 차이를 피하려고 행을 읽어 와 서버에서 계산합니다.

const ROW_LIMIT = 50000;
const DAY = 86400000;

// DB 시각 값(PostgreSQL Date 객체 / SQLite·직접 저장한 'YYYY-MM-DD HH:MM:SS' UTC 문자열) → ms
function toMs(v) {
  if (!v) return null;
  if (v instanceof Date) return v.getTime();
  const s = String(v);
  const t = Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return Number.isNaN(t) ? null : t;
}
function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
// 소요 시간 요약: 중간값·평균(일), 표본 수
function durationSummary(msList) {
  const days = msList.filter((ms) => Number.isFinite(ms) && ms >= 0).map((ms) => ms / DAY);
  if (!days.length) return { n: 0, medianDays: null, avgDays: null };
  const avg = days.reduce((s, d) => s + d, 0) / days.length;
  return { n: days.length, medianDays: Math.round(median(days) * 10) / 10, avgDays: Math.round(avg * 10) / 10 };
}
const pct = (num, den) => (den ? Math.round((num / den) * 1000) / 10 : null);

const BANDS = [
  { key: '90-100', min: 90, max: 100 },
  { key: '70-89', min: 70, max: 89 },
  { key: '50-69', min: 50, max: 69 },
  { key: '0-49', min: 0, max: 49 },
];

async function computePerformance(days) {
  const now = Date.now();
  const since = days >= 3650 ? 0 : now - days * DAY;
  const inWin = (v) => { const t = toMs(v); return t !== null && t >= since; };

  const [jobs, apps, props, projects, interviews, profiles, masked, cvPending] = await Promise.all([
    all(`SELECT id, company_id, category, stack_json, duty, grade, status, created_at FROM jobs ORDER BY id DESC LIMIT ${ROW_LIMIT}`),
    all(`SELECT id, job_id, freelancer_id, status, created_at, match_score FROM applications ORDER BY id DESC LIMIT ${ROW_LIMIT}`),
    all(`SELECT id, company_id, freelancer_id, job_id, status, created_at, responded_at, match_score FROM proposals ORDER BY id DESC LIMIT ${ROW_LIMIT}`),
    all(`SELECT id, job_id, company_id, freelancer_id, status, contracted_at, completed_at, created_at FROM projects ORDER BY id DESC LIMIT ${ROW_LIMIT}`),
    all(`SELECT i.status, i.created_at, c.company_id, c.freelancer_id FROM interviews i JOIN conversations c ON c.id = i.conversation_id ORDER BY i.id DESC LIMIT ${ROW_LIMIT}`),
    all('SELECT user_id, stack_json, role_title, grade, verified FROM freelancer_profiles'),
    all(`SELECT conversation_id, created_at FROM messages WHERE meta_json LIKE ? ORDER BY id DESC LIMIT ${ROW_LIMIT}`, ['%contactMasked%']),
    get("SELECT COUNT(*) AS c FROM career_verifications WHERE status IN ('pending','needs_review')"),
  ]);
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const profileById = new Map(profiles.map((p) => [p.user_id, p]));

  // ----- 매칭 퍼널 (기간 안에 시작된 건) -----
  const appsW = apps.filter((a) => inWin(a.created_at));
  const propsW = props.filter((p) => inWin(p.created_at));
  const projectsCreatedW = projects.filter((p) => inWin(p.created_at));
  const contractedW = projects.filter((p) => p.contracted_at && inWin(p.contracted_at));
  const funnel = {
    jobs: jobs.filter((j) => inWin(j.created_at)).length,
    applications: appsW.length,
    proposals: propsW.length,
    interviews: interviews.filter((i) => inWin(i.created_at)).length,
    matched: appsW.filter((a) => a.status === 'accepted').length + propsW.filter((p) => p.status === 'accepted').length,
    contracted: contractedW.length,
    completed: projects.filter((p) => p.completed_at && inWin(p.completed_at)).length,
  };
  const rates = {
    applicationAccept: pct(appsW.filter((a) => a.status === 'accepted').length, appsW.length),
    proposalAccept: pct(propsW.filter((p) => p.status === 'accepted').length, propsW.length),
    proposalResponded: pct(propsW.filter((p) => p.status !== 'sent').length, propsW.length),
    matchToContract: pct(projectsCreatedW.filter((p) => p.contracted_at).length, projectsCreatedW.length),
    contactToContract: pct(funnel.contracted, appsW.length + propsW.length),
  };

  // ----- 소요 시간 -----
  // 공고 등록 → 첫 반응(지원 또는 제안)
  const firstTouchByJob = new Map();
  for (const x of [...apps, ...props]) {
    if (!x.job_id) continue;
    const t = toMs(x.created_at);
    if (t !== null && (!firstTouchByJob.has(x.job_id) || t < firstTouchByJob.get(x.job_id))) firstTouchByJob.set(x.job_id, t);
  }
  const jobToFirstTouch = jobs.filter((j) => inWin(j.created_at) && firstTouchByJob.has(j.id))
    .map((j) => firstTouchByJob.get(j.id) - toMs(j.created_at));
  // 첫 접촉(같은 기업·프리랜서 사이의 첫 지원 또는 제안) → 계약 체결
  const firstContactByPair = new Map();
  for (const a of apps) {
    const j = jobById.get(a.job_id);
    if (!j) continue;
    const k = `${j.company_id}:${a.freelancer_id}`, t = toMs(a.created_at);
    if (t !== null && (!firstContactByPair.has(k) || t < firstContactByPair.get(k))) firstContactByPair.set(k, t);
  }
  for (const p of props) {
    const k = `${p.company_id}:${p.freelancer_id}`, t = toMs(p.created_at);
    if (t !== null && (!firstContactByPair.has(k) || t < firstContactByPair.get(k))) firstContactByPair.set(k, t);
  }
  const contactToContract = contractedW
    .map((p) => { const f = firstContactByPair.get(`${p.company_id}:${p.freelancer_id}`); return f === undefined ? null : toMs(p.contracted_at) - f; })
    .filter((v) => v !== null);
  const proposalResponse = props.filter((p) => p.responded_at && inWin(p.responded_at))
    .map((p) => toMs(p.responded_at) - toMs(p.created_at));
  const durations = {
    jobToFirstResponse: durationSummary(jobToFirstTouch),
    contactToContract: durationSummary(contactToContract),
    proposalResponse: durationSummary(proposalResponse),
  };

  // ----- 추천 점수 구간별 성사율 -----
  const contractedPairs = new Set(projects.filter((p) => p.contracted_at).map((p) => `${p.company_id}:${p.freelancer_id}`));
  const bands = BANDS.map((b) => ({ ...b, n: 0, matched: 0, contracted: 0, estimated: 0 }));
  const addToBand = (score, estimated, matched, contracted) => {
    if (score === null || score === undefined) return;
    const b = bands.find((x) => score >= x.min && score <= x.max);
    if (!b) return;
    b.n++; if (estimated) b.estimated++; if (matched) b.matched++; if (contracted) b.contracted++;
  };
  for (const a of appsW) {
    const j = jobById.get(a.job_id);
    if (!j) continue;
    const stored = a.match_score !== null && a.match_score !== undefined;
    const score = stored ? Number(a.match_score) : pairScore(j, profileById.get(a.freelancer_id));
    addToBand(score, !stored, a.status === 'accepted', contractedPairs.has(`${j.company_id}:${a.freelancer_id}`));
  }
  for (const p of propsW) {
    const j = p.job_id ? jobById.get(p.job_id) : null;
    const stored = p.match_score !== null && p.match_score !== undefined;
    const score = stored ? Number(p.match_score) : (j ? pairScore(j, profileById.get(p.freelancer_id)) : null);
    addToBand(score, !stored, p.status === 'accepted', contractedPairs.has(`${p.company_id}:${p.freelancer_id}`));
  }
  const scoreBands = bands.map((b) => ({
    key: b.key, n: b.n, estimated: b.estimated,
    matchRate: pct(b.matched, b.n), contractRate: pct(b.contracted, b.n),
  }));

  // ----- 재이용률 (전체 기간) -----
  const contractsBy = (col) => {
    const m = new Map();
    for (const p of projects) if (p.contracted_at) m.set(p[col], (m.get(p[col]) || 0) + 1);
    return m;
  };
  const byCompany = contractsBy('company_id');
  const byFreelancer = contractsBy('freelancer_id');
  const repeat = (m) => { const total = m.size; const again = [...m.values()].filter((c) => c >= 2).length; return { total, repeat: again, rate: pct(again, total) }; };
  const reuse = { companies: repeat(byCompany), freelancers: repeat(byFreelancer) };

  // ----- 분야별 성과 (기간) -----
  const catOf = (jobId) => (jobById.get(jobId) || {}).category || '미분류';
  const cats = new Map();
  const cat = (name) => { if (!cats.has(name)) cats.set(name, { category: name, jobs: 0, contacts: 0, matched: 0, contracted: 0 }); return cats.get(name); };
  for (const j of jobs) if (inWin(j.created_at)) cat(j.category || '미분류').jobs++;
  for (const a of appsW) { const c = cat(catOf(a.job_id)); c.contacts++; if (a.status === 'accepted') c.matched++; }
  for (const p of propsW) { const c = cat(p.job_id ? catOf(p.job_id) : '공고 없는 제안'); c.contacts++; if (p.status === 'accepted') c.matched++; }
  for (const p of contractedW) cat(p.job_id ? catOf(p.job_id) : '공고 없는 제안').contracted++;
  // 양면 균형: 분야별 모집 중 공고 수와 그 분야 기술을 가진 프리랜서 수를 함께 봐서, 어느 쪽을 먼저 모을지 정합니다.
  //  - 모집 중 공고가 없는데 인재가 있으면 '기업'을, 공고 1건당 인재가 5명 미만이면 '프리랜서'를 먼저 모읍니다.
  const parseStack = (v) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  const profileStacks = profiles.map((p) => parseStack(p.stack_json)).filter((st) => st.length);
  for (const name of CATEGORIES) cat(name);
  const balanceOf = (c) => {
    const openJobs = jobs.filter((j) => j.status === 'open' && (j.category || '미분류') === c.category).length;
    const talents = CATEGORIES.includes(c.category) ? profileStacks.filter((st) => matchesCategory(st, c.category)).length : null;
    const recruit = talents === null ? '' : openJobs === 0 ? (talents > 0 ? '기업' : '양쪽') : talents < openJobs * 5 ? '프리랜서' : '';
    return { openJobs, talents, recruit };
  };
  const byCategory = [...cats.values()]
    .map((c) => ({ ...c, ...balanceOf(c), contractRate: pct(c.contracted, c.contacts) }))
    .filter((c) => c.jobs || c.contacts || c.contracted || c.openJobs || c.talents)
    .sort((a, b) => b.contracted - a.contracted || b.contacts - a.contacts || b.jobs - a.jobs || (b.talents || 0) - (a.talents || 0));

  // ----- 신뢰·직접 거래 방지 -----
  const maskedW = masked.filter((m) => inWin(m.created_at));
  const trust = {
    verifiedFreelancers: profiles.filter((p) => Number(p.verified) === 1).length,
    totalFreelancers: profiles.length,
    verificationPending: Number((cvPending && cvPending.c) || 0),
    maskedMessages: maskedW.length,
    maskedConversations: new Set(maskedW.map((m) => m.conversation_id)).size,
  };

  return { days, funnel, rates, durations, scoreBands, reuse, byCategory, trust };
}

module.exports = { computePerformance };
