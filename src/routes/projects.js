const express = require('express');
const { run, get, all } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');
const crypto = require('crypto');
const { sendPushToUser } = require('../push');
const { signedFileUrl } = require('../fileAccess');
const { EXT_LABEL, extOf, createDocUpload, isValidDocument, fixFilenameEncoding } = require('../docUpload');

const upload = createDocUpload();

const router = express.Router();
wrapAllRoutes(router);

router.get('/', requireAuth, async (req, res) => {
  const col = req.user.role === 'freelancer' ? 'freelancer_id' : 'company_id';
  // 진행 중인 프로젝트를 항상 위에 보여줍니다 (완료된 건에 새 계약이 묻히지 않도록).
  const rows = await all(
    `SELECT * FROM projects WHERE ${col} = ? ORDER BY (CASE WHEN status = '완료' THEN 1 ELSE 0 END), created_at DESC, id DESC`,
    [req.user.id]
  );

  // 각 프로젝트에 내가 이미 리뷰를 남겼는지, 그리고 상대방이 나에게 남긴 평가도 함께 내려줍니다.
  // 프로젝트 수만큼 쿼리를 반복하지 않도록, 관련된 리뷰를 한 번에 가져와 메모리에서 매칭합니다.
  const projectIds = rows.map((p) => p.id);
  let allReviews = [];
  if (projectIds.length) {
    const placeholders = projectIds.map(() => '?').join(',');
    allReviews = await all(`SELECT * FROM reviews WHERE project_id IN (${placeholders})`, projectIds);
  }
  const withReview = rows.map((p) => {
    const mine = allReviews.find((r) => r.project_id === p.id && r.reviewer_id === req.user.id);
    const received = allReviews.find((r) => r.project_id === p.id && r.reviewee_id === req.user.id);
    const { contract_data, ...rest } = p; // 파일 내용 자체는 목록에 담지 않습니다.
    return {
      ...rest,
      contract_url: signedFileUrl(p.contract_filename),
      myReview: mine ? { rating: mine.rating } : null,
      receivedReview: received ? { rating: received.rating, comment: received.comment } : null,
    };
  });
  res.json({ projects: withReview });
});

// 진행 단계는 3단계입니다: 1) 계약 체결  2) 프로젝트 진행  3) 프로젝트 완료
// 각 단계는 정해진 쪽만 진행시킬 수 있어, 한쪽이 임의로 전체를 넘길 수 없습니다.
async function loadMyProject(req, res) {
  const col = req.user.role === 'freelancer' ? 'freelancer_id' : 'company_id';
  const project = await get(`SELECT * FROM projects WHERE id = ? AND ${col} = ?`, [req.params.id, req.user.id]);
  if (!project) {
    res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
    return null;
  }
  return project;
}

async function notify(userId, tag, title, body) {
  await run('INSERT INTO notifications (user_id, tag, title, body) VALUES (?,?,?,?)', [userId, tag, title, body]).catch(() => {});
  sendPushToUser(userId, { kind: 'result', title, body, url: '/', tag: 'project' }).catch(() => {});
}

// [1단계] 계약 조건에 동의 — 기업과 프리랜서가 각자 눌러야 하며, 둘 다 동의해야 다음 단계로 넘어갑니다.
// [1단계 준비] 계약서 첨부 — 기업만 가능하며, 계약 체결 전에만 올리거나 교체할 수 있습니다.
router.post('/:id/contract', requireAuth, (req, res) => {
  upload.single('contract')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || '업로드에 실패했어요.' });
    if (!req.file) return res.status(400).json({ error: '파일이 첨부되지 않았어요.' });

    const project = await loadMyProject(req, res);
    if (!project) return;
    if (req.user.id !== project.company_id) {
      return res.status(403).json({ error: '계약서는 기업만 첨부할 수 있어요.' });
    }
    if (project.stage !== 1) {
      return res.status(400).json({ error: '이미 계약이 체결되어 계약서를 변경할 수 없어요.' });
    }

    const ext = extOf(req.file.originalname);
    if (!isValidDocument(req.file.buffer, ext)) {
      return res.status(400).json({ error: `올바른 ${EXT_LABEL} 파일이 아니에요.` });
    }

    const originalName = fixFilenameEncoding(req.file.originalname);
    const filename = `contract_${crypto.randomBytes(12).toString('hex')}${ext}`;
    // 계약서가 바뀌면 기존 동의는 무효가 되므로 양측 동의를 초기화합니다.
    await run(
      'UPDATE projects SET contract_filename=?, contract_original_name=?, contract_data=?, company_agreed=0, freelancer_agreed=0 WHERE id=?',
      [filename, originalName.slice(0, 200), req.file.buffer, project.id]
    );
    await notify(project.freelancer_id, '계약', '계약서가 도착했어요',
      `"${project.title}" 계약서를 확인하고 동의해주세요.`);

    res.status(201).json({
      contract_url: signedFileUrl(filename),
      contract_original_name: originalName,
    });
  });
});

