const express = require('express');
const { run, get, all } = require('../db');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');

const router = express.Router();
wrapAllRoutes(router);

// 관심기업 등록/해제 토글 (프리랜서 전용)
router.post('/:companyId/follow', requireAuth, requireRole('freelancer'), async (req, res) => {
  const companyId = Number(req.params.companyId);
  if (!Number.isInteger(companyId)) return res.status(400).json({ error: '올바르지 않은 기업 ID입니다.' });

  const company = await get('SELECT user_id FROM companies WHERE user_id = ?', [companyId]);
  if (!company) return res.status(404).json({ error: '기업을 찾을 수 없습니다.' });

  const existing = await get('SELECT id FROM followed_companies WHERE freelancer_id=? AND company_id=?', [req.user.id, companyId]);
  if (existing) {
    await run('DELETE FROM followed_companies WHERE id = ?', [existing.id]);
    return res.json({ following: false });
  }
  await run('INSERT INTO followed_companies (freelancer_id, company_id) VALUES (?,?)', [req.user.id, companyId]);
  res.json({ following: true });
});

// 관심기업 목록 (프리랜서 전용) — 각 기업의 현재 채용중 공고 수 포함
router.get('/followed', requireAuth, requireRole('freelancer'), async (req, res) => {
  const rows = await all(
    `SELECT c.user_id, c.name, c.description,
       (SELECT COUNT(*) FROM jobs j WHERE j.company_id = c.user_id AND j.status = 'open') AS open_jobs
     FROM followed_companies fc
     JOIN companies c ON c.user_id = fc.company_id
     WHERE fc.freelancer_id = ?
     ORDER BY fc.created_at DESC, fc.id DESC`,
    [req.user.id]
  );
  res.json({ companies: rows.map((r) => ({ ...r, open_jobs: Number(r.open_jobs) })) });
});

module.exports = router;
