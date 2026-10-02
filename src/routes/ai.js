// AI 기능 API
// - GET  /api/ai/status                 AI 사용 가능 여부와 오늘 남은 이용 횟수
// - POST /api/ai/support-chat           고객센터 AI 상담 (Claude Haiku 4.5)
// - POST /api/ai/profile-from-resume    올려둔 경력기술서를 읽어 프로필 입력값을 제안 (저장은 하지 않음)
const express = require('express');
const { get, all } = require('../db');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');
const ai = require('../ai');
const { buildSupportSystemPrompt } = require('../aiSupportPrompt');
const { extractOfficeText } = require('../docText');
const { STACK_CATALOG } = require('../stackCatalog');
const { sameProject } = require('../portfolioDedupe');

const router = express.Router();
wrapAllRoutes(router);

const DUTY_OPTIONS = ['PM', 'PL', 'TA', 'SA', 'SE', 'DBA', '개발자', 'QA', '보안', '감리', '기타'];
const MAX_TURNS = 20;
const MAX_MESSAGE_CHARS = 1000;
const MAX_PROJECTS = 50; // 경력기술서에서 가져올 수행 프로젝트 최대 개수 (portfolios.js의 등록 상한과 같게)

const NOT_READY = 'AI 기능을 준비하고 있어요. 조금만 기다려주세요.';

router.get('/status', requireAuth, async (req, res) => {
  const enabled = ai.aiEnabled();
  res.json({
    enabled,
    remaining: enabled
      ? {
          support_chat: await ai.remainingToday(req.user.id, 'support_chat'),
          profile_from_resume: await ai.remainingToday(req.user.id, 'profile_from_resume'),
        }
      : null,
  });
});

// 화면에서 보낸 대화 기록을 검증·정리합니다: user/assistant가 번갈아 나오고,
// 첫 메시지와 마지막 메시지는 user여야 하며, 최근 MAX_TURNS개만 사용합니다.
function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return null;
  const msgs = [];
  for (const m of raw.slice(-MAX_TURNS)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue;
    const content = m.content.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!content) continue;
    const last = msgs[msgs.length - 1];
    if (last && last.role === m.role) last.content += '\n' + content;
    else msgs.push({ role: m.role, content });
  }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return null;
  return msgs;
}

router.post('/support-chat', requireAuth, async (req, res) => {
  const client = ai.getClient();
  if (!client) return res.status(503).json({ error: NOT_READY, code: 'AI_DISABLED' });

  const messages = sanitizeHistory(req.body && req.body.messages);
  if (!messages) return res.status(400).json({ error: '질문을 입력해주세요.' });

  const remaining = await ai.remainingToday(req.user.id, 'support_chat');
  if (remaining <= 0) {
    return res.status(429).json({
      error: '오늘 AI 상담 이용 횟수를 모두 사용했어요. 내일 다시 이용하거나 문의·신고로 접수해주세요.',
      code: 'AI_DAILY_LIMIT',
    });
  }

  let resp;
  try {
    resp = await client.messages.create({
      model: ai.SUPPORT_MODEL,
      max_tokens: 800,
      system: [{ type: 'text', text: buildSupportSystemPrompt(req.user.role), cache_control: { type: 'ephemeral' } }],
      messages,
    });
  } catch (err) {
    return res.status(502).json({ error: ai.friendlyError(err) });
  }
  await ai.recordUsage(req.user.id, 'support_chat', ai.SUPPORT_MODEL, resp.usage);

  let reply = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (resp.stop_reason === 'refusal' || !reply) {
    reply = '이 질문에는 답변드리기 어려워요. 왼쪽 메뉴 > 고객센터 > 문의·신고로 접수해주시면 담당자가 확인해 답변드릴게요.';
  }
  res.json({ reply, remaining: remaining - 1 });
});

// ---------- 경력기술서 → 프로필 자동 작성 ----------

const PROFILE_SCHEMA = {
  type: 'object',
  properties: {
    role_title: { type: 'string', enum: [...DUTY_OPTIONS, ''] },
    total_years: { type: 'number' },
    stack: { type: 'array', items: { type: 'string' } },
    certs: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    projects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          client: { type: 'string' },
          role_title: { type: 'string', enum: [...DUTY_OPTIONS, ''] },
          period: { type: 'string' },
          stack: { type: 'array', items: { type: 'string' } },
          description: { type: 'string' },
        },
        required: ['title', 'client', 'role_title', 'period', 'stack', 'description'],
        additionalProperties: false,
      },
    },
  },
  required: ['role_title', 'total_years', 'stack', 'certs', 'summary', 'projects'],
  additionalProperties: false,
};

