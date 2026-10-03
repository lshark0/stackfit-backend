// 관리자 2단계 인증(TOTP) — 로그인 흐름에서 쓰는 공통 함수
const { run, get } = require('./db');
const { signToken, verifyToken } = require('./auth');
const totp = require('./totp');

const MFA_LOGIN_TTL_SEC = 5 * 60; // 비밀번호 확인 후 코드 입력까지 허용하는 시간

const isMfaEnabled = (user) => !!(user && user.totp_enabled_at && user.totp_secret);

// 로그인 세션 토큰. 2단계 인증을 통과한 관리자 세션에는 mfa: true가 들어갑니다.
const sessionToken = (user, mfa = false) =>
  signToken({ id: user.id, role: user.role, email: user.email, ...(mfa ? { mfa: true } : {}) });

// 비밀번호(또는 소셜 로그인)는 통과했고 코드 입력만 남은 상태를 나타내는 임시 토큰
const mfaLoginToken = (user) => signToken({ purpose: 'mfa_login', uid: user.id }, MFA_LOGIN_TTL_SEC);
function readMfaLoginToken(token) {
  const p = verifyToken(token);
  return p && p.purpose === 'mfa_login' && Number.isInteger(p.uid) ? p : null;
}

// OTP 앱 6자리 코드 또는 일회용 백업 코드를 확인합니다. 맞으면 'totp' | 'backup', 틀리면 null
async function checkMfaCode(user, code) {
  const secret = totp.decryptSecret(user.totp_secret);
  if (!secret) return null;
  const raw = String(code || '').trim();
  const counter = totp.verifyTotp(secret, raw, Number(user.totp_last_counter) || 0);
  if (counter !== null) {
    // 같은 코드를 다시 쓰지 못하도록 사용한 시간 구간을 기록 (동시에 두 번 쓰는 경우도 막음)
    const r = await run('UPDATE users SET totp_last_counter = ? WHERE id = ? AND totp_last_counter < ?', [counter, user.id, counter]);
    return r.changes ? 'totp' : null;
  }
  const codes = JSON.parse(user.totp_backup_codes || '[]');
  const h = totp.hashBackupCode(raw);
  if (raw.replace(/[\s-]/g, '').length === 8 && codes.includes(h)) {
    const rest = codes.filter((c) => c !== h);
    const r = await run('UPDATE users SET totp_backup_codes = ? WHERE id = ? AND totp_backup_codes = ?',
      [JSON.stringify(rest), user.id, user.totp_backup_codes]);
    return r.changes ? 'backup' : null;
  }
  return null;
}

// 비상 해제: MFA_RESET_EMAILS 환경변수에 적힌 계정의 2단계 인증을 서버 시작 시 초기화합니다.
// (휴대폰과 백업 코드를 모두 잃어버린 경우. 해제 후에는 환경변수를 지우고 다시 설정하세요.)
async function resetMfaFromEnv(logEvent) {
  const emails = (process.env.MFA_RESET_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  for (const email of emails) {
    const u = await get('SELECT id FROM users WHERE email = ?', [email]);
    if (!u) continue;
    await run('UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_counter = 0, totp_backup_codes = NULL WHERE id = ?', [u.id]);
    console.warn(`[IT Free] 2단계 인증 초기화: ${email} (MFA_RESET_EMAILS)`);
    if (logEvent) await logEvent('mfa_reset', { email, userId: u.id, detail: '환경변수로 2단계 인증 초기화' });
  }
}

module.exports = { isMfaEnabled, sessionToken, mfaLoginToken, readMfaLoginToken, checkMfaCode, resetMfaFromEnv };
