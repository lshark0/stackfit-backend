const { all } = require('./db');
const { computeMatch } = require('./match');
const { getRatingSummaries } = require('./ratings');

// 등급을 숫자로 환산 (인접 등급은 부분 점수를 주기 위함)
const GRADE_LEVEL = { 초급: 1, 중급: 2, 고급: 3, 특급: 4 };

// 공고 ↔ 프리랜서 사이의 추천 점수(0~100)와 "왜 추천되는지" 근거를 계산합니다.
// 이랜서의 자동 매칭처럼, 기술스택만 보지 않고 업무·등급·평점까지 종합해 판단합니다.
//   - 기술스택 일치도 (최대 60점): 매칭의 핵심
//   - 업무(직무) 일치 (최대 20점): DBA 공고엔 DBA를 우선
//   - 등급 적합도 (최대 15점): 같은 등급이면 만점, 한 단계 차이면 부분 점수
//   - 평판 (최대 5점): 좋은 평가를 받은 쪽에 소폭 가점
function scoreMatch(job, profile, rating) {
  const reasons = [];

  const stackScore = Math.round((computeMatch(job.stack, profile.stack) / 99) * 60);
  const overlapCount = job.stack.filter((s) =>
    profile.stack.some((p) => p.toLowerCase() === s.toLowerCase())
  ).length;
  if (overlapCount > 0) reasons.push(`기술스택 ${overlapCount}개 일치`);

  let dutyScore = 0;
  if (job.duty && profile.role_title) {
    const role = profile.role_title.toLowerCase();
    const duty = job.duty.toLowerCase();
    if (role.includes(duty) || duty.includes(role)) {
      dutyScore = 20;
      reasons.push(`업무(${job.duty}) 일치`);
    }
  }

  let gradeScore = 0;
  if (job.grade && profile.grade) {
    const diff = Math.abs((GRADE_LEVEL[job.grade] || 0) - (GRADE_LEVEL[profile.grade] || 0));
    if (diff === 0) {
      gradeScore = 15;
      reasons.push(`등급(${profile.grade}) 일치`);
    } else if (diff === 1) {
      gradeScore = 8;
      reasons.push(`등급 근접(${profile.grade})`);
    }
  }

  let ratingScore = 0;
  if (rating && rating.rating_count > 0 && rating.rating_avg >= 4) {
    ratingScore = 5;
    reasons.push(`평점 ★${rating.rating_avg}`);
  }

  const total = Math.min(100, stackScore + dutyScore + gradeScore + ratingScore);
  return { score: total, reasons };
}

// [기업용] 특정 공고에 맞는 프리랜서를 자동 추천합니다.
async function recommendTalentsForJob(job, limit = 5) {
  const rows = await all('SELECT * FROM freelancer_profiles');
  if (rows.length === 0) return [];

  const profiles = rows.map((t) => ({ ...t, stack: JSON.parse(t.stack_json) }));
  const ratingById = await getRatingSummaries(profiles.map((p) => p.user_id));

  return profiles
    .map((p) => {
      const rating = ratingById[p.user_id] || { rating_avg: null, rating_count: 0 };
      const { score, reasons } = scoreMatch(job, p, rating);
      return { ...p, ...rating, score, reasons };
    })
    .filter((p) => p.score > 0) // 접점이 전혀 없는 사람은 추천하지 않음
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// [프리랜서용] 내 프로필에 맞는 공고를 자동 추천합니다.
async function recommendJobsForProfile(profile, limit = 5) {
  const rows = await all("SELECT * FROM jobs WHERE status = 'open'");
  if (rows.length === 0) return [];

  const jobs = rows.map((j) => ({ ...j, stack: JSON.parse(j.stack_json) }));
  const companyIds = [...new Set(jobs.map((j) => j.company_id))];
  const companyRows = companyIds.length
    ? await all(`SELECT user_id, name FROM companies WHERE user_id IN (${companyIds.map(() => '?').join(',')})`, companyIds)
    : [];
  const companyNameById = Object.fromEntries(companyRows.map((c) => [c.user_id, c.name]));
  const ratingById = await getRatingSummaries(companyIds);

  // 이미 지원했거나 마감된 공고는 추천에서 제외합니다.
  const applied = await all('SELECT job_id FROM applications WHERE freelancer_id = ?', [profile.user_id]);
  const appliedIds = new Set(applied.map((a) => a.job_id));
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return jobs
    .filter((j) => {
      if (appliedIds.has(j.id)) return false;
      if (j.deadline) {
        const d = new Date(j.deadline + 'T00:00:00');
        if (!Number.isNaN(d.getTime()) && d < today) return false;
      }
      return true;
    })
    .map((j) => {
      const rating = ratingById[j.company_id] || { rating_avg: null, rating_count: 0 };
      const { score, reasons } = scoreMatch(j, profile, rating);
      return {
        ...j,
        org: companyNameById[j.company_id] || '알 수 없음',
        ...rating,
        score,
        reasons,
      };
    })
    .filter((j) => j.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

module.exports = { recommendTalentsForJob, recommendJobsForProfile, scoreMatch };
