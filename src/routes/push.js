const express = require('express');
const { run, get } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');
const { getPublicKey, sendPushToUser } = require('../push');

const router = express.Router();
wrapAllRoutes(router);

// 브라우저가 알림 구독을 만들 때 필요한 공개키를 알려줍니다.
router.get('/public-key', (req, res) => {
  const key = getPublicKey();
  if (!key) return res.status(503).json({ error: '푸시 알림을 사용할 수 없어요.' });
  res.json({ publicKey: key });
});

// 이 기기에서 알림을 받겠다고 등록합니다.
router.post('/subscribe', requireAuth, async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || typeof endpoint !== 'string' || !keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ error: '구독 정보가 올바르지 않아요.' });
  }

  // 같은 기기(endpoint)가 다시 등록하면 소유자만 갱신합니다.
  // (한 기기를 여러 계정이 번갈아 쓰는 경우, 마지막 로그인 계정이 알림을 받도록)
  const existing = await get('SELECT id FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
  if (existing) {
    await run('UPDATE push_subscriptions SET user_id=?, p256dh=?, auth=? WHERE id=?', [
      req.user.id, keys.p256dh, keys.auth, existing.id,
    ]);
  } else {
    await run('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?,?,?,?)', [
      req.user.id, endpoint, keys.p256dh, keys.auth,
    ]);
  }
  res.status(201).json({ subscribed: true });
});

// 이 기기에서 알림 받기를 해제합니다.
router.post('/unsubscribe', requireAuth, async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: '구독 정보가 필요해요.' });
  await run('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', [endpoint, req.user.id]);
  res.json({ subscribed: false });
});

// 이 기기가 현재 등록되어 있는지 확인합니다.
router.get('/status', requireAuth, async (req, res) => {
  const { endpoint } = req.query;
  if (!endpoint) return res.json({ subscribed: false });
  const row = await get('SELECT id FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', [endpoint, req.user.id]);
  res.json({ subscribed: !!row });
});

// 내 기기로 테스트 알림을 보내봅니다 (설정이 제대로 됐는지 사용자가 직접 확인용).
router.post('/test', requireAuth, async (req, res) => {
  const row = await get('SELECT id FROM push_subscriptions WHERE user_id = ?', [req.user.id]);
  if (!row) return res.status(400).json({ error: '이 계정에 등록된 기기가 없어요. 알림을 다시 켜주세요.' });
  await sendPushToUser(req.user.id, {
    title: '스택핏 알림 테스트',
    body: '알림이 정상적으로 설정됐어요!',
    url: '/',
    tag: 'test',
  });
  res.json({ sent: true });
});

module.exports = router;
