// 로그인 토큰 폐기(보안-004)
// 로그인 토큰은 서버에 저장하지 않는 서명 토큰(7일 유효)이라, 비밀번호를 바꾸거나 탈퇴해도 예전 토큰이
// 만료 전까지 계속 쓰일 수 있었습니다. users.tokens_valid_after(초)보다 먼저 발급된 토큰과
// 이미 삭제된 계정의 토큰은 거부합니다.
// 요청마다 DB를 조회하지 않도록 계정별 값을 1분간 메모리에 보관하고, 이 서버에서 값을 바꾸면 즉시 반영합니다.
const { get, run } = require('./db');

const TTL_MS = 60 * 1000;
const cache = new Map(); // userId → { at, validAfter (초, 0=제한 없음), exists }
const CACHE_MAX = 5000;

async function lookup(userId) {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  const row = await get('SELECT tokens_valid_after FROM users WHERE id = ?', [userId]);
  const v = { at: Date.now(), exists: !!row, validAfter: Number(row && row.tokens_valid_after) || 0 };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(userId, v);
  return v;
}

// 토큰(검증된 payload)이 아직 유효한지
async function isTokenActive(payload) {
  const v = await lookup(payload.id);
  if (!v.exists) return false;
  return !v.validAfter || Number(payload.iat || 0) >= v.validAfter;
}

// 지금까지 발급된 이 계정의 로그인 토큰을 모두 무효로 합니다. 반환값: 기준 시각(초)
// 이 직후에 새로 발급하는 토큰(같은 초)은 유효합니다.
async function revokeTokens(userId) {
  const now = Math.floor(Date.now() / 1000);
  await run('UPDATE users SET tokens_valid_after = ? WHERE id = ?', [now, userId]);
  cache.set(Number(userId), { at: Date.now(), exists: true, validAfter: now });
  return now;
}

// 계정이 삭제됐을 때 메모리 값을 바로 지웁니다.
function forgetUser(userId) {
  cache.set(Number(userId), { at: Date.now(), exists: false, validAfter: 0 });
}

module.exports = { isTokenActive, revokeTokens, forgetUser };
