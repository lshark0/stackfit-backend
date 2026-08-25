const express = require('express');
const { run, get, all } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');

const router = express.Router();
wrapAllRoutes(router);

router.get('/', requireAuth, async (req, res) => {
  const col = req.user.role === 'freelancer' ? 'freelancer_id' : 'company_id';
  const rows = await all(`SELECT * FROM projects WHERE ${col} = ? ORDER BY created_at DESC, id DESC`, [req.user.id]);
  res.json({ projects: rows });
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

module.exports = router;
