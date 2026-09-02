const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const { run, get, all } = require('../db');
const { signedFileUrl } = require('../fileAccess');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');

const router = express.Router();
wrapAllRoutes(router);

const ALLOWED_EXT = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.hwp'];
const EXT_LABEL = 'PDF, Word, PPT, 한글(HWP)';
const extOf = (name) => {
  const m = /\.[^.]+$/.exec(name || '');
  return m ? m[0].toLowerCase() : '';
};

// 이력서 파일은 로컬 디스크가 아니라 메모리에만 잠깐 올린 뒤, 실제 내용을 DB(resume_data)에
// 직접 저장합니다. Render 무료 플랜은 재배포 시 디스크가 초기화되어 파일이 사라지는데,
// DB는 Neon(영구 저장)이라 배포를 아무리 반복해도 이력서가 유실되지 않습니다.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 문서 파일(PPT 등)은 용량이 클 수 있어 15MB로 설정
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_EXT.includes(extOf(file.originalname))) {
      return cb(new Error(`${EXT_LABEL} 파일만 업로드할 수 있어요.`));
    }
    cb(null, true);
  },
});

// multer는 확장자만 보고, 실제 파일 내용은 검사하지 않음.
// 파일 앞부분이 해당 형식의 실제 시그니처로 시작하는지 확인해 위장 업로드를 막습니다.
// - PDF: %PDF-
// - DOCX/PPTX(OOXML): ZIP 컨테이너 시그니처 (PK\x03\x04)
// - DOC/PPT/HWP(구버전 복합 문서 포맷): OLE2 컨테이너 시그니처
const MAGIC_BYTES = {
  '.pdf': [Buffer.from('%PDF-', 'ascii')],
  '.docx': [Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  '.pptx': [Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  '.doc': [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
  '.ppt': [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
  '.hwp': [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
};
function isValidDocument(buffer, ext) {
  const signatures = MAGIC_BYTES[ext];
  if (!signatures) return false;
  return signatures.some((sig) => buffer.subarray(0, sig.length).equals(sig));
}

const clamp = (v, max, fallback = '') => (typeof v === 'string' ? v.slice(0, max) : fallback);

// multer/busboy가 multipart 파일명을 기본적으로 latin1로 잘못 해석해서, 한글 등
// 비-ASCII 파일명이 깨지는 문제(글자 깨짐)를 바로잡습니다. (Node.js/multer의 잘 알려진 이슈)
function fixFilenameEncoding(name) {
  try { return Buffer.from(name, 'latin1').toString('utf8'); } catch (e) { return name; }
}

// 프로필 완성도: 사용자가 화면에서 실제로 채울 수 있는 항목만으로 100%에 도달 가능하도록 설계
function computeCompletion({ role_title, grade, rate, summary, stackCount, hasResume }) {
  let score = 20; // 이름은 가입 시 항상 있음
  if (role_title) score += 10;
  if (grade) score += 10;
  if (rate) score += 10;
  if (summary) score += 15;
  if (hasResume) score += 15;
  score += Math.min(stackCount, 4) * 5; // 기술스택 4개부터 만점(20)
  return Math.min(100, score);
}

// 이력서(프로필) 열람현황 — 어떤 기업이 언제 내 프로필을 봤는지 (잡코리아 스타일)
router.get('/views', requireAuth, requireRole('freelancer'), async (req, res) => {
  const rows = await all(
    `SELECT pv.created_at, c.name AS company_name, c.user_id AS company_id
     FROM profile_views pv
     JOIN companies c ON c.user_id = pv.company_id
     WHERE pv.freelancer_id = ?
     ORDER BY pv.created_at DESC, pv.id DESC
     LIMIT 50`,
    [req.user.id]
  );
  res.json({ views: rows });
});

router.get('/', requireAuth, async (req, res) => {
  if (req.user.role === 'freelancer') {
    const p = await get('SELECT * FROM freelancer_profiles WHERE user_id = ?', [req.user.id]);
    return res.json({
      ...p,
      stack: JSON.parse(p.stack_json),
      resume_url: signedFileUrl(p.resume_filename),
    });
  }
  const c = await get('SELECT * FROM companies WHERE user_id = ?', [req.user.id]);
  res.json(c);
});

router.put('/', requireAuth, async (req, res) => {
  if (req.user.role === 'freelancer') {
    const { name, role_title, years, rate, stack, summary, grade } = req.body || {};
    const current = await get('SELECT * FROM freelancer_profiles WHERE user_id = ?', [req.user.id]);

    let nextStack = Array.isArray(stack) ? stack : JSON.parse(current.stack_json);
    nextStack = nextStack
      .filter((s) => typeof s === 'string' && s.trim())
      .slice(0, 20)
      .map((s) => s.trim().slice(0, 40));

    const GRADE_OPTIONS = ['초급', '중급', '고급', '특급'];
    const nextGrade = grade === undefined ? current.grade : (GRADE_OPTIONS.includes(grade) ? grade : null);
    const nextRoleTitle = role_title !== undefined ? clamp(role_title, 60, current.role_title) : current.role_title;
    const nextRate = rate !== undefined ? clamp(rate, 40, current.rate) : current.rate;
    const nextSummary = summary !== undefined ? clamp(summary, 2000, current.summary) : current.summary;

    const completion = computeCompletion({
      role_title: nextRoleTitle, grade: nextGrade, rate: nextRate, summary: nextSummary,
      stackCount: nextStack.length, hasResume: !!current.resume_filename,
    });
    await run(
      `UPDATE freelancer_profiles SET name=?, role_title=?, years=?, rate=?, stack_json=?, summary=?, grade=?, completion=? WHERE user_id=?`,
      [
        name !== undefined ? clamp(name, 60, current.name) : current.name,
        nextRoleTitle,
        years !== undefined ? clamp(years, 20, current.years) : current.years,
        nextRate,
        JSON.stringify(nextStack),
        nextSummary,
        nextGrade,
        completion,
        req.user.id,
      ]
    );
    const updated = await get('SELECT * FROM freelancer_profiles WHERE user_id = ?', [req.user.id]);
    return res.json({ ...updated, stack: JSON.parse(updated.stack_json) });
  }

  const { name, contact_person, description } = req.body || {};
  const current = await get('SELECT * FROM companies WHERE user_id = ?', [req.user.id]);
  await run('UPDATE companies SET name=?, contact_person=?, description=? WHERE user_id=?', [
    name !== undefined ? clamp(name, 60, current.name) : current.name,
    contact_person !== undefined ? clamp(contact_person, 60, current.contact_person) : current.contact_person,
    description !== undefined ? clamp(description, 500, current.description) : current.description,
    req.user.id,
  ]);
  res.json(await get('SELECT * FROM companies WHERE user_id = ?', [req.user.id]));
});

// 경력기술서(PDF/Word/PPT/한글) 업로드 — 기존 파일이 있으면 교체.
// 파일 내용을 DB(Neon)에 직접 저장하므로 서버 재배포와 무관하게 계속 보관됩니다.
router.post('/resume', requireAuth, requireRole('freelancer'), (req, res) => {
  upload.single('resume')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || '업로드에 실패했어요.' });
    if (!req.file) return res.status(400).json({ error: '파일이 첨부되지 않았어요.' });

    const ext = extOf(req.file.originalname);
    if (!isValidDocument(req.file.buffer, ext)) {
      return res.status(400).json({ error: `올바른 ${EXT_LABEL} 파일이 아니에요.` });
    }

    const current = await get('SELECT * FROM freelancer_profiles WHERE user_id = ?', [req.user.id]);
    const originalName = fixFilenameEncoding(req.file.originalname);
    const filename = `${crypto.randomBytes(12).toString('hex')}${ext}`;
    const completion = computeCompletion({
      role_title: current.role_title, grade: current.grade, rate: current.rate, summary: current.summary,
      stackCount: JSON.parse(current.stack_json).length, hasResume: true,
    });
    await run(
      'UPDATE freelancer_profiles SET resume_filename=?, resume_original_name=?, resume_data=?, completion=? WHERE user_id=?',
      [filename, clamp(originalName, 200, 'resume.pdf'), req.file.buffer, completion, req.user.id]
    );
    res.status(201).json({
      resume_url: signedFileUrl(filename),
      resume_original_name: originalName,
      completion,
    });
  });
});

router.delete('/resume', requireAuth, requireRole('freelancer'), async (req, res) => {
  const current = await get('SELECT * FROM freelancer_profiles WHERE user_id = ?', [req.user.id]);
  const completion = computeCompletion({
    role_title: current.role_title, grade: current.grade, rate: current.rate, summary: current.summary,
    stackCount: JSON.parse(current.stack_json).length, hasResume: false,
  });
  await run(
    'UPDATE freelancer_profiles SET resume_filename=NULL, resume_original_name=NULL, resume_data=NULL, completion=? WHERE user_id=?',
    [completion, req.user.id]
  );
  res.json({ resume_url: null, completion });
});

module.exports = router;