const CATALOG_NAMES = Object.values(STACK_CATALOG).flat();
const CATALOG_BY_LOWER = new Map(CATALOG_NAMES.map((n) => [n.toLowerCase(), n]));

const PROFILE_INSTRUCTIONS = `위 문서는 IT 프리랜서의 경력기술서입니다. 이 문서에 실제로 적힌 내용만 근거로 IT Free 프로필 입력값을 추출하세요. 문서에 없는 내용은 지어내지 마세요.

- role_title: 주로 맡아 온 업무를 다음 중 하나로 고르세요: ${DUTY_OPTIONS.join(', ')}. 판단이 어려우면 빈 문자열.
- total_years: IT 분야 총 경력 연수(숫자, 소수 가능). 프로젝트 기간을 합산하거나 문서에 적힌 총 경력을 사용하세요. 알 수 없으면 -1.
- stack: 실제로 사용한 기술스택. 가능하면 다음 표준 표기를 그대로 쓰세요: ${CATALOG_NAMES.join(', ')}. 목록에 없는 기술은 일반적인 영문 표기로. 중요한 것부터 최대 20개.
- certs: 보유 자격증 정식 명칭(예: 정보처리기사). 없으면 빈 배열.
- summary: 프로필 자기소개. 경력 연수, 주요 업무·도메인, 사용 기술을 1인칭 합니다체 3~4문장(350자 이내)으로. 문서에 없는 성과·역할·수식어(예: 주도, 최적화, 능숙)는 덧붙이지 마세요. 개인 연락처·주민번호 등 개인정보는 넣지 마세요.
- projects: 문서에 나온 수행 프로젝트를 하나도 빠짐없이 모두(최대 50개), 최근 것부터. 표·목록으로 나열된 프로젝트도 각각 하나씩 넣으세요. title(프로젝트명), client(발주처/고객사, 없으면 빈 문자열), role_title(위 업무 목록 중 하나 또는 빈 문자열), period("2024.03 ~ 2024.09" 형식, 진행 중이면 "2025.06 ~ 진행중", 모르면 빈 문자열), stack(그 프로젝트 설명에 적힌 기술만, 최대 10개), description(문서에 적힌 담당 업무를 1~2문장, 150자 이내로 요약하되 없는 내용은 덧붙이지 말 것. 문서에 프로젝트명·기간만 있으면 빈 문자열).`;

// IT 업계에서 흔히 쓰는 학사 기준 기술자 등급(초급 → 3년 후 중급 → 6년 후 고급)을 단순 적용합니다.
// 사용자가 저장 전에 직접 확인·수정합니다.
function gradeFromYears(years) {
  if (typeof years !== 'number' || !Number.isFinite(years) || years < 0) return '';
  if (years < 3) return '초급';
  if (years < 6) return '중급';
  return '고급';
}

