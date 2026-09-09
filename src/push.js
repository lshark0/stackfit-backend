const webpush = require('web-push');
const { run, get, all } = require('./db');

// 웹 푸시를 보내려면 서버를 식별하는 한 쌍의 인증키(VAPID)가 필요합니다.
// 환경변수를 직접 설정하지 않아도 되도록, 처음 실행될 때 자동 생성해서 DB에 보관하고
// 이후에는 계속 같은 키를 재사용합니다. (키가 바뀌면 기존 구독이 모두 무효가 되기 때문)
let vapid = null;

async function initPush() {
  try {
    const pubRow = await get("SELECT value FROM app_settings WHERE key = 'vapid_public_key'");
    const privRow = await get("SELECT value FROM app_settings WHERE key = 'vapid_private_key'");

    if (pubRow && privRow) {
      vapid = { publicKey: pubRow.value, privateKey: privRow.value };
    } else {
      const keys = webpush.generateVAPIDKeys();
      await run('INSERT INTO app_settings (key, value) VALUES (?,?)', ['vapid_public_key', keys.publicKey]);
      await run('INSERT INTO app_settings (key, value) VALUES (?,?)', ['vapid_private_key', keys.privateKey]);
      vapid = keys;
      console.log('[김프리] 푸시 알림 인증키를 새로 생성했습니다.');
    }

    webpush.setVapidDetails(
      process.env.PUSH_CONTACT || 'mailto:lshark4541@gmail.com',
      vapid.publicKey,
      vapid.privateKey
    );
    console.log('[김프리] 푸시 알림 준비 완료');
  } catch (e) {
    console.warn('[김프리] 푸시 알림 초기화 실패 (푸시 없이 계속 동작합니다):', e.message);
    vapid = null;
  }
}

function getPublicKey() {
  return vapid ? vapid.publicKey : null;
}

// 특정 사용자의 모든 기기로 알림을 보냅니다.
// 만료되었거나 차단된 구독(410/404)은 자동으로 정리합니다.
async function sendPushToUser(userId, payload) {
  if (!vapid) return;
  let subs = [];
  try {
    subs = await all('SELECT * FROM push_subscriptions WHERE user_id = ?', [userId]);
  } catch (e) {
    return;
  }
  if (!subs.length) return;

  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s) => {
      const subscription = {
        endpoint: s.endpoint,
        keys: { p256dh: s.p256dh, auth: s.auth },
      };
      try {
        await webpush.sendNotification(subscription, body);
      } catch (err) {
        const code = err && err.statusCode;
        if (code === 404 || code === 410) {
          // 사용자가 앱을 지웠거나 알림을 껐을 때 — 더 이상 쓸 수 없는 구독이라 삭제
          await run('DELETE FROM push_subscriptions WHERE id = ?', [s.id]).catch(() => {});
        }
        // 그 외 일시적 오류는 무시합니다 (알림 실패가 메시지 전송을 막으면 안 되므로)
      }
    })
  );
}

module.exports = { initPush, getPublicKey, sendPushToUser };
