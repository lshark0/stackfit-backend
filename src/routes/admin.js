const express = require('express');
const { run, get, all } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { wrapAllRoutes } = require('../middleware/asyncHandler');
const { addNotification, pushTo } = require('../notify');
const { signedFileUrl } = require('../fileAccess');
const ai = require('../ai');
const { listSecurityEvents } = require('../securityLog');

const router = express.Router();
wrapAllRoutes(router);

const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const todayStr = () => new Date().toISOString().slice(0, 10);

// 관리자 화면 메뉴 노출 여부를 프론트가 매번 묻지 않아도 되도록, /auth/me에도 isAdmin을 함께 내려줍니다.
// 여기서는 신고된 공고 목록을 처리대기가 먼저 오도록 정렬해 보여줍니다.
router.get('/job-reports', requireAuth, requireAdmin, async (req, res) => {
  const rows = await all(
    `SELECT r.id, r.reason, r.content, r.reply_email, r.status, r.created_at, r.resolved_at, r.admin_note,
       r.attachment_filename, r.attachment_original_name,
       j.id AS job_id, j.title AS job_title, j.status AS job_status,
       c.name AS company_name, c.user_id AS company_id,
       f.name AS reporter_name, r.freelancer_id AS reporter_id
     FROM job_reports r
     JOIN jobs j ON j.id = r.job_id
     LEFT JOIN companies c ON c.user_id = j.company_id
     LEFT JOIN freelancer_profiles f ON f.user_id = r.freelancer_id
     ORDER BY (r.status = 'pending') DESC, r.created_at DESC, r.id DESC`
  );
  res.json({
    reports: rows.map((r) => ({ ...r, attachment_url: signedFileUrl(r.attachment_filename) })),
  });
});

// 신고 처리: 반려(dismiss) / 공고 마감(close_job) / 공고 삭제(delete_job) 중 하나를 선택합니다.
// 이미 처리한 신고도 (공고가 남아있는 한) 다른 조치로 다시 바꿀 수 있습니다.
// 단, 삭제는 되돌릴 수 없습니다 — 공고가 사라지면 이 신고 기록도 함께 사라지기 때문입니다.
router.post('/job-reports/:id/resolve', requireAuth, requireAdmin, async (req, res) => {
  const reportId = Number(req.params.id);
  if (!Number.isInteger(reportId)) return res.status(400).json({ error: '올바르지 않은 신고 ID입니다.' });
  const { action, note } = req.body || {};
  if (!['dismiss', 'close_job', 'delete_job'].includes(action)) {
    return res.status(400).json({ error: "action은 'dismiss', 'close_job', 'delete_job' 중 하나여야 합니다." });
  }

  const report = await get('SELECT * FROM job_reports WHERE id = ?', [reportId]);
  if (!report) return res.status(404).json({ error: '신고 내역을 찾을 수 없습니다.' });

  const job = await get('SELECT * FROM jobs WHERE id = ?', [report.job_id]);
  if (!job) return res.status(404).json({ error: '이미 삭제된 공고라 더 이상 처리를 바꿀 수 없어요.' });

  // job_reports.job_id는 ON DELETE CASCADE라서, 공고를 먼저 지우면 이 신고 행(및 같은 공고의
  // 다른 신고들)도 함께 사라집니다. 그래서 신고 처리 상태를 먼저 남긴 뒤에 공고를 건드립니다.
  const resolvedStatus = action === 'dismiss' ? 'dismissed' : 'resolved';
  await run(
    'UPDATE job_reports SET status = ?, resolved_at = ?, admin_note = ? WHERE id = ?',
    [resolvedStatus, nowStr(), typeof note === 'string' ? note.trim().slice(0, 300) : '', reportId]
  );

  if (action === 'close_job') {
    if (job.status !== 'closed') {
      await run("UPDATE jobs SET status = 'closed' WHERE id = ?", [job.id]);
      await addNotification(job.company_id, {
        tag: '공고', title: '공고가 마감 처리됐어요',
        body: `"${job.title}" 공고가 신고 접수에 따라 마감 처리됐습니다. 문의사항은 고객센터로 연락해주세요.`,
        link: `jobDetail:${job.id}`,
      });
      pushTo(job.company_id, {
        kind: 'result', title: '📋 공고가 마감 처리됐어요',
        body: `"${job.title}" 공고가 신고 접수에 따라 마감 처리됐습니다.`,
        tag: `job-closed-${job.id}`, link: `jobDetail:${job.id}`,
      });
    }
  } else if (action === 'dismiss') {
    // 이 신고 때문에 마감됐던 공고를 반려로 바꾸면 다시 열어줍니다.
    // 단, 마감일이 이미 지난 공고는 자연 마감이라 다시 열지 않습니다.
    const deadlineOk = !job.deadline || job.deadline >= todayStr();
    if (job.status === 'closed' && deadlineOk) {
      await run("UPDATE jobs SET status = 'open' WHERE id = ?", [job.id]);
      await addNotification(job.company_id, {
        tag: '공고', title: '공고가 다시 열렸어요',
        body: `"${job.title}" 공고가 신고 반려 처리에 따라 다시 게시됐습니다.`,
        link: `jobDetail:${job.id}`,
      });
      pushTo(job.company_id, {
        kind: 'result', title: '✅ 공고가 다시 열렸어요',
        body: `"${job.title}" 공고가 신고 반려 처리에 따라 다시 게시됐습니다.`,
        tag: `job-reopened-${job.id}`, link: `jobDetail:${job.id}`,
      });
    }
  } else if (action === 'delete_job') {
    await addNotification(job.company_id, {
      tag: '공고', title: '공고가 삭제됐어요',
      body: `"${job.title}" 공고가 신고 접수에 따라 삭제됐습니다. 문의사항은 고객센터로 연락해주세요.`,
      link: 'jobs',
    });
    pushTo(job.company_id, {
      kind: 'result', title: '🗑️ 공고가 삭제됐어요',
      body: `"${job.title}" 공고가 신고 접수에 따라 삭제됐습니다.`,
      tag: `job-deleted-${job.id}`, link: 'jobs',
    });
    await run('DELETE FROM jobs WHERE id = ?', [job.id]);
  }

  res.json({ status: resolvedStatus, action });
});

