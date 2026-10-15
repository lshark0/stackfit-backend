const express = require('express');
const crypto = require('crypto');
const { run, get, all } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { wrapAllRoutes } = require('../middleware/asyncHandler');
const { hashPassword, signToken } = require('../auth');
const { normalizeMobile, normalizeEmail } = require('../contact');
const { addNotification, pushTo } = require('../notify');
const { createJob, withCompanyAndStack } = require('./jobs');

// 관리자 공고 대리 등록: 초기에 공고를 먼저 채우기 위해, 기업 담당자의 동의를 받아 관리자가 공고를 대신 올립니다.
//  - 이미 가입한 기업: 그 기업 계정으로 공고를 올리고 기업에 알립니다(기업이 직접 수정·마감 가능).
//  - 가입 전 기업: 담당자 이메일로 기업 계정을 대신 만들고, '계정 연결 링크'를 담당자에게 보내 비밀번호를 정하게 합니다.
//    연결 전에는 비밀번호를 아무도 모르므로 로그인할 수 없고, 지원이 오면 관리자에게 알려 연결을 안내하게 합니다.
// 대리 등록한 공고에는 'IT Free 대리 등록' 표시가 붙습니다.
const router = express.Router();
wrapAllRoutes(router);
router.use(requireAuth, requireAdmin);

const CLAIM_DAYS = 30;
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

// 계정 연결 링크(30일). 새로 만들면 이전 링크는 쓸 수 없습니다(nonce 교체).
async function newClaimLink(req, userId) {
  const nonce = crypto.randomBytes(12).toString('hex');
  await run('UPDATE users SET claim_nonce = ? WHERE id = ? AND claim_pending = 1', [nonce, userId]);
  const token = signToken({ purpose: 'company_claim', uid: userId, n: nonce }, CLAIM_DAYS * 86400);
  const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/$/, '')}/?claim=${encodeURIComponent(token)}`;
}

// 기업 검색(회사명·담당자·계정 이메일)
router.get('/companies', async (req, res) => {
  const q = clip(req.query.q, 60);
  if (!q) return res.json({ companies: [] });
  const like = `%${q.toLowerCase()}%`;
  const rows = await all(
    `SELECT u.id, u.email, u.claim_pending, c.name, c.contact_person
     FROM users u JOIN companies c ON c.user_id = u.id
     WHERE u.role = 'company' AND (LOWER(c.name) LIKE ? OR LOWER(c.contact_person) LIKE ? OR LOWER(u.email) LIKE ?)
     ORDER BY c.name LIMIT 20`,
    [like, like, like]
  );
  res.json({ companies: rows.map((r) => ({ id: r.id, name: r.name, contactPerson: r.contact_person, email: r.email, claimPending: Number(r.claim_pending) === 1 })) });
});

// 가입 전 기업의 계정을 대신 만들기(담당자 동의 필수)
router.post('/companies', async (req, res) => {
  const b = req.body || {};
  if (b.consent !== true) return res.status(400).json({ error: '기업 담당자에게 대리 등록 동의를 받았는지 확인해주세요.' });
  const name = clip(b.name, 60);
  const contactPerson = clip(b.contactPerson, 60);
  const email = normalizeEmail(b.email);
  const phone = b.phone ? normalizeMobile(b.phone) : '';
  if (!name) return res.status(400).json({ error: '회사명을 적어주세요.' });
  if (!contactPerson) return res.status(400).json({ error: '담당자 이름을 적어주세요.' });
  if (!email) return res.status(400).json({ error: '담당자 이메일을 정확히 적어주세요. 계정 연결과 로그인에 쓰여요.' });
  if (b.phone && !phone) return res.status(400).json({ error: '담당자 휴대폰 번호를 정확히 적어주세요.' });
  if (await get('SELECT id FROM users WHERE email = ?', [email])) {
    return res.status(409).json({ error: '이미 가입된 이메일이에요. 위의 기업 검색에서 찾아 선택해주세요.' });
  }
  // 아무도 모르는 임의 비밀번호로 만들어, 계정 연결(비밀번호 설정) 전에는 로그인할 수 없게 합니다.
  const { hash, salt } = hashPassword(crypto.randomBytes(24).toString('hex'));
  const r = await run(
    'INSERT INTO users (email, password_hash, password_salt, role, claim_pending, proxy_created_by, signup_source) VALUES (?,?,?,?,1,?,?)',
    [email, hash, salt, 'company', req.user.id, 'proxy']
  );
  const id = Number(r.lastInsertRowid);
  await run('INSERT INTO companies (user_id, name, contact_person, phone, email) VALUES (?,?,?,?,?)', [id, name, contactPerson, phone || '', email]);
  res.status(201).json({ company: { id, name, contactPerson, email, claimPending: true }, claimLink: await newClaimLink(req, id) });
});

// 계정 연결 링크 다시 만들기(연결 전 기업만)
router.post('/companies/:id/claim-link', async (req, res) => {
  const id = Number(req.params.id);
  const u = await get("SELECT id FROM users WHERE id = ? AND role = 'company' AND claim_pending = 1", [id]);
  if (!u) return res.status(404).json({ error: '계정 연결을 기다리는 기업이 아니에요.' });
  res.json({ claimLink: await newClaimLink(req, id) });
});

// 공고 대리 등록
router.post('/jobs', async (req, res) => {
  const b = req.body || {};
  if (b.consent !== true) return res.status(400).json({ error: '기업 담당자에게 대리 등록 동의를 받았는지 확인해주세요.' });
  const companyId = Number(b.companyId);
  const company = await get(
    "SELECT u.id, u.claim_pending, c.name FROM users u JOIN companies c ON c.user_id = u.id WHERE u.id = ? AND u.role = 'company'",
    [companyId]
  );
  if (!company) return res.status(404).json({ error: '기업을 찾을 수 없어요.' });
  const job = await createJob(company.id, b, { proxyBy: req.user.id });
  if (!job) return res.status(400).json({ error: '공고 제목은 필수입니다.' });
  if (Number(company.claim_pending) !== 1) {
    const title = 'IT Free가 공고를 대신 등록했어요';
    const body = `"${job.title}" 공고를 요청하신 내용으로 등록했어요. 내용을 확인하고 언제든 수정·마감할 수 있어요.`;
    await addNotification(company.id, { tag: '공고', title, body: body.slice(0, 80), link: `jobDetail:${job.id}` });
    pushTo(company.id, { kind: 'result', title, body: body.slice(0, 100), tag: `proxy-job-${job.id}`, link: `jobDetail:${job.id}` });
  }
  res.status(201).json(await withCompanyAndStack(job));
});

// 대리 등록한 공고 목록
router.get('/jobs', async (req, res) => {
  const rows = await all(
    `SELECT j.id, j.title, j.status, j.created_at, j.company_id, c.name AS company_name, u.claim_pending,
       (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id) AS applicants
     FROM jobs j LEFT JOIN companies c ON c.user_id = j.company_id LEFT JOIN users u ON u.id = j.company_id
     WHERE j.proxy_by IS NOT NULL ORDER BY j.id DESC LIMIT 100`
  );
  res.json({
    jobs: rows.map((r) => ({
      id: r.id, title: r.title, status: r.status, created_at: r.created_at, companyId: r.company_id,
      companyName: r.company_name || '알 수 없음', claimPending: Number(r.claim_pending) === 1, applicants: Number(r.applicants) || 0,
    })),
  });
});

module.exports = router;
