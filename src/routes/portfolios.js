const express = require('express');
const { run, get, all } = require('../db');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');
const { sortPortfoliosByPeriod } = require('../periodSort');

const router = express.Router();
wrapAllRoutes(router);

const MAX_ITEMS = 30; // 한 사람이 등록할 수 있는 포트폴리오 개수 상한

const clean = (v, max, fallback = '') =>
  (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback);

const parseStack = (stack) =>
  (Array.isArray(stack) ? stack : [])
    .filter((s) => typeof s === 'string' && s.trim())
    .slice(0, 20)
    .map((s) => s.trim().slice(0, 40));

// http/https 링크만 허용 (javascript: 등 위험한 스킴 차단)
function safeUrl(url) {
  const v = clean(url, 500);
  if (!v) return '';
  return /^https?:\/\//i.test(v) ? v : '';
}

const withStack = (row) => ({ ...row, stack: JSON.parse(row.stack_json) });

// 내 포트폴리오 목록
router.get('/', requireAuth, requireRole('freelancer'), async (req, res) => {
  const rows = await all(
    'SELECT * FROM portfolios WHERE freelancer_id = ? ORDER BY created_at DESC, id DESC',
    [req.user.id]
  );
  // 등록 순서가 아니라, 실제 프로젝트 참여 기간 기준 최신순으로 보여줍니다.
  res.json({ portfolios: sortPortfoliosByPeriod(rows).map(withStack) });
});

// 포트폴리오 추가
router.post('/', requireAuth, requireRole('freelancer'), async (req, res) => {
  const { title, client, role_title, period, stack, description, link_url } = req.body || {};
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: '프로젝트명은 필수입니다.' });
  }

  const countRow = await get('SELECT COUNT(*) AS c FROM portfolios WHERE freelancer_id = ?', [req.user.id]);
  if (Number(countRow.c) >= MAX_ITEMS) {
    return res.status(400).json({ error: `포트폴리오는 최대 ${MAX_ITEMS}개까지 등록할 수 있어요.` });
  }

  const r = await run(
    `INSERT INTO portfolios (freelancer_id, title, client, role_title, period, stack_json, description, link_url)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      req.user.id,
      clean(title, 120),
      clean(client, 60),
      clean(role_title, 60),
      clean(period, 40),
      JSON.stringify(parseStack(stack)),
      clean(description, 2000),
      safeUrl(link_url),
    ]
  );
  const created = await get('SELECT * FROM portfolios WHERE id = ?', [r.lastInsertRowid]);
  res.status(201).json(withStack(created));
});

// 포트폴리오 수정 (본인 것만)
router.put('/:id', requireAuth, requireRole('freelancer'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '올바르지 않은 ID입니다.' });

  const item = await get('SELECT * FROM portfolios WHERE id = ? AND freelancer_id = ?', [id, req.user.id]);
  if (!item) return res.status(404).json({ error: '포트폴리오를 찾을 수 없거나 권한이 없어요.' });

  const { title, client, role_title, period, stack, description, link_url } = req.body || {};
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: '프로젝트명은 필수입니다.' });
  }

  await run(
    `UPDATE portfolios SET title=?, client=?, role_title=?, period=?, stack_json=?, description=?, link_url=? WHERE id=?`,
    [
      clean(title, 120, item.title),
      clean(client, 60, item.client),
      clean(role_title, 60, item.role_title),
      clean(period, 40, item.period),
      JSON.stringify(Array.isArray(stack) ? parseStack(stack) : JSON.parse(item.stack_json)),
      clean(description, 2000, item.description),
      link_url === undefined ? item.link_url : safeUrl(link_url),
      id,
    ]
  );
  res.json(withStack(await get('SELECT * FROM portfolios WHERE id = ?', [id])));
});

// 포트폴리오 삭제 (본인 것만)
router.delete('/:id', requireAuth, requireRole('freelancer'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '올바르지 않은 ID입니다.' });

  const item = await get('SELECT id FROM portfolios WHERE id = ? AND freelancer_id = ?', [id, req.user.id]);
  if (!item) return res.status(404).json({ error: '포트폴리오를 찾을 수 없거나 권한이 없어요.' });

  await run('DELETE FROM portfolios WHERE id = ?', [id]);
  res.json({ deleted: true });
});

module.exports = router;
