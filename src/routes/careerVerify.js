const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const { run, get, all } = require('../db');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { wrapAllRoutes } = require('../middleware/asyncHandler');
const { addNotification, pushTo } = require('../notify');
const { signedFileUrl } = require('../fileAccess');
const { reviewSubmission, notifyResult } = require('../careerReview');
const ai = require('../ai');

// 경력 검증: 프리랜서가 경력 증빙 서류를 올리면 AI가 프로필의 이름·경력과 맞는지 심사해
// '경력 검증' 배지를 붙입니다(심사 규칙은 src/careerReview.js). AI가 판단하기 어려운 서류만 관리자가 확인합니다.
// 서류에는 개인정보가 많으므로 심사가 끝나는 즉시 원본을 지웁니다.

const router = express.Router();
wrapAllRoutes(router);

const DOC_KINDS = ['건강보험 자격득실확인서', '경력증명서', 'SW기술자 경력확인서(KOSA)', '재직·퇴직증명서', '기타'];
const MAGIC = {
  '.pdf': [Buffer.from('%PDF-', 'ascii')],
  '.jpg': [Buffer.from([0xff, 0xd8, 0xff])],
  '.jpeg': [Buffer.from([0xff, 0xd8, 0xff])],
  '.png': [Buffer.from([0x89, 0x50, 0x4e, 0x47])],
};
const extOf = (name) => { const m = /\.[^.]+$/.exec(name || ''); return m ? m[0].toLowerCase() : ''; };
const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
function fixFilenameEncoding(name) {
  try { return Buffer.from(name, 'latin1').toString('utf8'); } catch (e) { return name; }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!MAGIC[extOf(file.originalname)]) return cb(new Error('PDF, JPG, PNG 파일만 올릴 수 있어요.'));
    cb(null, true);
  },
});

function publicRow(r) {
  if (!r) return null;
  return {
    id: r.id, doc_kind: r.doc_kind, memo: r.memo, status: r.status, admin_note: r.admin_note,
    created_at: r.created_at, reviewed_at: r.reviewed_at, reviewed_by: r.reviewed_by || '',
  };
}

// 내 경력 검증 상태
router.get('/me', requireAuth, requireRole('freelancer'), async (req, res) => {
  const p = await get('SELECT verified FROM freelancer_profiles WHERE user_id = ?', [req.user.id]);
  const latest = await get(
    'SELECT id, doc_kind, memo, status, admin_note, created_at, reviewed_at, reviewed_by FROM career_verifications WHERE user_id = ? ORDER BY id DESC LIMIT 1',
    [req.user.id]
  );
  res.json({ aiEnabled: ai.aiEnabled(), verified: !!(p && Number(p.verified) === 1), latest: publicRow(latest), docKinds: DOC_KINDS });
});

// 증빙 서류 제출
router.post('/', requireAuth, requireRole('freelancer'), (req, res, next) => {
  upload.single('doc')(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? '10MB 이하 파일만 올릴 수 있어요.' : (err.message || '업로드에 실패했어요.') });
      if (!req.file) return res.status(400).json({ error: '증빙 서류 파일을 선택해주세요.' });
      const ext = extOf(req.file.originalname);
      if (!MAGIC[ext].some((sig) => req.file.buffer.subarray(0, sig.length).equals(sig))) {
        return res.status(400).json({ error: '올바른 PDF·JPG·PNG 파일이 아니에요.' });
      }
      // AI가 읽을 수 있는 이미지 크기 제한(약 5MB) 때문에 사진은 3.5MB까지만 받습니다.
      if (ext !== '.pdf' && req.file.size > 3.5 * 1024 * 1024) {
        return res.status(400).json({ error: '사진 파일은 3.5MB 이하만 올릴 수 있어요. 크면 PDF로 저장해서 올려주세요.' });
      }
      const kind = DOC_KINDS.includes((req.body || {}).doc_kind) ? req.body.doc_kind : '기타';
      const memo = String((req.body || {}).memo || '').trim().slice(0, 300);
      if (await get("SELECT id FROM career_verifications WHERE user_id = ? AND status IN ('pending','needs_review')", [req.user.id])) {
        return res.status(409).json({ error: '이미 검토 중인 서류가 있어요. 검토가 끝난 뒤 다시 올려주세요.' });
      }
      if ((await ai.remainingToday(req.user.id, 'career_verify')) <= 0) {
        return res.status(429).json({ error: '오늘은 경력 검증 신청 횟수를 모두 사용했어요. 내일 다시 올려주세요.' });
      }
      const filename = `cv_${crypto.randomBytes(12).toString('hex')}${ext}`;
      const ins = await run(
        'INSERT INTO career_verifications (user_id, doc_kind, doc_filename, doc_original_name, doc_data, memo) VALUES (?,?,?,?,?,?)',
        [req.user.id, kind, filename, fixFilenameEncoding(req.file.originalname).slice(0, 200), req.file.buffer, memo]
      );
      // AI 심사는 1분 가까이 걸릴 수 있어 응답을 먼저 돌려주고 뒤에서 진행합니다(결과는 알림으로 안내).
      const newId = Number(ins.lastInsertRowid);
      setImmediate(() => reviewSubmission(newId).catch((e) => console.error('[AI] 경력 검증 심사 오류:', e.message)));
      const latest = await get(
        'SELECT id, doc_kind, memo, status, admin_note, created_at, reviewed_at, reviewed_by FROM career_verifications WHERE user_id = ? ORDER BY id DESC LIMIT 1',
        [req.user.id]
      );
      res.status(201).json({ latest: publicRow(latest) });
    } catch (e) { next(e); }
  });
});

