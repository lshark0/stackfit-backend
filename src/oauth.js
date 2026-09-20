const PROVIDERS = {
  google: {
    label: '구글',
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    async getProfile(accessToken) {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      // 이메일이 검증되지 않은 상태라면 계정 자동연동에 쓰지 않습니다 (계정 탈취 방지).
      const email = data.email_verified ? data.email : null;
      return { id: data.sub, email, name: data.name };
    },
  },
  naver: {
    label: '네이버',
    clientId: process.env.NAVER_CLIENT_ID,
    clientSecret: process.env.NAVER_CLIENT_SECRET,
    authorizeUrl: 'https://nid.naver.com/oauth2.0/authorize',
    tokenUrl: 'https://nid.naver.com/oauth2.0/token',
    scope: '',
    async getProfile(accessToken) {
      const res = await fetch('https://openapi.naver.com/v1/nid/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      const p = data.response || {};
      return { id: p.id, email: p.email, name: p.name };
    },
  },
  kakao: {
    label: '카카오',
    clientId: process.env.KAKAO_CLIENT_ID,
    clientSecret: process.env.KAKAO_CLIENT_SECRET,
    authorizeUrl: 'https://kauth.kakao.com/oauth/authorize',
    tokenUrl: 'https://kauth.kakao.com/oauth/token',
    scope: '',
    async getProfile(accessToken) {
      const res = await fetch('https://kapi.kakao.com/v2/user/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      const account = data.kakao_account || {};
      return {
        id: String(data.id),
        email: account.email || `kakao_${data.id}@stackfit.local`,
        name: (account.profile && account.profile.nickname) || '카카오사용자',
      };
    },
  },
};

function isConfigured(provider) {
  const cfg = PROVIDERS[provider];
  return !!(cfg && cfg.clientId);
}

// Render 등 프록시 뒤에서도 올바른 https 주소가 나오도록 요청에서 동적으로 구성합니다.
function redirectUri(provider, req) {
  return `${req.protocol}://${req.get('host')}/api/auth/oauth/${provider}/callback`;
}

function buildAuthorizeUrl(provider, state, req) {
  const cfg = PROVIDERS[provider];
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(provider, req),
    response_type: 'code',
    state,
  });
  if (cfg.scope) params.set('scope', cfg.scope);
  return `${cfg.authorizeUrl}?${params.toString()}`;
}

async function exchangeCode(provider, code, state, req) {
  const cfg = PROVIDERS[provider];
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret || '',
    redirect_uri: redirectUri(provider, req),
    code,
  });
  if (provider === 'naver') body.set('state', state);

  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error('토큰 교환에 실패했어요.');
  }
  return data.access_token;
}

module.exports = { PROVIDERS, isConfigured, buildAuthorizeUrl, exchangeCode };
