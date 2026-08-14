const express = require('express');
const path = require('path');
require('./src/db'); // DB 초기화 + 데모 시드 실행

const authRoutes = require('./src/routes/auth');
const profileRoutes = require('./src/routes/profile');
const jobRoutes = require('./src/routes/jobs');
const applicationRoutes = require('./src/routes/applications');
const talentRoutes = require('./src/routes/talents');
const proposalRoutes = require('./src/routes/proposals');
const projectRoutes = require('./src/routes/projects');
const conversationRoutes = require('./src/routes/conversations');
const notificationRoutes = require('./src/routes/notifications');

const app = express();
app.use(express.json());

// 아주 단순한 CORS 허용 (프론트엔드 프로토타입이 file://나 다른 origin에서 호출할 수 있도록)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'stackfit-backend' }));

app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api', applicationRoutes); // /api/jobs/:id/apply, /api/me/applications, /api/jobs/:id/applicants
app.use('/api/talents', talentRoutes);
app.use('/api', proposalRoutes);    // /api/talents/:userId/propose
app.use('/api/projects', projectRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/notifications', notificationRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`[stackfit] API 서버 실행 중 → http://localhost:${PORT}`);
});
