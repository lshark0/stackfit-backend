const { get, all } = require('./db');
const { criteriaFor, REVEAL_DAYS } = require('./reviewCriteria');

// 블라인드 상호 평가: 받은 평가는 상대방(평가받은 사람)도 그 프로젝트에 평가를 남겼거나,
// 평가가 작성된 지 REVEAL_DAYS일이 지난 경우에만 공개·집계합니다(보복성 평가 방지).
// r은 reviews 테이블의 별칭이어야 하고, 파라미터로 revealCutoff()를 함께 넘깁니다.
const VISIBLE_SQL = `(EXISTS (SELECT 1 FROM reviews r2 WHERE r2.project_id = r.project_id AND r2.reviewer_id = r.reviewee_id)
  OR r.created_at <= ?)`;
function revealCutoff() {
  return new Date(Date.now() - REVEAL_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

const parseJ = (v) => { try { return JSON.parse(v || ''); } catch (e) { return null; } };
// 평가 한 건의 종합 점수: 항목별 점수가 있으면 그 평균(소수), 없으면 예전 방식의 별점(정수)
function reviewScore(r) {
  const s = parseJ(r.scores_json);
  const vals = s && typeof s === 'object' ? Object.values(s).map(Number).filter((v) => v >= 1 && v <= 5) : [];
  return vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : Number(r.rating);
}
const round1 = (x) => Math.round(x * 10) / 10;

// 특정 사용자가 받은 (공개된) 리뷰의 평균 평점과 개수를 반환합니다.
async function getRatingSummary(userId) {
  return (await getRatingSummaries([Number(userId)]))[Number(userId)] || { rating_avg: null, rating_count: 0 };
}

// 여러 사용자의 평점을 한 번의 쿼리로 일괄 조회합니다 (목록 화면에서 N+1 쿼리 방지용).
// 반환값: { [userId]: { rating_avg, rating_count } }
async function getRatingSummaries(userIds) {
  const ids = [...new Set(userIds)].filter((id) => Number.isInteger(id));
  const map = {};
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await all(
    `SELECT r.reviewee_id, r.rating, r.scores_json FROM reviews r
     WHERE r.reviewee_id IN (${placeholders}) AND ${VISIBLE_SQL}`,
    [...ids, revealCutoff()]
  );
  const acc = {};
  for (const r of rows) {
    const a = acc[r.reviewee_id] || (acc[r.reviewee_id] = { sum: 0, n: 0 });
    a.sum += reviewScore(r); a.n += 1;
  }
  for (const [id, a] of Object.entries(acc)) map[id] = { rating_avg: round1(a.sum / a.n), rating_count: a.n };
  return map;
}

const parse = (v, fallback) => { try { const x = JSON.parse(v || ''); return x == null ? fallback : x; } catch (e) { return fallback; } };

// 프로필·공고 상세에 보여 줄 평가 요약: 종합 평점, 항목별 평균, 재계약 의사 비율, 강점 태그, 최근 후기.
async function getReviewDetail(userId, revieweeRole) {
  const rows = await all(
    `SELECT r.rating, r.comment, r.created_at, r.scores_json, r.again, r.tags_json FROM reviews r
     WHERE r.reviewee_id = ? AND ${VISIBLE_SQL} ORDER BY r.created_at DESC, r.id DESC`,
    [userId, revealCutoff()]
  );
  const { criteria } = criteriaFor(revieweeRole);
  const count = rows.length;
  const avg = count ? round1(rows.reduce((a, r) => a + reviewScore(r), 0) / count) : null;
  const categories = criteria.map((c) => {
    const vals = rows.map((r) => Number(parse(r.scores_json, {})[c.key])).filter((v) => v >= 1 && v <= 5);
    return { key: c.key, label: c.label, avg: vals.length ? Math.round((vals.reduce((a, v) => a + v, 0) / vals.length) * 10) / 10 : null, count: vals.length };
  });
  const againRows = rows.filter((r) => r.again === 0 || r.again === 1 || r.again === '0' || r.again === '1');
  const againYes = againRows.filter((r) => Number(r.again) === 1).length;
  const tagCount = {};
  rows.forEach((r) => parse(r.tags_json, []).forEach((t) => { tagCount[t] = (tagCount[t] || 0) + 1; }));
  const tags = Object.entries(tagCount).map(([tag, n]) => ({ tag, count: n })).sort((a, b) => b.count - a.count).slice(0, 6);
  const recent = rows.filter((r) => String(r.comment || '').trim()).slice(0, 3)
    .map((r) => ({ rating: round1(reviewScore(r)), comment: r.comment, createdAt: r.created_at }));
  return {
    rating_avg: avg,
    rating_count: count,
    categories,
    again: againRows.length ? { yes: againYes, total: againRows.length, rate: Math.round((againYes / againRows.length) * 100) } : null,
    tags,
    recent,
  };
}

module.exports = { getRatingSummary, getRatingSummaries, getReviewDetail, VISIBLE_SQL, revealCutoff };