// 가입 경로 통계: 기간(days) 동안 가입한 회원을 채널(signup_source)·캠페인·유형별로 집계합니다.
// 회원 수가 많지 않은 초기 단계라 DB별 날짜 함수 차이를 피하려고 필요한 컬럼만 읽어 메모리에서 집계합니다.
const toKstDate = (v) => {
  const d = v instanceof Date ? v : new Date(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? null : new Date(d.getTime() + 9 * 3600 * 1000);
};
router.get('/signup-stats', requireAuth, requireAdmin, async (req, res) => {
  const days = Math.min(3650, Math.max(1, Number.parseInt(req.query.days, 10) || 30));
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const users = await all(
    'SELECT id, role, created_at, signup_source, signup_medium, signup_campaign, referred_by FROM users'
  );
  const inPeriod = users.filter((u) => {
    const d = toKstDate(u.created_at);
    return d && d.getTime() - 9 * 3600 * 1000 >= since.getTime();
  });

  const bump = (map, key, role) => {
    const k = key || '';
    if (!map[k]) map[k] = { key: k, total: 0, freelancer: 0, company: 0 };
    map[k].total++;
    map[k][role] = (map[k][role] || 0) + 1;
  };
  const bySource = {}, byCampaign = {}, daily = {}, referrerCount = {};
  for (const u of inPeriod) {
    bump(bySource, u.signup_source, u.role);
    if (u.signup_campaign) bump(byCampaign, `${u.signup_source || ''}/${u.signup_campaign}`, u.role);
    const day = toKstDate(u.created_at).toISOString().slice(0, 10);
    daily[day] = (daily[day] || 0) + 1;
    if (u.referred_by) referrerCount[u.referred_by] = (referrerCount[u.referred_by] || 0) + 1;
  }

  const topIds = Object.entries(referrerCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id]) => Number(id));
  let topReferrers = [];
  if (topIds.length) {
    const ph = topIds.map(() => '?').join(',');
    const rows = await all(
      `SELECT u.id, u.role, f.name AS freelancer_name, c.name AS company_name
       FROM users u LEFT JOIN freelancer_profiles f ON f.user_id = u.id LEFT JOIN companies c ON c.user_id = u.id
       WHERE u.id IN (${ph})`,
      topIds
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    topReferrers = topIds.filter((id) => byId[id]).map((id) => ({
      id, role: byId[id].role,
      name: (byId[id].role === 'company' ? byId[id].company_name : byId[id].freelancer_name) || '이름 미입력',
      count: referrerCount[id],
    }));
  }

  const sortDesc = (m) => Object.values(m).sort((a, b) => b.total - a.total);
  res.json({
    days,
    total: inPeriod.length,
    freelancer: inPeriod.filter((u) => u.role === 'freelancer').length,
    company: inPeriod.filter((u) => u.role === 'company').length,
    referred: inPeriod.filter((u) => u.referred_by).length,
    bySource: sortDesc(bySource),
    byCampaign: sortDesc(byCampaign).slice(0, 20),
    daily: Object.entries(daily).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, count]) => ({ date, count })),
    topReferrers,
  });
});

