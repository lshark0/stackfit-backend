const express = require('express');
const { get, all } = require('../db');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { computeMatch } = require('../match');

const router = express.Router();

router.get('/', requireAuth, requireRole('company'), (req, res) => {
  const { q, category, jobId } = req.query;
  let talents = all('SELECT * FROM freelancer_profiles').map(t => ({ ...t, stack: JSON.parse(t.stack_json) }));

  if (q) {
    const needle = String(q).toLowerCase();
    talents = talents.filter(t =>
      t.name.toLowerCase().includes(needle) ||
      t.role_title.toLowerCase().includes(needle) ||
      t.stack.some(s => s.toLowerCase().includes(needle))
    );
  }
  if (category && category !== '전체') {
    talents = talents.filter(t => t.stack.some(s => s.toLowerCase().includes(String(category).toLowerCase())));
  }

  let jobStack = [];
  if (jobId) {
    const job = get('SELECT stack_json FROM jobs WHERE id = ?', [jobId]);
    if (job) jobStack = JSON.parse(job.stack_json);
  }
  const proposedIds = new Set(
    all('SELECT freelancer_id FROM proposals WHERE company_id = ?', [req.user.id]).map(p => p.freelancer_id)
  );

  const result = talents.map(t => ({
    ...t,
    match: jobStack.length ? computeMatch(jobStack, t.stack) : Math.round(55 + t.stack.length * 6),
    proposed: proposedIds.has(t.user_id),
  }));

  res.json({ talents: result });
});

router.get('/:userId', requireAuth, requireRole('company'), (req, res) => {
  const t = get('SELECT * FROM freelancer_profiles WHERE user_id = ?', [req.params.userId]);
  if (!t) return res.status(404).json({ error: '프로필을 찾을 수 없습니다.' });
  const proposed = !!get('SELECT id FROM proposals WHERE company_id=? AND freelancer_id=?', [req.user.id, req.params.userId]);
  res.json({
    ...t,
    stack: JSON.parse(t.stack_json),
    proposed,
    resume_url: t.resume_filename ? `/uploads/${t.resume_filename}` : null,
  });
});

module.exports = router;
