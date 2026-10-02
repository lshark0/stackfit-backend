// Claude(Anthropic) API 연동 — 고객센터 AI 상담과 경력기술서 → 프로필 자동 작성에 사용합니다.
// ANTHROPIC_API_KEY가 없으면 AI 기능은 꺼진 상태(aiEnabled() === false)로 동작하고,
// 화면에는 "준비 중" 안내만 표시됩니다.
//
// 키가 워크스페이스에 속하지 않은 키라면 ANTHROPIC_WORKSPACE_ID도 함께 설정해야 합니다
// (요청마다 anthropic-workspace-id 헤더로 전달).
const AnthropicSdk = require('@anthropic-ai/sdk');
const { run, get } = require('./db');

const Anthropic = AnthropicSdk.default || AnthropicSdk;

// 비용을 아끼기 위해 기본은 Claude Haiku 4.5. 필요하면 환경변수로 바꿀 수 있습니다.
const SUPPORT_MODEL = process.env.AI_SUPPORT_MODEL || 'claude-haiku-4-5';
const PROFILE_MODEL = process.env.AI_PROFILE_MODEL || 'claude-haiku-4-5';

// 1인 1일 이용 한도 (한국시간 기준). 비용 폭주를 막기 위한 안전장치입니다.
const DAILY_LIMITS = {
  support_chat: Number(process.env.AI_SUPPORT_DAILY_LIMIT) || 30,
  profile_from_resume: Number(process.env.AI_PROFILE_DAILY_LIMIT) || 5,
};

let client = null;
function aiEnabled() {
  return !!process.env.ANTHROPIC_API_KEY;
}
function getClient() {
  if (!aiEnabled()) return null;
  if (!client) {
    const defaultHeaders = {};
    if (process.env.ANTHROPIC_WORKSPACE_ID) defaultHeaders['anthropic-workspace-id'] = process.env.ANTHROPIC_WORKSPACE_ID;
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, defaultHeaders, maxRetries: 2, timeout: 60 * 1000 });
  }
  return client;
}
// 테스트에서 가짜 클라이언트를 끼워 넣을 때 사용
function setClientForTest(c) {
  client = c;
}

function kstDay() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// 오늘 남은 이용 횟수를 확인합니다. 한도를 넘었으면 null 대신 0을 돌려줍니다.
async function remainingToday(userId, feature) {
  const limit = DAILY_LIMITS[feature] || 10;
  const row = await get('SELECT COUNT(*) AS n FROM ai_usage WHERE user_id = ? AND feature = ? AND day = ?', [userId, feature, kstDay()]);
  return Math.max(0, limit - Number(row ? row.n : 0));
}

async function recordUsage(userId, feature, model, usage) {
  await run(
    'INSERT INTO ai_usage (user_id, feature, day, model, input_tokens, output_tokens) VALUES (?,?,?,?,?,?)',
    [userId, feature, kstDay(), model, Number(usage?.input_tokens) || 0, Number(usage?.output_tokens) || 0]
  );
}

// SDK 오류를 사용자에게 보여줄 한국어 메시지로 바꿉니다. (원인은 서버 로그에만 남김)
function friendlyError(err) {
  const status = err && err.status;
  console.error('[AI] 호출 실패:', status || '', err && err.message);
  if (status === 429) return 'AI 이용자가 많아요. 잠시 후 다시 시도해주세요.';
  if (status === 529 || status >= 500) return 'AI 서버가 일시적으로 바빠요. 잠시 후 다시 시도해주세요.';
  return 'AI 기능을 지금 사용할 수 없어요. 잠시 후 다시 시도해주세요.';
}

module.exports = {
  aiEnabled,
  getClient,
  setClientForTest,
  remainingToday,
  recordUsage,
  friendlyError,
  SUPPORT_MODEL,
  PROFILE_MODEL,
  DAILY_LIMITS,
};
