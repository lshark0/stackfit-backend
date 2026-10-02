// 수행 프로젝트(포트폴리오) 중복 판별·정리
// - AI 자동 채우기가 이미 등록된 프로젝트를 다시 추가하지 않도록 sameProject()로 비교합니다.
// - 예전에 AI 자동 채우기로 중복 등록된 프로젝트는 서버 시작 시 한 번 정리합니다(dedupeAllPortfolios).
const { run, get, all } = require('./db');

// 프로젝트명 비교용: 공백·괄호·기호를 무시합니다.
const normTitle = (t) => String(t || '').toLowerCase().replace(/[\s()[\]{}·.,\-_/'"]/g, '');

// 참여 기간의 시작 연월 (예: "2025.7 ~ 2026.06" → "2025.07")
function periodStart(period) {
  const m = /(\d{4})\s*[.\-/년]?\s*(\d{1,2})?/.exec(String(period || ''));
  return m ? `${m[1]}.${String(m[2] || '1').padStart(2, '0')}` : '';
}

// AI 제안과 기존 프로젝트 비교: 프로젝트명이 같거나(한쪽이 다른 쪽을 포함), 발주처+시작 연월이 같으면 같은 프로젝트
function sameProject(a, b) {
  const ta = normTitle(a.title), tb = normTitle(b.title);
  if (ta && tb && (ta === tb || (Math.min(ta.length, tb.length) >= 6 && (ta.includes(tb) || tb.includes(ta))))) return true;
  const ca = normTitle(a.client), cb = normTitle(b.client);
  const sa = periodStart(a.period), sb = periodStart(b.period);
  return !!(ca && ca === cb && sa && sa === sb);
}

// 이미 저장된 항목을 지울 때는 더 엄격하게: 프로젝트명이 같고 시작 연월도 같을 때만 중복으로 봅니다.
function strictDuplicate(a, b) {
  return normTitle(a.title) === normTitle(b.title) && periodStart(a.period) === periodStart(b.period);
}

const contentScore = (p) => JSON.parse(p.stack_json || '[]').length * 10 + String(p.description || '').length
  + (p.client ? 5 : 0) + (p.role_title ? 5 : 0) + (p.link_url ? 5 : 0);

// 회원 한 명의 중복 프로젝트를 정리합니다. 내용이 가장 많은 항목을 남기고,
// 지워지는 항목의 기술스택은 남기는 항목에 합칩니다(최대 20개). 지운 개수를 돌려줍니다.
async function dedupeUserPortfolios(freelancerId) {
  const rows = await all('SELECT * FROM portfolios WHERE freelancer_id = ? ORDER BY id', [freelancerId]);
  const groups = [];
  for (const r of rows) {
    if (!normTitle(r.title)) continue;
    const g = groups.find((grp) => strictDuplicate(grp[0], r));
    if (g) g.push(r); else groups.push([r]);
  }
  let removed = 0;
  for (const g of groups) {
    if (g.length < 2) continue;
    const keep = g.reduce((best, r) => (contentScore(r) > contentScore(best) ? r : best), g[0]);
    const stack = [];
    for (const r of [keep, ...g.filter((x) => x !== keep)]) {
      for (const s of JSON.parse(r.stack_json || '[]')) {
        if (stack.length < 20 && !stack.some((x) => x.toLowerCase() === String(s).toLowerCase())) stack.push(s);
      }
    }
    await run('UPDATE portfolios SET stack_json = ? WHERE id = ?', [JSON.stringify(stack), keep.id]);
    for (const r of g) {
      if (r === keep) continue;
      await run('DELETE FROM portfolios WHERE id = ? AND freelancer_id = ?', [r.id, freelancerId]);
      removed++;
    }
  }
  return removed;
}

// 서버 시작 시 한 번만 실행 (app_settings에 완료 표시)
async function dedupeAllPortfolios() {
  const FLAG = 'portfolio_dedupe_v1';
  try {
    if (await get('SELECT value FROM app_settings WHERE key = ?', [FLAG])) return;
    const owners = await all('SELECT DISTINCT freelancer_id FROM portfolios');
    let removed = 0, users = 0;
    for (const o of owners) {
      const n = await dedupeUserPortfolios(o.freelancer_id);
      if (n) { removed += n; users++; }
    }
    await run('INSERT INTO app_settings (key, value) VALUES (?,?)', [FLAG, String(removed)]);
    console.log(`[IT Free] 중복 수행 프로젝트 정리: 회원 ${users}명, ${removed}건 삭제`);
  } catch (e) {
    console.warn('[IT Free] 중복 수행 프로젝트 정리 건너뜀:', e.message);
  }
}

module.exports = { sameProject, dedupeUserPortfolios, dedupeAllPortfolios };
