// 초기 고객(기업)과 프리랜서를 함께 모으기 위한 장치들.
//  1) 새 공고 맞춤 알림: 공고가 올라오면 기술이 맞는 프리랜서와 그 기업을 관심 기업으로 둔 프리랜서에게 바로 알려
//     공고가 빈 채로 남지 않게 하고(기업 유지), 프리랜서는 앱을 열 이유가 생깁니다(프리랜서 유지).
//  2) 교차 초대: 기업이 함께 일했던 프리랜서를 초대하면 그 기업을 자동으로 관심 기업에 추가하고,
//     프리랜서가 일했던 회사를 초대하면 그 회사가 첫 공고를 올릴 때 초대한 프리랜서에게 먼저 알립니다.
const { get, all, run } = require('./db');
const { addNotification, pushTo } = require('./notify');
const { pairScore } = require('./recommend');

const MATCH_MIN_SCORE = 70;      // 이 점수 이상인 프리랜서에게만 알림
const MATCH_MAX_PER_JOB = 50;    // 공고 하나당 알림을 받는 최대 인원(점수 높은 순)
const DAILY_CAP = 5;             // 프리랜서 한 명이 하루에 받는 새 공고 알림 최대 수(스팸 방지)

const kstDayStart = () => {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 9 * 3600 * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
};

async function notifyNewJob(jobId) {
  const job = await get('SELECT j.*, c.name AS company_name FROM jobs j LEFT JOIN companies c ON c.user_id = j.company_id WHERE j.id = ?', [jobId]);
  if (!job || job.status !== 'open') return { sent: 0 };
  const companyName = job.company_name || '기업';
  const targets = new Map(); // freelancerId → { reason, score }

  // 관심 기업으로 둔 프리랜서(교차 초대로 자동 추가된 경우 포함)
  const followers = await all('SELECT freelancer_id FROM followed_companies WHERE company_id = ?', [job.company_id]);
  for (const f of followers) targets.set(f.freelancer_id, { reason: 'follow', score: null });

  // 기술이 맞는 프리랜서(새 공고 알림을 끈 회원 제외)
  const profiles = await all(
    "SELECT user_id, stack_json, role_title, grade FROM freelancer_profiles WHERE COALESCE(job_alerts, 1) = 1 AND stack_json IS NOT NULL AND stack_json <> '[]' LIMIT 5000"
  );
  const scored = profiles
    .map((p) => ({ id: p.user_id, score: pairScore(job, p) }))
    .filter((p) => p.score !== null && p.score >= MATCH_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MATCH_MAX_PER_JOB);
  for (const p of scored) {
    const t = targets.get(p.id);
    if (t) t.score = p.score; else targets.set(p.id, { reason: 'match', score: p.score });
  }

  const since = kstDayStart();
  let sent = 0;
  for (const [fid, t] of targets) {
    const opt = await get('SELECT COALESCE(job_alerts, 1) AS on_ FROM freelancer_profiles WHERE user_id = ?', [fid]);
    if (!opt || Number(opt.on_) !== 1) continue;
    const { c } = await get("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND tag = '새 공고' AND created_at >= ?", [fid, since]);
    if (Number(c) >= DAILY_CAP) continue;
    const title = t.reason === 'follow' ? `관심 기업 ${companyName}의 새 공고` : '내 기술에 맞는 새 공고가 올라왔어요';
    const body = `${companyName} · ${job.title}${t.score ? ` (추천 ${t.score}%)` : ''}`;
    await addNotification(fid, { tag: '새 공고', title, body: body.slice(0, 80), link: `jobDetail:${job.id}` });
    pushTo(fid, { kind: 'job', title, body: body.slice(0, 100), tag: `newjob-${job.id}`, link: `jobDetail:${job.id}` });
    sent++;
  }

  // 프리랜서가 초대한 회사의 첫 공고면, 초대한 프리랜서에게도 알립니다(위에서 이미 받았으면 생략).
  const company = await get('SELECT referred_by FROM users WHERE id = ?', [job.company_id]);
  if (company && company.referred_by && !targets.has(company.referred_by)) {
    const inviter = await get("SELECT id FROM users WHERE id = ? AND role = 'freelancer'", [company.referred_by]);
    const { n } = await get('SELECT COUNT(*) AS n FROM jobs WHERE company_id = ?', [job.company_id]);
    if (inviter && Number(n) === 1) {
      const title = '초대한 회사가 첫 공고를 올렸어요';
      const body = `${companyName} · ${job.title}`;
      await addNotification(inviter.id, { tag: '새 공고', title, body: body.slice(0, 80), link: `jobDetail:${job.id}` });
      pushTo(inviter.id, { kind: 'job', title, body: body.slice(0, 100), tag: `newjob-${job.id}`, link: `jobDetail:${job.id}` });
      sent++;
    }
  }
  return { sent };
}

function notifyNewJobLater(jobId) {
  setImmediate(() => notifyNewJob(jobId).catch((e) => console.warn('[김프리] 새 공고 알림 실패:', e.message)));
}

// 교차 초대: 기업의 초대 링크로 가입한 프리랜서는 그 기업을 관심 기업에 자동으로 추가합니다.
async function linkCrossInvite(newUserId, referrerId) {
  const [u, r] = await Promise.all([
    get('SELECT id, role FROM users WHERE id = ?', [newUserId]),
    get('SELECT id, role FROM users WHERE id = ?', [referrerId]),
  ]);
  if (!u || !r) return null;
  if (u.role === 'freelancer' && r.role === 'company') {
    if (!(await get('SELECT id FROM followed_companies WHERE freelancer_id = ? AND company_id = ?', [u.id, r.id]))) {
      await run('INSERT INTO followed_companies (freelancer_id, company_id) VALUES (?, ?)', [u.id, r.id]);
    }
    return 'freelancer_follows_company';
  }
  if (u.role === 'company' && r.role === 'freelancer') return 'company_invited_by_freelancer';
  return null;
}

module.exports = { notifyNewJob, notifyNewJobLater, linkCrossInvite, MATCH_MIN_SCORE, DAILY_CAP };
