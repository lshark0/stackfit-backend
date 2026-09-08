// 포트폴리오의 "참여 기간"은 자유 입력이라 형식이 제각각입니다.
// (예: "2024.03 ~ 2024.09", "2024-03 ~ 2024-09 (7개월)", "2023년 5월 ~ 2024년 2월", "2024.03~진행중")
// 여기서 가장 마지막(최근) 연월을 찾아내어 최신순 정렬에 사용합니다.
function extractLatestYearMonth(period) {
  if (!period || typeof period !== 'string') return null;

  // "진행중", "현재" 등이 포함되면 아직 진행 중인 프로젝트로 보고 가장 최신으로 취급합니다.
  if (/진행\s*중|현재|재직\s*중|ing\b|present/i.test(period)) return 999912;

  // YYYY 뒤에 오는 MM을 모두 찾습니다. 구분자는 . - / 년 월 공백 등 무엇이든 허용.
  const matches = [...period.matchAll(/(\d{4})\s*[.\-/년]?\s*(\d{1,2})?/g)];
  let best = null;
  for (const m of matches) {
    const year = Number(m[1]);
    if (year < 1980 || year > 2100) continue; // 연도로 보기 어려운 숫자는 무시
    const rawMonth = m[2] ? Number(m[2]) : 1;
    const month = rawMonth >= 1 && rawMonth <= 12 ? rawMonth : 1;
    const value = year * 100 + month;
    if (best === null || value > best) best = value;
  }
  return best;
}

// 포트폴리오 목록을 "참여 기간 최신순"으로 정렬합니다.
// 기간을 못 읽는 항목(미입력 등)은 뒤로 보내고, 그들끼리는 등록 최신순을 유지합니다.
function sortPortfoliosByPeriod(rows) {
  return [...rows].sort((a, b) => {
    const av = extractLatestYearMonth(a.period);
    const bv = extractLatestYearMonth(b.period);
    if (av === null && bv === null) return (b.id || 0) - (a.id || 0);
    if (av === null) return 1;
    if (bv === null) return -1;
    if (bv !== av) return bv - av;
    return (b.id || 0) - (a.id || 0);
  });
}

module.exports = { extractLatestYearMonth, sortPortfoliosByPeriod };
