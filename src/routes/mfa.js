// 관리자 2단계 인증 API
// - GET  /api/auth/mfa/status   내 2단계 인증 상태
// - POST /api/auth/mfa/setup    OTP 앱에 등록할 QR 코드 발급 (아직 사용 전인 관리자만)
// - POST /api/auth/mfa/enable   OTP 앱 코드 확인 후 사용 시작 → 백업 코드 + 2단계 인증된 세션 발급
// - POST /api/auth/mfa/verify   로그인 2단계: 비밀번호 확인 후 받은 임시 토큰 + 코드 → 세션 발급
const express = require('express');
const QRCode = require('qrcode');
const { run, get } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');
const { isAdminEmail } = require('../middleware/requireAdmin');
const totp = require('../totp');
const mfa = require('../mfa');
const securityLog = require('../securityLog');

const router = express.Router();
wrapAllRoutes(router);

const publicUser = (u) => ({ id: u.id, email: u.email, role: u.role, isAdmin: isAdminEmail(u.email) });

router.get('/status', requireAuth, async (req, res) => {
  const u = await get('SELECT email, totp_secret, totp_enabled_at, totp_backup_codes FROM users WHERE id = ?', [req.user.id]);
  if (!u) return res.status(404).json({ error: '계정을 찾을 수 없습니다.' });
  res.json({
    required: isAdminEmail(u.email),
    enabled: mfa.isMfaEnabled(u),
    verified: !!req.user.mfa,
    backupCodesLeft: mfa.isMfaEnabled(u) ? JSON.parse(u.totp_backup_codes || '[]').length : 0,
  });
});

router.post('/setup', requireAuth, async (req, res) => {
  const u = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!u || !isAdminEmail(u.email)) return res.status(403).json({ error: '관리자 계정만 설정할 수 있어요.' });
  if (mfa.isMfaEnabled(u)) return res.status(409).json({ error: '이미 2단계 인증을 사용 중이에요.' });
  const secret = totp.generateSecret();
  await run('UPDATE users SET totp_secret = ?, totp_last_counter = 0 WHERE id = ?', [totp.encryptSecret(secret), u.id]);
  const url = totp.otpauthUrl(secret, u.email);
  res.json({ secret, otpauthUrl: url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) });
});

router.post('/enable', requireAuth, async (req, res) => {
  const u = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!u || !isAdminEmail(u.email)) return res.status(403).json({ error: '관리자 계정만 설정할 수 있어요.' });
  if (mfa.isMfaEnabled(u)) return res.status(409).json({ error: '이미 2단계 인증을 사용 중이에요.' });
  const secret = totp.decryptSecret(u.totp_secret);
  if (!secret) return res.status(400).json({ error: 'QR 코드를 먼저 발급받아주세요.' });
  const counter = totp.verifyTotp(secret, req.body && req.body.code, 0);
  if (counter === null) return res.status(400).json({ error: '코드가 맞지 않아요. OTP 앱의 6자리 숫자를 확인해주세요.' });

  const backupCodes = totp.generateBackupCodes(8);
  await run(
    'UPDATE users SET totp_enabled_at = ?, totp_last_counter = ?, totp_backup_codes = ? WHERE id = ?',
    [new Date().toISOString(), counter, JSON.stringify(backupCodes.map(totp.hashBackupCode)), u.id]
  );
  await securityLog.logEvent('mfa_enabled', { email: u.email, userId: u.id, ip: securityLog.clientIp(req), detail: '2단계 인증 사용 시작' });
  res.json({ token: mfa.sessionToken(u, true), user: publicUser(u), backupCodes });
});

router.post('/verify', async (req, res) => {
  const { mfaToken, code } = req.body || {};
  const p = mfa.readMfaLoginToken(mfaToken);
  if (!p) return res.status(401).json({ error: '인증 시간이 지났어요. 처음부터 다시 로그인해주세요.', code: 'MFA_EXPIRED' });
  const u = await get('SELECT * FROM users WHERE id = ?', [p.uid]);
  if (!u || !mfa.isMfaEnabled(u)) return res.status(401).json({ error: '처음부터 다시 로그인해주세요.', code: 'MFA_EXPIRED' });

  const ip = securityLog.clientIp(req);
  // 코드 대입 공격 방지: 비밀번호와 같은 잠금 규칙(15분 내 5회 실패 시 15분 잠금)을 적용
  if (await securityLog.isLoginLocked(u.email)) {
    await securityLog.logEvent('login_blocked', { email: u.email, userId: u.id, ip, detail: '2단계 인증' });
    return res.status(429).json({ error: '시도가 너무 많아 잠시 잠겼어요. 15분 후 다시 시도해주세요.', code: 'LOGIN_LOCKED' });
  }
  const used = await mfa.checkMfaCode(u, code);
  if (!used) {
    await securityLog.recordLoginFailure(u.email, ip, u.id);
    return res.status(401).json({ error: '인증 코드가 맞지 않아요.' });
  }
  await securityLog.logEvent('login_success', {
    email: u.email, userId: u.id, ip,
    detail: `관리자 · 2단계 인증${used === 'backup' ? ' (백업 코드 사용)' : ''}`,
  });
  const left = used === 'backup' ? JSON.parse((await get('SELECT totp_backup_codes FROM users WHERE id = ?', [u.id])).totp_backup_codes || '[]').length : null;
  res.json({ token: mfa.sessionToken(u, true), user: publicUser(u), backupCodesLeft: left });
});

module.exports = router;
