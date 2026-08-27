const express = require('express');
const crypto = require('crypto');
const { run, get } = require('../db');
const { signToken, verifyToken, hashPassword } = require('../auth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');
const { PROVIDERS, isConfigured, buildAuthorizeUrl, exchangeCode } = require('../oauth');

const router = express.Router();
wrapAllRoutes(router);

// ── 임시 진단 화면 ──────────────────────────────────────────────
// OAuth 결과가 사용자에게 보이지 않고 바로 넘어가버리는 문제를 진단하기 위해,
// 자동으로 리다이렉트하지 않고 결과를 화면에 띄운 뒤 사용자가 직접 "계속하기"를
//눌러야 다음으로 넘어가도록 만든 임시 페이지입니다. 원인 파악 후 제거 예정입니다.
function debugLanding({ title, detailLines, continueUrl }) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rows = detailLines.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0; color:#5B6472; white-space:nowrap; vertical-align:top;">${esc(k)}</td><td style="padding:6px 0; word-break:break-all;"><code>${esc(v)}</code></td></tr>`).join('');
  return `<!doctype html>
<html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>로그인 진단</title></head>
<body style="font-family:-apple-system,'Pretendard',sans-serif; max-width:600px; margin:0 auto; padding:28px 20px; background:#F7F6F2; color:#14171C;">
  <h2 style="margin-bottom:4px;">${esc(title)}</h2>
  <p style="color:#5B6472; font-size:13px; margin-bottom:20px;">이 화면은 로그인 문제를 진단하기 위한 임시 화면이에요. 아래 내용을 캡처해서 보내주세요.</p>
  <table style="width:100%; background:#fff; border:1px solid #E1DED6; border-radius:12px; padding:14px; border-collapse:collapse; font-size:13px;">${rows}</table>
  <a href="${continueUrl}" style="display:inline-block; margin-top:22px; padding:13px 22px; background:#14171C; color:#F5D9A8; text-decoration:none; border-radius:10px; font-weight:600;">앱으로 계속하기 →</a>
</body></html>`;
}

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
    return res.send(debugLanding({
      title: '설정 오류',
      detailLines: [['provider', provider], ['오류', `${provider}_not_configured`]],
      continueUrl: `/?oauth_error=${provider}_not_configured`,
    }));
  }
  const statePayload = verifyToken(state);
  if (!statePayload || statePayload.purpose !== 'oauth_state' || statePayload.provider !== provider) {
    return res.send(debugLanding({
      title: 'state 검증 실패',
      detailLines: [['provider', provider], ['받은 state', state || '(없음)'], ['오류', 'invalid_state']],
      continueUrl: `/?oauth_error=invalid_state`,
    }));
  }
  if (!code) {
    return res.send(debugLanding({
      title: '인증 코드 없음',
      detailLines: [['provider', provider], ['query', JSON.stringify(req.query)]],
      continueUrl: `/?oauth_error=no_code`,
    }));
  }

  let accessToken, profile, exchangeErr;
  try {
    accessToken = await exchangeCode(provider, code, state, req);
    profile = await PROVIDERS[provider].getProfile(accessToken);
  } catch (e) {
    exchangeErr = e;
  }
  if (exchangeErr) {
    return res.send(debugLanding({
      title: '토큰 교환/프로필 조회 실패',
      detailLines: [['provider', provider], ['에러', exchangeErr.message || String(exchangeErr)]],
      continueUrl: `/?oauth_error=exchange_failed`,
    }));
  }
  if (!profile || !profile.id) {
    return res.send(debugLanding({
      title: '프로필 조회 실패',
      detailLines: [['provider', provider], ['profile', JSON.stringify(profile)]],
      continueUrl: `/?oauth_error=no_profile`,
    }));
  }

  let user = await get('SELECT * FROM users WHERE oauth_provider=? AND oauth_id=?', [provider, profile.id]);
  if (!user && profile.email) {
    const existing = await get('SELECT * FROM users WHERE email=?', [profile.email]);
    if (existing) {
      await run('UPDATE users SET oauth_provider=?, oauth_id=? WHERE id=?', [provider, profile.id, existing.id]);
      user = existing;
    }
  }

  if (user) {
    const token = signToken({ id: user.id, role: user.role, email: user.email });
    return res.send(debugLanding({
      title: '로그인 성공 (기존 계정)',
      detailLines: [
        ['provider', provider],
        ['user.id', user.id],
        ['user.email', user.email],
        ['user.role', user.role],
        ['token(앞 20자)', token.slice(0, 20) + '...'],
        ['이동할 주소', `/?token=${token.slice(0, 12)}...(생략)`],
      ],
      continueUrl: `/?token=${encodeURIComponent(token)}`,
    }));
  }

  const pendingToken = signToken(
    { pending: true, provider, oauthId: profile.id, email: profile.email || '', name: profile.name || '' },
    600
  );
  const qs = new URLSearchParams({ oauth_pending: pendingToken, name: profile.name || '', email: profile.email || '' });
  return res.send(debugLanding({
    title: '신규 사용자 (역할 선택 필요)',
    detailLines: [
      ['provider', provider],
      ['profile.email', profile.email || '(없음)'],
      ['profile.name', profile.name || '(없음)'],
      ['이동할 주소', `/?${qs.toString()}`.slice(0, 100) + '...'],
    ],
    continueUrl: `/?${qs.toString()}`,
  }));
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
