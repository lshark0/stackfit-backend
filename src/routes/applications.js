const express = require('express');
const { run, get, all } = require('../db');
const { signedFileUrl } = require('../fileAccess');
const { computeMatch } = require('../match');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');
const { sendPushToUser } = require('../push');

const router = express.Router();
wrapAllRoutes(router);

router.post('/jobs/:id/apply', requireAuth, requireRole('freelancer'), async (req, res) => {
  const jobId = Number(req.params.id);
  const job = await get('SELECT * FROM jobs WHERE id = ?', [jobId]);
  if (!job) return res.status(404).json({ error: '공고를 찾을 수 없습니다.' });

  if (job.deadline) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const deadlineDate = new Date(job.deadline + 'T00:00:00');
    if (!Number.isNaN(deadlineDate.getTime()) && deadlineDate < today) {
      return res.status(400).json({ error: '마감된 공고에는 지원할 수 없어요.' });
    }
  }

  const existing = await get('SELECT id FROM applications WHERE job_id=? AND freelancer_id=?', [jobId, req.user.id]);
  if (existing) return res.status(409).json({ error: '이미 지원한 공고입니다.' });

  // 기업이 지원자를 제대로 판단할 수 있도록, 프로필이 모두 채워져 있어야 지원할 수 있습니다.
  const myProfile = await get('SELECT * FROM freelancer_profiles WHERE user_id = ?', [req.user.id]);
  const missing = [];
  if (!myProfile || !String(myProfile.role_title || '').trim()) missing.push('업무');
  if (!myProfile || !String(myProfile.grade || '').trim()) missing.push('등급');
  if (!myProfile || !String(myProfile.rate || '').trim()) missing.push('희망 단가');
  if (!myProfile || JSON.parse(myProfile.stack_json || '[]').length === 0) missing.push('기술스택');
  if (!myProfile || !String(myProfile.summary || '').trim()) missing.push('자기 소개');
  if (!myProfile || !myProfile.resume_filename) missing.push('경력기술서');
  if (missing.length) {
    return res.status(400).json({
      error: `지원하려면 프로필을 먼저 완성해주세요. (${missing.join(', ')})`,
      code: 'PROFILE_INCOMPLETE',
      missing,
    });
  }

  await run('INSERT INTO applications (job_id, freelancer_id) VALUES (?,?)', [jobId, req.user.id]);

  const profile = await get('SELECT name FROM freelancer_profiles WHERE user_id = ?', [req.user.id]);
  await run('INSERT INTO notifications (user_id, tag, title, body) VALUES (?,?,?,?)', [
    job.company_id, '지원', '새 지원자가 있어요', `${profile.name}님이 "${job.title}" 공고에 지원했습니다.`,
  ]);
  sendPushToUser(job.company_id, {
    kind: 'applicant',
    title: '🙋 새 지원자 도착',
    body: `${profile.name}님이 "${job.title}" 공고에 지원했어요.`,
    url: '/',
    tag: `applicant-${job.id}`,
  }).catch(() => {});
  await run('INSERT INTO notifications (user_id, tag, title, body) VALUES (?,?,?,?)', [
    req.user.id, '지원', '지원이 접수되었어요', `"${job.title}" 공고에 지원이 완료됐습니다.`,
  ]);

  res.status(201).json({ applied: true });
});

// 지원 취소 (검토중 상태일 때만 가능 — 이미 합격/불합격 처리된 지원은 취소 불가)
router.delete('/jobs/:id/apply', requireAuth, requireRole('freelancer'), async (req, res) => {
  const jobId = Number(req.params.id);
  const application = await get('SELECT * FROM applications WHERE job_id=? AND freelancer_id=?', [jobId, req.user.id]);
  if (!application) return res.status(404).json({ error: '지원 내역을 찾을 수 없습니다.' });
  if (application.status !== 'submitted') {
    return res.status(400).json({ error: '이미 처리된 지원은 취소할 수 없어요.' });
  }
  await run('DELETE FROM applications WHERE id = ?', [application.id]);
  res.json({ applied: false });
});

router.get('/me/applications', requireAuth, requireRole('freelancer'), async (req, res) => {
  const rows = await all(
    `SELECT a.id AS application_id, a.status AS application_status, a.created_at, j.*, c.name AS org
     FROM applications a
     JOIN jobs j ON j.id = a.job_id
     LEFT JOIN companies c ON c.user_id = j.company_id
     WHERE a.freelancer_id = ? ORDER BY a.created_at DESC, a.id DESC`,
    [req.user.id]
  );
  res.json({
    applications: rows.map(r => ({ ...r, status: r.application_status, stack: JSON.parse(r.stack_json) })),
  });
});

