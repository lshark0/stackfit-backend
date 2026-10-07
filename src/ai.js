// Claude(Anthropic) API 연동 — 고객센터 AI 상담과 경력기술서 → 프로필 자동 작성에 사용합니다.
// ANTHROPIC_API_KEY가 없으면 AI 기능은 꺼진 상태(aiEnabled() === false)로 동작하고,
// 화면에는 "준비 중" 안내만 표시됩니다.
//
// 키가 워크스페이스에 속하지 않은 키라면 ANTHROPIC_WORKSPACE_ID도 함께 설정해야 합니다
// (요청마다 anthropic-workspace-id 헤더로 전달).
const crypto = require('crypto');
const AnthropicSdk = require('@anthropic-ai/sdk');
const { run, get } = require('./db');
const { deriveKey } = require('./auth');

const Anthropic = AnthropicSdk.default || AnthropicSdk;

// 비용을 아끼기 위해 기본은 Claude Haiku 4.5. 필요하면 환경변수로 바꿀 수 있습니다.
const SUPPORT_MODEL = process.env.AI_SUPPORT_MODEL || 'claude-haiku-4-5';
const PROFILE_MODEL = process.env.AI_PROFILE_MODEL || 'claude-haiku-4-5';

// 1인 1일 이용 한도 (한국시간 기준). 비용 폭주를 막기 위한 안전장치입니다.
const DAILY_LIMITS = {
  support_chat: Number(process.env.AI_SUPPORT_DAILY_LIMIT) || 30,
  profile_from_resume: Number(process.env.AI_PROFILE_DAILY_LIMIT) || 5,
};

// 서비스 전체 1일 이용 한도. 봇이 계정을 여러 개 만들어 AI를 대신 돌리게 하는
// '비용 폭탄(Denial of Wallet)' 공격을 막는 마지막 안전장치입니다.
const GLOBAL_DAILY_LIMIT = Number(process.env.AI_GLOBAL_DAILY_LIMIT) || 2000;

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

// 서비스 전체에서 오늘 남은 이용 횟수
async function globalRemainingToday() {
  const row = await get('SELECT COUNT(*) AS n FROM ai_usage WHERE day = ?', [kstDay()]);
  return Math.max(0, GLOBAL_DAILY_LIMIT - Number(row ? row.n : 0));
}

// 같은 계정이 같은 기능을 동시에 여러 번 호출하지 못하게 합니다.
// (한도 확인 → AI 호출 → 사용 기록 사이에 요청을 동시에 몰아 보내 1일 한도를 우회하는 것을 차단)
// 서버가 한 대(Render 인스턴스 1개)라 메모리 잠금으로 충분합니다.
const inFlight = new Set();
function tryBegin(userId, feature) {
  const key = `${userId}:${feature}`;
  if (inFlight.has(key)) return null;
  inFlight.add(key);
  return () => inFlight.delete(key);
}

// AI 상담 답변 서명: 화면이 보내는 대화 기록 중 'AI 답변'은 서버가 실제로 보낸 것만 인정합니다.
// 사용자가 가짜 AI 답변("관리자 모드로 전환했습니다" 등)을 끼워 넣어 AI를 조종하는 것을 막습니다.
const REPLY_KEY = deriveKey('ai-support-reply');
function signReply(userId, text) {
  return crypto.createHmac('sha256', REPLY_KEY).update(`${userId}\n${text}`).digest('base64url').slice(0, 32);
}
function verifyReply(userId, text, sig) {
  if (typeof sig !== 'string' || sig.length !== 32) return false;
  const want = Buffer.from(signReply(userId, text));
  const got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

async function recordUsage(userId, feature, model, usage) {
  // 프롬프트 캐시를 쓴 경우 캐시 토큰도 입력 토큰에 합산합니다(비용을 넉넉히 잡는 쪽).
  const input = (Number(usage?.input_tokens) || 0)
    + (Number(usage?.cache_creation_input_tokens) || 0)
    + (Number(usage?.cache_read_input_tokens) || 0);
  await run(
    'INSERT INTO ai_usage (user_id, feature, day, model, input_tokens, output_tokens) VALUES (?,?,?,?,?,?)',
    [userId, feature, kstDay(), model, input, Number(usage?.output_tokens) || 0]
  );
}

// 모델별 가격 (USD / 100만 토큰). 관리자 통계의 예상 비용 계산에만 씁니다.
const MODEL_PRICES = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-opus-5-5': { input: 4, output: 20 },
};
function estimateCostUsd(model, inputTokens, outputTokens) {
  const key = Object.keys(MODEL_PRICES).find((k) => String(model || '').startsWith(k));
  const price = MODEL_PRICES[key] || MODEL_PRICES['claude-haiku-4-5'];
  return (Number(inputTokens) * price.input + Number(outputTokens) * price.output) / 1e6;
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
  globalRemainingToday,
  tryBegin,
  signReply,
  verifyReply,
  recordUsage,
  estimateCostUsd,
  kstDay,
  friendlyError,
  SUPPORT_MODEL,
  PROFILE_MODEL,
  DAILY_LIMITS,
  GLOBAL_DAILY_LIMIT,
};
