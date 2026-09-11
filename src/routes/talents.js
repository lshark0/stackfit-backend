const express = require('express');
const { run, get, all } = require('../db');
const { signedFileUrl } = require('../fileAccess');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');
const { computeMatch } = require('../match');
const { getRatingSummary, getRatingSummaries } = require('../ratings');
const { sortPortfoliosByPeriod } = require('../periodSort');
const { matchesCategory } = require('../stackCatalog');
const { publicTalent } = require('../contact');
const { addNotification } = require('../notify');

const router = express.Router();
wrapAllRoutes(router);

router.get('/', requireAuth, requireRole('company'), async (req, res) => {
  const { q, category, jobId, grade, duty } = req.query;
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
    talents = talents.filter(t => matchesCategory(t.stack, category));
  }
  if (grade && grade !== '전체') {
    talents = talents.filter(t => t.grade === grade);
  }
  // 업무(직무)는 프리랜서가 자유롭게 입력하므로(예: "DBA / 튜닝 담당"),
  // 정확히 같은 값이 아니라 해당 키워드가 포함되는지로 걸러줍니다.
  if (duty && duty !== '전체') {
    const needle = String(duty).toLowerCase();
    talents = talents.filter(t => String(t.role_title || '').toLowerCase().includes(needle));
  }

  let jobStack = [];
  if (jobId) {
    const job = await get('SELECT stack_json FROM jobs WHERE id = ?', [jobId]);
    if (job) jobStack = JSON.parse(job.stack_json);
  }
  const proposalRows = await all('SELECT freelancer_id FROM proposals WHERE company_id = ?', [req.user.id]);
  const proposedIds = new Set(proposalRows.map(p => p.freelancer_id));
  const savedRows = await all('SELECT freelancer_id FROM saved_talents WHERE company_id = ?', [req.user.id]);
  const savedIds = new Set(savedRows.map(s => s.freelancer_id));

  // N+1 방지: 평점을 한 번의 쿼리로 일괄 조회한 뒤 메모리에서 조합합니다.
  const ratingById = await getRatingSummaries(talents.map((t) => t.user_id));
  const result = talents.map((t) => ({
    ...publicTalent(t),
    match: jobStack.length ? computeMatch(jobStack, t.stack) : Math.round(55 + t.stack.length * 6),
    proposed: proposedIds.has(t.user_id),
    saved: savedIds.has(t.user_id),
    ...(ratingById[t.user_id] || { rating_avg: null, rating_count: 0 }),
  }));

  res.json({ talents: result });
});

// [기업] 관심 인재 목록
router.get('/saved', requireAuth, requireRole('company'), async (req, res) => {
  const rows = await all(
    `SELECT f.* FROM saved_talents s
     JOIN freelancer_profiles f ON f.user_id = s.freelancer_id
     WHERE s.company_id = ?
     ORDER BY s.created_at DESC, s.id DESC`,
    [req.user.id]
  );
  const proposalRows = await all('SELECT freelancer_id FROM proposals WHERE company_id = ?', [req.user.id]);
  const proposedIds = new Set(proposalRows.map(p => p.freelancer_id));
  const ratingById = await getRatingSummaries(rows.map((t) => t.user_id));
  res.json({
    talents: rows.map((t) => {
      const stack = JSON.parse(t.stack_json);
      return {
        ...publicTalent(t),
        stack,
        match: Math.round(55 + stack.length * 6),
        proposed: proposedIds.has(t.user_id),
        saved: true,
        ...(ratingById[t.user_id] || { rating_avg: null, rating_count: 0 }),
      };
    }),
  });
});

// [기업] 관심 인재 등록/해제 토글
router.post('/:userId/save', requireAuth, requireRole('company'), async (req, res) => {
  const freelancerId = Number(req.params.userId);
  if (!Number.isInteger(freelancerId)) return res.status(400).json({ error: '올바르지 않은 사용자 ID입니다.' });
  const t = await get('SELECT user_id FROM freelancer_profiles WHERE user_id = ?', [freelancerId]);
  if (!t) return res.status(404).json({ error: '프로필을 찾을 수 없습니다.' });

  const existing = await get('SELECT id FROM saved_talents WHERE company_id=? AND freelancer_id=?', [req.user.id, freelancerId]);
  if (existing) {
    await run('DELETE FROM saved_talents WHERE id = ?', [existing.id]);
    return res.json({ saved: false });
  }
  await run('INSERT INTO saved_talents (company_id, freelancer_id) VALUES (?,?)', [req.user.id, freelancerId]);
  res.json({ saved: true });
});

router.get('/:userId', requireAuth, requireRole('company'), async (req, res) => {
  const freelancerId = Number(req.params.userId);
  if (!Number.isInteger(freelancerId)) return res.status(400).json({ error: '올바르지 않은 사용자 ID입니다.' });

  const t = await get('SELECT * FROM freelancer_profiles WHERE user_id = ?', [freelancerId]);
  if (!t) return res.status(404).json({ error: '프로필을 찾을 수 없습니다.' });
  const proposed = !!(await get('SELECT id FROM proposals WHERE company_id=? AND freelancer_id=?', [req.user.id, freelancerId]));
  const saved = !!(await get('SELECT id FROM saved_talents WHERE company_id=? AND freelancer_id=?', [req.user.id, freelancerId]));

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
    await addNotification(freelancerId, {
      tag: '열람', title: '프로필을 열람했어요',
      body: `${company ? company.name : '한 기업'}에서 회원님의 프로필을 확인했습니다.`,
      link: 'profileViews',
    });
  }

  const rating = await getRatingSummary(freelancerId);
  const portfolioRows = await all(
    'SELECT * FROM portfolios WHERE freelancer_id = ? ORDER BY created_at DESC, id DESC',
    [freelancerId]
  );

  res.json({
    ...publicTalent(t),
    stack: JSON.parse(t.stack_json),
    certs: JSON.parse(t.certs_json || '[]'),
    proposed,
    saved,
    resume_url: signedFileUrl(t.resume_filename),
    portfolios: sortPortfoliosByPeriod(portfolioRows).map((p) => ({ ...p, stack: JSON.parse(p.stack_json) })),
    ...rating,
  });
});

module.exports = router;
