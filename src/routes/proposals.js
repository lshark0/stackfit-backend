const express = require('express');
const { run, get, all } = require('../db');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');
const { sendPushToUser } = require('../push');

const router = express.Router();
wrapAllRoutes(router);

router.post('/talents/:userId/propose', requireAuth, requireRole('company'), async (req, res) => {
  const freelancerId = Number(req.params.userId);
  if (!Number.isInteger(freelancerId)) return res.status(400).json({ error: '올바르지 않은 사용자 ID입니다.' });
  const { jobId, message } = req.body || {};

  const talent = await get('SELECT * FROM freelancer_profiles WHERE user_id = ?', [freelancerId]);
  if (!talent) return res.status(404).json({ error: '프로필을 찾을 수 없습니다.' });

  // 공고를 지정한 경우, 본인 기업의 실제 공고가 맞는지 확인합니다.
  let safeJobId = null;
  if (jobId !== undefined && jobId !== null && jobId !== '') {
    const jid = Number(jobId);
    if (!Number.isInteger(jid)) return res.status(400).json({ error: '올바르지 않은 공고 ID입니다.' });
    const job = await get('SELECT id FROM jobs WHERE id = ? AND company_id = ?', [jid, req.user.id]);
    if (!job) return res.status(404).json({ error: '공고를 찾을 수 없습니다.' });
    safeJobId = jid;
  }

  const existing = await get('SELECT id FROM proposals WHERE company_id=? AND freelancer_id=?', [req.user.id, freelancerId]);
  if (existing) return res.status(409).json({ error: '이미 제안을 보냈습니다.' });

  const safeMessage = typeof message === 'string' ? message.trim().slice(0, 1000) : '';
  await run('INSERT INTO proposals (company_id, freelancer_id, job_id, message) VALUES (?,?,?,?)', [
    req.user.id, freelancerId, safeJobId, safeMessage,
  ]);

  const company = await get('SELECT name FROM companies WHERE user_id = ?', [req.user.id]);
  await run('INSERT INTO notifications (user_id, tag, title, body) VALUES (?,?,?,?)', [
    freelancerId, '제안', '새로운 제안이 도착했어요', `${company ? company.name : '한 기업'}에서 포지션을 제안했습니다.`,
  ]);

  sendPushToUser(freelancerId, {
    kind: 'proposal',
    title: '📨 새 포지션 제안',
    body: `${company ? company.name : '한 기업'}에서 포지션을 제안했어요. 앱에서 확인해보세요.`,
    url: '/',
    tag: 'proposal',
  }).catch(() => {});

  res.status(201).json({ proposed: true });
});

// 제안 취소 (기업 전용, 본인이 보낸 제안만)
router.delete('/talents/:userId/propose', requireAuth, requireRole('company'), async (req, res) => {
  const freelancerId = Number(req.params.userId);
  if (!Number.isInteger(freelancerId)) return res.status(400).json({ error: '올바르지 않은 사용자 ID입니다.' });

  const existing = await get('SELECT id FROM proposals WHERE company_id=? AND freelancer_id=?', [req.user.id, freelancerId]);
  if (!existing) return res.status(404).json({ error: '보낸 제안을 찾을 수 없습니다.' });

  await run('DELETE FROM proposals WHERE id = ?', [existing.id]);

  // 상대가 아직 읽지 않은 제안 알림이 남아있다면 함께 지웁니다.
  // (이미 읽은 알림은 상대가 본 기록이므로 남겨둡니다.)
  const company = await get('SELECT name FROM companies WHERE user_id = ?', [req.user.id]);
  const companyName = company ? company.name : '한 기업';
  await run(
    "DELETE FROM notifications WHERE user_id = ? AND tag = '제안' AND is_read = 0 AND body = ?",
    [freelancerId, `${companyName}에서 포지션을 제안했습니다.`]
  );

  res.json({ proposed: false });
});

// 내가(프리랜서) 받은 제안 목록
router.get('/proposals/received', requireAuth, requireRole('freelancer'), async (req, res) => {
  const rows = await all(
    `SELECT p.id, p.created_at, p.job_id, p.company_id, p.status, p.message, p.decline_reason, p.responded_at,
            c.name AS company_name, c.description AS company_description,
            j.title AS job_title, j.stack_json, j.rate, j.period, j.work_type, j.location,
            j.duty, j.grade, j.description AS job_description, j.deadline, j.status AS job_status
     FROM proposals p
     JOIN companies c ON c.user_id = p.company_id
     LEFT JOIN jobs j ON j.id = p.job_id
     WHERE p.freelancer_id = ?
     ORDER BY (CASE WHEN p.status = 'sent' THEN 0 ELSE 1 END), p.created_at DESC, p.id DESC`,
    [req.user.id]
  );
  // 제안에 연결된 공고 정보를 함께 내려, 프리랜서가 조건을 보고 판단할 수 있게 합니다.
  res.json({
    proposals: rows.map((r) => ({
      ...r,
      stack: r.stack_json ? JSON.parse(r.stack_json) : [],
    })),
  });
});

