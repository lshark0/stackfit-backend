const express = require('express');
const { run, get } = require('../db');
const { hashPassword, verifyPassword, signToken } = require('../auth');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

router.post('/signup', (req, res) => {
  const { email, password, role, name, companyName } = req.body || {};
  if (!email || !password || !role) {
    return res.status(400).json({ error: 'email, password, role은 필수입니다.' });
  }
  if (!['freelancer', 'company'].includes(role)) {
    return res.status(400).json({ error: "role은 'freelancer' 또는 'company'여야 합니다." });
  }
  if (get('SELECT id FROM users WHERE email = ?', [email])) {
    return res.status(409).json({ error: '이미 가입된 이메일입니다.' });
  }

  const { hash, salt } = hashPassword(password);
  const r = run('INSERT INTO users (email, password_hash, password_salt, role) VALUES (?,?,?,?)', [email, hash, salt, role]);
  const userId = Number(r.lastInsertRowid);

  if (role === 'freelancer') {
    run('INSERT INTO freelancer_profiles (user_id, name) VALUES (?,?)', [userId, name || '이름 미입력']);
  } else {
    run('INSERT INTO companies (user_id, name) VALUES (?,?)', [userId, companyName || '회사명 미입력']);
  }

  const token = signToken({ id: userId, role, email });
  res.status(201).json({ token, user: { id: userId, email, role } });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !verifyPassword(password || '', user.password_hash, user.password_salt)) {
    return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
  }
  const token = signToken({ id: user.id, role: user.role, email: user.email });
  res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