router.post('/:id/agree', requireAuth, async (req, res) => {
  const project = await loadMyProject(req, res);
  if (!project) return;
  if (project.stage !== 1) return res.status(400).json({ error: '이미 계약이 체결된 프로젝트예요.' });

  // 계약서 없이는 어느 쪽도 동의할 수 없습니다.
  if (!project.contract_filename) {
    return res.status(400).json({
      error: req.user.id === project.company_id
        ? '계약서를 먼저 첨부해주세요.'
        : '기업이 계약서를 첨부하면 동의할 수 있어요.',
      code: 'CONTRACT_REQUIRED',
    });
  }

  const isCompany = req.user.id === project.company_id;
  const myCol = isCompany ? 'company_agreed' : 'freelancer_agreed';
  if (project[myCol]) return res.status(400).json({ error: '이미 계약에 동의하셨어요. 상대방의 동의를 기다리는 중이에요.' });

  await run(`UPDATE projects SET ${myCol} = 1 WHERE id = ?`, [project.id]);
  const updated = await get('SELECT * FROM projects WHERE id = ?', [project.id]);

  const counterpartId = isCompany ? project.freelancer_id : project.company_id;
  if (updated.company_agreed && updated.freelancer_agreed) {
    // 양측 동의 완료 → 프로젝트 진행 단계로
    await run('UPDATE projects SET stage = 2 WHERE id = ?', [project.id]);
    await notify(counterpartId, '계약', '계약이 체결됐어요', `"${project.title}" 프로젝트가 시작됩니다.`);
    await notify(req.user.id, '계약', '계약이 체결됐어요', `"${project.title}" 프로젝트가 시작됩니다.`);
  } else {
    await notify(counterpartId, '계약', '계약 동의 요청', `"${project.title}" 계약 조건에 상대방이 동의했어요. 확인해주세요.`);
  }
  res.json(await get('SELECT * FROM projects WHERE id = ?', [project.id]));
});

// [2단계] 프로젝트 완료 요청 — 실제로 일한 프리랜서가 먼저 완료를 알립니다.
router.post('/:id/report-done', requireAuth, async (req, res) => {
  const project = await loadMyProject(req, res);
  if (!project) return;
  if (req.user.id !== project.freelancer_id) {
    return res.status(403).json({ error: '프로젝트 완료 요청은 프리랜서만 할 수 있어요.' });
  }
  if (project.stage !== 2) return res.status(400).json({ error: '프로젝트 진행 단계에서만 완료 요청을 할 수 있어요.' });

  await run('UPDATE projects SET stage = 3 WHERE id = ?', [project.id]);
  await notify(project.company_id, '완료', '프리랜서가 프로젝트 완료를 요청했어요', `"${project.title}" 프로젝트 완료를 확인해주세요.`);
  res.json(await get('SELECT * FROM projects WHERE id = ?', [project.id]));
});

// [3단계] 프로젝트 완료 확인 — 기업이 최종 확인해야 프로젝트가 종료됩니다.
router.post('/:id/settle', requireAuth, async (req, res) => {
  const project = await loadMyProject(req, res);
  if (!project) return;
  if (req.user.id !== project.company_id) {
    return res.status(403).json({ error: '프로젝트 완료 확인은 기업만 할 수 있어요.' });
  }
  if (project.stage !== 3) return res.status(400).json({ error: '프리랜서가 완료를 요청한 뒤에 확인할 수 있어요.' });

  await run("UPDATE projects SET status = '완료' WHERE id = ?", [project.id]);
  await notify(project.freelancer_id, '완료', '프로젝트가 완료됐어요', `"${project.title}" 프로젝트가 최종 완료됐습니다. 리뷰를 남겨보세요.`);
  res.json(await get('SELECT * FROM projects WHERE id = ?', [project.id]));
});

// 완료된 프로젝트에 대해 상대방(기업↔프리랜서)을 리뷰/평점
router.post('/:id/review', requireAuth, async (req, res) => {
  const project = await get('SELECT * FROM projects WHERE id = ?', [req.params.id]);
  if (!project) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
  if (project.company_id !== req.user.id && project.freelancer_id !== req.user.id) {
    return res.status(403).json({ error: '이 프로젝트에 대한 권한이 없습니다.' });
  }
  if (project.status !== '완료') {
    return res.status(400).json({ error: '완료된 프로젝트만 리뷰를 남길 수 있어요.' });
  }

  const { rating, comment } = req.body || {};
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) {
    return res.status(400).json({ error: '평점은 1~5 사이의 정수여야 해요.' });
  }
  const safeComment = typeof comment === 'string' ? comment.trim().slice(0, 500) : '';
  const revieweeId = req.user.id === project.company_id ? project.freelancer_id : project.company_id;

  const existing = await get('SELECT id FROM reviews WHERE project_id=? AND reviewer_id=?', [project.id, req.user.id]);
  if (existing) return res.status(409).json({ error: '이미 이 프로젝트에 리뷰를 남겼어요.' });

  await run(
    'INSERT INTO reviews (project_id, reviewer_id, reviewee_id, rating, comment) VALUES (?,?,?,?,?)',
    [project.id, req.user.id, revieweeId, r, safeComment]
  );
  await run('INSERT INTO notifications (user_id, tag, title, body) VALUES (?,?,?,?)', [
    revieweeId, '리뷰', '새 리뷰가 도착했어요', `"${project.title}" 프로젝트에 대한 리뷰(★${r})가 등록됐습니다.`,
  ]);

  res.status(201).json({ ok: true });
});

// 이 프로젝트에서 내가 쓴 리뷰 / 상대방이 나에게 남긴 리뷰 조회
router.get('/:id/review', requireAuth, async (req, res) => {
  const project = await get('SELECT * FROM projects WHERE id = ?', [req.params.id]);
  if (!project) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
  if (project.company_id !== req.user.id && project.freelancer_id !== req.user.id) {
    return res.status(403).json({ error: '이 프로젝트에 대한 권한이 없습니다.' });
  }
  const rows = await all('SELECT * FROM reviews WHERE project_id = ?', [project.id]);
  const myReview = rows.find((r) => r.reviewer_id === req.user.id) || null;
  const receivedReview = rows.find((r) => r.reviewee_id === req.user.id) || null;
  res.json({ myReview, receivedReview });
});

module.exports = router;
