const express = require('express');
const { run, get, all } = require('../db');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');
const { verifyToken } = require('../auth');
const { computeMatch } = require('../match');
const { getRatingSummary, getRatingSummaries } = require('../ratings');

// SI/공공 프로젝트에서 흔히 쓰는 업무 구분과 기술등급
const DUTY_OPTIONS = ['PM', 'PL', 'TA', 'SA', 'DBA', '개발자', 'QA', '보안', '감리', '기타'];
const GRADE_OPTIONS = ['초급', '중급', '고급', '특급'];
const pickFrom = (value, options, fallback) => (options.includes(value) ? value : fallback);

const router = express.Router();
wrapAllRoutes(router);

// 토큰이 있으면 req.user를 채우되, 없어도 통과시킴 (공고 목록은 비로그인도 조회 가능)
function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  req.user = token ? verifyToken(token) : null;
  next();
}

function baseJob(job, companyName, rating) {
  return {
    ...job,
    org: companyName || '알 수 없음',
    stack: JSON.parse(job.stack_json),
    d_day: dDay(job.deadline),
    ...rating,
  };
}

async function withCompanyAndStack(job) {
  const company = await get('SELECT name FROM companies WHERE user_id = ?', [job.company_id]);
  const rating = await getRatingSummary(job.company_id);
  return baseJob(job, company ? company.name : null, rating);
}

