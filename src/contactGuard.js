const { get } = require('./db');

// 직접 거래(수수료 우회) 대응: 계약 전 채팅에서 전화번호·이메일·메신저 ID를 가립니다.
// 연락처 공개 원칙(프리랜서가 제안을 수락하거나 기업이 지원을 합격 처리한 뒤에만 공개)을 채팅에도 똑같이 적용해,
// 매칭 전에 연락처를 주고받아 플랫폼 밖에서 거래하는 것을 막습니다.

const MASK = '[연락처 보호]';
const RULES = [
  // 휴대폰·일반전화: 010-1234-5678, 010 1234 5678, 01012345678, 02)123-4567, +82 10-1234-5678
  { type: 'phone', re: /(?<!\d)(?:(?:\+|00)?82[\s.-]*\(?0?|\(?0)\d{1,2}\)?[\s.-]*\d{3,4}[\s.-]*\d{4}(?!\d)/g },
  // 이메일
  { type: 'email', re: /[A-Za-z0-9._%+-]+\s*(?:@|＠|\(at\)|\[at\])\s*[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi },
  // 메신저 링크: 카카오 오픈채팅, 텔레그램, 라인
  { type: 'messenger', re: /(?:https?:\/\/)?(?:open\.kakao\.com|qr\.kakao\.com|pf\.kakao\.com|t\.me|telegram\.me|line\.me)\/\S*/gi },
  // 메신저 아이디 안내: "카톡 아이디 abc123", "kakao id: abc", "텔레그램 ID @abc" (아이디/ID라고 밝힌 경우)
  { type: 'messenger', re: /(?:카톡|카카오톡|카카오|kakao(?:talk)?|텔레그램|telegram|라인|line)\s*(?:아이디|id)\s*[:：]?\s*@?[A-Za-z0-9._-]{3,}/gi },
  // "카톡 abc1234", "텔레그램 @abcd" 처럼 바로 아이디를 적은 경우 (일반 낱말과 헷갈리지 않게 카톡·텔레그램만)
  { type: 'messenger', re: /(?:카톡|카카오톡|텔레그램)\s*[:：]?\s*@?[A-Za-z0-9._-]{4,}/gi },
];

// 가린 문장과 가린 종류를 돌려줍니다. 가릴 게 없으면 masked: false
function maskContacts(text) {
  let out = String(text || '');
  const types = new Set();
  for (const { type, re } of RULES) {
    out = out.replace(re, (m) => {
      // 날짜(2026-10-12)나 금액처럼 0으로 시작하지 않는 숫자는 위 규칙에서 이미 제외됩니다.
      types.add(type);
      return MASK;
    });
  }
  return { text: out, masked: types.size > 0, types: [...types] };
}

// 두 사람이 이미 매칭됐는지(연락처가 공개되는 단계인지) 확인합니다.
// 프리랜서가 기업의 제안을 수락했거나, 기업이 지원을 합격 처리해 프로젝트가 만들어진 경우입니다.
async function isPairConnected(companyId, freelancerId) {
  const proposal = await get(
    "SELECT id FROM proposals WHERE company_id = ? AND freelancer_id = ? AND status = 'accepted' LIMIT 1",
    [companyId, freelancerId]
  );
  if (proposal) return true;
  const project = await get('SELECT id FROM projects WHERE company_id = ? AND freelancer_id = ? LIMIT 1', [companyId, freelancerId]);
  return !!project;
}

module.exports = { maskContacts, isPairConnected, MASK };
