const express = require('express');
const { run, get } = require('../db');
const { requireAuth, requireRole } = require('../middleware/requireAuth');

const router = express.Router();

router.post('/talents/:userId/propose', requireAuth, requireRole('company'), (req, res) => {
  const freelancerId = Number(req.params.userId);
  const { jobId } = req.body || {};

  const talent = get('SELECT * FROM freelancer_profiles WHERE user_id = ?', [freelancerId]);
  if (!talent) return res.status(404).json({ error: '프로필을 찾을 수 없습니다.' });

  const existing = get('SELECT id FROM proposals WHERE company_id=? AND freelancer_id=?', [req.user.id, freelancerId]);
  if (existing) return res.status(409).json({ error: '이미 제안을 보냈습니다.' });

  run('INSERT INTO proposals (company_id, freelancer_id, job_id) VALUES (?,?,?)', [req.user.id, freelancerId, jobId || null]);

  const company = get('SELECT name FROM companies WHERE user_id = ?', [req.user.id]);
  run('INSERT INTO notifications (user_id, tag, title, body) VALUES (?,?,?,?)', [
    freelancerId, '제안', '새로운 제안이 도착했어요', `${company.name}에서 포지션을 제안했습니다.`,
  ]);

  res.status(201).json({ proposed: true });
});

module.exports = router;
