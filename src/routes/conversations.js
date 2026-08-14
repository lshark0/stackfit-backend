const express = require('express');
const { run, get, all } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

function counterpartName(conv, viewerRole) {
  if (viewerRole === 'freelancer') {
    const c = get('SELECT name FROM companies WHERE user_id = ?', [conv.company_id]);
    return c ? c.name : '기업';
  }
  const f = get('SELECT name FROM freelancer_profiles WHERE user_id = ?', [conv.freelancer_id]);
  return f ? f.name : '프리랜서';
}

router.get('/', requireAuth, (req, res) => {
  const col = req.user.role === 'freelancer' ? 'freelancer_id' : 'company_id';
  const convs = all(`SELECT * FROM conversations WHERE ${col} = ? ORDER BY created_at DESC, id DESC`, [req.user.id]);

  const result = convs.map(c => {
    const last = get('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', [c.id]);
    const unread = get(
      'SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND sender_id != ? AND created_at > COALESCE((SELECT MAX(created_at) FROM messages WHERE conversation_id=? AND sender_id=?), \'\')',
      [c.id, req.user.id, c.id, req.user.id]
    ).n;
    return { ...c, name: counterpartName(c, req.user.role), lastMessage: last, unread };
  });

  res.json({ conversations: result });
});

// 새 대화 시작 (없으면 생성, 있으면 재사용)
router.post('/', requireAuth, (req, res) => {
  const { companyId, freelancerId, jobId } = req.body || {};
  const cId = req.user.role === 'company' ? req.user.id : companyId;
  const fId = req.user.role === 'freelancer' ? req.user.id : freelancerId;
  if (!cId || !fId) return res.status(400).json({ error: 'companyId, freelancerId가 필요합니다.' });

  let conv = get('SELECT * FROM conversations WHERE company_id=? AND freelancer_id=? AND job_id IS ?', [cId, fId, jobId || null]);
  if (!conv) {
    const r = run('INSERT INTO conversations (company_id, freelancer_id, job_id) VALUES (?,?,?)', [cId, fId, jobId || null]);
    conv = get('SELECT * FROM conversations WHERE id = ?', [r.lastInsertRowid]);
  }
  res.status(201).json(conv);
});

router.get('/:id/messages', requireAuth, (req, res) => {
  const conv = get('SELECT * FROM conversations WHERE id = ?', [req.params.id]);
  if (!conv || (conv.company_id !== req.user.id && conv.freelancer_id !== req.user.id)) {
    return res.status(404).json({ error: '대화를 찾을 수 없습니다.' });
  }
  const msgs = all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC', [req.params.id]);
  res.json({ messages: msgs });
});

router.post('/:id/messages', requireAuth, (req, res) => {
  const { body } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: '메시지 내용을 입력해주세요.' });

  const conv = get('SELECT * FROM conversations WHERE id = ?', [req.params.id]);
  if (!conv || (conv.company_id !== req.user.id && conv.freelancer_id !== req.user.id)) {
    return res.status(404).json({ error: '대화를 찾을 수 없습니다.' });
  }

  run('INSERT INTO messages (conversation_id, sender_id, body) VALUES (?,?,?)', [conv.id, req.user.id, body.trim()]);
  const counterpartId = req.user.id === conv.company_id ? conv.freelancer_id : conv.company_id;
  run('INSERT INTO notifications (user_id, tag, title, body) VALUES (?,?,?,?)', [
    counterpartId, '메시지', '새 메시지가 도착했어요', body.trim().slice(0, 40),
  ]);

  const msgs = all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC', [conv.id]);
  res.status(201).json({ messages: msgs });
});

module.exports = router;
