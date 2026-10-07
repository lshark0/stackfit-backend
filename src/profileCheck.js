// 프리랜서 프로필에서 아직 비어 있는 필수 항목을 돌려줍니다.
// 공고 지원 조건과 로그인 후 '프로필 작성 안내' 팝업이 같은 기준을 쓰도록 한곳에 둡니다.
function freelancerMissingFields(p) {
  const missing = [];
  if (!p || !String(p.role_title || '').trim()) missing.push('업무');
  if (!p || !String(p.grade || '').trim()) missing.push('등급');
  if (!p || !String(p.rate || '').trim()) missing.push('희망 단가');
  if (!p || JSON.parse(p.stack_json || '[]').length === 0) missing.push('기술스택');
  if (!p || !String(p.summary || '').trim()) missing.push('자기 소개');
  if (!p || !p.resume_filename) missing.push('경력기술서');
  if (!p || !String(p.phone || '').trim()) missing.push('휴대폰');
  return missing;
}

const FREELANCER_REQUIRED_COUNT = 7;

module.exports = { freelancerMissingFields, FREELANCER_REQUIRED_COUNT };
