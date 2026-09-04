const { get, all } = require('./db');

// 특정 사용자가 받은 리뷰의 평균 평점과 개수를 반환합니다.
async function getRatingSummary(userId) {
  const row = await get('SELECT AVG(rating) AS avg, COUNT(*) AS cnt FROM reviews WHERE reviewee_id = ?', [userId]);
  const cnt = Number(row?.cnt || 0);
  const avg = cnt > 0 ? Math.round(Number(row.avg) * 10) / 10 : null;
  return { rating_avg: avg, rating_count: cnt };
}

// 여러 사용자의 평점을 한 번의 쿼리로 일괄 조회합니다 (목록 화면에서 N+1 쿼리 방지용).
// 반환값: { [userId]: { rating_avg, rating_count } }
async function getRatingSummaries(userIds) {
  const ids = [...new Set(userIds)].filter((id) => Number.isInteger(id));
  const map = {};
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await all(
    `SELECT reviewee_id, AVG(rating) AS avg, COUNT(*) AS cnt FROM reviews WHERE reviewee_id IN (${placeholders}) GROUP BY reviewee_id`,
    ids
  );
  for (const r of rows) {
    map[r.reviewee_id] = { rating_avg: Math.round(Number(r.avg) * 10) / 10, rating_count: Number(r.cnt) };
  }
  return map;
}

module.exports = { getRatingSummary, getRatingSummaries };
