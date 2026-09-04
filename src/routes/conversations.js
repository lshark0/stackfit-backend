const express = require('express');
const { run, get, all } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');

const router = express.Router();
wrapAllRoutes(router);

router.get('/', requireAuth, async (req, res) => {
  const col = req.user.role === 'freelancer' ? 'freelancer_id' : 'company_id';
  const convs = await all(`SELECT * FROM conversations WHERE ${col} = ? ORDER BY created_at DESC, id DESC`, [req.user.id]);
  if (convs.length === 0) return res.json({ conversations: [] });

  // N+1 방지: 상대방 이름 / 공고 제목 / 메시지를 각각 한 번의 쿼리로 모아온 뒤 메모리에서 조합합니다.
  const convIds = convs.map((c) => c.id);
  const msgPlaceholders = convIds.map(() => '?').join(',');
  const allMsgs = await all(
    `SELECT * FROM messages WHERE conversation_id IN (${msgPlaceholders}) ORDER BY created_at ASC, id ASC`,
    convIds
  );

  const counterpartIds = [...new Set(convs.map((c) => (req.user.role === 'freelancer' ? c.company_id : c.freelancer_id)))];
  const cpPlaceholders = counterpartIds.map(() => '?').join(',');
  const counterpartRows = req.user.role === 'freelancer'
    ? await all(`SELECT user_id, name FROM companies WHERE user_id IN (${cpPlaceholders})`, counterpartIds)
    : await all(`SELECT user_id, name FROM freelancer_profiles WHERE user_id IN (${cpPlaceholders})`, counterpartIds);
  const nameById = Object.fromEntries(counterpartRows.map((r) => [r.user_id, r.name]));

  const jobIds = [...new Set(convs.map((c) => c.job_id).filter(Boolean))];
  const jobRows = jobIds.length
    ? await all(`SELECT id, title FROM jobs WHERE id IN (${jobIds.map(() => '?').join(',')})`, jobIds)
    : [];
  const jobTitleById = Object.fromEntries(jobRows.map((j) => [j.id, j.title]));

  const result = convs.map((c) => {
    const msgs = allMsgs.filter((m) => m.conversation_id === c.id);
    const last = msgs.length ? msgs[msgs.length - 1] : null;
    // 내가 마지막으로 보낸 시각 이후에 상대가 보낸 메시지를 안 읽은 것으로 계산합니다.
    const myLastSentAt = msgs.filter((m) => m.sender_id === req.user.id).map((m) => m.created_at).pop() || '1970-01-01';
    const unread = msgs.filter((m) => m.sender_id !== req.user.id && m.created_at > myLastSentAt).length;
    const counterpartId = req.user.role === 'freelancer' ? c.company_id : c.freelancer_id;
    return {
      ...c,
      name: nameById[counterpartId] || (req.user.role === 'freelancer' ? '기업' : '프리랜서'),
      jobTitle: c.job_id ? (jobTitleById[c.job_id] || null) : null,
      lastMessage: last,
      unread,
    };
  });

  res.json({ conversations: result });
});

// 새 대화 시작 (없으면 생성, 있으면 재사용)
router.post('/', requireAuth, async (req, res) => {
  const { companyId, freelancerId, jobId } = req.body || {};
  const cId = req.user.role === 'company' ? req.user.id : Number(companyId);
  const fId = req.user.role === 'freelancer' ? req.user.id : Number(freelancerId);
  if (!cId || !fId) return res.status(400).json({ error: 'companyId, freelancerId가 필요합니다.' });

  // 상대방이 실제로 존재하는 올바른 역할의 계정인지 확인 (임의 사용자 대상 스팸/알림 남용 방지)
  if (req.user.role === 'freelancer') {
    const company = await get('SELECT user_id FROM companies WHERE user_id = ?', [cId]);
    if (!company) return res.status(404).json({ error: '기업을 찾을 수 없습니다.' });
  } else {
    const freelancer = await get('SELECT user_id FROM freelancer_profiles WHERE user_id = ?', [fId]);
    if (!freelancer) return res.status(404).json({ error: '프리랜서를 찾을 수 없습니다.' });
  }

  // 공고를 지정한 경우, 실제 존재하며 그 기업의 공고가 맞는지 확인합니다.
  let safeJobId = null;
  if (jobId !== undefined && jobId !== null && jobId !== '') {
    const jid = Number(jobId);
    if (!Number.isInteger(jid)) return res.status(400).json({ error: '올바르지 않은 공고 ID입니다.' });
    const job = await get('SELECT id FROM jobs WHERE id = ? AND company_id = ?', [jid, cId]);
    if (!job) return res.status(404).json({ error: '공고를 찾을 수 없습니다.' });
    safeJobId = jid;
  }

  let conv = await get(
    'SELECT * FROM conversations WHERE company_id=? AND freelancer_id=? AND job_id IS NOT DISTINCT FROM ?',
    [cId, fId, safeJobId]
  );
  if (!conv) {
    const r = await run('INSERT INTO conversations (company_id, freelancer_id, job_id) VALUES (?,?,?)', [cId, fId, safeJobId]);
    conv = await get('SELECT * FROM conversations WHERE id = ?', [r.lastInsertRowid]);
  }
  res.status(201).json(conv);
});

router.get('/:id/messages', requireAuth, async (req, res) => {
  const conv = await get('SELECT * FROM conversations WHERE id = ?', [req.params.id]);
  if (!conv || (conv.company_id !== req.user.id && conv.freelancer_id !== req.user.id)) {
    return res.status(404).json({ error: '대화를 찾을 수 없습니다.' });
  }
  const msgs = await all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC', [req.params.id]);
  res.json({ messages: msgs });
});

router.post('/:id/messages', requireAuth, async (req, res) => {
  const { body } = req.body || {};
  if (!body || typeof body !== 'string' || !body.trim()) return res.status(400).json({ error: '메시지 내용을 입력해주세요.' });
  if (body.trim().length > 2000) return res.status(400).json({ error: '메시지가 너무 길어요 (2000자 이내).' });

  const conv = await get('SELECT * FROM conversations WHERE id = ?', [req.params.id]);
  if (!conv || (conv.company_id !== req.user.id && conv.freelancer_id !== req.user.id)) {
    return res.status(404).json({ error: '대화를 찾을 수 없습니다.' });
  }

  await run('INSERT INTO messages (conversation_id, sender_id, body) VALUES (?,?,?)', [conv.id, req.user.id, body.trim()]);
  const counterpartId = req.user.id === conv.company_id ? conv.freelancer_id : conv.company_id;
  await run('INSERT INTO notifications (user_id, tag, title, body) VALUES (?,?,?,?)', [
    counterpartId, '메시지', '새 메시지가 도착했어요', body.trim().slice(0, 40),
  ]);

  const msgs = await all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC', [conv.id]);
  res.status(201).json({ messages: msgs });
});

module.exports = router;
