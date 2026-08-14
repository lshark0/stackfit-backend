const express = require('express');
const { run, all } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const rows = all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC', [req.user.id]);
  res.json({ notifications: rows });
});

router.patch('/:id/read', requireAuth, (req, res) => {
  run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

router.patch('/read-all', requireAuth, (req, res) => {
  run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
