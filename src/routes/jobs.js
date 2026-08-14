const express = require('express');
const { run, get, all } = require('../db');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { verifyToken } = require('../auth');
const { computeMatch } = require('../match');

const router = express.Router();

// 토큰이 있으면 req.user를 채우되, 없어도 통과시킴 (공고 목록은 비로그인도 조회 가능)
function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  req.user = token ? verifyToken(token) : null;
  next();
}

function withCompanyAndStack(job) {
  const company = get('SELECT name FROM companies WHERE user_id = ?', [job.company_id]);
  return { ...job, org: company ? company.name : '알 수 없음', stack: JSON.parse(job.stack_json) };
}

router.get('/', optionalAuth, (req, res) => {
  const { q, category } = req.query;
  let jobs = all("SELECT * FROM jobs WHERE status = 'open' ORDER BY created_at DESC, id DESC").map(withCompanyAndStack);

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

  let profileStack = [];
  let appliedJobIds = new Set();
  let savedJobIds = new Set();
  if (req.user && req.user.role === 'freelancer') {
    const p = get('SELECT stack_json FROM freelancer_profiles WHERE user_id = ?', [req.user.id]);
    profileStack = p ? JSON.parse(p.stack_json) : [];
    appliedJobIds = new Set(all('SELECT job_id FROM applications WHERE freelancer_id = ?', [req.user.id]).map(a => a.job_id));
    savedJobIds = new Set(all('SELECT job_id FROM saved_jobs WHERE freelancer_id = ?', [req.user.id]).map(s => s.job_id));
  }

  const result = jobs.map(j => ({
    ...j,
    match: computeMatch(j.stack, profileStack),
    applied: appliedJobIds.has(j.id),
    saved: savedJobIds.has(j.id),
  }));

  res.json({ jobs: result });
});

router.get('/:id', optionalAuth, (req, res) => {
  const job = get('SELECT * FROM jobs WHERE id = ?', [req.params.id]);
  if (!job) return res.status(404).json({ error: '공고를 찾을 수 없습니다.' });
  const full = withCompanyAndStack(job);

  let match = 0, applied = false, saved = false;
  if (req.user && req.user.role === 'freelancer') {
    const p = get('SELECT stack_json FROM freelancer_profiles WHERE user_id = ?', [req.user.id]);
    match = computeMatch(full.stack, p ? JSON.parse(p.stack_json) : []);
    applied = !!get('SELECT id FROM applications WHERE job_id=? AND freelancer_id=?', [job.id, req.user.id]);
    saved = !!get('SELECT id FROM saved_jobs WHERE job_id=? AND freelancer_id=?', [job.id, req.user.id]);
  }

  const applicantCount = get('SELECT COUNT(*) AS c FROM applications WHERE job_id = ?', [job.id]).c;
  res.json({ ...full, match, applied, saved, applicantCount });
});

router.post('/', requireAuth, requireRole('company'), (req, res) => {
  const { title, stack, period, rate, work_type, location, category, description } = req.body || {};
  if (!title) return res.status(400).json({ error: '공고 제목은 필수입니다.' });
  const r = run(
    `INSERT INTO jobs (company_id, title, stack_json, period, rate, work_type, location, category, description)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      req.user.id, title, JSON.stringify(Array.isArray(stack) ? stack : []),
      period || '협의', rate || '협의', work_type || '협의', location || '협의', category || '인프라', description || '',
    ]
  );
  const job = get('SELECT * FROM jobs WHERE id = ?', [r.lastInsertRowid]);
  res.status(201).json(withCompanyAndStack(job));
});

// 공고 저장(즐겨찾기) 토글
router.post('/:id/save', requireAuth, requireRole('freelancer'), (req, res) => {
  const jobId = Number(req.params.id);
  const existing = get('SELECT id FROM saved_jobs WHERE job_id=? AND freelancer_id=?', [jobId, req.user.id]);
  if (existing) {
    run('DELETE FROM saved_jobs WHERE id = ?', [existing.id]);
    return res.json({ saved: false });
  }
  run('INSERT INTO saved_jobs (freelancer_id, job_id) VALUES (?,?)', [req.user.id, jobId]);
  res.json({ saved: true });
});

module.exports = router;