// 마감일 문자열('YYYY-MM-DD')을 D-day 라벨로 변환 (잡코리아 스타일)
function dDay(deadline) {
  if (!deadline) return '상시채용';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(deadline + 'T00:00:00');
  if (Number.isNaN(target.getTime())) return '상시채용';
  const diffDays = Math.round((target - today) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return '마감';
  if (diffDays === 0) return '오늘마감';
  return `D-${diffDays}`;
}

router.get('/', optionalAuth, async (req, res) => {
  const { q, category, duty, grade, location } = req.query;
  const rows = await all("SELECT * FROM jobs WHERE status = 'open' ORDER BY created_at DESC, id DESC");

  // N+1 방지: 회사명/평점을 각각 한 번의 쿼리로 일괄 조회한 뒤 메모리에서 조합합니다.
  const companyIds = [...new Set(rows.map((j) => j.company_id))];
  const companyRows = companyIds.length
    ? await all(`SELECT user_id, name FROM companies WHERE user_id IN (${companyIds.map(() => '?').join(',')})`, companyIds)
    : [];
  const companyNameById = Object.fromEntries(companyRows.map((c) => [c.user_id, c.name]));
  const ratingById = await getRatingSummaries(companyIds);

  let jobs = rows.map((j) => baseJob(j, companyNameById[j.company_id], ratingById[j.company_id] || { rating_avg: null, rating_count: 0 }));

  if (q) {
    const needle = String(q).toLowerCase();
    jobs = jobs.filter(j =>
      j.title.toLowerCase().includes(needle) ||
      j.org.toLowerCase().includes(needle) ||
      j.stack.some(s => s.toLowerCase().includes(needle))
    );
  }
  if (category && category !== '전체') {
    jobs = jobs.filter(j => j.category === category);
  }
  if (duty && duty !== '전체') {
    jobs = jobs.filter(j => j.duty === duty);
  }
  if (grade && grade !== '전체') {
    jobs = jobs.filter(j => j.grade === grade);
  }
  if (location) {
    const needle = String(location).toLowerCase();
    jobs = jobs.filter(j => (j.location || '').toLowerCase().includes(needle));
  }

  let profileStack = [];
  let appliedJobIds = new Set();
  let savedJobIds = new Set();
  if (req.user && req.user.role === 'freelancer') {
    const p = await get('SELECT stack_json FROM freelancer_profiles WHERE user_id = ?', [req.user.id]);
    profileStack = p ? JSON.parse(p.stack_json) : [];
    const applied = await all('SELECT job_id FROM applications WHERE freelancer_id = ?', [req.user.id]);
    const saved = await all('SELECT job_id FROM saved_jobs WHERE freelancer_id = ?', [req.user.id]);
    appliedJobIds = new Set(applied.map(a => a.job_id));
    savedJobIds = new Set(saved.map(s => s.job_id));
  }

  const result = jobs.map(j => ({
    ...j,
    match: computeMatch(j.stack, profileStack),
    applied: appliedJobIds.has(j.id),
    saved: savedJobIds.has(j.id),
  }));

  const finalResult = req.query.saved === 'true' ? result.filter(j => j.saved) : result;
  res.json({ jobs: finalResult });
});

router.get('/:id', optionalAuth, async (req, res) => {
  const job = await get('SELECT * FROM jobs WHERE id = ?', [req.params.id]);
  if (!job) return res.status(404).json({ error: '공고를 찾을 수 없습니다.' });
  const full = await withCompanyAndStack(job);

  let match = 0, applied = false, saved = false, following = false;
  if (req.user && req.user.role === 'freelancer') {
    const p = await get('SELECT stack_json FROM freelancer_profiles WHERE user_id = ?', [req.user.id]);
    match = computeMatch(full.stack, p ? JSON.parse(p.stack_json) : []);
    applied = !!(await get('SELECT id FROM applications WHERE job_id=? AND freelancer_id=?', [job.id, req.user.id]));
    saved = !!(await get('SELECT id FROM saved_jobs WHERE job_id=? AND freelancer_id=?', [job.id, req.user.id]));
    following = !!(await get('SELECT id FROM followed_companies WHERE freelancer_id=? AND company_id=?', [req.user.id, job.company_id]));
  }

  const applicantCount = (await get('SELECT COUNT(*) AS c FROM applications WHERE job_id = ?', [job.id])).c;
  res.json({ ...full, match, applied, saved, following, applicantCount: Number(applicantCount) });
});

router.post('/', requireAuth, requireRole('company'), async (req, res) => {
  const { title, stack, period, rate, work_type, location, category, description, deadline, duty, grade } = req.body || {};
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: '공고 제목은 필수입니다.' });
  }
  const clamp = (v, max, fallback) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback);
  const safeStack = (Array.isArray(stack) ? stack : [])
    .filter((s) => typeof s === 'string' && s.trim())
    .slice(0, 20)
    .map((s) => s.trim().slice(0, 40));
  const safeDeadline = typeof deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(deadline.trim()) ? deadline.trim() : null;

  const r = await run(
    `INSERT INTO jobs (company_id, title, stack_json, period, rate, work_type, location, category, description, deadline, duty, grade)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      req.user.id,
      clamp(title, 120, title.trim()),
      JSON.stringify(safeStack),
      clamp(period, 40, '협의'),
      clamp(rate, 40, '협의'),
      clamp(work_type, 40, '협의'),
      clamp(location, 40, '협의'),
      clamp(category, 20, '인프라'),
      clamp(description, 3000, ''),
      safeDeadline,
      pickFrom(duty, DUTY_OPTIONS, null),
      pickFrom(grade, GRADE_OPTIONS, null),
    ]
  );
  const job = await get('SELECT * FROM jobs WHERE id = ?', [r.lastInsertRowid]);
  res.status(201).json(await withCompanyAndStack(job));
});

// 공고 수정 (기업 전용, 본인이 등록한 공고만)
router.put('/:id', requireAuth, requireRole('company'), async (req, res) => {
  const jobId = Number(req.params.id);
  if (!Number.isInteger(jobId)) return res.status(400).json({ error: '올바르지 않은 공고 ID입니다.' });

  const job = await get('SELECT * FROM jobs WHERE id = ? AND company_id = ?', [jobId, req.user.id]);
  if (!job) return res.status(404).json({ error: '공고를 찾을 수 없거나 수정 권한이 없어요.' });

  const { title, stack, period, rate, work_type, location, category, description, deadline, duty, grade } = req.body || {};
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: '공고 제목은 필수입니다.' });
  }
  const clamp = (v, max, fallback) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback);
  const safeStack = Array.isArray(stack)
    ? stack.filter((s) => typeof s === 'string' && s.trim()).slice(0, 20).map((s) => s.trim().slice(0, 40))
    : JSON.parse(job.stack_json);
  // 마감일: 빈 문자열이면 '상시채용'으로 되돌림(null), 유효한 날짜면 반영, 값이 아예 없으면 기존 값 유지
  const safeDeadline =
    deadline === undefined ? job.deadline
      : (typeof deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(deadline.trim()) ? deadline.trim() : null);
  const safeDuty = duty === undefined ? job.duty : pickFrom(duty, DUTY_OPTIONS, null);
  const safeGrade = grade === undefined ? job.grade : pickFrom(grade, GRADE_OPTIONS, null);

  await run(
    `UPDATE jobs SET title=?, stack_json=?, period=?, rate=?, work_type=?, location=?, category=?, description=?, deadline=?, duty=?, grade=? WHERE id=?`,
    [
      clamp(title, 120, job.title),
      JSON.stringify(safeStack),
      clamp(period, 40, job.period),
      clamp(rate, 40, job.rate),
      clamp(work_type, 40, job.work_type),
      clamp(location, 40, job.location),
      clamp(category, 20, job.category),
      clamp(description, 3000, job.description),
      safeDeadline,
      safeDuty,
      safeGrade,
      jobId,
    ]
  );
  const updated = await get('SELECT * FROM jobs WHERE id = ?', [jobId]);
  res.json(await withCompanyAndStack(updated));
});

// 공고 저장(즐겨찾기) 토글
router.post('/:id/save', requireAuth, requireRole('freelancer'), async (req, res) => {
  const jobId = Number(req.params.id);
  if (!Number.isInteger(jobId)) return res.status(400).json({ error: '올바르지 않은 공고 ID입니다.' });

  const job = await get('SELECT id FROM jobs WHERE id = ?', [jobId]);
  if (!job) return res.status(404).json({ error: '공고를 찾을 수 없습니다.' });

  const existing = await get('SELECT id FROM saved_jobs WHERE job_id=? AND freelancer_id=?', [jobId, req.user.id]);
  if (existing) {
    await run('DELETE FROM saved_jobs WHERE id = ?', [existing.id]);
    return res.json({ saved: false });
  }
  await run('INSERT INTO saved_jobs (freelancer_id, job_id) VALUES (?,?)', [req.user.id, jobId]);
  res.json({ saved: true });
});

// 공고 삭제 (기업 전용, 본인이 등록한 공고만)
router.delete('/:id', requireAuth, requireRole('company'), async (req, res) => {
  const jobId = Number(req.params.id);
  if (!Number.isInteger(jobId)) return res.status(400).json({ error: '올바르지 않은 공고 ID입니다.' });

  const job = await get('SELECT id FROM jobs WHERE id = ? AND company_id = ?', [jobId, req.user.id]);
  if (!job) return res.status(404).json({ error: '공고를 찾을 수 없거나 삭제 권한이 없어요.' });

  await run('DELETE FROM jobs WHERE id = ?', [jobId]);
  res.json({ deleted: true });
});

module.exports = router;
