// 프리랜서 학력 — [{ school, degree, major, end: 'YYYY.MM', status }] 최대 6개.
// 상태는 '졸업'만 씁니다(2026-11-12 대표 결정: 재학·수료 등은 받지 않음).
// 화면(public/index.html의 EDU_DEGREES·EDU_STATUS)과 같은 값만 받습니다.
const EDU_DEGREES = ['고등학교', '전문학사', '학사', '석사', '박사'];
const EDU_STATUS = ['졸업'];

const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001F]/g, '').trim().slice(0, n);

// '2002-02', '2002.02', '200202' 모두 'YYYY.MM'으로. 잘못된 값은 ''.
function normalizeYm(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(d)) return '';
  const y = Number(d.slice(0, 4)), m = Number(d.slice(4, 6));
  if (y < 1950 || y > new Date().getFullYear() + 6 || m < 1 || m > 12) return '';
  return `${d.slice(0, 4)}.${d.slice(4, 6)}`;
}

function normalizeEducation(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((e) => ({
      school: clip(e && e.school, 60),
      degree: EDU_DEGREES.includes(e && e.degree) ? e.degree : '',
      major: clip(e && e.major, 60),
      end: normalizeYm(e && e.end),
      status: '졸업',
    }))
    .filter((e) => e.school)
    .slice(0, 6);
}

function parseEducation(json) {
  try { return normalizeEducation(JSON.parse(json || '[]')); } catch (e) { return []; }
}

module.exports = { EDU_DEGREES, EDU_STATUS, normalizeEducation, parseEducation };