function normalizeStackList(list, max) {
  const out = [];
  const seen = new Set();
  for (const s of Array.isArray(list) ? list : []) {
    if (typeof s !== 'string' || !s.trim()) continue;
    const v = s.trim().slice(0, 40);
    const canon = CATALOG_BY_LOWER.get(v.toLowerCase()) || v;
    const key = canon.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(canon);
    if (out.length >= max) break;
  }
  return out;
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function cleanSuggestion(raw) {
  const years = Number(raw.total_years);
  return {
    role_title: DUTY_OPTIONS.includes(raw.role_title) ? raw.role_title : '',
    years: Number.isFinite(years) && years >= 0 ? Math.round(years * 10) / 10 : null,
    grade: gradeFromYears(years),
    stack: normalizeStackList(raw.stack, 20),
    certs: normalizeStackList(raw.certs, 15),
    summary: str(raw.summary, 600),
    projects: (Array.isArray(raw.projects) ? raw.projects : [])
      .filter((p) => p && str(p.title, 120))
      .slice(0, MAX_PROJECTS)
      .map((p) => ({
        title: str(p.title, 120),
        client: str(p.client, 60),
        role_title: DUTY_OPTIONS.includes(p.role_title) ? p.role_title : '',
        period: str(p.period, 40),
        stack: normalizeStackList(p.stack, 10),
        description: str(p.description, 300),
      })),
  };
}

// AI 결과 안의 중복을 없애고, 이미 등록된 프로젝트에는 exists: true를 표시합니다.
function markExistingProjects(projects, existing) {
  const unique = [];
  for (const p of projects) if (!unique.some((u) => sameProject(u, p))) unique.push(p);
  return unique.map((p) => ({ ...p, exists: existing.some((e) => sameProject(e, p)) }));
}

router.post('/profile-from-resume', requireAuth, requireRole('freelancer'), async (req, res) => {
  const client = ai.getClient();
  if (!client) return res.status(503).json({ error: NOT_READY, code: 'AI_DISABLED' });

  const prof = await get(
    'SELECT resume_original_name, resume_filename, resume_data FROM freelancer_profiles WHERE user_id = ?',
    [req.user.id]
  );
  if (!prof || !prof.resume_data) {
    return res.status(400).json({ error: '경력기술서를 먼저 올려주세요.', code: 'NO_RESUME' });
  }
  const buf = Buffer.from(prof.resume_data);
  const ext = (/\.[^.]+$/.exec(prof.resume_filename || prof.resume_original_name || '') || [''])[0].toLowerCase();

  let docBlock;
  if (ext === '.pdf') {
    if (buf.length > 15 * 1024 * 1024) return res.status(400).json({ error: '파일이 너무 커서 분석할 수 없어요.' });
    docBlock = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } };
  } else if (ext === '.docx' || ext === '.pptx') {
    let text = '';
    try { text = extractOfficeText(buf, ext) || ''; } catch (e) { text = ''; }
    if (text.length < 30) return res.status(400).json({ error: '경력기술서에서 글자를 읽지 못했어요. PDF로 저장해서 다시 올려주세요.' });
    docBlock = { type: 'text', text: `<resume>\n${text}\n</resume>` };
  } else {
    return res.status(400).json({
      error: 'AI 자동 채우기는 PDF, Word(docx), PPT(pptx) 경력기술서만 지원해요. PDF로 저장해서 다시 올려주세요.',
      code: 'UNSUPPORTED_FORMAT',
    });
  }

  const remaining = await ai.remainingToday(req.user.id, 'profile_from_resume');
  if (remaining <= 0) {
    return res.status(429).json({ error: '오늘 AI 자동 채우기 이용 횟수를 모두 사용했어요. 내일 다시 시도해주세요.', code: 'AI_DAILY_LIMIT' });
  }

  let resp;
  try {
    // 프로젝트가 많은 경력기술서는 응답이 길어 1분 이상 걸릴 수 있어 넉넉히 기다립니다.
    resp = await client.messages.create({
      model: ai.PROFILE_MODEL,
      max_tokens: 16000,
      messages: [{ role: 'user', content: [docBlock, { type: 'text', text: PROFILE_INSTRUCTIONS }] }],
      output_config: { format: { type: 'json_schema', schema: PROFILE_SCHEMA } },
    }, { timeout: 180 * 1000, maxRetries: 1 });
  } catch (err) {
    return res.status(502).json({ error: ai.friendlyError(err) });
  }
  await ai.recordUsage(req.user.id, 'profile_from_resume', ai.PROFILE_MODEL, resp.usage);

  const textOut = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try { parsed = JSON.parse(textOut); } catch (e) { parsed = null; }
  if (resp.stop_reason !== 'end_turn' || !parsed) {
    console.error('[AI] 프로필 추출 실패:', resp.stop_reason);
    return res.status(502).json({ error: '경력기술서를 분석하지 못했어요. 잠시 후 다시 시도해주세요.' });
  }
  const suggestion = cleanSuggestion(parsed);
  const existing = await all('SELECT title, client, period FROM portfolios WHERE freelancer_id = ?', [req.user.id]);
  suggestion.projects = markExistingProjects(suggestion.projects, existing);
  res.json({ suggestion, remaining: remaining - 1 });
});

module.exports = router;
module.exports._test = { sanitizeHistory, cleanSuggestion, gradeFromYears, markExistingProjects };
