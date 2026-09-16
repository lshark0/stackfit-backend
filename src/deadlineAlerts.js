const { all, get, run } = require('./db');
const { addNotification, pushTo } = require('./notify');

// 마감일이 지난 공고를 자동으로 마감 처리합니다. 이게 없으면 jobs.status가 계속 'open'으로
// 남아, 지원 화면(매칭률 순)에서는 d_day로만 걸러지고 기업의 "등록한 공고"에는 계속 활성 상태로
// 보여서 실제로 마감됐는지 구분이 안 되는 문제가 있었습니다.
async function closeExpiredJobs() {
  const todayStr = new Date().toISOString().slice(0, 10);
  await run("UPDATE jobs SET status = 'closed' WHERE status = 'open' AND deadline IS NOT NULL AND deadline < ?", [todayStr]);
}

// 잡코리아 스타일: 저장한(관심) 공고의 마감이 내일(D-1)로 임박하면 한 번만 알려줍니다.
// notifications 테이블에 같은 공고로 이미 보낸 기록이 있으면 건너뛰어, 여러 번 실행돼도 중복 발송되지 않습니다.
async function checkDeadlineAlerts() {
  const rows = await all(
    `SELECT sj.freelancer_id, j.id AS job_id, j.title, j.deadline
     FROM saved_jobs sj
     JOIN jobs j ON j.id = sj.job_id
     WHERE j.status = 'open' AND j.deadline IS NOT NULL`
  );
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const r of rows) {
    const deadlineDate = new Date(r.deadline + 'T00:00:00');
    if (Number.isNaN(deadlineDate.getTime())) continue;
    const diffDays = Math.round((deadlineDate - today) / (1000 * 60 * 60 * 24));
    if (diffDays !== 1) continue; // 마감 하루 전(D-1)에만 알림

    const link = `jobDetail:${r.job_id}`;
    const already = await get(
      "SELECT id FROM notifications WHERE user_id=? AND tag='마감임박' AND link=?",
      [r.freelancer_id, link]
    );
    if (already) continue;

    const body = `"${r.title}" 공고가 내일 마감돼요.`;
    await addNotification(r.freelancer_id, { tag: '마감임박', title: '저장한 공고 마감이 임박했어요', body, link });
    pushTo(r.freelancer_id, { kind: 'result', title: '⏰ 마감임박', body, tag: `deadline-${r.job_id}`, link });
  }
}

module.exports = { checkDeadlineAlerts, closeExpiredJobs };
