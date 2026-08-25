const { get } = require('./db');

// 특정 사용자가 받은 리뷰의 평균 평점과 개수를 반환합니다.
async function getRatingSummary(userId) {
  const row = await get('SELECT AVG(rating) AS avg, COUNT(*) AS cnt FROM reviews WHERE reviewee_id = ?', [userId]);
  const cnt = Number(row?.cnt || 0);
  const avg = cnt > 0 ? Math.round(Number(row.avg) * 10) / 10 : null;
  return { rating_avg: avg, rating_count: cnt };
}

module.exports = { getRatingSummary };
