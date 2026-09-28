// 공고 요구 스택과 프리랜서 보유 스택의 매치율(%)을 계산합니다.
// 공식: 겹치는 기술 수 / 공고 요구 기술 수 × 100 — 요구 기술을 모두 갖추면 100%입니다.
function computeMatch(jobStack = [], profileStack = []) {
  if (!jobStack.length) return 0;
  const jobSet = new Set(jobStack.map(s => s.toLowerCase()));
  const profSet = new Set(profileStack.map(s => s.toLowerCase()));
  let overlap = 0;
  for (const s of jobSet) if (profSet.has(s)) overlap++;
  return Math.round((overlap / jobSet.size) * 100);
}

// 공고 요구 스택 중 프리랜서가 보유한 기술 목록(소문자). 화면에서 일치한 태그를 강조하는 데 씁니다.
function matchedStack(jobStack = [], profileStack = []) {
  const profSet = new Set(profileStack.map(s => s.toLowerCase()));
  return [...new Set(jobStack.map(s => s.toLowerCase()))].filter(s => profSet.has(s));
}

module.exports = { computeMatch, matchedStack };
