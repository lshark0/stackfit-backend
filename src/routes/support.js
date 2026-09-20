const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const { run, get, all } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');
const { signedFileUrl } = require('../fileAccess');
const { normalizeEmail } = require('../contact');

const router = express.Router();
wrapAllRoutes(router);

// 잡코리아 문의·신고 양식과 동일한 첨부 가능 파일 종류(용량 10MB)
const REPORT_ATTACH_EXT = ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.hwp', '.jpg', '.jpeg', '.gif', '.png', '.pdf', '.zip'];
const reportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = ('.' + (file.originalname.split('.').pop() || '')).toLowerCase();
    if (!REPORT_ATTACH_EXT.includes(ext)) {
      return cb(new Error('MS Office, 한글(HWP), jpg, gif, png, pdf, zip 파일만 첨부할 수 있어요.'));
    }
    cb(null, true);
  },
});
function fixFilenameEncoding(name) {
  try { return Buffer.from(name, 'latin1').toString('utf8'); } catch (e) { return name; }
}

// 잡코리아 "문의·신고" 양식과 동일: 문의종류(reason) / 내용(content) /
// 파일첨부(attachment, 선택) / 답변받을 이메일(email). 특정 공고에 매이지 않는
// 고객센터 일반 문의로, 프리랜서·기업 회원 모두 이용할 수 있습니다.
const REPORT_REASONS = ['불법/허위 채용정보', '과장/오류', '연락처 도용/사칭', '중복 등록', '차별적인 내용 포함', '기타'];

router.get('/inquiries', requireAuth, async (req, res) => {
  const rows = await all(
    `SELECT id, reason, content, reply_email, status, created_at, resolved_at, admin_note,
       attachment_filename, attachment_original_name
     FROM support_inquiries
     WHERE user_id = ?
     ORDER BY created_at DESC, id DESC`,
    [req.user.id]
  );
  res.json({
    inquiries: rows.map((r) => ({
      ...r,
      attachment_url: signedFileUrl(r.attachment_filename),
    })),
  });
});

router.post('/inquiries', requireAuth, (req, res) => {
  reportUpload.single('attachment')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || '업로드에 실패했어요.' });

    const { reason, content, email } = req.body || {};
    if (!REPORT_REASONS.includes(reason)) {
      return res.status(400).json({ error: '문의종류를 선택해주세요.' });
    }
    const safeContent = typeof content === 'string' ? content.trim().slice(0, 2000) : '';
    if (!safeContent) return res.status(400).json({ error: '내용을 입력해주세요.' });
    const safeEmail = normalizeEmail(email);
    if (!safeEmail) return res.status(400).json({ error: '답변받을 이메일을 정확히 입력해주세요.' });

    let attachmentFilename = null, attachmentOriginalName = null, attachmentData = null;
    if (req.file) {
      const ext = ('.' + (req.file.originalname.split('.').pop() || '')).toLowerCase();
      attachmentFilename = `${crypto.randomBytes(12).toString('hex')}${ext}`;
      attachmentOriginalName = fixFilenameEncoding(req.file.originalname).slice(0, 200);
      attachmentData = req.file.buffer;
    }

    await run(
      `INSERT INTO support_inquiries (user_id, reason, content, reply_email, attachment_filename, attachment_original_name, attachment_data)
       VALUES (?,?,?,?,?,?,?)`,
      [req.user.id, reason, safeContent, safeEmail, attachmentFilename, attachmentOriginalName, attachmentData]
    );
    res.status(201).json({ reported: true });
  });
});

module.exports = router;
