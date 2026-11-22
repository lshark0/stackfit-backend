const { all } = require('./db');
const { VISIBLE_SQL, revealCutoff } = require('./ratings');

// 김프리에서 계약하고 기업이 최종 완료를 확인한 프로젝트(= '김프리 완료')를 모읍니다.
// 프리랜서가 직접 적는 '수행 프로젝트'와 달리 플랫폼 안에서 확인된 이력이라 기업이 믿고 볼 수 있습니다.
// 기업 이름·단가·계약서는 내려주지 않습니다(거래 상대·조건은 당사자만 아는 정보). 공고 제목·기간·기술·평가만.

const parseList = (v) => { try { const x = JSON.parse(v || '[]'); return Array.isArray(x) ? x : []; } catch (e) { return []; } };
const parseObj = (v) => { try { const x = JSON.parse(v || ''); return x && typeof x === 'object' ? x : null; } catch (e) { return null; } };
const ym = (s) => (s ? String(s).slice(0, 7).replace('-', '.') : '');

// 여러 프리랜서의 김프리 완료 건수를 한 번에(목록 카드용). 반환: { [userId]: n }
async function getKimfreeDoneCounts(userIds) {
  const ids = [...new Set(userIds.map(Number))].filter((id) => Number.isInteger(id));
  if (!ids.length) return {};
  const rows = await all(
    `SELECT freelancer_id, COUNT(*) AS n FROM projects
     WHERE status = '완료' AND freelancer_id IN (${ids.map(() => '?').join(',')}) GROUP BY freelancer_id`,
    ids
  );
  return Object.fromEntries(rows.map((r) => [r.freelancer_id, Number(r.n)]));
}

// 한 프리랜서의 김프리 완료 프로젝트 목록(최근 완료 순, 최대 20건).
// 기업이 남긴 평가는 블라인드 규칙(VISIBLE_SQL)을 통과한 것만 붙입니다.
async function getKimfreeHistory(freelancerId) {
  const rows = await all(
    `SELECT p.id, p.title, p.period, p.contracted_at, p.created_at, p.completed_at, j.stack_json, c.biz_verified_at
     FROM projects p
     LEFT JOIN jobs j ON j.id = p.job_id
     LEFT JOIN companies c ON c.user_id = p.company_id
     WHERE p.freelancer_id = ? AND p.status = '완료'
     ORDER BY p.completed_at DESC, p.id DESC LIMIT 20`,
    [freelancerId]
  );
  if (!rows.length) return [];
  const reviews = await all(
    `SELECT r.project_id, r.rating, r.scores_json, r.again FROM reviews r
     WHERE r.reviewee_id = ? AND r.project_id IN (${rows.map(() => '?').join(',')}) AND ${VISIBLE_SQL}`,
    [freelancerId, ...rows.map((p) => p.id), revealCutoff()]
  );
  const reviewByProject = {};
  for (const r of reviews) {
    const s = parseObj(r.scores_json);
    const vals = s ? Object.values(s).map(Number).filter((v) => v >= 1 && v <= 5) : [];
    const score = vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : Number(r.rating);
    reviewByProject[r.project_id] = {
      score: Math.round(score * 10) / 10,
      again: r.again == null || r.again === '' ? null : Number(r.again) === 1,
    };
  }
  return rows.map((p) => {
    const start = ym(p.contracted_at || p.created_at);
    const end = ym(p.completed_at);
    return {
      id: p.id,
      title: p.title,
      period: p.period || '',
      span: start && end ? (start === end ? end : `${start} ~ ${end}`) : end,
      stack: parseList(p.stack_json).slice(0, 8),
      company_verified: !!p.biz_verified_at,
      review: reviewByProject[p.id] || null,
    };
  });
}

module.exports = { getKimfreeHistory, getKimfreeDoneCounts };
