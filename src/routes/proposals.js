const express = require('express');
const { run, get, all } = require('../db');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');

const router = express.Router();
wrapAllRoutes(router);

router.post('/talents/:userId/propose', requireAuth, requireRole('company'), async (req, res) => {
  const freelancerId = Number(req.params.userId);
  const { jobId } = req.body || {};

  const talent = await get('SELECT * FROM freelancer_profiles WHERE user_id = ?', [freelancerId]);
  if (!talent) return res.status(404).json({ error: '프로필을 찾을 수 없습니다.' });

  const existing = await get('SELECT id FROM proposals WHERE company_id=? AND freelancer_id=?', [req.user.id, freelancerId]);
  if (existing) return res.status(409).json({ error: '이미 제안을 보냈습니다.' });

  await run('INSERT INTO proposals (company_id, freelancer_id, job_id) VALUES (?,?,?)', [req.user.id, freelancerId, jobId || null]);

  const company = await get('SELECT name FROM companies WHERE user_id = ?', [req.user.id]);
  await run('INSERT INTO notifications (user_id, tag, title, body) VALUES (?,?,?,?)', [
    freelancerId, '제안', '새로운 제안이 도착했어요', `${company.name}에서 포지션을 제안했습니다.`,
  ]);

  res.status(201).json({ proposed: true });
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