// AI 사용량 통계 — 기능별 호출 수·토큰·예상 비용(USD/원), 일별 추이, 많이 쓴 회원
const AI_FEATURE_LABELS = { support_chat: 'AI 상담', profile_from_resume: '경력기술서 자동 채우기' };
router.get('/ai-usage', requireAuth, requireAdmin, async (req, res) => {
  const days = Math.min(3650, Math.max(1, Number.parseInt(req.query.days, 10) || 30));
  const today = ai.kstDay();
  const sinceDay = new Date(Date.parse(today) - (days - 1) * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';
  const fromDay = sinceDay < monthStart ? sinceDay : monthStart;
  const rows = await all(
    'SELECT user_id, feature, day, model, input_tokens, output_tokens FROM ai_usage WHERE day >= ?',
    [fromDay]
  );
  const krwPerUsd = Number(process.env.AI_KRW_PER_USD) || 1400;

  const empty = () => ({ calls: 0, input: 0, output: 0, costUsd: 0, users: new Set() });
  const add = (acc, r, cost) => {
    acc.calls++; acc.input += Number(r.input_tokens); acc.output += Number(r.output_tokens);
    acc.costUsd += cost; acc.users.add(r.user_id);
  };
  const total = empty(), month = empty(), todayAcc = empty();
  const byFeature = {}, daily = {}, byUser = {};
  for (const r of rows) {
    const cost = ai.estimateCostUsd(r.model, r.input_tokens, r.output_tokens);
    if (r.day >= monthStart) add(month, r, cost);
    if (r.day === today) add(todayAcc, r, cost);
    if (r.day < sinceDay) continue;
    add(total, r, cost);
    add(byFeature[r.feature] || (byFeature[r.feature] = empty()), r, cost);
    const d = daily[r.day] || (daily[r.day] = { date: r.day, calls: 0, costUsd: 0 });
    d.calls++; d.costUsd += cost;
    const u = byUser[r.user_id] || (byUser[r.user_id] = { id: r.user_id, calls: 0, costUsd: 0 });
    u.calls++; u.costUsd += cost;
  }
  const out = (a) => ({
    calls: a.calls, users: a.users.size, input: a.input, output: a.output,
    costUsd: Math.round(a.costUsd * 10000) / 10000, costKrw: Math.round(a.costUsd * krwPerUsd),
  });

  const top = Object.values(byUser).sort((a, b) => b.calls - a.calls).slice(0, 10);
  let topUsers = [];
  if (top.length) {
    const ph = top.map(() => '?').join(',');
    const users = await all(
      `SELECT u.id, u.role, f.name AS freelancer_name, c.name AS company_name
       FROM users u LEFT JOIN freelancer_profiles f ON f.user_id = u.id LEFT JOIN companies c ON c.user_id = u.id
       WHERE u.id IN (${ph})`,
      top.map((t) => t.id)
    );
    const byId = Object.fromEntries(users.map((u) => [u.id, u]));
    topUsers = top.map((t) => {
      const u = byId[t.id];
      return {
        id: t.id, role: u ? u.role : null,
        name: u ? ((u.role === 'company' ? u.company_name : u.freelancer_name) || '이름 미입력') : '(탈퇴한 회원)',
        calls: t.calls, costKrw: Math.round(t.costUsd * krwPerUsd),
      };
    });
  }

  res.json({
    days, krwPerUsd,
    model: ai.SUPPORT_MODEL,
    enabled: ai.aiEnabled(),
    limits: ai.DAILY_LIMITS,
    total: out(total), month: out(month), today: out(todayAcc),
    byFeature: Object.entries(byFeature)
      .map(([feature, a]) => ({ feature, label: AI_FEATURE_LABELS[feature] || feature, ...out(a) }))
      .sort((a, b) => b.calls - a.calls),
    daily: Object.values(daily).sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((d) => ({ date: d.date, calls: d.calls, costKrw: Math.round(d.costUsd * krwPerUsd) })),
    topUsers,
  });
});

// 보안 로그 조회 — 최근 로그인 실패·잠금·관리자 작업 등 (6개월 보관)
router.get('/security-events', requireAuth, requireAdmin, async (req, res) => {
  const events = await listSecurityEvents(Number.parseInt(req.query.limit, 10) || 200);
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const recent = events.filter((e) => e.ts >= dayAgo);
  res.json({
    summary: {
      failed24h: recent.filter((e) => e.event === 'login_failed').length,
      locked24h: recent.filter((e) => e.event === 'login_locked').length,
      denied24h: recent.filter((e) => e.event === 'admin_denied').length,
      adminLogins24h: recent.filter((e) => e.event === 'login_success' && /관리자/.test(e.detail)).length,
    },
    events,
  });
});

module.exports = router;
