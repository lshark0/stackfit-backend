const { run, get, all } = require('./db');
const { addNotification } = require('./notify');
const { freelancerMissingFields } = require('./profileCheck');

// 친구 초대 보상: 초대한 친구가 실제로 활동을 시작하면(프리랜서는 필수 프로필 완성, 기업은 기술스택이 있는 첫 공고 등록)
// 초대한 사람에게 '정식 출시 후 쓸 수 있는 이용권'을 1장 적립합니다. 지금은 적립만 하고, 결제 기능이 생기면 열람권·등록권 등으로 씁니다.
// 가입만 한 계정으로는 적립되지 않게 해 가짜 계정으로 쌓는 것을 막고, 1명당 적립 한도를 둡니다.
const REWARD_MAX = Math.max(0, Number(process.env.REFERRAL_REWARD_MAX) || 20);

// 초대받은 회원이 보상 조건을 채웠는지 확인합니다.
async function activationOf(user) {
  if (user.role === 'freelancer') {
    const p = await get(
      'SELECT role_title, grade, rate, stack_json, summary, resume_filename, phone FROM freelancer_profiles WHERE user_id = ?',
      [user.id]
    );
    return { done: !!p && freelancerMissingFields(p).length === 0, reason: 'profile_complete' };
  }
  if (user.role === 'company') {
    const jobs = await all('SELECT stack_json FROM jobs WHERE company_id = ?', [user.id]);
    const done = jobs.some((j) => {
      try { return JSON.parse(j.stack_json || '[]').length > 0; } catch (e) { return false; }
    });
    return { done, reason: 'first_job' };
  }
  return { done: false, reason: '' };
}

// 초대받은 회원(inviteeId)이 조건을 채웠으면 초대한 사람에게 이용권을 적립합니다. 적립했으면 true.
// 프로필 저장·공고 등록 직후에 호출하고, 초대 화면을 열 때도 놓친 적립이 없는지 다시 확인합니다.
async function grantReferralReward(inviteeId, { notify = true } = {}) {
  const u = await get('SELECT id, role, referred_by FROM users WHERE id = ?', [inviteeId]);
  if (!u || !u.referred_by || u.referred_by === u.id) return false;
  if (await get('SELECT id FROM referral_rewards WHERE invitee_id = ?', [u.id])) return false;
  const { c } = await get('SELECT COUNT(*) AS c FROM referral_rewards WHERE referrer_id = ?', [u.referred_by]);
  if (Number(c) >= REWARD_MAX) return false;
  const { done, reason } = await activationOf(u);
  if (!done) return false;
  try {
    await run('INSERT INTO referral_rewards (referrer_id, invitee_id, reason) VALUES (?,?,?)', [u.referred_by, u.id, reason]);
  } catch (e) {
    // 같은 친구로 동시에 두 번 적립하려는 경우(invitee_id 유니크 위반)는 무시합니다.
    if (e && (e.code === '23505' || /UNIQUE/i.test(e.message || ''))) return false;
    throw e;
  }
  if (notify) {
    await addNotification(u.referred_by, {
      tag: '친구 초대', title: '이용권 1장이 적립됐어요',
      body: u.role === 'company'
        ? '초대한 기업회원이 첫 공고를 등록했어요. 적립된 이용권은 정식 출시 후 쓸 수 있어요.'
        : '초대한 친구가 프로필을 완성했어요. 적립된 이용권은 정식 출시 후 쓸 수 있어요.',
      link: 'invite',
    }).catch(() => {});
  }
  return true;
}

// 요청 처리를 막지 않도록 결과를 기다리지 않고 실행합니다(실패해도 다음 확인 때 다시 적립됨).
function grantReferralRewardLater(inviteeId) {
  grantReferralReward(inviteeId).catch((e) => console.warn('[IT Free] 초대 보상 적립 실패:', e.message));
}

module.exports = { REWARD_MAX, activationOf, grantReferralReward, grantReferralRewardLater };
