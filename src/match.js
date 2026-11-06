// 공고 요구 스택과 프리랜서 보유 스택의 매치율(%)을 계산합니다.
// 공식: 겹치는 기술 수 / 공고 요구 기술 수 × 100 — 요구 기술을 모두 갖추면 100%입니다.
//
// 기술 이름은 사람이 직접 입력하는 경우가 많아 표기가 조금씩 다릅니다(예: 공고 "NetApp NAS", 프로필 "NetApp").
// 그래서 아래 둘 중 하나면 같은 기술로 봅니다.
//   1) 대소문자·띄어쓰기·기호를 뺀 이름이 같다 (예: "Windows Server" = "windows-server")
//   2) 짧은 쪽 이름의 단어가 모두 긴 쪽 이름에 단어 단위로 들어 있다 (예: "NetApp" ⊂ "NetApp NAS")
//      단, 짧은 쪽이 3글자 미만(C, R, Go 등)이면 오탐이 많아 2)는 쓰지 않습니다.
//      글자 일부만 겹치는 경우(Java ↔ JavaScript)는 단어 단위가 아니므로 일치로 보지 않습니다.
const words = (s) => String(s).toLowerCase().split(/[\s/,()·+_-]+/).filter(Boolean);
const compact = (s) => String(s).toLowerCase().replace(/[\s/,()·+_.-]+/g, '');

function sameTech(a, b) {
  if (compact(a) === compact(b)) return true;
  const [short, long] = compact(a).length <= compact(b).length ? [a, b] : [b, a];
  if (compact(short).length < 3) return false;
  const longWords = new Set(words(long));
  const shortWords = words(short);
  return shortWords.length > 0 && shortWords.every((w) => longWords.has(w));
}

// 공고 요구 기술(중복 제거, 첫 표기 유지)
function uniqueTags(stack = []) {
  const seen = new Set();
  return stack.filter((s) => { const k = String(s).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

// 공고 요구 스택 중 프리랜서가 보유한 기술 목록(소문자). 화면에서 일치한 태그를 강조하는 데 씁니다.
function matchedStack(jobStack = [], profileStack = []) {
  return uniqueTags(jobStack)
    .filter((j) => profileStack.some((p) => sameTech(j, p)))
    .map((s) => String(s).toLowerCase());
}

function computeMatch(jobStack = [], profileStack = []) {
  const total = uniqueTags(jobStack).length;
  if (!total) return 0;
  return Math.round((matchedStack(jobStack, profileStack).length / total) * 100);
}

// 공고 요구 기술 수와 그중 프리랜서가 가진 기술 수. 화면에 "기술스택 3개 중 2개 일치"로 보여줍니다.
// matchedStack도 함께 내려서 카드의 기술 태그 중 일치한 것을 색으로 강조합니다.
function stackCounts(jobStack = [], profileStack = []) {
  const matched = matchedStack(jobStack, profileStack);
  return {
    matchedStack: matched,
    matchCount: matched.length,
    matchTotal: uniqueTags(jobStack).length,
  };
}

module.exports = { computeMatch, matchedStack, stackCounts, sameTech };
