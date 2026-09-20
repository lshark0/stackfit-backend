const express = require('express');
const { run, get, all } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { wrapAllRoutes } = require('../middleware/asyncHandler');

const router = express.Router();
wrapAllRoutes(router);

const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const KINDS = ['notice', 'event'];

// 고객센터 공지사항/이벤트·혜택 목록 — 로그인한 회원이면 누구나 조회 가능
router.get('/', requireAuth, async (req, res) => {
  const { kind } = req.query;
  if (!KINDS.includes(kind)) return res.status(400).json({ error: "kind는 'notice' 또는 'event'여야 합니다." });
  const rows = await all(
    'SELECT id, kind, title, body, created_at, updated_at FROM announcements WHERE kind = ? ORDER BY created_at DESC, id DESC',
    [kind]
  );
  res.json({ announcements: rows });
});

// 작성/수정/삭제는 관리자 계정만 가능
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { kind, title, body } = req.body || {};
  if (!KINDS.includes(kind)) return res.status(400).json({ error: "kind는 'notice' 또는 'event'여야 합니다." });
  const safeTitle = typeof title === 'string' ? title.trim().slice(0, 120) : '';
  if (!safeTitle) return res.status(400).json({ error: '제목을 입력해주세요.' });
  const safeBody = typeof body === 'string' ? body.trim().slice(0, 4000) : '';
  if (!safeBody) return res.status(400).json({ error: '내용을 입력해주세요.' });

  const now = nowStr();
  const r = await run(
    'INSERT INTO announcements (kind, title, body, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?)',
    [kind, safeTitle, safeBody, req.user.id, now, now]
  );
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '올바르지 않은 ID입니다.' });
  const existing = await get('SELECT id FROM announcements WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ error: '글을 찾을 수 없습니다.' });

  const { title, body } = req.body || {};
  const safeTitle = typeof title === 'string' ? title.trim().slice(0, 120) : '';
  if (!safeTitle) return res.status(400).json({ error: '제목을 입력해주세요.' });
  const safeBody = typeof body === 'string' ? body.trim().slice(0, 4000) : '';
  if (!safeBody) return res.status(400).json({ error: '내용을 입력해주세요.' });

  await run('UPDATE announcements SET title=?, body=?, updated_at=? WHERE id=?', [safeTitle, safeBody, nowStr(), id]);
  res.json({ updated: true });
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '올바르지 않은 ID입니다.' });
  const existing = await get('SELECT id FROM announcements WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ error: '글을 찾을 수 없습니다.' });
  await run('DELETE FROM announcements WHERE id = ?', [id]);
  res.json({ deleted: true });
});

module.exports = router;
