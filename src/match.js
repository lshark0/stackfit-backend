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

// 공고 요구 기술 수와 그중 프리랜서가 가진 기술 수. 화면에 "기술스택 3개 중 2개 일치"로 보여줍니다.
// matchedStack도 함께 내려서 카드의 기술 태그 중 일치한 것을 색으로 강조합니다.
function stackCounts(jobStack = [], profileStack = []) {
  const matched = matchedStack(jobStack, profileStack);
  return {
    matchedStack: matched,
    matchCount: matched.length,
    matchTotal: new Set(jobStack.map((s) => s.toLowerCase())).size,
  };
}

module.exports = { computeMatch, matchedStack, stackCounts };
