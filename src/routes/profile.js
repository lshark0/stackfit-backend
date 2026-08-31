const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { run, get, all } = require('../db');
const { signedFileUrl } = require('../fileAccess');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');

const router = express.Router();
wrapAllRoutes(router);

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_EXT = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.hwp'];
const EXT_LABEL = 'PDF, Word, PPT, 한글(HWP)';

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const unique = crypto.randomBytes(12).toString('hex');
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${unique}${ALLOWED_EXT.includes(ext) ? ext : ''}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 }, // 문서 파일(PPT 등)은 용량이 클 수 있어 15MB로 설정
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) return cb(new Error(`${EXT_LABEL} 파일만 업로드할 수 있어요.`));
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
function isValidDocument(filePath, ext) {
  const signatures = MAGIC_BYTES[ext];
  if (!signatures) return false;
  const maxLen = Math.max(...signatures.map((s) => s.length));
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(maxLen);
  fs.readSync(fd, buf, 0, maxLen, 0);
  fs.closeSync(fd);
  return signatures.some((sig) => buf.subarray(0, sig.length).equals(sig));
}

const clamp = (v, max, fallback = '') => (typeof v === 'string' ? v.slice(0, max) : fallback);

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
    const { name, role_title, years, rate, stack, summary } = req.body || {};
    const current = await get('SELECT * FROM freelancer_profiles WHERE user_id = ?', [req.user.id]);

    let nextStack = Array.isArray(stack) ? stack : JSON.parse(current.stack_json);
    nextStack = nextStack
      .filter((s) => typeof s === 'string' && s.trim())
      .slice(0, 20)
      .map((s) => s.trim().slice(0, 40));

    const completion = Math.min(100, 50 + nextStack.length * 5 + (summary ? 10 : 0) + (current.verified ? 10 : 0));
    await run(
      `UPDATE freelancer_profiles SET name=?, role_title=?, years=?, rate=?, stack_json=?, summary=?, completion=? WHERE user_id=?`,
      [
        name !== undefined ? clamp(name, 60, current.name) : current.name,
        role_title !== undefined ? clamp(role_title, 60, current.role_title) : current.role_title,
        years !== undefined ? clamp(years, 20, current.years) : current.years,
        rate !== undefined ? clamp(rate, 40, current.rate) : current.rate,
        JSON.stringify(nextStack),
        summary !== undefined ? clamp(summary, 2000, current.summary) : current.summary,
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

// 경력기술서(PDF/Word/PPT/한글) 업로드 — 기존 파일이 있으면 교체
// 참고: 업로드된 파일은 로컬 디스크에 저장되어, Render 무료 플랜에서는 재배포 시 유실될 수 있습니다.
router.post('/resume', requireAuth, requireRole('freelancer'), (req, res) => {
  upload.single('resume')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || '업로드에 실패했어요.' });
    if (!req.file) return res.status(400).json({ error: '파일이 첨부되지 않았어요.' });

    const ext = path.extname(req.file.filename).toLowerCase();
    if (!isValidDocument(req.file.path, ext)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: `올바른 ${EXT_LABEL} 파일이 아니에요.` });
    }

    const current = await get('SELECT * FROM freelancer_profiles WHERE user_id = ?', [req.user.id]);
    if (current.resume_filename) {
      const oldPath = path.join(UPLOAD_DIR, current.resume_filename);
      fs.unlink(oldPath, () => {});
    }
    const completion = Math.min(100, current.completion + (current.resume_filename ? 0 : 10));
    await run('UPDATE freelancer_profiles SET resume_filename=?, resume_original_name=?, completion=? WHERE user_id=?', [
      req.file.filename, clamp(req.file.originalname, 200, 'resume.pdf'), completion, req.user.id,
    ]);
    res.status(201).json({
      resume_url: signedFileUrl(req.file.filename),
      resume_original_name: req.file.originalname,
      completion,
    });
  });
});

router.delete('/resume', requireAuth, requireRole('freelancer'), async (req, res) => {
  const current = await get('SELECT * FROM freelancer_profiles WHERE user_id = ?', [req.user.id]);
  if (current.resume_filename) {
    fs.unlink(path.join(UPLOAD_DIR, current.resume_filename), () => {});
  }
  await run('UPDATE freelancer_profiles SET resume_filename=NULL, resume_original_name=NULL WHERE user_id=?', [req.user.id]);
  res.json({ resume_url: null });
});

module.exports = router;
