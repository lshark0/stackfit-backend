// [개선-012 시험] AI 추천 이유 — 규칙으로 계산한 추천(점수) 위에, AI가 공고와 경력을 읽고
// "왜 맞는지"를 두 문장 이내로 설명합니다. 점수 계산은 바꾸지 않습니다(src/recommend.js).
//
// 지금은 관리자 화면의 '미리보기'에서만 씁니다. 대표가 실제 결과를 보고 회원 화면 반영 여부를 정합니다.
// - AI에는 이름·연락처·생년월일을 보내지 않습니다. 자유 입력 글(소개·공고 설명)은 연락처를 가린 뒤 잘라서 보냅니다.
// - 같은 공고·프로필 내용이면 다시 묻지 않도록 서버 메모리에 결과를 잠시 보관합니다.
const crypto = require('crypto');
const ai = require('./ai');
const { all } = require('./db');
const { maskContacts } = require('./contactGuard');

const MODEL = process.env.AI_RECO_MODEL || ai.PROFILE_MODEL;
const cache = new Map(); // sig → { text, usage }
const CACHE_MAX = 500;

const list = (v) => (Array.isArray(v) ? v : (() => { try { return JSON.parse(v || '[]'); } catch (e) { return []; } })());
const clip = (s, n) => {
  const t = maskContacts(String(s || '')).text.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};

function jobFacts(job) {
  return [
    `공고 제목: ${clip(job.title, 120)}`,
    job.duty && `업무: ${job.duty}`,
    job.grade && `요구 등급: ${job.grade}`,
    `요구 기술: ${list(job.stack || job.stack_json).join(', ') || '없음'}`,
    list(job.certs || job.certs_json).length && `요구 자격증: ${list(job.certs || job.certs_json).join(', ')}`,
    job.period && `기간: ${clip(job.period, 40)}`,
    job.start_date && `투입 예정: ${job.start_date}`,
    job.work_type && `근무 형태: ${clip(job.work_type, 40)}`,
    job.location && `근무지: ${clip(job.location, 40)}`,
    job.rate && `단가: ${clip(job.rate, 40)}`,
    job.description && `상세 내용: ${clip(job.description, 1200)}`,
  ].filter(Boolean).join('\n');
}

function withoutName(text, name) {
  const n = String(name || '').trim();
  if (n.length < 2) return text;
  return String(text || '').split(n).join('본인');
}

function profileFacts(p, portfolios) {
  return [
    p.role_title && `업무: ${clip(p.role_title, 40)}`,
    p.grade && `등급: ${p.grade}`,
    p.years && `경력: ${clip(p.years, 20)}`,
    `보유 기술: ${list(p.stack || p.stack_json).join(', ') || '없음'}`,
    list(p.certs || p.certs_json).length && `자격증: ${list(p.certs || p.certs_json).join(', ')}`,
    p.available_from && `투입 가능일: ${p.available_from}`,
    p.pref_work_type && `선호 근무 형태: ${p.pref_work_type}`,
    list(p.pref_regions_json).length && `근무 가능 지역: ${list(p.pref_regions_json).join(', ')}`,
    p.rate && `희망 단가: ${clip(p.rate, 40)}`,
    // 자기소개에 본인 이름을 적은 경우가 많아, 프로필 이름은 '본인'으로 바꿔 보냅니다.
    p.summary && `자기소개(요약): ${clip(withoutName(p.summary, p.name), 800)}`,
    portfolios.length && '수행 프로젝트:\n' + portfolios.map((x) =>
      `- ${clip(x.title, 80)}${x.client ? ` (${clip(x.client, 40)})` : ''}${x.role_title ? `, ${clip(x.role_title, 30)}` : ''}${x.period ? `, ${clip(x.period, 30)}` : ''}${list(x.stack_json).length ? `, 기술: ${list(x.stack_json).slice(0, 8).join(', ')}` : ''}`
    ).join('\n'),
  ].filter(Boolean).join('\n');
}

function instructions(viewer) {
  const who = viewer === 'company'
    ? '채용 담당자에게 이 프리랜서가 이 공고에 왜 맞는지'
    : '프리랜서 본인에게 이 공고가 왜 맞는지';
  return `당신은 IT 프리랜서 매칭 서비스 '김프리'의 추천 설명 작성자입니다.
아래 <공고>와 <프리랜서> 정보만 근거로, ${who} 한국어 두 문장 이내(120자 안팎)로 설명하세요.
- 첫 문장: 가장 강한 근거(겹치는 기술·업무·비슷한 프로젝트 경험·등급 등)를 구체적으로.
- 두 번째 문장(필요할 때만): 확인이 필요한 점 한 가지(예: 공고가 요구하지만 프로필에 없는 기술)를 짧게.
- 주어진 정보에 없는 사실을 지어내지 말고, 과장('최고의', '완벽한')하지 마세요.
- 사람 이름·회사 연락처는 쓰지 말고, 점수 숫자도 쓰지 마세요.
- 설명 문장만 출력하세요(머리말·따옴표·목록 없이).`;
}

// 공고·프로필 원문이 같으면 같은 설명을 다시 씁니다.
function signature(viewer, job, profile, portfolios) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([viewer, jobFacts(job), profileFacts(profile, portfolios)]))
    .digest('hex');
}

async function portfoliosOf(freelancerId) {
  return all(
    'SELECT title, client, role_title, period, stack_json FROM portfolios WHERE freelancer_id = ? ORDER BY id DESC LIMIT 5',
    [freelancerId]
  );
}

// 한 쌍(공고·프리랜서)의 추천 이유를 만듭니다. userId는 AI 사용량을 기록할 계정(미리보기에서는 관리자)입니다.
async function reasonFor({ viewer, job, profile, ruleReasons, userId }) {
  const portfolios = await portfoliosOf(profile.user_id);
  const sig = signature(viewer, job, profile, portfolios);
  if (cache.has(sig)) return { ...cache.get(sig), cached: true };

  const client = ai.getClient();
  if (!client) throw Object.assign(new Error('AI 키가 설정되지 않았어요.'), { status: 503 });
  const content = `<공고>\n${jobFacts(job)}\n</공고>\n\n<프리랜서>\n${profileFacts(profile, portfolios)}\n</프리랜서>\n\n` +
    `<규칙 기반 추천 근거>\n${(ruleReasons || []).join(', ') || '없음'}\n</규칙 기반 추천 근거>`;
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: instructions(viewer),
    messages: [{ role: 'user', content }],
  }, { timeout: 60 * 1000, maxRetries: 1 });
  await ai.recordUsage(userId, 'reco_reason', MODEL, resp.usage);
  const text = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
    .replace(/^["'“”]+|["'“”]+$/g, '');
  const out = {
    text: maskContacts(text).text.slice(0, 300),
    inputTokens: Number(resp.usage?.input_tokens) || 0,
    outputTokens: Number(resp.usage?.output_tokens) || 0,
    model: MODEL,
  };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(sig, out);
  return { ...out, cached: false };
}

module.exports = { reasonFor, jobFacts, profileFacts, MODEL };
