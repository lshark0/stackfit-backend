const { get, all, run } = require('./db');

// 상대 회원 차단(개선-018, Play 콘텐츠 등급 '사용자 차단 기능' 대응).
// A가 B를 차단하면 둘 사이의 메시지·제안·지원을 막고, 서로의 추천·검색 목록에서 빼 줍니다(양방향 효과).
// 차단당한 쪽에는 '차단되었다'고 알리지 않고, 보낼 수 없다는 일반 안내만 보여 줍니다.
// 차단 목록(누가 누구를)은 본인과 관리자 건수 집계에만 쓰고 상대에게 내려주지 않습니다.

const BLOCKED_MSG = '이 회원과는 메시지·제안·지원을 주고받을 수 없어요.';

// 두 회원 사이에 어느 쪽이든 차단이 있는지
async function isBlockedBetween(a, b) {
  const x = Number(a), y = Number(b);
  if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
  const row = await get(
    'SELECT id FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1',
    [x, y, y, x]
  );
  return !!row;
}

// 이 회원과 차단 관계(내가 차단했거나 나를 차단한)인 회원 id 모음 — 목록에서 빼는 용도
async function blockedIdSet(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id)) return new Set();
  const rows = await all('SELECT blocker_id, blocked_id FROM user_blocks WHERE blocker_id = ? OR blocked_id = ?', [id, id]);
  return new Set(rows.map((r) => Number(r.blocker_id) === id ? Number(r.blocked_id) : Number(r.blocker_id)));
}

// 내가 차단한 회원 id 모음(대화 목록에서 내가 차단한 상대만 숨길 때)
async function myBlockedIds(userId) {
  const rows = await all('SELECT blocked_id FROM user_blocks WHERE blocker_id = ?', [Number(userId)]);
  return new Set(rows.map((r) => Number(r.blocked_id)));
}

// 내가 차단한 회원 목록(이름은 기업명/프리랜서 이름, 차단 해제 화면용)
async function listMyBlocks(userId) {
  const rows = await all(
    `SELECT b.blocked_id, b.created_at, u.role, c.name AS company_name, f.name AS freelancer_name
     FROM user_blocks b
     JOIN users u ON u.id = b.blocked_id
     LEFT JOIN companies c ON c.user_id = b.blocked_id
     LEFT JOIN freelancer_profiles f ON f.user_id = b.blocked_id
     WHERE b.blocker_id = ? ORDER BY b.id DESC`,
    [Number(userId)]
  );
  return rows.map((r) => ({
    user_id: r.blocked_id,
    role: r.role,
    name: (r.role === 'company' ? r.company_name : r.freelancer_name) || '(이름 없음)',
    created_at: r.created_at,
  }));
}

async function addBlock(blockerId, blockedId) {
  const exists = await get('SELECT id FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?', [blockerId, blockedId]);
  if (exists) return false;
  await run('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (?, ?)', [blockerId, blockedId]);
  return true;
}

async function removeBlock(blockerId, blockedId) {
  await run('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?', [blockerId, blockedId]);
}

module.exports = { BLOCKED_MSG, isBlockedBetween, blockedIdSet, myBlockedIds, listMyBlocks, addBlock, removeBlock };
