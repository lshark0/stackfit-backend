const express = require('express');
const crypto = require('crypto');
const { run, get } = require('../db');
const { signToken, verifyToken, hashPassword } = require('../auth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');
const { PROVIDERS, isConfigured, buildAuthorizeUrl, exchangeCode } = require('../oauth');

const router = express.Router();
wrapAllRoutes(router);

router.get('/:provider/start', (req, res) => {
  const { provider } = req.params;
  if (!PROVIDERS[provider]) return res.status(404).send('지원하지 않는 로그인 방식이에요.');
  if (!isConfigured(provider)) {
    return res.redirect(`/?oauth_error=${provider}_not_configured`);
  }
  const state = signToken({ purpose: 'oauth_state', provider }, 600);
  res.redirect(buildAuthorizeUrl(provider, state, req));
});

router.get('/:provider/callback', async (req, res) => {
  const { provider } = req.params;
  const { code, state } = req.query;

  if (!PROVIDERS[provider] || !isConfigured(provider)) {
    return res.redirect(`/?oauth_error=${provider}_not_configured`);
  }
  const statePayload = verifyToken(state);
  if (!statePayload || statePayload.purpose !== 'oauth_state' || statePayload.provider !== provider) {
    return res.redirect(`/?oauth_error=invalid_state`);
  }
  if (!code) return res.redirect(`/?oauth_error=no_code`);

  let accessToken, profile;
  try {
    accessToken = await exchangeCode(provider, code, state, req);
    profile = await PROVIDERS[provider].getProfile(accessToken);
  } catch (e) {
    return res.redirect(`/?oauth_error=exchange_failed`);
  }
  if (!profile || !profile.id) {
    return res.redirect(`/?oauth_error=no_profile`);
  }

  // 1) 이미 이 소셜 계정으로 가입된 사용자가 있으면 바로 로그인
  let user = await get('SELECT * FROM users WHERE oauth_provider=? AND oauth_id=?', [provider, profile.id]);

  // 2) 같은 이메일의 기존 계정이 있으면 소셜 로그인을 연결
  if (!user && profile.email) {
    const existing = await get('SELECT * FROM users WHERE email=?', [profile.email]);
    if (existing) {
      await run('UPDATE users SET oauth_provider=?, oauth_id=? WHERE id=?', [provider, profile.id, existing.id]);
      user = existing;
    }
  }

  if (user) {
    const token = signToken({ id: user.id, role: user.role, email: user.email });
    return res.redirect(`/?token=${encodeURIComponent(token)}`);
  }

  // 3) 신규 사용자 — 역할(프리랜서/기업) 선택이 필요하므로 임시 토큰으로 프론트에 전달
  const pendingToken = signToken(
    { pending: true, provider, oauthId: profile.id, email: profile.email || '', name: profile.name || '' },
    600
  );
  const qs = new URLSearchParams({ oauth_pending: pendingToken, name: profile.name || '', email: profile.email || '' });
  res.redirect(`/?${qs.toString()}`);
});

router.post('/finish', async (req, res) => {
  const { pendingToken, role, name } = req.body || {};
  const payload = verifyToken(pendingToken);
  if (!payload || !payload.pending) {
    return res.status(400).json({ error: '인증 정보가 만료됐어요. 다시 시도해주세요.' });
  }
  if (!['freelancer', 'company'].includes(role)) {
    return res.status(400).json({ error: "role은 'freelancer' 또는 'company'여야 합니다." });
  }

  const email = payload.email || `${payload.provider}_${payload.oauthId}@stackfit.local`;
  const already = await get('SELECT id FROM users WHERE email=?', [email]);
  if (already) {
    return res.status(409).json({ error: '이미 같은 이메일로 가입된 계정이 있어요. 일반 로그인을 이용해주세요.' });
  }

  // 소셜 계정은 비밀번호 로그인을 쓰지 않으므로, 추측 불가능한 무작위 값을 채워둡니다.
  const { hash, salt } = hashPassword(crypto.randomBytes(32).toString('hex'));
  const r = await run(
    'INSERT INTO users (email, password_hash, password_salt, role, oauth_provider, oauth_id) VALUES (?,?,?,?,?,?)',
    [email, hash, salt, role, payload.provider, payload.oauthId]
  );
  const userId = Number(r.lastInsertRowid);
  const safeName = (name || payload.name || '이름 미입력').toString().trim().slice(0, 60) || '이름 미입력';

  if (role === 'freelancer') {
    await run('INSERT INTO freelancer_profiles (user_id, name) VALUES (?,?)', [userId, safeName]);
  } else {
    await run('INSERT INTO companies (user_id, name) VALUES (?,?)', [userId, safeName]);
  }

  const token = signToken({ id: userId, role, email });
  res.status(201).json({ token, user: { id: userId, email, role } });
});

module.exports = router;
