const express = require('express');
const { run, get } = require('../db');
const { hashPassword, verifyPassword, signToken } = require('../auth');
const { requireAuth } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');

const router = express.Router();
wrapAllRoutes(router);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).+$/; // 영문 1자 이상 + 숫자 1자 이상

router.post('/signup', async (req, res) => {
  let { email, password, role, name, companyName } = req.body || {};
  email = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!email || !password || !role) {
    return res.status(400).json({ error: 'email, password, role은 필수입니다.' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: '올바른 이메일 형식이 아니에요.' });
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LEN || !PASSWORD_RE.test(password)) {
    return res.status(400).json({ error: `비밀번호는 영문과 숫자를 포함해 ${MIN_PASSWORD_LEN}자 이상이어야 해요.` });
  }
  if (!['freelancer', 'company'].includes(role)) {
    return res.status(400).json({ error: "role은 'freelancer' 또는 'company'여야 합니다." });
  }
  if (await get('SELECT id FROM users WHERE email = ?', [email])) {
    return res.status(409).json({ error: '이미 가입된 이메일입니다.' });
  }

  const { hash, salt } = hashPassword(password);
  const r = await run('INSERT INTO users (email, password_hash, password_salt, role) VALUES (?,?,?,?)', [email, hash, salt, role]);
  const userId = Number(r.lastInsertRowid);

  if (role === 'freelancer') {
    await run('INSERT INTO freelancer_profiles (user_id, name, completion) VALUES (?,?,20)', [userId, (name || '이름 미입력').slice(0, 60)]);
  } else {
    await run('INSERT INTO companies (user_id, name) VALUES (?,?)', [userId, (companyName || '회사명 미입력').slice(0, 60)]);
  }

  const token = signToken({ id: userId, role, email });
  res.status(201).json({ token, user: { id: userId, email, role } });
});

router.post('/login', async (req, res) => {
  let { email, password } = req.body || {};
  email = typeof email === 'string' ? email.trim().toLowerCase() : '';

  // 이메일 존재 여부가 응답 내용/시간차로 드러나지 않도록 항상 동일한 오류 메시지 사용
  const genericError = () => res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });

  if (!email || !password) return genericError();

  const user = await get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user) {
    // 존재하지 않는 계정이어도 동일한 지연을 주어 계정 존재 여부를 타이밍으로 추측하기 어렵게 함
    hashPassword(password);
    return genericError();
  }
  if (!verifyPassword(password, user.password_hash, user.password_salt)) {
    return genericError();
  }

  const token = signToken({ id: user.id, role: user.role, email: user.email });
  res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await get('SELECT id, email, role, oauth_provider FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: '계정을 찾을 수 없습니다.' });
  res.json({ user: { id: user.id, email: user.email, role: user.role, hasPassword: !user.oauth_provider } });
});

// 비밀번호 변경 (이메일/비밀번호로 가입한 계정만 — 소셜 전용 계정은 대상 아님)
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const user = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: '계정을 찾을 수 없습니다.' });
  if (user.oauth_provider) {
    return res.status(400).json({ error: '소셜 로그인 계정은 비밀번호 변경이 필요 없어요.' });
  }
  if (!currentPassword || !verifyPassword(currentPassword, user.password_hash, user.password_salt)) {
    return res.status(401).json({ error: '현재 비밀번호가 올바르지 않아요.' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LEN || !PASSWORD_RE.test(newPassword)) {
    return res.status(400).json({ error: `새 비밀번호는 영문과 숫자를 포함해 ${MIN_PASSWORD_LEN}자 이상이어야 해요.` });
  }
  const { hash, salt } = hashPassword(newPassword);
  await run('UPDATE users SET password_hash=?, password_salt=? WHERE id=?', [hash, salt, user.id]);
  res.json({ ok: true });
});

// 회원탈퇴 — 이메일 계정은 비밀번호 확인, 소셜 계정은 확인 없이 즉시 삭제 (연관 데이터는 CASCADE로 함께 삭제됨)
router.delete('/me', requireAuth, async (req, res) => {
  const { password } = req.body || {};
  const user = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: '계정을 찾을 수 없습니다.' });
  if (!user.oauth_provider) {
    if (!password || !verifyPassword(password, user.password_hash, user.password_salt)) {
      return res.status(401).json({ error: '비밀번호가 올바르지 않아요.' });
    }
  }
  await run('DELETE FROM users WHERE id = ?', [user.id]);
  res.json({ ok: true });
});

module.exports = router;
