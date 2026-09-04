const express = require('express');
const { run, all } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');

const router = express.Router();
wrapAllRoutes(router);

router.get('/', requireAuth, async (req, res) => {
  // 알림이 쌓여도 앱이 느려지지 않도록 최근 100건까지만 내려줍니다.
  const rows = await all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100', [req.user.id]);
  res.json({ notifications: rows });
});

router.patch('/:id/read', requireAuth, async (req, res) => {
  await run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

router.patch('/read-all', requireAuth, async (req, res) => {
  await run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
