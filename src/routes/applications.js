const express = require('express');
const { run, get, all } = require('../db');
const { requireAuth, requireRole } = require('../middleware/requireAuth');

const router = express.Router();

router.post('/jobs/:id/apply', requireAuth, requireRole('freelancer'), async (req, res) => {
  const jobId = Number(req.params.id);
  const job = await get('SELECT * FROM jobs WHERE id = ?', [jobId]);
  if (!job) return res.status(404).json({ error: '공고를 찾을 수 없습니다.' });

  const existing = await get('SELECT id FROM applications WHERE job_id=? AND freelancer_id=?', [jobId, req.user.id]);
  if (existing) return res.status(409).json({ error: '이미 지원한 공고입니다.' });

  await run('INSERT INTO applications (job_id, freelancer_id) VALUES (?,?)', [jobId, req.user.id]);

  const profile = await get('SELECT name FROM freelancer_profiles WHERE user_id = ?', [req.user.id]);
  await run('INSERT INTO notifications (user_id, tag, title, body) VALUES (?,?,?,?)', [
    job.company_id, '지원', '새 지원자가 있어요', `${profile.name}님이 "${job.title}" 공고에 지원했습니다.`,
  ]);
  await run('INSERT INTO notifications (user_id, tag, title, body) VALUES (?,?,?,?)', [
    req.user.id, '지원', '지원이 접수되었어요', `"${job.title}" 공고에 지원이 완료됐습니다.`,
  ]);

  res.status(201).json({ applied: true });
});

router.get('/me/applications', requireAuth, requireRole('freelancer'), async (req, res) => {
  const rows = await all(
    `SELECT a.id AS application_id, a.status, a.created_at, j.*
     FROM applications a JOIN jobs j ON j.id = a.job_id
     WHERE a.freelancer_id = ? ORDER BY a.created_at DESC`,
    [req.user.id]
  );
  res.json({ applications: rows.map(r => ({ ...r, stack: JSON.parse(r.stack_json) })) });
});

router.get('/jobs/:id/applicants', requireAuth, requireRole('company'), async (req, res) => {
  const job = await get('SELECT * FROM jobs WHERE id = ? AND company_id = ?', [req.params.id, req.user.id]);
  if (!job) return res.status(404).json({ error: '공고를 찾을 수 없습니다.' });
  const rows = await all(
    `SELECT a.id AS application_id, a.status, a.created_at, f.*
     FROM applications a JOIN freelancer_profiles f ON f.user_id = a.freelancer_id
     WHERE a.job_id = ? ORDER BY a.created_at DESC`,
    [req.params.id]
  );
  res.json({
    job: { id: job.id, title: job.title },
    applicants: rows.map(r => ({
      ...r,
      stack: JSON.parse(r.stack_json),
      resume_url: r.resume_filename ? `/uploads/${r.resume_filename}` : null,
    })),
  });
});

// 지원 수락/거절 (기업 전용, 본인 공고에 한함). 수락 시 프로젝트를 자동 생성합니다.
router.patch('/jobs/:jobId/applicants/:applicationId', requireAuth, requireRole('company'), async (req, res) => {
  const { status } = req.body || {};
  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: "status는 'accepted' 또는 'rejected'여야 합니다." });
  }
  const job = await get('SELECT * FROM jobs WHERE id = ? AND company_id = ?', [req.params.jobId, req.user.id]);
  if (!job) return res.status(404).json({ error: '공고를 찾을 수 없습니다.' });

  const application = await get('SELECT * FROM applications WHERE id = ? AND job_id = ?', [req.params.applicationId, job.id]);
  if (!application) return res.status(404).json({ error: '지원 내역을 찾을 수 없습니다.' });

  await run('UPDATE applications SET status = ? WHERE id = ?', [status, application.id]);

  await run('INSERT INTO notifications (user_id, tag, title, body) VALUES (?,?,?,?)', [
    application.freelancer_id,
    status === 'accepted' ? '합격' : '지원결과',
    status === 'accepted' ? '지원이 수락됐어요!' : '지원 결과가 도착했어요',
    status === 'accepted'
      ? `"${job.title}" 공고에 합격하셨습니다. 프로젝트가 생성됐어요.`
      : `"${job.title}" 공고에는 아쉽게도 채용이 어려워요.`,
  ]);

  if (status === 'accepted') {
    const existingProject = await get('SELECT id FROM projects WHERE job_id=? AND freelancer_id=?', [job.id, application.freelancer_id]);
    if (!existingProject) {
      await run(
        'INSERT INTO projects (job_id, company_id, freelancer_id, title, rate, period, status, stage) VALUES (?,?,?,?,?,?,?,?)',
        [job.id, req.user.id, application.freelancer_id, job.title, job.rate, job.period, '진행중', 1]
      );
    }
  }

  res.json({ status });
});

module.exports = router;
