const express = require('express');
const { run, get } = require('../db');
const { hashPassword, verifyPassword, signToken, verifyToken } = require('../auth');
const { requireAuth } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');
const { normalizeMobile, normalizePhone, normalizeBirthDate } = require('../contact');
const { isAdminEmail } = require('../middleware/requireAdmin');
const { recordSignupAttribution } = require('../attribution');
const { findFreelancerByPhone, duplicatePhoneMessage } = require('../duplicateAccount');
const identity = require('../identity');
const securityLog = require('../securityLog');
const mfa = require('../mfa');
const emailVerify = require('../emailVerify');

const router = express.Router();
wrapAllRoutes(router);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).+$/; // 영문 1자 이상 + 숫자 1자 이상
const clamp = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '');

// 사업자등록번호: 숫자 10자리를 'XXX-XX-XXXXX' 형태로 통일 (국세청 실시간 검증은 하지 않음). 형식이 틀리면 null.
function normalizeBizRegNo(v) {
  const digits = String(v || '').replace(/\D/g, '');
  if (digits.length !== 10) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

// ---------- 휴대폰 본인인증 (포트원) ----------
router.get('/identity/config', (req, res) => {
  res.json(identity.publicConfig());
});

router.post('/identity/verify', async (req, res) => {
  try {
    const v = await identity.fetchVerifiedCustomer((req.body || {}).identityVerificationId);
    if (v.ci) {
      const dup = await get('SELECT email, oauth_provider FROM users WHERE ci = ?', [v.ci]);
      if (dup) {
        const how = dup.oauth_provider ? `${dup.oauth_provider} 소셜 로그인` : identity.maskEmail(dup.email);
        return res.status(409).json({ error: `이미 가입된 회원이에요. (${how})\n로그인하거나 비밀번호 찾기를 이용해주세요.` });
      }
    }
    res.json({
      ivToken: identity.issueIvToken(v),
      name: v.name, phone: v.phone, birthDate: v.birthDate, gender: v.gender,
    });
  } catch (e) {
    if (e instanceof identity.IdentityError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

router.post('/signup', async (req, res) => {
  let {
    email, password, role, name, companyName, phone, companyPhone, address, description, contactPerson, position,
    birthDate, gender, companyType, bizRegNo, ceoName,
  } = req.body || {};
  email = typeof email === 'string' ? email.trim().toLowerCase() : '';

  // 본인인증이 켜져 있으면, 이름·생년월일·성별·휴대폰은 포트원이 확인해준 값만 사용합니다.
  let verified = null;
  if (identity.identityEnabled()) {
    verified = identity.readIvToken((req.body || {}).ivToken);
    if (!verified) {
      return res.status(400).json({ error: '휴대폰 본인인증을 먼저 완료해주세요. (인증 후 30분이 지났다면 다시 인증해주세요)' });
    }
    phone = verified.phone;
    if (role === 'freelancer') {
      name = verified.name;
      birthDate = verified.birthDate.replace(/-/g, '');
      gender = verified.gender;
    } else {
      contactPerson = verified.name;
    }
  }

  if (!email || !password || !role) {
    return res.status(400).json({ error: 'email, password, role은 필수입니다.' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: '올바른 이메일 형식이 아니에요.' });
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LEN || !PASSWORD_RE.test(password)) {
    return res.status(400).json({ error: `비밀번호는 영문과 숫자를 포함해 ${MIN_PASSWORD_LEN}자 이상이어야 해요.` });
  }
  if (!['freelancer', 'company'].includes(role)) {
    return res.status(400).json({ error: "role은 'freelancer' 또는 'company'여야 합니다." });
  }
  // 휴대폰은 프리랜서·기업 담당자 모두 가입 시 필수입니다.
  const normalizedPhone = normalizeMobile(phone);
  if (!normalizedPhone) {
    return res.status(400).json({ error: '휴대폰 번호를 정확히 입력해주세요. (예: 010-1234-5678)' });
  }
  let normalizedCompanyPhone = '';
  if (role === 'company' && String(companyPhone || '').trim() !== '') {
    normalizedCompanyPhone = normalizePhone(companyPhone);
    if (!normalizedCompanyPhone) {
      return res.status(400).json({ error: '회사 전화번호를 정확히 입력해주세요. (예: 02-1234-5678)' });
    }
  }
  let normalizedBirthDate = '';
  if (role === 'freelancer' && String(birthDate || '').trim() !== '') {
    normalizedBirthDate = normalizeBirthDate(birthDate);
    if (normalizedBirthDate === null) {
      return res.status(400).json({ error: '생년월일을 정확히 입력해주세요. (예: 20000131)' });
    }
  }
  const safeGender = ['남자', '여자'].includes(gender) ? gender : '';
  let normalizedBizRegNo = '';
  if (role === 'company' && String(bizRegNo || '').trim() !== '') {
    normalizedBizRegNo = normalizeBizRegNo(bizRegNo);
    if (normalizedBizRegNo === null) {
      return res.status(400).json({ error: '사업자등록번호 10자리를 정확히 입력해주세요.' });
    }
  }
  // 인증을 마치지 않은 채 남은 가입(본인이 아니거나 메일을 놓친 경우)은 지우고 새로 가입받습니다.
  // 링크를 누르지 않은 계정은 로그인한 적이 없어 지워도 잃는 데이터가 없습니다.
  const sameEmail = await get('SELECT * FROM users WHERE email = ?', [email]);
  if (sameEmail && emailVerify.needsEmailVerification(sameEmail)) {
    await run('DELETE FROM users WHERE id = ?', [sameEmail.id]);
  } else if (sameEmail) {
    return res.status(409).json({ error: '이미 가입된 이메일입니다.' });
  }
  // 로그인 방법만 바꿔 같은 사람이 프리랜서 계정을 또 만들지 않도록 휴대폰 번호로 확인합니다.
  if (role === 'freelancer') {
    const dup = await findFreelancerByPhone(normalizedPhone);
    const dupUser = dup ? await get('SELECT * FROM users WHERE id = ?', [dup.id]) : null;
    // 이메일 인증을 마치지 않은 가입은 로그인할 수 없으니, 같은 번호로 다시 가입하면 지우고 새로 받습니다.
    if (dupUser && emailVerify.needsEmailVerification(dupUser)) {
      await run('DELETE FROM users WHERE id = ?', [dupUser.id]);
    } else if (dup) {
      return res.status(409).json({ error: duplicatePhoneMessage(dup) });
    }
  }

  if (verified && verified.ci && (await get('SELECT id FROM users WHERE ci = ?', [verified.ci]))) {
    return res.status(409).json({ error: '이미 본인인증으로 가입된 회원이에요.' });
  }

  const { hash, salt } = hashPassword(password);
  let r;
  try {
    r = await run(
      'INSERT INTO users (email, password_hash, password_salt, role, ci, di, identity_verified_at, email_verify_required) VALUES (?,?,?,?,?,?,?,?)',
      [email, hash, salt, role, verified ? verified.ci : null, verified ? verified.di : null, verified ? new Date().toISOString() : null,
        emailVerify.emailVerifyEnabled() ? 1 : 0]
    );
  } catch (e) {
    // 동시에 같은 사람이 두 번 가입을 누른 경우 (CI 유니크 인덱스 위반)
    if (e && (e.code === '23505' || /UNIQUE/i.test(e.message || ''))) {
      return res.status(409).json({ error: '이미 가입된 회원이에요.' });
    }
    throw e;
  }
  const userId = Number(r.lastInsertRowid);

  if (role === 'freelancer') {
    await run(
      'INSERT INTO freelancer_profiles (user_id, name, completion, phone, birth_date, gender) VALUES (?,?,20,?,?,?)',
      [userId, (name || '이름 미입력').slice(0, 60), normalizedPhone, normalizedBirthDate || null, safeGender || null]
    );
  } else {
    await run(
      `INSERT INTO companies (user_id, name, contact_person, contact_position, company_phone, phone, address, description, company_type, biz_reg_no, ceo_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        userId,
        (companyName || '회사명 미입력').slice(0, 60),
        clamp(contactPerson, 60),
        clamp(position, 40),
        normalizedCompanyPhone,
        normalizedPhone,
        clamp(address, 200),
        clamp(description, 500),
        clamp(companyType, 40),
        normalizedBizRegNo,
        clamp(ceoName, 60),
      ]
    );
  }

  await recordSignupAttribution(userId, req.body.attribution)
    .catch((e) => console.warn('[김프리] 가입 경로 기록 실패:', e.message));

  // 이메일 인증을 쓰면 로그인 토큰 대신 인증 메일을 보냅니다. 메일이 실패해도 가입은 유지되고 다시 보내기로 받을 수 있습니다.
  if (emailVerify.emailVerifyEnabled()) {
    let mailSent = true;
    await emailVerify.sendVerificationMail({ id: userId, email }, req).catch((e) => {
      mailSent = false;
      console.warn('[김프리] 인증 메일 발송 실패:', e.message);
    });
    return res.status(201).json({ verifyRequired: true, email, mailSent });
  }

  const token = signToken({ id: userId, role, email });
  res.status(201).json({ token, user: { id: userId, email, role, isAdmin: isAdminEmail(email) } });
});

// 인증 메일의 링크(/?verify_email=…)로 들어오면 화면이 이 API를 불러 인증을 마치고 바로 로그인시킵니다.
router.post('/verify-email', async (req, res) => {
  const user = await emailVerify.consumeVerificationToken((req.body || {}).token);
  if (!user) {
    return res.status(400).json({ error: '인증 링크가 만료됐거나 이미 사용됐어요. 로그인 화면에서 인증 메일을 다시 받아주세요.' });
  }
  if (isAdminEmail(user.email) && mfa.isMfaEnabled(user)) {
    return res.json({ mfaRequired: true, mfaToken: mfa.mfaLoginToken(user) });
  }
  await securityLog.logEvent('login_success', { email: user.email, ip: securityLog.clientIp(req), userId: user.id, detail: '이메일 인증 완료' });
  const token = signToken({ id: user.id, role: user.role, email: user.email });
  res.json({ token, user: { id: user.id, email: user.email, role: user.role, isAdmin: isAdminEmail(user.email) } });
});

// 인증 메일 다시 보내기. 가입 여부가 드러나지 않도록 항상 같은 응답을 줍니다.
router.post('/resend-verification', async (req, res) => {
  const email = typeof (req.body || {}).email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (EMAIL_RE.test(email)) {
    await emailVerify.resendVerificationMail(email, req)
      .catch((e) => console.warn('[김프리] 인증 메일 재발송 실패:', e.message));
  }
  res.json({ ok: true });
});

router.post('/login', async (req, res) => {
  let { email, password } = req.body || {};
  email = typeof email === 'string' ? email.trim().toLowerCase() : '';

  // 이메일 존재 여부가 응답 내용/시간차로 드러나지 않도록 항상 동일한 오류 메시지 사용
  const genericError = () => res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });

  if (!email || !password) return genericError();

  const ip = securityLog.clientIp(req);
  // 같은 이메일로 연속 실패하면 잠시 잠급니다 (여러 IP로 나눠 시도하는 대입 공격 방어).
  if (await securityLog.isLoginLocked(email)) {
    hashPassword(password);
    await securityLog.logEvent('login_blocked', { email, ip });
    return res.status(429).json({ error: '로그인 시도가 너무 많아 잠시 잠겼어요. 15분 후 다시 시도해주세요.', code: 'LOGIN_LOCKED' });
  }

  const user = await get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user) {
    // 존재하지 않는 계정이어도 동일한 지연을 주어 계정 존재 여부를 타이밍으로 추측하기 어렵게 함
    hashPassword(password);
    await securityLog.recordLoginFailure(email, ip);
    return genericError();
  }
  if (!verifyPassword(password, user.password_hash, user.password_salt)) {
    await securityLog.recordLoginFailure(email, ip, user.id);
    return genericError();
  }
  // 비밀번호가 맞아도 이메일 인증 전이면 로그인시키지 않습니다(비밀번호를 아는 사람에게만 알려 주므로 가입 여부가 새지 않음).
  if (emailVerify.needsEmailVerification(user)) {
    return res.status(403).json({ error: '이메일 인증을 아직 마치지 않았어요. 가입할 때 받은 메일의 링크를 눌러주세요.', code: 'EMAIL_UNVERIFIED' });
  }

  // 2단계 인증을 켠 관리자는 비밀번호만으로 세션을 주지 않고, OTP 코드 입력 단계로 보냅니다.
  if (isAdminEmail(user.email) && mfa.isMfaEnabled(user)) {
    return res.json({ mfaRequired: true, mfaToken: mfa.mfaLoginToken(user) });
  }
  await securityLog.logEvent('login_success', { email, ip, userId: user.id, detail: isAdminEmail(user.email) ? '관리자 (2단계 인증 미설정)' : '' });
  const token = signToken({ id: user.id, role: user.role, email: user.email });
  res.json({ token, user: { id: user.id, email: user.email, role: user.role, isAdmin: isAdminEmail(user.email) } });
});

// 계정 연결: 관리자가 공고를 대신 등록하며 만든 기업 계정을, 담당자가 링크로 들어와 비밀번호를 정해 넘겨받습니다.
async function claimTarget(token) {
  const p = verifyToken(String(token || ''));
  if (!p || p.purpose !== 'company_claim' || !Number.isInteger(p.uid) || !p.n) return null;
  const u = await get("SELECT id, email, role, claim_pending, claim_nonce FROM users WHERE id = ? AND role = 'company'", [p.uid]);
  if (!u || Number(u.claim_pending) !== 1 || u.claim_nonce !== p.n) return null;
  return u;
}
router.get('/claim', async (req, res) => {
  const u = await claimTarget(req.query.token);
  if (!u) return res.status(400).json({ error: '계정 연결 링크가 만료됐거나 이미 사용됐어요. 김프리에 새 링크를 요청해주세요.' });
  const c = await get('SELECT name, contact_person, phone FROM companies WHERE user_id = ?', [u.id]);
  const { n } = await get('SELECT COUNT(*) AS n FROM jobs WHERE company_id = ?', [u.id]);
  res.json({ email: u.email, companyName: c ? c.name : '', contactPerson: c ? c.contact_person : '', needPhone: !(c && c.phone), jobs: Number(n) });
});
router.post('/claim', async (req, res) => {
  const { token, password } = req.body || {};
  const u = await claimTarget(token);
  if (!u) return res.status(400).json({ error: '계정 연결 링크가 만료됐거나 이미 사용됐어요. 김프리에 새 링크를 요청해주세요.' });
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LEN || !PASSWORD_RE.test(password)) {
    return res.status(400).json({ error: `비밀번호는 영문과 숫자를 포함해 ${MIN_PASSWORD_LEN}자 이상이어야 해요.` });
  }
  const c = await get('SELECT phone FROM companies WHERE user_id = ?', [u.id]);
  let phone = c && c.phone;
  if (!phone) {
    phone = normalizeMobile((req.body || {}).phone);
    if (!phone) return res.status(400).json({ error: '담당자 휴대폰 번호를 정확히 입력해주세요. (예: 010-1234-5678)' });
  }
  const { hash, salt } = hashPassword(password);
  const upd = await run(
    'UPDATE users SET password_hash = ?, password_salt = ?, claim_pending = 0, claim_nonce = NULL WHERE id = ? AND claim_pending = 1',
    [hash, salt, u.id]
  );
  if (!upd.changes) return res.status(409).json({ error: '이미 연결된 계정이에요. 로그인해주세요.' });
  await run('UPDATE companies SET phone = ? WHERE user_id = ?', [phone, u.id]);
  await securityLog.logEvent('login_success', { email: u.email, ip: securityLog.clientIp(req), userId: u.id, detail: '대리 등록 기업 계정 연결' });
  const sessionToken = signToken({ id: u.id, role: 'company', email: u.email });
  res.json({ token: sessionToken, user: { id: u.id, email: u.email, role: 'company', isAdmin: isAdminEmail(u.email) } });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await get('SELECT id, email, role, oauth_provider, totp_secret, totp_enabled_at FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: '계정을 찾을 수 없습니다.' });
  const isAdmin = isAdminEmail(user.email);
  res.json({ user: {
    id: user.id, email: user.email, role: user.role, hasPassword: !user.oauth_provider, isAdmin,
    ...(isAdmin ? { mfaEnabled: mfa.isMfaEnabled(user), mfaVerified: !!req.user.mfa } : {}),
  } });
});

// 비밀번호 변경 (이메일/비밀번호로 가입한 계정만 — 소셜 전용 계정은 대상 아님)
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const user = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: '계정을 찾을 수 없습니다.' });
  if (user.oauth_provider) {
    return res.status(400).json({ error: '소셜 로그인 계정은 비밀번호 변경이 필요 없어요.' });
  }
  if (!currentPassword || !verifyPassword(currentPassword, user.password_hash, user.password_salt)) {
    return res.status(401).json({ error: '현재 비밀번호가 올바르지 않아요.' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LEN || !PASSWORD_RE.test(newPassword)) {
    return res.status(400).json({ error: `새 비밀번호는 영문과 숫자를 포함해 ${MIN_PASSWORD_LEN}자 이상이어야 해요.` });
  }
  const { hash, salt } = hashPassword(newPassword);
  await run('UPDATE users SET password_hash=?, password_salt=? WHERE id=?', [hash, salt, user.id]);
  res.json({ ok: true });
});

// 회원탈퇴 — 이메일 계정은 비밀번호 확인, 소셜 계정은 확인 없이 즉시 삭제 (연관 데이터는 CASCADE로 함께 삭제됨)
router.delete('/me', requireAuth, async (req, res) => {
  const { password } = req.body || {};
  const user = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: '계정을 찾을 수 없습니다.' });
  if (!user.oauth_provider) {
    if (!password || !verifyPassword(password, user.password_hash, user.password_salt)) {
      return res.status(401).json({ error: '비밀번호가 올바르지 않아요.' });
    }
  }
  await run('DELETE FROM users WHERE id = ?', [user.id]);
  res.json({ ok: true });
});

module.exports = router;