// 검토 전이면 제출을 취소할 수 있습니다(서류도 함께 삭제).
router.delete('/me', requireAuth, requireRole('freelancer'), async (req, res) => {
  const r = await run("DELETE FROM career_verifications WHERE user_id = ? AND status IN ('pending','needs_review')", [req.user.id]);
  if (!r.changes) return res.status(404).json({ error: '취소할 제출 내역이 없어요.' });
  res.json({ ok: true });
});

// 관리자: 검토 대기 + 최근 처리 내역
router.get('/admin', requireAuth, requireAdmin, async (req, res) => {
  const rows = await all(
    `SELECT v.id, v.user_id, v.doc_kind, v.doc_filename, v.doc_original_name, v.memo, v.status, v.admin_note, v.created_at, v.reviewed_at,
       v.reviewed_by, v.ai_result_json, f.name, f.role_title, f.years, f.grade, f.verified
     FROM career_verifications v LEFT JOIN freelancer_profiles f ON f.user_id = v.user_id
     ORDER BY CASE v.status WHEN 'needs_review' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, v.id DESC
     LIMIT 100`
  );
  const open = (st) => st === 'pending' || st === 'needs_review';
  res.json({
    items: rows.map((r) => {
      let aiResult = null;
      try { aiResult = r.ai_result_json ? JSON.parse(r.ai_result_json) : null; } catch (e) { aiResult = null; }
      return {
        ...publicRow(r),
        user_id: r.user_id,
        name: r.name || '이름 없음',
        role_title: r.role_title, years: r.years, grade: r.grade,
        ai: aiResult,
        doc_original_name: open(r.status) ? r.doc_original_name : null,
        doc_url: open(r.status) ? signedFileUrl(r.doc_filename) : null,
      };
    }),
    pending: rows.filter((r) => r.status === 'needs_review').length,
    reviewing: rows.filter((r) => r.status === 'pending').length,
  });
});

// 관리자: 승인/반려 — 처리와 동시에 서류 원본을 지웁니다.
router.post('/admin/:id/decide', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { decision } = req.body || {};
  const note = String((req.body || {}).note || '').trim().slice(0, 300);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '올바르지 않은 요청이에요.' });
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: '승인 또는 반려를 선택해주세요.' });
  if (decision === 'rejected' && !note) return res.status(400).json({ error: '반려 사유를 적어주세요. 프리랜서에게 그대로 안내돼요.' });
  const row = await get("SELECT * FROM career_verifications WHERE id = ? AND status IN ('pending','needs_review')", [id]);
  if (!row) return res.status(404).json({ error: '확인 대기 중인 서류를 찾을 수 없어요.' });

  const upd = await run(
    "UPDATE career_verifications SET status = ?, admin_note = ?, reviewed_at = ?, reviewed_by = 'admin', doc_data = NULL, doc_filename = NULL WHERE id = ? AND status IN ('pending','needs_review')",
    [decision, note, nowStr(), id]
  );
  if (!upd.changes) return res.status(409).json({ error: '방금 AI 심사가 끝났어요. 목록을 새로고침해주세요.' });
  if (decision === 'approved') await run('UPDATE freelancer_profiles SET verified = 1 WHERE user_id = ?', [row.user_id]);
  await notifyResult(row.user_id, id, decision, note);
  res.json({ ok: true });
});

// 관리자: AI가 승인한 건을 나중에 취소(위조 신고 등). 배지를 떼고 프리랜서에게 알립니다.
router.post('/admin/:id/revoke', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const note = String((req.body || {}).note || '').trim().slice(0, 300);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '올바르지 않은 요청이에요.' });
  if (!note) return res.status(400).json({ error: '취소 사유를 적어주세요. 프리랜서에게 그대로 안내돼요.' });
  const row = await get("SELECT * FROM career_verifications WHERE id = ? AND status = 'approved'", [id]);
  if (!row) return res.status(404).json({ error: '승인된 검증 내역을 찾을 수 없어요.' });
  await run("UPDATE career_verifications SET status = 'revoked', admin_note = ?, reviewed_at = ?, reviewed_by = 'admin' WHERE id = ?", [note, nowStr(), id]);
  await run('UPDATE freelancer_profiles SET verified = 0 WHERE user_id = ?', [row.user_id]);
  await addNotification(row.user_id, { tag: '경력검증', title: '경력 검증 배지가 취소됐어요', body: `사유: ${note}`.slice(0, 80), link: 'careerVerify' });
  pushTo(row.user_id, { kind: 'result', title: '경력 검증 배지가 취소됐어요', body: `사유: ${note}`.slice(0, 100), tag: `career-${id}`, link: 'careerVerify' });
  res.json({ ok: true });
});

module.exports = router;
