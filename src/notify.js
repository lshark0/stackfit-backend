const { run, all } = require('./db');
const { sendPushToUser } = require('./push');

// 알림(앱 내 알림 + 휴대폰 푸시)을 누르면 관련 화면으로 바로 이동할 수 있도록
// 이동할 화면을 'screen' 또는 'screen:param' 형태의 링크로 함께 저장합니다.
//   예) 'chatRoom:12'   → 12번 대화방
//       'applicants:5'  → 5번 공고의 지원자 관리
//       'receivedProposals' → 받은 제안 목록
function linkToUrl(link) {
  if (!link) return '/';
  const [screen, param] = String(link).split(':');
  return `/?go=${encodeURIComponent(screen)}${param ? `&p=${encodeURIComponent(param)}` : ''}`;
}

// 앱 내 알림을 저장합니다. (실패해도 본래 동작은 막지 않습니다)
async function addNotification(userId, { tag, title, body = '', link = null }) {
  await run('INSERT INTO notifications (user_id, tag, title, body, link) VALUES (?,?,?,?,?)', [
    userId, tag, title, body, link,
  ]).catch((e) => console.warn('[김프리] 알림 저장 실패:', e.message));
}

// 휴대폰 푸시를 보냅니다. link가 있으면 알림을 눌렀을 때 해당 화면으로 이동합니다.
function pushTo(userId, { kind, title, body, tag, link = null }) {
  sendPushToUser(userId, { kind, title, body, tag, link, url: linkToUrl(link) }).catch(() => {});
}

// 관리자가 확인해야 할 건(경력 검증 확인 요청, 공고 신고, 1:1 문의)을 관리자 모두에게 알립니다(앱 알림 + 푸시).
// 관리자는 ADMIN_EMAILS 환경변수로 지정된 계정입니다.
async function notifyAdmins({ title, body = '', link = null, tag }) {
  try {
    const { adminEmails } = require('./middleware/requireAdmin');
    const emails = adminEmails();
    if (!emails.length) return;
    const admins = await all(`SELECT id FROM users WHERE LOWER(email) IN (${emails.map(() => '?').join(',')})`, emails);
    for (const a of admins) {
      await addNotification(a.id, { tag: '관리자', title, body: String(body).slice(0, 80), link });
      pushTo(a.id, { kind: 'admin', title, body: String(body).slice(0, 100), tag, link });
    }
  } catch (e) {
    console.warn('[김프리] 관리자 알림 실패:', e.message);
  }
}

module.exports = { addNotification, pushTo, notifyAdmins, linkToUrl };
