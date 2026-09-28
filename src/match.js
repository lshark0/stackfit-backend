// 공고 요구 스택과 프리랜서 보유 스택의 매치율(%)을 계산합니다.
// 공식: (겹치는 기술 수 / 공고 요구 기술 수) 를 기본으로 하고,
//       보유 스택이 요구 스택을 더 폭넓게 커버할수록 가점을 줍니다.
function computeMatch(jobStack = [], profileStack = []) {
  if (!jobStack.length) return 0;
  const jobSet = new Set(jobStack.map(s => s.toLowerCase()));
  const profSet = new Set(profileStack.map(s => s.toLowerCase()));
  let overlap = 0;
  for (const s of jobSet) if (profSet.has(s)) overlap++;

  const coverage = overlap / jobSet.size;          // 요구 스택을 얼마나 채우는지
  const breadthBonus = profSet.size >= jobSet.size ? 5 : 0; // 보유 스택이 더 풍부하면 소폭 가점
  const score = Math.round(coverage * 90 + breadthBonus);
  return Math.max(0, Math.min(99, score));
}

module.exports = { computeMatch };
