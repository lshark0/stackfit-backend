const { run } = require('./db');
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

module.exports = { addNotification, pushTo, linkToUrl };
