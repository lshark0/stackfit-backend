const { all } = require('./db');
const { computeMatch, matchedStack, stackCounts } = require('./match');
const { getRatingSummaries } = require('./ratings');
const { scoreTiming, scoreWorkType, scoreRegion, scoreCerts } = require('./workConditions');

// 등급을 숫자로 환산 (인접 등급은 부분 점수를 주기 위함)
const GRADE_LEVEL = { 초급: 1, 중급: 2, 고급: 3, 특급: 4 };

// 공고 ↔ 프리랜서 사이의 추천 점수(0~100)와 "왜 추천되는지" 근거를 계산합니다.
// 이랜서의 자동 매칭처럼, 기술스택만 보지 않고 업무·등급·근무 조건·평점까지 종합해 판단합니다.
//   - 기술스택 일치도 (최대 45점): 매칭의 핵심
//   - 업무(직무) 일치 (최대 15점): DBA 공고엔 DBA를 우선
//   - 등급 적합도 (최대 10점): 같은 등급이면 만점, 한 단계 차이면 부분 점수
//   - 투입 시기 (최대 10점): 공고 투입 예정일까지 투입할 수 있는지
//   - 근무 형태·지역 (최대 10점): 상주/재택/혼합 선호와 근무 가능 지역
//   - 자격증 (최대 5점): 공고 요구 자격증 보유
//   - 평판 (최대 5점): 좋은 평가를 받은 쪽에 소폭 가점
// 근무 조건을 입력하지 않은 회원은 감점하지 않도록 중간 점수(중립)를 줍니다(src/workConditions.js).
// 업무 일치 판정. PM·SE 같은 짧은 영문 코드는 단어 단위로만 비교합니다
// (예전에 직접 입력한 "Senior 개발자"가 SE로 잘못 일치하지 않도록).
function containsTerm(text, term) {
  if (!term) return false;
  if (/^[a-z]{1,3}$/.test(term)) return new RegExp(`(^|[^a-z])${term}([^a-z]|$)`).test(text);
  return text.includes(term);
}
function dutyMatches(role, duty) {
  return role === duty || containsTerm(role, duty) || containsTerm(duty, role);
}

function parseList(v) {
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}

function scoreMatch(job, profile, rating) {
  const reasons = [];

  const match = computeMatch(job.stack, profile.stack);
  const stackScore = Math.round((match / 100) * 45);
  const matched = matchedStack(job.stack, profile.stack);
  const { matchTotal } = stackCounts(job.stack, profile.stack);
  if (matched.length > 0) reasons.push(`기술스택 ${matchTotal}개 중 ${matched.length}개 일치`);

  let dutyScore = 0;
  if (job.duty && profile.role_title) {
    const role = profile.role_title.toLowerCase();
    const duty = job.duty.toLowerCase();
    if (dutyMatches(role, duty)) {
      dutyScore = 15;
      reasons.push(`업무(${job.duty}) 일치`);
    }
  }

  let gradeScore = 0;
  if (job.grade && profile.grade) {
    const diff = Math.abs((GRADE_LEVEL[job.grade] || 0) - (GRADE_LEVEL[profile.grade] || 0));
    if (diff === 0) {
      gradeScore = 10;
      reasons.push(`등급(${profile.grade}) 일치`);
    } else if (diff === 1) {
      gradeScore = 5;
      reasons.push(`등급 근접(${profile.grade})`);
    }
  }

  const timing = scoreTiming(job, profile);
  const workType = scoreWorkType(job, profile);
  const region = scoreRegion(job, profile);
  const certs = scoreCerts(job.certs, profile.certs);
  for (const r of [certs.reason, timing.reason, workType.reason, region.reason]) if (r) reasons.push(r);

  let ratingScore = 0;
  if (rating && rating.rating_count > 0 && rating.rating_avg >= 4) {
    ratingScore = 5;
    reasons.push(`평점 ★${rating.rating_avg}`);
  }

  const workScore = workType.score + region.score;
  const total = Math.min(100, stackScore + dutyScore + gradeScore + timing.score + workScore + certs.score + ratingScore);
  // 화면에 "스택 45 + 업무 15 + 등급 10 + 시기 10 + 근무 10 + 자격 5 + 평점 0"처럼 점수 내역을 보여주기 위한 값
  const breakdown = {
    stack: stackScore, duty: dutyScore, grade: gradeScore,
    timing: timing.score, work: workScore, certs: certs.score, rating: ratingScore,
  };
  // 근무 조건은 중립 점수가 있으므로, 기술·업무·자격증 중 하나라도 맞아야 '접점이 있다'고 봅니다.
  const relevant = stackScore > 0 || dutyScore > 0 || certs.matched > 0;
  return { score: total, match, matched, matchTotal, reasons, breakdown, relevant };
}

// [기업용] 특정 공고에 맞는 프리랜서를 자동 추천합니다.
async function recommendTalentsForJob(job, limit = 5) {
  const rows = await all('SELECT * FROM freelancer_profiles');
  if (rows.length === 0) return [];

  const profiles = rows.map((t) => ({ ...t, stack: JSON.parse(t.stack_json), certs: parseList(t.certs_json) }));
  const ratingById = await getRatingSummaries(profiles.map((p) => p.user_id));

  return profiles
    .map((p) => {
      const rating = ratingById[p.user_id] || { rating_avg: null, rating_count: 0 };
      const { score, match, matched, matchTotal, reasons, breakdown, relevant } = scoreMatch(job, p, rating);
      return { ...p, ...rating, score, match, matchedStack: matched, matchCount: matched.length, matchTotal, reasons, breakdown, relevant };
    })
    .filter((p) => p.relevant) // 접점이 전혀 없는 사람은 추천하지 않음
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// [프리랜서용] 내 프로필에 맞는 공고를 자동 추천합니다.
async function recommendJobsForProfile(profile, limit = 5) {
  const rows = await all("SELECT * FROM jobs WHERE status = 'open'");
  if (rows.length === 0) return [];

  const jobs = rows.map((j) => ({ ...j, stack: JSON.parse(j.stack_json), certs: parseList(j.certs_json) }));
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
      const { score, match, matched, matchTotal, reasons, breakdown, relevant } = scoreMatch(j, profile, rating);
      return {
        ...j,
        org: companyNameById[j.company_id] || '알 수 없음',
        ...rating,
        score,
        match,
        matchedStack: matched,
        matchCount: matched.length,
        matchTotal,
        reasons,
        breakdown,
        relevant,
      };
    })
    .filter((j) => j.relevant)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// 공고 행·프리랜서 프로필 행(DB 원본)으로 바로 추천 점수를 계산합니다. 공고가 없으면 null.
// 지원·제안 시점에 저장해 두고, 성과 지표에서 '추천 점수별 계약 성사율'을 보는 데 씁니다.
function pairScore(jobRow, profileRow) {
  if (!jobRow || !profileRow) return null;
  return scoreMatch(
    { ...jobRow, stack: parseList(jobRow.stack_json), certs: parseList(jobRow.certs_json) },
    { ...profileRow, stack: parseList(profileRow.stack_json), certs: parseList(profileRow.certs_json) },
    null
  ).score;
}

module.exports = { recommendTalentsForJob, recommendJobsForProfile, scoreMatch, pairScore };