router.get('/jobs/:id/applicants', requireAuth, requireRole('company'), async (req, res) => {
  const job = await get('SELECT * FROM jobs WHERE id = ? AND company_id = ?', [req.params.id, req.user.id]);
  if (!job) return res.status(404).json({ error: '공고를 찾을 수 없습니다.' });
  const jobStack = JSON.parse(job.stack_json);
  const rows = await all(
    `SELECT a.id AS application_id, a.status, a.created_at, a.freelancer_id, f.*
     FROM applications a LEFT JOIN freelancer_profiles f ON f.user_id = a.freelancer_id
     WHERE a.job_id = ? ORDER BY a.created_at DESC`,
    [req.params.id]
  );
  res.json({
    job: { id: job.id, title: job.title },
    applicants: rows.map(r => {
      const stack = r.stack_json ? JSON.parse(r.stack_json) : [];
      return {
        ...r,
        user_id: r.user_id ?? r.freelancer_id,
        name: r.name || '(탈퇴한 회원)',
        role_title: r.role_title || '',
        rate: r.rate || '',
        stack,
        match: computeMatch(jobStack, stack),
        resume_url: signedFileUrl(r.resume_filename),
      };
    }),
  });
});

// 지원 수락/거절 (기업 전용, 본인 공고에 한함). 수락 시 프로젝트를 자동 생성합니다.
router.patch('/jobs/:jobId/applicants/:applicationId', requireAuth, requireRole('company'), async (req, res) => {
  const { status } = req.body || {};
  // submitted = 거절 취소(검토중으로 되돌리기)
  if (!['accepted', 'rejected', 'submitted'].includes(status)) {
    return res.status(400).json({ error: "status는 'accepted', 'rejected', 'submitted' 중 하나여야 합니다." });
  }
  const job = await get('SELECT * FROM jobs WHERE id = ? AND company_id = ?', [req.params.jobId, req.user.id]);
  if (!job) return res.status(404).json({ error: '공고를 찾을 수 없습니다.' });

  const application = await get('SELECT * FROM applications WHERE id = ? AND job_id = ?', [req.params.applicationId, job.id]);
  if (!application) return res.status(404).json({ error: '지원 내역을 찾을 수 없습니다.' });
  // 거절은 언제든 되돌릴 수 있지만, 수락은 이미 프로젝트가 만들어졌으므로 되돌릴 수 없습니다.
  if (application.status === 'accepted') {
    return res.status(400).json({ error: '이미 수락한 지원이에요. 진행 중인 프로젝트가 있어 되돌릴 수 없어요.' });
  }
  if (application.status === status) {
    return res.status(400).json({ error: '이미 같은 상태예요.' });
  }

  await run('UPDATE applications SET status = ? WHERE id = ?', [status, application.id]);

  // 거절을 취소해 '검토중'으로 되돌린 경우에는 지원자에게 결과 알림을 보내지 않습니다.
  if (status === 'submitted') {
    return res.json({ status });
  }

  const resultTitle = status === 'accepted' ? '지원이 수락됐어요!' : '지원 결과가 도착했어요';
  const resultBody = status === 'accepted'
    ? `"${job.title}" 공고에 합격하셨습니다. 프로젝트가 생성됐어요.`
    : `"${job.title}" 공고에는 아쉽게도 채용이 어려워요.`;
  await run('INSERT INTO notifications (user_id, tag, title, body) VALUES (?,?,?,?)', [
    application.freelancer_id,
    status === 'accepted' ? '합격' : '지원결과',
    resultTitle,
    resultBody,
  ]);
  sendPushToUser(application.freelancer_id, {
    kind: 'result',
    title: status === 'accepted' ? '🎉 지원이 수락됐어요' : '📢 지원 결과 도착',
    body: resultBody,
    url: '/',
    tag: `result-${job.id}`,
  }).catch(() => {});

  if (status === 'accepted') {
    // 같은 공고·같은 사람이라도 이전 계약이 이미 '완료'됐다면 재계약이므로 새 프로젝트를 만듭니다.
    // (진행 중인 프로젝트가 있을 때만 중복 생성을 막습니다.)
    const activeProject = await get(
      "SELECT id FROM projects WHERE job_id=? AND freelancer_id=? AND status != '완료'",
      [job.id, application.freelancer_id]
    );
    if (!activeProject) {
      await run(
        'INSERT INTO projects (job_id, company_id, freelancer_id, title, rate, period, status, stage) VALUES (?,?,?,?,?,?,?,?)',
        [job.id, req.user.id, application.freelancer_id, job.title, job.rate, job.period, '진행중', 1]
      );
    }
  }

  res.json({ status });
});

module.exports = router;
