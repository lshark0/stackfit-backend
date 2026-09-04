const express = require('express');
const { run, get, all } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');

const router = express.Router();
wrapAllRoutes(router);

router.get('/', requireAuth, async (req, res) => {
  const col = req.user.role === 'freelancer' ? 'freelancer_id' : 'company_id';
  const rows = await all(`SELECT * FROM projects WHERE ${col} = ? ORDER BY created_at DESC, id DESC`, [req.user.id]);

  // 각 프로젝트에 내가 이미 리뷰를 남겼는지, 그리고 상대방이 나에게 남긴 평가도 함께 내려줍니다.
  // 프로젝트 수만큼 쿼리를 반복하지 않도록, 관련된 리뷰를 한 번에 가져와 메모리에서 매칭합니다.
  const projectIds = rows.map((p) => p.id);
  let allReviews = [];
  if (projectIds.length) {
    const placeholders = projectIds.map(() => '?').join(',');
    allReviews = await all(`SELECT * FROM reviews WHERE project_id IN (${placeholders})`, projectIds);
  }
  const withReview = rows.map((p) => {
    const mine = allReviews.find((r) => r.project_id === p.id && r.reviewer_id === req.user.id);
    const received = allReviews.find((r) => r.project_id === p.id && r.reviewee_id === req.user.id);
    return {
      ...p,
      myReview: mine ? { rating: mine.rating } : null,
      receivedReview: received ? { rating: received.rating, comment: received.comment } : null,
    };
  });
  res.json({ projects: withReview });
});

router.patch('/:id/stage', requireAuth, async (req, res) => {
  const { stage } = req.body || {};
  if (![1, 2, 3, 4].includes(Number(stage))) {
    return res.status(400).json({ error: 'stage는 1~4 사이의 값이어야 합니다.' });
  }
  const col = req.user.role === 'freelancer' ? 'freelancer_id' : 'company_id';
  const project = await get(`SELECT * FROM projects WHERE id = ? AND ${col} = ?`, [req.params.id, req.user.id]);
  if (!project) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });

  const status = Number(stage) === 4 ? '완료' : '진행중';
  await run('UPDATE projects SET stage = ?, status = ? WHERE id = ?', [stage, status, project.id]);
  res.json(await get('SELECT * FROM projects WHERE id = ?', [project.id]));
});

// 완료된 프로젝트에 대해 상대방(기업↔프리랜서)을 리뷰/평점
router.post('/:id/review', requireAuth, async (req, res) => {
  const project = await get('SELECT * FROM projects WHERE id = ?', [req.params.id]);
  if (!project) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
  if (project.company_id !== req.user.id && project.freelancer_id !== req.user.id) {
    return res.status(403).json({ error: '이 프로젝트에 대한 권한이 없습니다.' });
  }
  if (project.status !== '완료') {
    return res.status(400).json({ error: '완료된 프로젝트만 리뷰를 남길 수 있어요.' });
  }

  const { rating, comment } = req.body || {};
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) {
    return res.status(400).json({ error: '평점은 1~5 사이의 정수여야 해요.' });
  }
  const safeComment = typeof comment === 'string' ? comment.trim().slice(0, 500) : '';
  const revieweeId = req.user.id === project.company_id ? project.freelancer_id : project.company_id;

  const existing = await get('SELECT id FROM reviews WHERE project_id=? AND reviewer_id=?', [project.id, req.user.id]);
  if (existing) return res.status(409).json({ error: '이미 이 프로젝트에 리뷰를 남겼어요.' });

  await run(
    'INSERT INTO reviews (project_id, reviewer_id, reviewee_id, rating, comment) VALUES (?,?,?,?,?)',
    [project.id, req.user.id, revieweeId, r, safeComment]
  );
  await run('INSERT INTO notifications (user_id, tag, title, body) VALUES (?,?,?,?)', [
    revieweeId, '리뷰', '새 리뷰가 도착했어요', `"${project.title}" 프로젝트에 대한 리뷰(★${r})가 등록됐습니다.`,
  ]);

  res.status(201).json({ ok: true });
});

// 이 프로젝트에서 내가 쓴 리뷰 / 상대방이 나에게 남긴 리뷰 조회
router.get('/:id/review', requireAuth, async (req, res) => {
  const project = await get('SELECT * FROM projects WHERE id = ?', [req.params.id]);
  if (!project) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
  if (project.company_id !== req.user.id && project.freelancer_id !== req.user.id) {
    return res.status(403).json({ error: '이 프로젝트에 대한 권한이 없습니다.' });
  }
  const rows = await all('SELECT * FROM reviews WHERE project_id = ?', [project.id]);
  const myReview = rows.find((r) => r.reviewer_id === req.user.id) || null;
  const receivedReview = rows.find((r) => r.reviewee_id === req.user.id) || null;
  res.json({ myReview, receivedReview });
});

module.exports = router;
