const express = require('express');
const { run, get, all } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { wrapAllRoutes } = require('../middleware/asyncHandler');
const { addNotification, pushTo } = require('../notify');

const router = express.Router();
wrapAllRoutes(router);

const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

// 관리자 화면 메뉴 노출 여부를 프론트가 매번 묻지 않아도 되도록, /auth/me에도 isAdmin을 함께 내려줍니다.
// 여기서는 신고된 공고 목록을 처리대기가 먼저 오도록 정렬해 보여줍니다.
router.get('/job-reports', requireAuth, requireAdmin, async (req, res) => {
  const rows = await all(
    `SELECT r.id, r.reason, r.status, r.created_at, r.resolved_at, r.admin_note,
       j.id AS job_id, j.title AS job_title, j.status AS job_status,
       c.name AS company_name, c.user_id AS company_id,
       f.name AS reporter_name, r.freelancer_id AS reporter_id
     FROM job_reports r
     JOIN jobs j ON j.id = r.job_id
     LEFT JOIN companies c ON c.user_id = j.company_id
     LEFT JOIN freelancer_profiles f ON f.user_id = r.freelancer_id
     ORDER BY (r.status = 'pending') DESC, r.created_at DESC, r.id DESC`
  );
  res.json({ reports: rows });
});

// 신고 처리: 반려(dismiss) / 공고 마감(close_job) / 공고 삭제(delete_job) 중 하나를 선택합니다.
router.post('/job-reports/:id/resolve', requireAuth, requireAdmin, async (req, res) => {
  const reportId = Number(req.params.id);
  if (!Number.isInteger(reportId)) return res.status(400).json({ error: '올바르지 않은 신고 ID입니다.' });
  const { action, note } = req.body || {};
  if (!['dismiss', 'close_job', 'delete_job'].includes(action)) {
    return res.status(400).json({ error: "action은 'dismiss', 'close_job', 'delete_job' 중 하나여야 합니다." });
  }

  const report = await get('SELECT * FROM job_reports WHERE id = ?', [reportId]);
  if (!report) return res.status(404).json({ error: '신고 내역을 찾을 수 없습니다.' });
  if (report.status !== 'pending') return res.status(400).json({ error: '이미 처리된 신고예요.' });

  const job = await get('SELECT * FROM jobs WHERE id = ?', [report.job_id]);

  // job_reports.job_id는 ON DELETE CASCADE라서, 공고를 먼저 지우면 이 신고 행(및 같은 공고의
  // 다른 신고들)도 함께 사라집니다. 그래서 신고 처리 상태를 먼저 남긴 뒤에 공고를 건드립니다.
  const resolvedStatus = action === 'dismiss' ? 'dismissed' : 'resolved';
  await run(
    'UPDATE job_reports SET status = ?, resolved_at = ?, admin_note = ? WHERE id = ?',
    [resolvedStatus, nowStr(), typeof note === 'string' ? note.trim().slice(0, 300) : '', reportId]
  );

  if (action === 'close_job' && job) {
    await run("UPDATE jobs SET status = 'closed' WHERE id = ?", [job.id]);
    await addNotification(job.company_id, {
      tag: '공고', title: '공고가 마감 처리됐어요',
      body: `"${job.title}" 공고가 신고 접수에 따라 마감 처리됐습니다. 문의사항은 고객센터로 연락해주세요.`,
      link: `jobDetail:${job.id}`,
    });
    pushTo(job.company_id, {
      kind: 'result', title: '📋 공고가 마감 처리됐어요',
      body: `"${job.title}" 공고가 신고 접수에 따라 마감 처리됐습니다.`,
      tag: `job-closed-${job.id}`, link: `jobDetail:${job.id}`,
    });
  } else if (action === 'delete_job' && job) {
    await addNotification(job.company_id, {
      tag: '공고', title: '공고가 삭제됐어요',
      body: `"${job.title}" 공고가 신고 접수에 따라 삭제됐습니다. 문의사항은 고객센터로 연락해주세요.`,
      link: 'jobs',
    });
    pushTo(job.company_id, {
      kind: 'result', title: '🗑️ 공고가 삭제됐어요',
      body: `"${job.title}" 공고가 신고 접수에 따라 삭제됐습니다.`,
      tag: `job-deleted-${job.id}`, link: 'jobs',
    });
    await run('DELETE FROM jobs WHERE id = ?', [job.id]);
  }

  res.json({ status: resolvedStatus, action });
});

module.exports = router;
