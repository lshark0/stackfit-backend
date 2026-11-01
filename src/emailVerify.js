// 가입 이메일 인증.
// - 이메일로 가입하면 인증 메일을 보내고, 메일의 링크를 눌러야 로그인할 수 있습니다.
//   남의 이메일로 먼저 가입해 두는 것(계정 선점)을 막기 위함입니다.
// - 메일은 Resend(https://resend.com) API로 보냅니다. RESEND_API_KEY·MAIL_FROM 환경변수가 없으면
//   이 기능은 꺼진 채(기존처럼 가입 즉시 로그인) 동작합니다.
// - 소셜 로그인 이메일은 업체(구글·카카오 등)가 확인한 것이라 따로 인증하지 않습니다.
const crypto = require('crypto');
const { run, get } = require('./db');

const API_KEY = (process.env.RESEND_API_KEY || '').trim();
const MAIL_FROM = (process.env.MAIL_FROM || '').trim(); // 예: 김프리 <no-reply@kimfree.co.kr>
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 인증 링크는 24시간 동안 유효
const RESEND_GAP_MS = 60 * 1000; // 인증 메일 다시 보내기는 1분에 한 번

const emailVerifyEnabled = () => !!(API_KEY && MAIL_FROM);

// 이메일로 가입했고(인증 대상) 아직 링크를 누르지 않은 회원. 기능을 끄면 막지 않습니다.
const needsEmailVerification = (user) =>
  emailVerifyEnabled() && !!user && Number(user.email_verify_required) === 1 && !user.email_verified_at;

// 링크 원문은 메일에만 있고, DB에는 해시만 둡니다(DB가 새도 링크를 만들 수 없게).
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

function siteUrl(req) {
  return process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

async function sendMail({ to, subject, html, text }) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, html, text }),
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`메일 발송 실패 (${resp.status}) ${detail.slice(0, 200)}`);
  }
}

// 새 인증 링크를 만들어(이전 링크는 무효) 메일로 보냅니다.
async function sendVerificationMail(user, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  await run(
    'UPDATE users SET email_verify_hash = ?, email_verify_expires = ?, email_verify_sent_at = ? WHERE id = ?',
    [hashToken(token), new Date(Date.now() + TOKEN_TTL_MS).toISOString(), new Date().toISOString(), user.id]
  );
  const link = `${siteUrl(req)}/?verify_email=${encodeURIComponent(token)}`;
  await sendMail({
    to: user.email,
    subject: '[김프리] 이메일 인증을 완료해 주세요',
    text: `김프리에 가입해 주셔서 감사합니다.\n\n아래 링크를 열면 이메일 인증이 끝나고 바로 로그인됩니다(24시간 동안 유효).\n${link}\n\n직접 가입하지 않으셨다면 이 메일은 무시하셔도 됩니다.\n\n김프리 · 마켓리어`,
    html: `<div style="font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif; max-width:480px; margin:0 auto; padding:24px; color:#141821; line-height:1.7;">
  <h2 style="font-size:19px; margin:0 0 12px;">이메일 인증을 완료해 주세요</h2>
  <p style="font-size:14.5px; margin:0 0 20px;">김프리에 가입해 주셔서 감사합니다. 아래 버튼을 누르면 이메일 인증이 끝나고 바로 로그인됩니다.</p>
  <p style="margin:0 0 20px;"><a href="${link}" style="display:inline-block; padding:12px 22px; border-radius:10px; background:#141821; color:#ffffff; font-weight:700; text-decoration:none;">이메일 인증하기</a></p>
  <p style="font-size:12.5px; color:#5B6472; margin:0 0 6px;">버튼이 열리지 않으면 이 주소를 복사해 브라우저에 붙여 넣으세요. 링크는 24시간 동안 유효합니다.</p>
  <p style="font-size:12px; color:#5B6472; word-break:break-all; margin:0 0 20px;">${link}</p>
  <p style="font-size:12.5px; color:#5B6472; margin:0;">직접 가입하지 않으셨다면 이 메일은 무시하셔도 됩니다.</p>
  <p style="font-size:12px; color:#9AA2AD; margin:20px 0 0;">김프리 · 마켓리어</p>
</div>`,
  });
}

// 이메일로 다시 보내기 요청. 1분 안에 이미 보냈으면 보내지 않습니다.
// 가입 여부가 드러나지 않도록 호출한 쪽은 결과와 관계없이 같은 응답을 줍니다.
async function resendVerificationMail(email, req) {
  const user = await get('SELECT * FROM users WHERE email = ?', [email]);
  if (!needsEmailVerification(user)) return;
  if (user.email_verify_sent_at && Date.now() - Date.parse(user.email_verify_sent_at) < RESEND_GAP_MS) return;
  await sendVerificationMail(user, req);
}

// 링크의 토큰이 맞고 만료 전이면 인증 완료로 표시하고 회원을 돌려줍니다.
async function consumeVerificationToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const user = await get('SELECT * FROM users WHERE email_verify_hash = ?', [hashToken(token)]);
  if (!user || !user.email_verify_expires || Date.parse(user.email_verify_expires) < Date.now()) return null;
  const now = new Date().toISOString();
  await run(
    'UPDATE users SET email_verified_at = ?, email_verify_hash = NULL, email_verify_expires = NULL WHERE id = ?',
    [now, user.id]
  );
  return { ...user, email_verified_at: now };
}

module.exports = {
  emailVerifyEnabled, needsEmailVerification, sendVerificationMail, resendVerificationMail, consumeVerificationToken,
};
