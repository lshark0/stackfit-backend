// 구인 기업의 사업자등록 확인 (직업안정법 시행령: 직업정보제공사업자는 구인광고를 의뢰한 구인자의 사업자등록 여부를 확인해야 함).
//  1) 사업자등록번호 형식·검증번호(체크섬) 확인 — 항상
//  2) 국세청 사업자등록 진위확인(공공데이터포털 API) — NTS_API_KEY 환경변수가 있을 때
//     사업자등록번호 + 대표자명 + 개업일자가 국세청 정보와 맞는지, 계속사업자인지(휴·폐업 아님) 확인합니다.
//  API 키가 없거나 국세청 서버가 응답하지 않으면 형식 확인만 하고 'format'으로 표시해, 나중에 다시 확인할 수 있게 둡니다.
const NTS_URL = 'https://api.odcloud.kr/api/nts-businessman/v1/validate';

const digitsOf = (v) => String(v || '').replace(/\D/g, '');
const formatBizNo = (d) => `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;

// 사업자등록번호 검증번호(마지막 자리) 계산
function checksumOk(d) {
  if (!/^\d{10}$/.test(d)) return false;
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * w[i];
  sum += Math.floor((Number(d[8]) * 5) / 10);
  return (10 - (sum % 10)) % 10 === Number(d[9]);
}

function normalizeStartDt(v) {
  const d = digitsOf(v);
  if (!/^\d{8}$/.test(d)) return null;
  const y = Number(d.slice(0, 4)), m = Number(d.slice(4, 6)), day = Number(d.slice(6));
  const dt = new Date(Date.UTC(y, m - 1, day));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== day) return null;
  if (y < 1950 || dt.getTime() > Date.now() + 86400000) return null;
  return d;
}

// 결과: { ok, method: 'nts'|'format', status, error, bizRegNo, startDt, ceoName }
async function verifyBusiness({ bizRegNo, ceoName, startDt }) {
  const d = digitsOf(bizRegNo);
  if (d.length !== 10) return { ok: false, error: '사업자등록번호 10자리를 정확히 입력해주세요.' };
  if (!checksumOk(d)) return { ok: false, error: '올바른 사업자등록번호가 아니에요. 번호를 다시 확인해주세요.' };
  const name = String(ceoName || '').trim().slice(0, 60);
  if (!name) return { ok: false, error: '대표자 성명을 입력해주세요.' };
  const start = normalizeStartDt(startDt);
  if (!start) return { ok: false, error: '개업일자를 정확히 입력해주세요. (예: 2021-03-23)' };
  const base = { bizRegNo: formatBizNo(d), ceoName: name, startDt: start };

  const key = process.env.NTS_API_KEY;
  if (!key) return { ...base, ok: true, method: 'format', status: '' };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${NTS_URL}?serviceKey=${encodeURIComponent(key)}&returnType=JSON`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ businesses: [{ b_no: d, start_dt: start, p_nm: name }] }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) throw new Error(`국세청 API ${res.status}`);
    const body = await res.json();
    const row = body && Array.isArray(body.data) ? body.data[0] : null;
    if (!row) throw new Error('국세청 API 응답 형식이 달라요');
    if (row.valid !== '01') {
      return { ok: false, error: '국세청 사업자 정보와 일치하지 않아요. 사업자등록번호·대표자 성명·개업일자를 사업자등록증과 똑같이 입력해주세요.' };
    }
    const st = row.status || {};
    if (st.b_stt_cd && st.b_stt_cd !== '01') {
      return { ok: false, error: `${st.b_stt || '휴업 또는 폐업'} 상태인 사업자는 공고를 등록할 수 없어요.` };
    }
    return { ...base, ok: true, method: 'nts', status: st.b_stt || '계속사업자' };
  } catch (e) {
    // 국세청 서버 장애로 공고 등록이 막히지 않도록, 형식 확인만 통과시키고 나중에 다시 확인합니다.
    console.warn('[IT Free] 국세청 사업자 진위확인 실패:', e.message);
    return { ...base, ok: true, method: 'format', status: '' };
  }
}

// 확인 결과를 기업 정보에 저장합니다.
async function saveBusiness(companyId, r) {
  const { run } = require('./db');
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await run('UPDATE companies SET biz_reg_no = ?, ceo_name = ?, biz_start_dt = ?, biz_check = ?, biz_status = ?, biz_verified_at = ? WHERE user_id = ?',
    [r.bizRegNo, r.ceoName, r.startDt, r.method, r.status || '', now, companyId]);
}
// 화면에 보여줄 확인 상태
function businessInfo(c) {
  return {
    verified: !!(c && c.biz_verified_at),
    method: (c && c.biz_check) || '',
    bizRegNo: (c && c.biz_reg_no) || '',
    ceoName: (c && c.ceo_name) || '',
    startDt: (c && c.biz_start_dt) || '',
    status: (c && c.biz_status) || '',
    verifiedAt: (c && c.biz_verified_at) || null,
  };
}

module.exports = { verifyBusiness, checksumOk, saveBusiness, businessInfo };
