// 근무 조건(투입 시기·근무 형태·근무 지역) 입력값 정리와 공고 ↔ 프리랜서 비교를 한곳에서 담당합니다.
// 추천 점수(src/recommend.js)와 프로필·공고 저장(routes)이 같은 규칙을 쓰도록 모아 둡니다.

// 근무 가능 지역 — 공고 근무지의 지역 목록(routes/jobs.js LOCATION_REGIONS)과 같은 값 + '전국'(지역 무관)
const PREF_REGIONS = ['전국', '서울', '경기', '인천', '부산', '대구', '광주', '대전', '울산', '세종',
  '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
// 선호 근무 형태 — '무관'은 어떤 형태든 괜찮다는 뜻입니다.
const PREF_WORK_TYPES = ['상주', '재택', '혼합', '무관'];

// 'YYYY-MM-DD'만 받습니다. 빈 값은 '', 형식이 틀리면 null.
function normalizeDate(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

function normalizeRegions(list) {
  const arr = (Array.isArray(list) ? list : []).filter((r) => PREF_REGIONS.includes(r));
  return arr.includes('전국') ? ['전국'] : [...new Set(arr)];
}

function parseRegions(json) {
  try { return normalizeRegions(JSON.parse(json || '[]')); } catch (e) { return []; }
}

// 공고의 근무 형태를 '상주' | '재택' | '혼합' | null(알 수 없음)로 분류합니다.
// 근무 형태는 자유 입력(예: "상주 · 주5일")이라 낱말로 판단하고, 근무지가 '원격'이면 재택으로 봅니다.
function jobWorkMode(job) {
  const text = `${job.work_type || ''} ${job.location || ''}`;
  const remote = /재택|원격|리모트|remote/i.test(text);
  const onsite = /상주|출근|오피스|사무실/.test(text);
  if (/혼합|병행|하이브리드|hybrid/i.test(text) || (remote && onsite)) return '혼합';
  if (remote) return '재택';
  if (onsite) return '상주';
  return null;
}

// 공고 근무지의 지역(예: "경기 판교" → '경기'). 원격·협의·목록에 없는 값은 null.
function jobRegion(job) {
  const s = String(job.location || '').trim();
  return PREF_REGIONS.find((r) => r !== '전국' && s.startsWith(r)) || null;
}

function todayStr() {
  // 한국 시간 기준 오늘
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function mmdd(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${Number(m)}/${Number(d)}`;
}

// 투입 시기 (최대 10점). 공고 투입 예정일(없으면 오늘)까지 투입할 수 있으면 만점,
// 2주 안에 가능하면 절반. 프리랜서가 투입 가능일을 입력하지 않았으면 중립(5점)으로 둡니다.
function scoreTiming(job, profile) {
  const avail = normalizeDate(profile.available_from);
  if (!avail) return { score: 5, reason: null };
  const today = todayStr();
  const start = normalizeDate(job.start_date) || today;
  const ref = start < today ? today : start;
  if (avail <= ref) return { score: 10, reason: avail <= today ? '즉시 투입 가능' : `${mmdd(avail)}부터 투입 가능` };
  if (avail <= addDays(ref, 14)) return { score: 5, reason: `${mmdd(avail)}부터 투입 가능` };
  return { score: 0, reason: null };
}

// 근무 형태 (최대 5점). 같으면 만점, 한쪽이 혼합이면 3점, 상주 ↔ 재택처럼 반대면 0점.
// 프리랜서 선호나 공고 형태를 알 수 없으면 중립(2점).
function scoreWorkType(job, profile) {
  const pref = PREF_WORK_TYPES.includes(profile.pref_work_type) ? profile.pref_work_type : null;
  if (pref === '무관') return { score: 5, reason: null };
  const mode = jobWorkMode(job);
  if (!pref || !mode) return { score: 2, reason: null };
  if (pref === mode) return { score: 5, reason: `근무형태(${mode}) 일치` };
  if (pref === '혼합' || mode === '혼합') return { score: 3, reason: null };
  return { score: 0, reason: null };
}

// 근무 지역 (최대 5점). 재택 공고이거나 '전국' 선택이면 만점, 근무지 지역이 선호 지역에 있으면 만점.
// 프리랜서가 지역을 고르지 않았거나 공고 근무지가 '협의' 등으로 불분명하면 중립(2점).
function scoreRegion(job, profile) {
  const prefs = parseRegions(profile.pref_regions_json);
  if (jobWorkMode(job) === '재택') return { score: 5, reason: null };
  if (prefs.includes('전국')) return { score: 5, reason: null };
  const region = jobRegion(job);
  if (!prefs.length || !region) return { score: 2, reason: null };
  if (prefs.includes(region)) return { score: 5, reason: `근무지(${region}) 가능` };
  return { score: 0, reason: null };
}

// 자격증 (최대 5점). 공고가 요구하는 자격증이 없으면 요건 충족으로 만점,
// 요구 자격증을 모두 가졌으면 만점, 일부만 가졌으면 3점.
function scoreCerts(jobCerts = [], profileCerts = []) {
  const need = new Set(jobCerts.map((c) => String(c).trim().toLowerCase()));
  if (!need.size) return { score: 5, matched: 0, reason: null };
  const have = new Set(profileCerts.map((c) => String(c).trim().toLowerCase()));
  const matched = [...need].filter((c) => have.has(c)).length;
  if (!matched) return { score: 0, matched: 0, reason: null };
  return { score: matched === need.size ? 5 : 3, matched, reason: `자격증 ${matched}개 일치` };
}

module.exports = {
  PREF_REGIONS, PREF_WORK_TYPES, normalizeDate, normalizeRegions, parseRegions,
  jobWorkMode, jobRegion, scoreTiming, scoreWorkType, scoreRegion, scoreCerts,
};
