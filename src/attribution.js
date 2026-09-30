const crypto = require('crypto');
const { run, get } = require('./db');
const { addNotification } = require('./notify');

// 친구 초대 코드: 헷갈리는 글자(0/O, 1/I/L)를 뺀 대문자·숫자 6자리
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randomCode() {
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

// 내 초대 코드를 돌려줍니다. 아직 없으면 새로 만들어 저장합니다(기존 회원도 처음 열 때 자동 발급).
async function ensureReferralCode(userId) {
  const row = await get('SELECT referral_code FROM users WHERE id = ?', [userId]);
  if (!row) return null;
  if (row.referral_code) return row.referral_code;
  for (let i = 0; i < 5; i++) {
    const code = randomCode();
    if (await get('SELECT id FROM users WHERE referral_code = ?', [code])) continue;
    await run('UPDATE users SET referral_code = ? WHERE id = ? AND referral_code IS NULL', [code, userId]);
    const saved = await get('SELECT referral_code FROM users WHERE id = ?', [userId]);
    if (saved && saved.referral_code) return saved.referral_code;
  }
  throw new Error('초대 코드를 만들지 못했어요. 잠시 후 다시 시도해주세요.');
}

// 가입 경로 값은 링크에 붙는 짧은 영문 식별자만 받습니다(예: okky, openchat, google_ads).
function cleanTag(v) {
  const s = String(v || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 40);
  return s || null;
}
function cleanCode(v) {
  const s = String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  return s || null;
}

// 가입 직후 한 번만 호출: 어느 채널로 들어왔는지(utm_*)와 누가 초대했는지(ref)를 기록합니다.
// 잘못된 값은 조용히 무시해 가입 자체를 막지 않습니다.
async function recordSignupAttribution(userId, attribution) {
  const a = attribution && typeof attribution === 'object' ? attribution : {};
  let source = cleanTag(a.source);
  const medium = cleanTag(a.medium);
  const campaign = cleanTag(a.campaign);

  let referredBy = null;
  const code = cleanCode(a.ref);
  if (code) {
    const referrer = await get('SELECT id FROM users WHERE referral_code = ?', [code]);
    if (referrer && referrer.id !== userId) {
      referredBy = referrer.id;
      if (!source) source = 'referral';
    }
  }
  await run(
    'UPDATE users SET signup_source = ?, signup_medium = ?, signup_campaign = ?, referred_by = ? WHERE id = ?',
    [source, medium, campaign, referredBy, userId]
  );
  if (referredBy) {
    await addNotification(referredBy, {
      tag: '친구 초대', title: '초대한 친구가 가입했어요',
      body: '내 초대 코드로 새 회원이 가입했어요. 마이페이지 > 친구 초대에서 확인할 수 있어요.',
      link: 'mypage',
    }).catch(() => {});
  }
  return { referredBy };
}

module.exports = { ensureReferralCode, recordSignupAttribution, cleanCode };
