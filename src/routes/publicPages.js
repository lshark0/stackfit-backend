const express = require('express');
const { get, all } = require('../db');
const { wrapAllRoutes } = require('../middleware/asyncHandler');

// 로그인 없이 볼 수 있는 공개 공고 페이지(/jobs, /jobs/:id)와 검색엔진용 sitemap.xml·robots.txt.
// 앱(index.html)은 자바스크립트로 그려지는 한 페이지라 검색엔진이 공고를 찾지 못하므로,
// 열려 있는 공고를 서버에서 바로 HTML로 만들어 네이버·구글 검색과 공유 미리보기에 잡히게 합니다.
// 공고 목록 API(/api/jobs)가 이미 비로그인 조회를 허용하는 정보(공고 내용·회사명)만 보여줍니다.

const router = express.Router();
wrapAllRoutes(router);

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// 공유 주소는 PUBLIC_BASE_URL(예: https://itfree.co.kr)을 우선 쓰고, 없으면 요청이 들어온 주소를 씁니다.
function baseUrl(req) {
  const env = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (/^https?:\/\/[^/\s]+$/i.test(env)) return env;
  return `${req.protocol}://${req.get('host')}`;
}

// 한국 시간 기준 오늘 날짜(YYYY-MM-DD)
const todayKst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
function isExpired(job) {
  return !!job.deadline && /^\d{4}-\d{2}-\d{2}$/.test(job.deadline) && job.deadline < todayKst();
}
function dDayLabel(deadline) {
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return '상시 채용';
  const diff = Math.round((Date.parse(deadline) - Date.parse(todayKst())) / 86400000);
  if (diff < 0) return '마감';
  if (diff === 0) return '오늘 마감';
  return `D-${diff}`;
}
function dateOnly(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
const parseList = (json) => { try { const a = JSON.parse(json || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
const isOpen = (job) => job.status === 'open' && !isExpired(job);

// 열려 있는 공고 목록은 자주 바뀌지 않으므로 1분간 메모리에 보관해 검색엔진 수집이 DB에 부담을 주지 않게 합니다.
let openJobsCache = { at: 0, rows: null };
async function openJobs() {
  if (openJobsCache.rows && Date.now() - openJobsCache.at < 60 * 1000) return openJobsCache.rows;
  const rows = await all(
    `SELECT j.id, j.title, j.stack_json, j.period, j.rate, j.work_type, j.location, j.deadline, j.duty, j.grade, j.status, j.created_at,
       c.name AS company_name
     FROM jobs j LEFT JOIN companies c ON c.user_id = j.company_id
     WHERE j.status = 'open'
     ORDER BY j.created_at DESC, j.id DESC
     LIMIT 1000`
  );
  const open = rows.filter((j) => !isExpired(j));
  openJobsCache = { at: Date.now(), rows: open };
  return open;
}

const STYLE = `
  :root{--ink:#14171C; --slate:#4B5563; --line:#E1DED6; --paper:#F7F6F2; --amber:#F5A623; --amber-deep:#D9800E;}
  *{box-sizing:border-box;}
  body{margin:0; font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif; background:var(--paper); color:var(--ink); line-height:1.65;}
  a{color:inherit;}
  .wrap{max-width:760px; margin:0 auto; padding:20px 16px 64px;}
  .top{display:flex; align-items:center; justify-content:space-between; gap:12px; padding:4px 0 18px;}
  .brand{display:flex; align-items:center; gap:10px; text-decoration:none; font-weight:800; font-size:19px;}
  .brand img{width:34px; height:34px; border-radius:9px;}
  .top-cta{font-size:14px; font-weight:700; text-decoration:none; padding:9px 14px; border-radius:999px; background:var(--ink); color:#fff; white-space:nowrap;}
  h1{font-size:24px; line-height:1.35; margin:6px 0 6px; letter-spacing:-.3px;}
  .sub{color:var(--slate); font-size:14.5px; margin:0 0 18px;}
  .card{display:block; background:#fff; border:1px solid var(--line); border-radius:16px; padding:16px; margin-bottom:12px; text-decoration:none;}
  .card:hover{border-color:#C9C5BA;}
  .card h2{font-size:17px; margin:0 0 4px; line-height:1.4;}
  .org{color:var(--slate); font-size:13.5px;}
  .chips{display:flex; flex-wrap:wrap; gap:6px; margin:10px 0 8px; padding:0; list-style:none;}
  .chips li{font-size:12.5px; font-weight:700; padding:4px 10px; border-radius:999px; background:#F1EFE9; border:1px solid var(--line);}
  .meta{font-size:13px; color:var(--slate);}
  .dday{display:inline-block; font-size:12px; font-weight:800; color:var(--amber-deep); margin-left:6px;}
  table{width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--line); border-radius:16px; overflow:hidden; margin:14px 0;}
  td{padding:11px 14px; font-size:14.5px; border-bottom:1px solid #EEECE6; vertical-align:top;}
  tr:last-child td{border-bottom:none;}
  td.lbl{width:110px; color:var(--slate); font-weight:700; white-space:nowrap;}
  .desc{background:#fff; border:1px solid var(--line); border-radius:16px; padding:16px; white-space:pre-wrap; word-break:break-word; font-size:14.5px;}
  .cta{display:block; text-align:center; text-decoration:none; font-weight:800; font-size:16px; padding:15px; border-radius:14px; background:var(--ink); color:#fff; margin:20px 0 8px;}
  .cta-note{text-align:center; font-size:13px; color:var(--slate); margin:0;}
  .closed{background:#FDEDEA; border:1px solid #F3D6D2; border-radius:12px; padding:12px 14px; font-weight:700; margin:10px 0;}
  .empty{background:#fff; border:1px dashed var(--line); border-radius:16px; padding:28px 16px; text-align:center; color:var(--slate);}
  .foot{margin-top:36px; padding-top:16px; border-top:1px solid var(--line); font-size:12.5px; color:var(--slate);}
  .foot a{margin-right:14px;}
`;

function page({ title, description, canonical, ogImage, noindex = false, body, jsonLd = null }) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${esc(canonical)}">`}
<meta property="og:type" content="website">
<meta property="og:site_name" content="IT Free">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:locale" content="ko_KR">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">
<meta name="theme-color" content="#0A1633">
<style>${STYLE}</style>
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body><div class="wrap">
  <div class="top">
    <a class="brand" href="/"><img src="/icons/icon-192.png" alt="">IT Free</a>
    <a class="top-cta" href="/?utm_source=jobpage&amp;utm_medium=organic">앱에서 열기</a>
  </div>
  ${body}
  <div class="foot">
    <a href="/jobs">전체 공고</a><a href="/company.html">사업자 정보</a><a href="/terms.html">이용약관</a><a href="/privacy.html">개인정보처리방침</a>
    <p>IT Free는 기술스택으로 IT 프리랜서와 기업을 연결하는 매칭 서비스입니다. © 마켓리어</p>
  </div>
</div></body>
</html>`;
}

function metaLine(j) {
  return [j.duty, j.grade, j.location && j.location !== '협의' ? j.location : null, j.period && j.period !== '협의' ? j.period : null]
    .filter(Boolean).map(esc).join(' · ');
}

// 공개 공고 목록
router.get('/jobs', async (req, res) => {
  const base = baseUrl(req);
  const jobs = await openJobs();
  const cards = jobs.map((j) => {
    const stack = parseList(j.stack_json).slice(0, 8);
    const meta = metaLine(j);
    return `<a class="card" href="/jobs/${j.id}">
      <h2>${esc(j.title)}<span class="dday">${esc(dDayLabel(j.deadline))}</span></h2>
      <div class="org">${esc(j.company_name || '기업 정보 비공개')}</div>
      ${stack.length ? `<ul class="chips">${stack.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
      ${meta ? `<div class="meta">${meta}</div>` : ''}
    </a>`;
  }).join('');
  res.set('Cache-Control', 'public, max-age=300');
  res.type('html').send(page({
    title: 'IT 프리랜서 프로젝트 공고 — IT Free',
    description: `지금 모집 중인 IT 프리랜서 프로젝트 공고 ${jobs.length}건. 기술스택·업무·등급별 프로젝트를 확인하고, 내 기술스택과 몇 % 맞는지 IT Free에서 바로 확인하세요.`,
    canonical: `${base}/jobs`,
    ogImage: `${base}/icons/og-itfree.png`,
    body: `<h1>모집 중인 IT 프로젝트</h1>
      <p class="sub">총 ${jobs.length}건 · 공고를 누르면 상세 내용을 볼 수 있어요. 지원과 추천 %는 IT Free 앱에서 확인할 수 있어요.</p>
      ${cards || '<div class="empty">지금 모집 중인 공고가 없어요.<br>새 공고가 올라오면 이곳에 표시돼요.</div>'}`,
  }));
});

// 공개 공고 상세
router.get('/jobs/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return next();
  const base = baseUrl(req);
  const j = await get(
    `SELECT j.*, c.name AS company_name FROM jobs j LEFT JOIN companies c ON c.user_id = j.company_id WHERE j.id = ?`,
    [id]
  );
  if (!j) {
    return res.status(404).type('html').send(page({
      title: '공고를 찾을 수 없어요 — IT Free',
      description: '삭제되었거나 없는 공고입니다.',
      canonical: `${base}/jobs`, ogImage: `${base}/icons/og-itfree.png`, noindex: true,
      body: '<h1>공고를 찾을 수 없어요</h1><p class="sub">삭제되었거나 없는 공고입니다.</p><a class="cta" href="/jobs">모집 중인 공고 보기</a>',
    }));
  }
  const open = isOpen(j);
  const stack = parseList(j.stack_json);
  const certs = parseList(j.certs_json);
  const org = j.company_name || '기업 정보 비공개';
  const rows = [
    ['업무', j.duty], ['등급', j.grade], ['기술스택', stack.join(', ')], ['자격증', certs.join(', ')],
    ['기간', j.period], ['단가', j.rate], ['근무 형태', j.work_type], ['근무지', j.location],
    ['마감', j.deadline ? `${j.deadline} (${dDayLabel(j.deadline)})` : '상시 채용'],
  ].filter(([, v]) => v && String(v).trim());
  const applyUrl = `/?go=jobDetail&p=${j.id}&utm_source=jobpage&utm_medium=organic&utm_campaign=job_${j.id}`;
  const summary = [stack.slice(0, 5).join(', '), j.duty, j.grade, j.location, j.period].filter((v) => v && v !== '협의').join(' · ');
  const description = `${org} · ${summary || 'IT 프로젝트'} — IT Free에서 내 기술스택과 몇 % 맞는지 확인하고 바로 지원하세요.`.slice(0, 200);

  // 구글 검색의 채용 정보용 구조화 데이터(JobPosting). 열려 있는 공고에만 넣습니다.
  let jsonLd = null;
  if (open) {
    const remote = /원격|재택/.test(j.location || '') || /원격|재택/.test(j.work_type || '');
    const region = String(j.location || '').trim().split(/\s+/)[0];
    jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: j.title,
      description: `<p>${esc(j.description || summary || j.title).replace(/\n/g, '<br>')}</p>`,
      datePosted: dateOnly(j.created_at) || todayKst(),
      employmentType: 'CONTRACTOR',
      hiringOrganization: { '@type': 'Organization', name: org },
      ...(j.deadline ? { validThrough: `${j.deadline}T23:59:59+09:00` } : {}),
      ...(remote
        ? { jobLocationType: 'TELECOMMUTE', applicantLocationRequirements: { '@type': 'Country', name: 'KR' } }
        : { jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressCountry: 'KR', ...(region && region !== '협의' ? { addressRegion: region } : {}) } } }),
      ...(stack.length ? { skills: stack.join(', ') } : {}),
      url: `${base}/jobs/${j.id}`,
    };
  }

  res.set('Cache-Control', 'public, max-age=300');
  res.type('html').send(page({
    title: `${j.title} — ${org} | IT Free`,
    description,
    canonical: `${base}/jobs/${j.id}`,
    ogImage: `${base}/icons/og-itfree.png`,
    noindex: !open,
    jsonLd,
    body: `<p class="sub" style="margin:0;"><a href="/jobs">← 전체 공고</a></p>
      <h1>${esc(j.title)}</h1>
      <div class="org">${esc(org)}${open ? `<span class="dday">${esc(dDayLabel(j.deadline))}</span>` : ''}</div>
      ${open ? '' : '<div class="closed">모집이 끝난 공고예요.</div>'}
      ${stack.length ? `<ul class="chips">${stack.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
      <table>${rows.map(([k, v]) => `<tr><td class="lbl">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
      ${j.description && j.description.trim() ? `<div class="desc">${esc(j.description.trim())}</div>` : ''}
      ${open
        ? `<a class="cta" href="${esc(applyUrl)}">IT Free에서 지원하기</a>
           <p class="cta-note">로그인하면 내 기술스택과 몇 % 맞는지 바로 보여드려요. 가입은 무료예요.</p>`
        : '<a class="cta" href="/jobs">모집 중인 다른 공고 보기</a>'}`,
  }));
});

// 검색엔진에 알려줄 주소 목록
router.get('/sitemap.xml', async (req, res) => {
  const base = baseUrl(req);
  const jobs = await openJobs();
  const urls = [
    { loc: `${base}/`, changefreq: 'weekly', priority: '1.0' },
    { loc: `${base}/jobs`, changefreq: 'daily', priority: '0.9' },
    ...jobs.map((j) => ({ loc: `${base}/jobs/${j.id}`, lastmod: dateOnly(j.created_at), changefreq: 'weekly', priority: '0.8' })),
    { loc: `${base}/company.html`, changefreq: 'yearly', priority: '0.3' },
    { loc: `${base}/terms.html`, changefreq: 'yearly', priority: '0.2' },
    { loc: `${base}/privacy.html`, changefreq: 'yearly', priority: '0.2' },
  ];
  res.set('Cache-Control', 'public, max-age=600');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>
`);
});

router.get('/robots.txt', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('text/plain').send(`User-agent: *
Allow: /
Disallow: /api/
Disallow: /uploads/

Sitemap: ${baseUrl(req)}/sitemap.xml
`);
});

module.exports = router;