// 프리랜서가 고를 수 있는 거절 사유 (기업에게 왜 거절됐는지 알려주기 위함)
const DECLINE_REASONS = [
  '일정이 맞지 않아요',
  '단가 조건이 맞지 않아요',
  '기술 분야가 맞지 않아요',
  '근무지·근무형태가 맞지 않아요',
  '이미 다른 프로젝트를 진행 중이에요',
  '기타',
];

router.get('/proposals/decline-reasons', requireAuth, (req, res) => {
  res.json({ reasons: DECLINE_REASONS });
});

async function loadMyProposal(req, res) {
  const proposal = await get('SELECT * FROM proposals WHERE id = ? AND freelancer_id = ?', [req.params.id, req.user.id]);
  if (!proposal) {
    res.status(404).json({ error: '제안을 찾을 수 없습니다.' });
    return null;
  }
  if (proposal.status !== 'sent') {
    res.status(400).json({ error: '이미 응답한 제안이에요.' });
    return null;
  }
  return proposal;
}

const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

// 제안 수락 — 바로 계약으로 넘어가지 않고, 먼저 채팅으로 세부 조건을 논의합니다.
// (계약은 기업이 지원자 관리에서 수락하거나 별도 합의 후 진행)
router.post('/proposals/:id/accept', requireAuth, requireRole('freelancer'), async (req, res) => {
  const proposal = await loadMyProposal(req, res);
  if (!proposal) return;

  await run("UPDATE proposals SET status='accepted', responded_at=? WHERE id=?", [nowStr(), proposal.id]);

  const profile = await get('SELECT name FROM freelancer_profiles WHERE user_id = ?', [req.user.id]);
  const who = profile ? profile.name : '프리랜서';

  // 바로 대화를 이어갈 수 있도록 채팅방을 준비합니다 (이미 있으면 그대로 사용).
  let conv = await get(
    'SELECT * FROM conversations WHERE company_id=? AND freelancer_id=? AND job_id IS NOT DISTINCT FROM ?',
    [proposal.company_id, req.user.id, proposal.job_id || null]
  );
  if (!conv) {
    const r = await run('INSERT INTO conversations (company_id, freelancer_id, job_id) VALUES (?,?,?)', [
      proposal.company_id, req.user.id, proposal.job_id || null,
    ]);
    conv = await get('SELECT * FROM conversations WHERE id = ?', [r.lastInsertRowid]);
  }

  const body = `${who}님이 제안을 수락했어요. 채팅으로 세부 조건을 논의해보세요.`;
  await run('INSERT INTO notifications (user_id, tag, title, body) VALUES (?,?,?,?)', [
    proposal.company_id, '제안', '제안이 수락됐어요', body,
  ]);
  sendPushToUser(proposal.company_id, {
    kind: 'result', title: '🎉 제안이 수락됐어요', body, url: '/', tag: `proposal-${proposal.id}`,
  }).catch(() => {});

  res.json({ status: 'accepted', conversationId: conv.id });
});

// 제안 거절 — 사유를 함께 전달합니다.
router.post('/proposals/:id/decline', requireAuth, requireRole('freelancer'), async (req, res) => {
  const proposal = await loadMyProposal(req, res);
  if (!proposal) return;

  const { reason } = req.body || {};
  if (!DECLINE_REASONS.includes(reason)) {
    return res.status(400).json({ error: '거절 사유를 선택해주세요.' });
  }

  await run("UPDATE proposals SET status='declined', decline_reason=?, responded_at=? WHERE id=?", [reason, nowStr(), proposal.id]);

  const profile = await get('SELECT name FROM freelancer_profiles WHERE user_id = ?', [req.user.id]);
  const who = profile ? profile.name : '프리랜서';
  const body = `${who}님이 제안을 거절했어요. (사유: ${reason})`;
  await run('INSERT INTO notifications (user_id, tag, title, body) VALUES (?,?,?,?)', [
    proposal.company_id, '제안', '제안이 거절됐어요', body,
  ]);
  sendPushToUser(proposal.company_id, {
    kind: 'result', title: '제안 결과가 도착했어요', body, url: '/', tag: `proposal-${proposal.id}`,
  }).catch(() => {});

  res.json({ status: 'declined', reason });
});

module.exports = router;
