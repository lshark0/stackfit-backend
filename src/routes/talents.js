const express = require('express');
const { run, get, all } = require('../db');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');
const { computeMatch } = require('../match');
const { getRatingSummary } = require('../ratings');

const router = express.Router();
wrapAllRoutes(router);

router.get('/', requireAuth, requireRole('company'), async (req, res) => {
  const { q, category, jobId } = req.query;
  const rows = await all('SELECT * FROM freelancer_profiles');
  let talents = rows.map(t => ({ ...t, stack: JSON.parse(t.stack_json) }));

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
    const job = await get('SELECT stack_json FROM jobs WHERE id = ?', [jobId]);
    if (job) jobStack = JSON.parse(job.stack_json);
  }
  const proposalRows = await all('SELECT freelancer_id FROM proposals WHERE company_id = ?', [req.user.id]);
  const proposedIds = new Set(proposalRows.map(p => p.freelancer_id));

  const result = [];
  for (const t of talents) {
    const rating = await getRatingSummary(t.user_id);
    result.push({
      ...t,
      match: jobStack.length ? computeMatch(jobStack, t.stack) : Math.round(55 + t.stack.length * 6),
      proposed: proposedIds.has(t.user_id),
      ...rating,
    });
  }

  res.json({ talents: result });
});

router.get('/:userId', requireAuth, requireRole('company'), async (req, res) => {
  const freelancerId = Number(req.params.userId);
  if (!Number.isInteger(freelancerId)) return res.status(400).json({ error: '올바르지 않은 사용자 ID입니다.' });

  const t = await get('SELECT * FROM freelancer_profiles WHERE user_id = ?', [freelancerId]);
  if (!t) return res.status(404).json({ error: '프로필을 찾을 수 없습니다.' });
  const proposed = !!(await get('SELECT id FROM proposals WHERE company_id=? AND freelancer_id=?', [req.user.id, freelancerId]));

  // 열람 기록 남기기 + (같은 기업이 최근 6시간 내 이미 봤으면 중복 알림은 생략)
  const lastView = await get(
    'SELECT created_at FROM profile_views WHERE freelancer_id=? AND company_id=? ORDER BY created_at DESC, id DESC LIMIT 1',
    [freelancerId, req.user.id]
  );
  const sixHoursMs = 6 * 60 * 60 * 1000;
  const isRecent = lastView && (Date.now() - new Date(lastView.created_at).getTime()) < sixHoursMs;

  await run('INSERT INTO profile_views (freelancer_id, company_id) VALUES (?,?)', [freelancerId, req.user.id]);
  if (!isRecent) {
    const company = await get('SELECT name FROM companies WHERE user_id = ?', [req.user.id]);
    await run('INSERT INTO notifications (user_id, tag, title, body) VALUES (?,?,?,?)', [
      freelancerId, '열람', '프로필을 열람했어요', `${company ? company.name : '한 기업'}에서 회원님의 프로필을 확인했습니다.`,
    ]);
  }

  const rating = await getRatingSummary(freelancerId);

  res.json({
    ...t,
    stack: JSON.parse(t.stack_json),
    proposed,
    resume_url: t.resume_filename ? `/uploads/${t.resume_filename}` : null,
    ...rating,
  });
});

module.exports = router;
