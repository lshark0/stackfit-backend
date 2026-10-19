const { all, get } = require('./db');
const { pairScore } = require('./recommend');
const { CATEGORIES, matchesCategory } = require('./stackCatalog');
const { CONTACT_SOURCES, SOURCE_LABEL } = require('./contactSource');

// 관리자 성과 지표: '기능이 있다'가 아니라 '실제로 거래가 이뤄지는지'를 숫자로 보여줍니다.
//  - 매칭 퍼널: 공고 → 지원·제안 → 인터뷰 → 매칭(합격·수락) → 계약 체결 → 완료
//  - 소요 시간: 공고 등록 → 첫 반응, 첫 접촉(지원·제안) → 계약 체결
//  - 추천 점수 구간별 성사율: 추천 점수가 높을수록 실제로 매칭·계약이 잘 되는지(매칭 정확도 근거)
//  - 재이용률: 두 번 이상 계약한 기업·프리랜서 비율
//  - 분야별 성과: 어느 기술 분야에서 계약이 나오는지(집중할 분야 찾기)
//  - 신뢰·안전 거래: 경력 검증 현황, 매칭 전 연락처 공유(사기 주의 안내)
//  - 기존 방식과 비교: 계약 후 설문의 '기존 방식으로 걸리던 기간'과 같은 계약의 실제 소요 기간, 재이용 의향(NPS),
//    기존 대비 조건 적합도(매칭 정확도), 계약 1건까지 접촉한 수(성사율)
//  - 출처별 성과: 추천 목록·검색·알림 중 어디서 시작된 지원·제안이 더 빨리·많이 계약되는지('추천부터 계약까지')
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

  const [jobs, apps, props, projects, interviews, profiles, masked, cvPending, surveys] = await Promise.all([
    all(`SELECT id, company_id, category, stack_json, duty, grade, status, created_at FROM jobs ORDER BY id DESC LIMIT ${ROW_LIMIT}`),
    all(`SELECT id, job_id, freelancer_id, status, created_at, match_score, source FROM applications ORDER BY id DESC LIMIT ${ROW_LIMIT}`),
    all(`SELECT id, company_id, freelancer_id, job_id, status, created_at, responded_at, match_score, source FROM proposals ORDER BY id DESC LIMIT ${ROW_LIMIT}`),
    all(`SELECT id, job_id, company_id, freelancer_id, status, contracted_at, completed_at, created_at FROM projects ORDER BY id DESC LIMIT ${ROW_LIMIT}`),
    all(`SELECT i.status, i.created_at, c.company_id, c.freelancer_id FROM interviews i JOIN conversations c ON c.id = i.conversation_id ORDER BY i.id DESC LIMIT ${ROW_LIMIT}`),
    all('SELECT user_id, stack_json, role_title, grade, verified FROM freelancer_profiles'),
    all(`SELECT conversation_id, created_at FROM messages WHERE meta_json LIKE ? ORDER BY id DESC LIMIT ${ROW_LIMIT}`, ['%contact%ed%']),
    get("SELECT COUNT(*) AS c FROM career_verifications WHERE status IN ('pending','needs_review')"),
    all(`SELECT project_id, role, prev_channel, prev_days, reuse_intent, fit_vs_prev, prev_contacts, created_at FROM contract_surveys ORDER BY id DESC LIMIT ${ROW_LIMIT}`),
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
  const firstSourceByPair = new Map(); // 그 첫 접촉이 어디서 시작됐는지(추천·검색·알림)
  const srcOf = (x) => (CONTACT_SOURCES.includes(x.source) ? x.source : null); // 기록 전(예전) 데이터는 null
  for (const a of apps) {
    const j = jobById.get(a.job_id);
    if (!j) continue;
    const k = `${j.company_id}:${a.freelancer_id}`, t = toMs(a.created_at);
    if (t !== null && (!firstContactByPair.has(k) || t < firstContactByPair.get(k))) { firstContactByPair.set(k, t); firstSourceByPair.set(k, srcOf(a)); }
  }
  for (const p of props) {
    const k = `${p.company_id}:${p.freelancer_id}`, t = toMs(p.created_at);
    if (t !== null && (!firstContactByPair.has(k) || t < firstContactByPair.get(k))) { firstContactByPair.set(k, t); firstSourceByPair.set(k, srcOf(p)); }
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

  // ----- 출처별 성과 (기간): 추천 목록에서 시작된 연결이 검색·알림보다 빨리·많이 계약되는지 -----
  const srcStat = new Map(CONTACT_SOURCES.map((k) => [k, { source: k, label: SOURCE_LABEL[k], n: 0, matched: 0, contracted: 0, days: [] }]));
  for (const a of appsW) {
    const src = srcOf(a); if (!src) continue;
    const j = jobById.get(a.job_id); if (!j) continue;
    const st = srcStat.get(src); st.n++;
    if (a.status === 'accepted') st.matched++;
    if (contractedPairs.has(`${j.company_id}:${a.freelancer_id}`)) st.contracted++;
  }
  for (const p of propsW) {
    const src = srcOf(p); if (!src) continue;
    const st = srcStat.get(src); st.n++;
    if (p.status === 'accepted') st.matched++;
    if (contractedPairs.has(`${p.company_id}:${p.freelancer_id}`)) st.contracted++;
  }
  for (const p of contractedW) {
    const k = `${p.company_id}:${p.freelancer_id}`;
    const src = firstSourceByPair.get(k), f = firstContactByPair.get(k);
    if (!src || f === undefined) continue;
    srcStat.get(src).days.push(toMs(p.contracted_at) - f);
  }
  const bySource = [...srcStat.values()].map((x) => ({
    source: x.source, label: x.label, n: x.n,
    matchRate: pct(x.matched, x.n), contractRate: pct(x.contracted, x.n),
    contactToContract: durationSummary(x.days),
  }));

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

  // ----- 신뢰·안전 거래 -----
  const maskedW = masked.filter((m) => inWin(m.created_at));
  const trust = {
    verifiedFreelancers: profiles.filter((p) => Number(p.verified) === 1).length,
    totalFreelancers: profiles.length,
    verificationPending: Number((cvPending && cvPending.c) || 0),
    maskedMessages: maskedW.length,
    maskedConversations: new Set(maskedW.map((m) => m.conversation_id)).size,
  };

  // ----- 기존 방식과 비교 (계약 체결 후 설문) -----
  // 같은 계약에서 'IT Free 첫 접촉 → 계약'에 걸린 일수와 응답자가 기존 방식으로 걸리던 일수를 나란히 놓고 비교합니다.
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const surveysW = surveys.filter((x) => inWin(x.created_at));
  const paired = [];
  for (const x of surveysW) {
    if (x.prev_days === null || x.prev_days === undefined) continue;
    const pr = projectById.get(x.project_id);
    if (!pr || !pr.contracted_at) continue;
    const first = firstContactByPair.get(`${pr.company_id}:${pr.freelancer_id}`);
    if (first === undefined) continue;
    const platformDays = (toMs(pr.contracted_at) - first) / DAY;
    if (!Number.isFinite(platformDays) || platformDays < 0) continue;
    paired.push({ role: x.role, platformDays, prevDays: Number(x.prev_days) });
  }
  const r1 = (v) => (v === null ? null : Math.round(v * 10) / 10);
  const compareOf = (rows) => ({
    n: rows.length,
    platformMedianDays: r1(median(rows.map((r) => r.platformDays))),
    prevMedianDays: r1(median(rows.map((r) => r.prevDays))),
    fasterRate: pct(rows.filter((r) => r.platformDays < r.prevDays).length, rows.length),
  });
  // 재이용 의향(0~10): 9~10 추천, 0~6 비추천 → 순추천지수(NPS) = 추천 비율 - 비추천 비율
  const npsOf = (rows) => {
    if (!rows.length) return { n: 0, nps: null, avg: null };
    const promoters = rows.filter((r) => r.reuse_intent >= 9).length;
    const detractors = rows.filter((r) => r.reuse_intent <= 6).length;
    const avg = rows.reduce((s2, r) => s2 + Number(r.reuse_intent), 0) / rows.length;
    return { n: rows.length, nps: Math.round(((promoters - detractors) / rows.length) * 100), avg: Math.round(avg * 10) / 10 };
  };
  const channels = {};
  for (const x of surveysW) channels[x.prev_channel] = (channels[x.prev_channel] || 0) + 1;

  // 매칭 정확도: 기존 방식으로 만나던 상대와 비교한 이번 상대의 조건 적합도(-2~2)
  const fitRows = surveysW.filter((x) => x.fit_vs_prev !== null && x.fit_vs_prev !== undefined).map((x) => Number(x.fit_vs_prev));
  const fit = {
    n: fitRows.length,
    betterRate: pct(fitRows.filter((v) => v > 0).length, fitRows.length),
    sameRate: pct(fitRows.filter((v) => v === 0).length, fitRows.length),
    worseRate: pct(fitRows.filter((v) => v < 0).length, fitRows.length),
    avg: fitRows.length ? r1(fitRows.reduce((a, b) => a + b, 0) / fitRows.length) : null,
  };

  // 계약 성사율: 계약 1건까지 검토·접촉한 수 — IT Free(실제 기록) vs 기존 방식(설문)
  //  기업: 계약한 공고에 들어온 지원 + 그 공고로 보낸 제안 상대 수
  //  프리랜서: 계약 전 90일 동안 보낸 지원 + 받은 제안 수
  const contactsOnJob = new Map();
  const addJobContact = (jobId, fid) => { if (!jobId) return; if (!contactsOnJob.has(jobId)) contactsOnJob.set(jobId, new Set()); contactsOnJob.get(jobId).add(fid); };
  for (const a of apps) addJobContact(a.job_id, a.freelancer_id);
  for (const p of props) addJobContact(p.job_id, p.freelancer_id);
  const freelancerContactsBefore = (fid, until) => {
    const from = until - 90 * DAY;
    const inRange = (v) => { const t = toMs(v); return t !== null && t >= from && t <= until; };
    return apps.filter((a) => a.freelancer_id === fid && inRange(a.created_at)).length
      + props.filter((p) => p.freelancer_id === fid && inRange(p.created_at)).length;
  };
  const contactPairs = [];
  for (const x of surveysW) {
    if (x.prev_contacts === null || x.prev_contacts === undefined) continue;
    const pr = projectById.get(x.project_id);
    if (!pr || !pr.contracted_at) continue;
    let platform = null;
    if (x.role === 'company') platform = pr.job_id && contactsOnJob.has(pr.job_id) ? contactsOnJob.get(pr.job_id).size : null;
    else platform = freelancerContactsBefore(pr.freelancer_id, toMs(pr.contracted_at)) || null;
    if (!platform) continue;
    contactPairs.push({ role: x.role, platform, prev: Number(x.prev_contacts) });
  }
  const contactsOf = (rows) => ({
    n: rows.length,
    platformMedian: r1(median(rows.map((r) => r.platform))),
    prevMedian: r1(median(rows.map((r) => r.prev))),
    fewerRate: pct(rows.filter((r) => r.platform < r.prev).length, rows.length),
  });
  const baseline = {
    responses: surveysW.length,
    responseRate: pct(surveysW.length, contractedW.length * 2), // 계약 1건당 기업·프리랜서 2명
    compare: compareOf(paired),
    compareCompany: compareOf(paired.filter((r) => r.role === 'company')),
    compareFreelancer: compareOf(paired.filter((r) => r.role === 'freelancer')),
    reuseIntent: npsOf(surveysW),
    channels,
    fit,
    contacts: contactsOf(contactPairs),
    contactsCompany: contactsOf(contactPairs.filter((r) => r.role === 'company')),
    contactsFreelancer: contactsOf(contactPairs.filter((r) => r.role === 'freelancer')),
  };

  return { days, funnel, rates, durations, scoreBands, bySource, reuse, byCategory, trust, baseline };
}

module.exports = { computePerformance };
