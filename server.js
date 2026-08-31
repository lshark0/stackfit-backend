const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { initDb, get, USE_POSTGRES } = require('./src/db');

const authRoutes = require('./src/routes/auth');
const profileRoutes = require('./src/routes/profile');
const jobRoutes = require('./src/routes/jobs');
const applicationRoutes = require('./src/routes/applications');
const talentRoutes = require('./src/routes/talents');
const proposalRoutes = require('./src/routes/proposals');
const projectRoutes = require('./src/routes/projects');
const conversationRoutes = require('./src/routes/conversations');
const notificationRoutes = require('./src/routes/notifications');
const companyRoutes = require('./src/routes/companies');
const oauthRoutes = require('./src/routes/oauth');
const { verifyToken } = require('./src/auth');

const app = express();
app.set('trust proxy', 1); // Render는 프록시 뒤에 있으므로 rate-limit이 실제 클라이언트 IP를 보게 함

// 보안 HTTP 헤더. CSP는 정적 프론트엔드가 인라인 스크립트/스타일을 쓰므로 완화해서 적용.
app.use(
  helmet({
    contentSecurityPolicy: false, // 프론트엔드가 단일 HTML(인라인 script/style)이라 기본 CSP와 충돌함
    crossOriginEmbedderPolicy: false,
  })
);

app.use(express.json({ limit: '200kb' })); // 과도하게 큰 JSON payload로 인한 DoS 방지

// CORS: 허용할 origin을 환경변수로 지정 가능 (콤마로 구분). 미지정 시 전체 허용(개발 편의).
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.length === 0 || !origin || allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// 로그인/회원가입 무차별 대입 공격 방어: 15분에 IP당 20회로 제한
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/signup', authLimiter);
app.use('/api/auth/change-password', authLimiter);
// DELETE /api/auth/me(회원탈퇴)의 비밀번호 확인 무차별 대입만 제한 — GET(세션 확인)은 자주 호출되므로 제외
app.use('/api/auth/me', (req, res, next) => (req.method === 'DELETE' ? authLimiter(req, res, next) : next()));

// 그 외 전체 API에 대한 넉넉한 기본 레이트리밋 (남용/스크래핑 방지)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

// 이력서 등 업로드 파일: 아무나 접근 가능한 고정 URL 대신, 짧은 시간(5분)만 유효한
// 서명된 링크로만 접근할 수 있게 합니다. URL이 캡처화면/로그 등으로 유출되어도
// 시간이 지나면 무효화되어 개인정보(이력서) 노출 위험을 줄입니다.
const UPLOAD_DIR = path.join(__dirname, 'uploads');
app.get('/uploads/:filename', (req, res) => {
  const { filename } = req.params;
  const { token } = req.query;
  const payload = token ? verifyToken(token) : null;
  if (!payload || payload.purpose !== 'file_view' || payload.filename !== filename) {
    return res.status(403).json({ error: '파일에 접근할 수 없거나 링크가 만료됐어요.' });
  }
  const safeName = path.basename(filename); // 경로 탈출(path traversal) 방지
  res.sendFile(path.join(UPLOAD_DIR, safeName), (err) => {
    if (err) res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
  });
});
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // HTML은 절대 캐시되면 안 됨 (통신사 프록시/브라우저가 예전 버전을 계속 보여주는 문제 방지).
    // 아이콘 등 정적 자산은 기존처럼 캐시 허용.
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  },
}));

// DB까지 실제로 쿼리해서 깨움 — Neon 같은 서버리스 DB는 유휴 상태에서 자동으로 잠들기 때문에,
// 헬스체크가 서버만 깨우고 DB는 깨우지 않으면 로그인 시 DB 콜드스타트로 여전히 느려질 수 있음.
app.get('/api/health', async (_req, res) => {
  try {
    await get('SELECT 1 AS ok');
    res.json({ ok: true, service: 'stackfit-backend', db: USE_POSTGRES ? 'postgres' : 'sqlite' });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'DB에 연결할 수 없어요.' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/auth/oauth', oauthRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api', applicationRoutes); // /api/jobs/:id/apply, /api/me/applications, /api/jobs/:id/applicants
app.use('/api/talents', talentRoutes);
app.use('/api', proposalRoutes);    // /api/talents/:userId/propose
app.use('/api/projects', projectRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/companies', companyRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

const PORT = process.env.PORT || 4000;

async function main() {
  await initDb(); // 스키마 준비 + (필요 시) 데모 데이터 시드까지 끝난 뒤에 요청을 받기 시작
  app.listen(PORT, () => {
    console.log(`[stackfit] API 서버 실행 중 → http://localhost:${PORT} (DB: ${USE_POSTGRES ? 'PostgreSQL' : 'SQLite'})`);
  });
}

main().catch((err) => {
  console.error('[stackfit] 서버 시작 실패:', err);
  process.exit(1);
});
