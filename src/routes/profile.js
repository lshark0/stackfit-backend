const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { run, get } = require('../db');
const { requireAuth, requireRole } = require('../middleware/requireAuth');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const unique = crypto.randomBytes(12).toString('hex');
      cb(null, `${unique}.pdf`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf') return cb(new Error('PDF 파일만 업로드할 수 있어요.'));
    cb(null, true);
  },
});

router.get('/', requireAuth, async (req, res) => {
  if (req.user.role === 'freelancer') {
    const p = await get('SELECT * FROM freelancer_profiles WHERE user_id = ?', [req.user.id]);
    return res.json({
      ...p,
      stack: JSON.parse(p.stack_json),
      resume_url: p.resume_filename ? `/uploads/${p.resume_filename}` : null,
    });
  }
  const c = await get('SELECT * FROM companies WHERE user_id = ?', [req.user.id]);
  res.json(c);
});

router.put('/', requireAuth, async (req, res) => {
  if (req.user.role === 'freelancer') {
    const { name, role_title, years, rate, stack, summary } = req.body || {};
    const current = await get('SELECT * FROM freelancer_profiles WHERE user_id = ?', [req.user.id]);
    const nextStack = Array.isArray(stack) ? stack : JSON.parse(current.stack_json);
    const completion = Math.min(100, 50 + nextStack.length * 5 + (summary ? 10 : 0) + (current.verified ? 10 : 0));
    await run(
      `UPDATE freelancer_profiles SET name=?, role_title=?, years=?, rate=?, stack_json=?, summary=?, completion=? WHERE user_id=?`,
      [
        name ?? current.name,
        role_title ?? current.role_title,
        years ?? current.years,
        rate ?? current.rate,
        JSON.stringify(nextStack),
        summary ?? current.summary,
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
    name ?? current.name,
    contact_person ?? current.contact_person,
    description ?? current.description,
    req.user.id,
  ]);
  res.json(await get('SELECT * FROM companies WHERE user_id = ?', [req.user.id]));
});

// 경력기술서(PDF) 업로드 — 기존 파일이 있으면 교체
// 참고: 업로드된 파일은 로컬 디스크에 저장되어, Render 무료 플랜에서는 재배포 시 유실될 수 있습니다.
router.post('/resume', requireAuth, requireRole('freelancer'), (req, res) => {
  upload.single('resume')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || '업로드에 실패했어요.' });
    if (!req.file) return res.status(400).json({ error: '파일이 첨부되지 않았어요.' });

    const current = await get('SELECT * FROM freelancer_profiles WHERE user_id = ?', [req.user.id]);
    if (current.resume_filename) {
      const oldPath = path.join(UPLOAD_DIR, current.resume_filename);
      fs.unlink(oldPath, () => {});
    }
    const completion = Math.min(100, current.completion + (current.resume_filename ? 0 : 10));
    await run('UPDATE freelancer_profiles SET resume_filename=?, resume_original_name=?, completion=? WHERE user_id=?', [
      req.file.filename, req.file.originalname, completion, req.user.id,
    ]);
    res.status(201).json({
      resume_url: `/uploads/${req.file.filename}`,
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
