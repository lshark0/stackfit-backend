const express = require('express');
const { run, get, all } = require('../db');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');

const router = express.Router();
wrapAllRoutes(router);

router.post('/talents/:userId/propose', requireAuth, requireRole('company'), async (req, res) => {
  const freelancerId = Number(req.params.userId);
  if (!Number.isInteger(freelancerId)) return res.status(400).json({ error: '올바르지 않은 사용자 ID입니다.' });
  const { jobId } = req.body || {};

  const talent = await get('SELECT * FROM freelancer_profiles WHERE user_id = ?', [freelancerId]);
  if (!talent) return res.status(404).json({ error: '프로필을 찾을 수 없습니다.' });

  // 공고를 지정한 경우, 본인 기업의 실제 공고가 맞는지 확인합니다.
  let safeJobId = null;
  if (jobId !== undefined && jobId !== null && jobId !== '') {
    const jid = Number(jobId);
    if (!Number.isInteger(jid)) return res.status(400).json({ error: '올바르지 않은 공고 ID입니다.' });
    const job = await get('SELECT id FROM jobs WHERE id = ? AND company_id = ?', [jid, req.user.id]);
    if (!job) return res.status(404).json({ error: '공고를 찾을 수 없습니다.' });
    safeJobId = jid;
  }

  const existing = await get('SELECT id FROM proposals WHERE company_id=? AND freelancer_id=?', [req.user.id, freelancerId]);
  if (existing) return res.status(409).json({ error: '이미 제안을 보냈습니다.' });

  await run('INSERT INTO proposals (company_id, freelancer_id, job_id) VALUES (?,?,?)', [req.user.id, freelancerId, safeJobId]);

  const company = await get('SELECT name FROM companies WHERE user_id = ?', [req.user.id]);
  await run('INSERT INTO notifications (user_id, tag, title, body) VALUES (?,?,?,?)', [
    freelancerId, '제안', '새로운 제안이 도착했어요', `${company ? company.name : '한 기업'}에서 포지션을 제안했습니다.`,
  ]);

  res.status(201).json({ proposed: true });
});

// 제안 취소 (기업 전용, 본인이 보낸 제안만)
router.delete('/talents/:userId/propose', requireAuth, requireRole('company'), async (req, res) => {
  const freelancerId = Number(req.params.userId);
  if (!Number.isInteger(freelancerId)) return res.status(400).json({ error: '올바르지 않은 사용자 ID입니다.' });

  const existing = await get('SELECT id FROM proposals WHERE company_id=? AND freelancer_id=?', [req.user.id, freelancerId]);
  if (!existing) return res.status(404).json({ error: '보낸 제안을 찾을 수 없습니다.' });

  await run('DELETE FROM proposals WHERE id = ?', [existing.id]);

  // 상대가 아직 읽지 않은 제안 알림이 남아있다면 함께 지웁니다.
  // (이미 읽은 알림은 상대가 본 기록이므로 남겨둡니다.)
  const company = await get('SELECT name FROM companies WHERE user_id = ?', [req.user.id]);
  const companyName = company ? company.name : '한 기업';
  await run(
    "DELETE FROM notifications WHERE user_id = ? AND tag = '제안' AND is_read = 0 AND body = ?",
    [freelancerId, `${companyName}에서 포지션을 제안했습니다.`]
  );

  res.json({ proposed: false });
});

// 내가(프리랜서) 받은 제안 목록
router.get('/proposals/received', requireAuth, requireRole('freelancer'), async (req, res) => {
  const rows = await all(
    `SELECT p.id, p.created_at, p.job_id, p.company_id,
            c.name AS company_name, c.description AS company_description,
            j.title AS job_title
     FROM proposals p
     JOIN companies c ON c.user_id = p.company_id
     LEFT JOIN jobs j ON j.id = p.job_id
     WHERE p.freelancer_id = ?
     ORDER BY p.created_at DESC, p.id DESC`,
    [req.user.id]
  );
  res.json({ proposals: rows });
});

module.exports = router;
