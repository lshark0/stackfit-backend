const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { initDb, get, USE_POSTGRES } = require('./src/db');
const { checkDeadlineAlerts, closeExpiredJobs } = require('./src/deadlineAlerts');

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
const recommendRoutes = require('./src/routes/recommend');
const portfolioRoutes = require('./src/routes/portfolios');
const pushRoutes = require('./src/routes/push');
const { initPush } = require('./src/push');
const oauthRoutes = require('./src/routes/oauth');
const adminRoutes = require('./src/routes/admin');
const supportRoutes = require('./src/routes/support');
const announcementsRoutes = require('./src/routes/announcements');
const referralRoutes = require('./src/routes/referral');
const aiRoutes = require('./src/routes/ai');
const mfaRoutes = require('./src/routes/mfa');
const { resetMfaFromEnv } = require('./src/mfa');
const { verifyToken, verifySessionToken } = require('./src/auth');
const { dedupeAllPortfolios } = require('./src/portfolioDedupe');
const securityLog = require('./src/securityLog');
const { purgeOldSecurityEvents } = securityLog;

const app = express();
app.set('trust proxy', 1); // Render는 프록시 뒤에 있으므로 rate-limit이 실제 클라이언트 IP를 보게 함

// 보안 HTTP 헤더. CSP는 정적 프론트엔드가 인라인 스크립트/스타일을 쓰므로 완화해서 적용.
app.use(
  helmet({
    contentSecurityPolicy: false, // 프론트엔드가 단일 HTML(인라인 script/style)이라 기본 CSP와 충돌함
    crossOriginEmbedderPolicy: false,
    // 기본값(same-origin)이면 포트원 본인인증 팝업과 opener 연결이 끊겨 창이 비고 즉시 '취소' 처리됨
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
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
app.use('/api/auth/identity/verify', authLimiter);
app.use('/api/auth/change-password', authLimiter);
app.use('/api/auth/mfa/verify', authLimiter);
app.use('/api/auth/mfa/enable', authLimiter);
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

// 인재 정보 대량 수집(스크래핑) 방어: 로그인한 계정 단위로 인재 목록·상세 조회를 시간당 300회로 제한합니다.
// IP를 바꿔가며 한 계정으로 전체 프리랜서 정보를 긁어가는 것을 막고, 한도를 넘으면 보안 로그에 남깁니다.
const userKey = (req) => {
  const h = req.headers.authorization || '';
  const payload = h.startsWith('Bearer ') ? verifySessionToken(h.slice(7)) : null;
  return payload ? `user:${payload.id}` : `ip:${req.ip}`;
};
const TALENT_HOURLY_LIMIT = Number(process.env.TALENT_HOURLY_LIMIT) || 300;
const scrapeLogged = new Map(); // 같은 계정의 한도 초과는 창(1시간)마다 한 번만 기록
const talentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: TALENT_HOURLY_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  skip: (req) => req.method !== 'GET',
  handler: (req, res) => {
    const key = userKey(req);
    if ((scrapeLogged.get(key) || 0) < Date.now() - 60 * 60 * 1000) {
      scrapeLogged.set(key, Date.now());
      const h = req.headers.authorization || '';
      const payload = h.startsWith('Bearer ') ? verifySessionToken(h.slice(7)) : null;
      securityLog.logEvent('scrape_suspected', {
        email: payload && payload.email, userId: payload && payload.id, ip: securityLog.clientIp(req),
        detail: `인재 조회 시간당 ${TALENT_HOURLY_LIMIT}회 초과 (${req.originalUrl.split('?')[0]})`,
      });
    }
    res.status(429).json({ error: '조회가 너무 많아요. 잠시 후 다시 시도해주세요.' });
  },
});
app.use('/api/talents', talentLimiter);

// AI 봇 자동 도배 방어: 사람이 하기 어려운 속도로 제안·메시지·공고·신고를 쏟아내는 계정을 막습니다.
// (AI로 만든 피싱 제안·가짜 공고를 대량으로 뿌리는 공격) 계정 단위로 시간당 횟수를 제한하고,
// 한도를 넘으면 보안 로그에 '자동 도배 의심'으로 남깁니다.
const WRITE_RULES = [
  { name: '제안 보내기', re: /^\/api\/talents\/\d+\/propose$/, limit: Number(process.env.PROPOSE_HOURLY_LIMIT) || 30 },
  { name: '채팅 메시지', re: /^\/api\/conversations\/\d+\/messages$/, limit: 200 },
  { name: '대화 시작', re: /^\/api\/conversations\/?$/, limit: 60 },
  { name: '공고 등록', re: /^\/api\/jobs\/?$|^\/api\/jobs\/\d+\/duplicate$/, limit: 20 },
  { name: '공고 지원', re: /^\/api\/jobs\/\d+\/apply$/, limit: 60 },
  { name: '신고·문의', re: /^\/api\/jobs\/\d+\/report$|^\/api\/support\/inquiries$/, limit: 10 },
];
const spamLogged = new Map();
for (const rule of WRITE_RULES) {
  app.use('/api', rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: rule.limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${userKey(req)}:${rule.name}`,
    skip: (req) => req.method !== 'POST' || !rule.re.test(req.originalUrl.split('?')[0]),
    handler: (req, res) => {
      const key = `${userKey(req)}:${rule.name}`;
      if ((spamLogged.get(key) || 0) < Date.now() - 60 * 60 * 1000) {
        spamLogged.set(key, Date.now());
        const h = req.headers.authorization || '';
        const payload = h.startsWith('Bearer ') ? verifySessionToken(h.slice(7)) : null;
        securityLog.logEvent('spam_suspected', {
          email: payload && payload.email, userId: payload && payload.id, ip: securityLog.clientIp(req),
          detail: `${rule.name} 시간당 ${rule.limit}회 초과`,
        });
      }
      res.status(429).json({ error: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.' });
    },
  }));
}

// AI 기능 IP 단위 제한: 한 곳에서 계정을 여러 개 만들어 AI를 돌리는 것을 막습니다(계정별 1일 한도와 별도).
app.use('/api/ai', rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: Number(process.env.AI_IP_LIMIT_10MIN) || 40,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method !== 'POST',
  message: { error: 'AI 요청이 너무 많아요. 잠시 후 다시 시도해주세요.', code: 'AI_RATE_LIMIT' },
}));

// 이력서 등 업로드 파일: 아무나 접근 가능한 고정 URL 대신, 짧은 시간(5분)만 유효한
// 서명된 링크로만 접근할 수 있게 합니다. URL이 캡처화면/로그 등으로 유출되어도
// 시간이 지나면 무효화되어 개인정보(이력서) 노출 위험을 줄입니다.
// 파일 내용은 디스크가 아니라 DB(resume_data)에 저장되어 있어, 재배포와 무관하게 보존됩니다.
const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.hwp': 'application/x-hwp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.zip': 'application/zip',
};
app.get('/uploads/:filename', async (req, res) => {
  const { filename } = req.params;
  const { token } = req.query;
  const payload = token ? verifyToken(token) : null;
  if (!payload || payload.purpose !== 'file_view' || payload.filename !== filename) {
    return res.status(403).json({ error: '파일에 접근할 수 없거나 링크가 만료됐어요.' });
  }
  const safeName = path.basename(filename); // 경로 탈출(path traversal) 방지

  // 경력기술서와 계약서 두 곳에서 파일을 찾습니다.
  let data = null;
  const resumeRow = await get(
    'SELECT resume_data FROM freelancer_profiles WHERE resume_filename = ?',
    [safeName]
  );
  if (resumeRow && resumeRow.resume_data) {
    data = resumeRow.resume_data;
  } else {
    const contractRow = await get(
      'SELECT contract_data FROM projects WHERE contract_filename = ?',
      [safeName]
    );
    if (contractRow && contractRow.contract_data) {
      data = contractRow.contract_data;
    } else {
      const reportRow = await get(
        'SELECT attachment_data FROM job_reports WHERE attachment_filename = ?',
        [safeName]
      );
      if (reportRow && reportRow.attachment_data) {
        data = reportRow.attachment_data;
      } else {
        const inquiryRow = await get(
          'SELECT attachment_data FROM support_inquiries WHERE attachment_filename = ?',
          [safeName]
        );
        if (inquiryRow && inquiryRow.attachment_data) data = inquiryRow.attachment_data;
      }
    }
  }
  if (!data) {
    return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
  }
  const ext = path.extname(safeName).toLowerCase();
  res.setHeader('Content-Type', MIME_BY_EXT[ext] || 'application/octet-stream');
  res.send(Buffer.from(data));
});
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // HTML과 서비스워커는 절대 캐시되면 안 됩니다.
    // (통신사 프록시/브라우저가 예전 버전을 계속 보여주는 문제 방지.
    //  특히 서비스워커가 낡은 채로 남으면 푸시 알림 같은 새 기능이 아예 동작하지 않습니다.)
    // 아이콘 등 정적 자산은 기존처럼 캐시 허용.
    if (filePath.endsWith('.html') || filePath.endsWith('service-worker.js') || filePath.endsWith('manifest.json')) {
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
    res.json({ ok: true }); // 내부 구성(서비스명·DB 종류)은 응답에 담지 않습니다
  } catch (err) {
    res.status(503).json({ ok: false, error: 'DB에 연결할 수 없어요.' });
  }
});

app.use('/api/auth/mfa', mfaRoutes);
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
app.use('/api/recommend', recommendRoutes);
app.use('/api/portfolios', portfolioRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/announcements', announcementsRoutes);
app.use('/api/referral', referralRoutes);
app.use('/api/ai', aiRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

const PORT = process.env.PORT || 4000;

async function main() {
  await initDb(); // 스키마 준비 + (필요 시) 데모 데이터 시드까지 끝난 뒤에 요청을 받기 시작
  await initPush(); // 푸시 인증키 준비 (실패해도 서버는 정상 동작)
  await resetMfaFromEnv(securityLog.logEvent); // 비상시 관리자 2단계 인증 초기화 (MFA_RESET_EMAILS)
  await dedupeAllPortfolios(); // 예전에 AI 자동 채우기로 중복 등록된 수행 프로젝트를 한 번 정리
  app.listen(PORT, () => {
    console.log(`[IT Free] API 서버 실행 중 → http://localhost:${PORT} (DB: ${USE_POSTGRES ? 'PostgreSQL' : 'SQLite'})`);
  });

  // 마감일이 지난 공고 자동 마감 처리 + 저장한 공고 마감임박 알림: 기동 직후 한 번, 이후 6시간마다 확인합니다.
  const runScheduledChecks = () => {
    closeExpiredJobs().catch((e) => console.warn('[IT Free] 공고 자동 마감 처리 실패:', e.message));
    purgeOldSecurityEvents().catch((e) => console.warn('[IT Free] 오래된 보안 로그 삭제 실패:', e.message));
    checkDeadlineAlerts().catch((e) => console.warn('[IT Free] 마감임박 알림 확인 실패:', e.message));
  };
  runScheduledChecks();
  setInterval(runScheduledChecks, 6 * 60 * 60 * 1000);
}

main().catch((err) => {
  console.error('[IT Free] 서버 시작 실패:', err);
  process.exit(1);
});
