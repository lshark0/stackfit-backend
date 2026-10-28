// 같은 사람이 로그인 방법(이메일·구글·카카오·네이버)을 바꿔 프리랜서 계정을 또 만드는 것을 막습니다.
// 휴대폰 번호가 같은 프리랜서 계정이 이미 있으면 가입·번호 저장을 막고 기존 계정으로 안내합니다.
const { get } = require('./db');

const PROVIDER_LABEL = { google: '구글', kakao: '카카오', naver: '네이버' };

// 하이픈 유무와 관계없이 같은 번호를 찾습니다. exceptUserId는 본인 계정(프로필 수정 시)을 뺄 때 씁니다.
async function findFreelancerByPhone(phone, exceptUserId = 0) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  return get(
    `SELECT u.id, u.oauth_provider FROM freelancer_profiles f JOIN users u ON u.id = f.user_id
     WHERE REPLACE(f.phone, '-', '') = ? AND f.user_id <> ?
     LIMIT 1`,
    [digits, Number(exceptUserId) || 0]
  );
}

function duplicatePhoneMessage(existing) {
  const how = PROVIDER_LABEL[existing.oauth_provider] ? `${PROVIDER_LABEL[existing.oauth_provider]} 로그인` : '이메일 로그인';
  return `이미 가입된 계정이 있어요. 이 휴대폰 번호로 가입된 프리랜서 계정(${how})으로 로그인해주세요.`;
}

module.exports = { findFreelancerByPhone, duplicatePhoneMessage };
