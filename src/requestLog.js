// 보안 점검용 요청 기록(지시-016)
// Render는 이 서비스의 요청 로그를 제공하지 않아(로그 종류가 app·build뿐), 보안 점검 때 외부 공격 흔적을 볼 수 없었습니다.
// 그래서 실패·차단 응답(401·403·404·405·429·5xx)만 앱 로그에 한 줄씩 남깁니다. 정상 요청(2xx·3xx)은 남기지 않습니다.
//
// 개인정보 보호
//  - 쿼리 문자열은 남기지 않습니다(로그인 토큰 등이 들어갈 수 있음). 경로만 120자까지.
//  - IP는 서버 비밀값으로 만든 해시 앞 8자리만 남깁니다(같은 곳에서 온 요청인지만 알 수 있음).
//
// 로그 형식: [요청] 401 POST /api/auth/login ip=1a2b3c4d ua=Mozilla/5.0 …
// 공격으로 로그가 넘치지 않도록 1분에 최대 MAX_PER_MIN줄까지만 남기고, 넘친 건수는 상태 코드별로 한 줄에 요약합니다.
// 대량 404가 몰려도 401·403·405·429·5xx는 1분 PRIORITY_EXTRA줄까지 더 남겨 점검 때 놓치지 않게 합니다.
const crypto = require('crypto');

const LOG_STATUS = (s) => s === 401 || s === 403 || s === 404 || s === 405 || s === 429 || s >= 500;
const MAX_PER_MIN = 120;
const PRIORITY_EXTRA = 60;
const CTRL_RE = /[\u0000-\u001F\u007F]/g;

let windowStart = 0;
let count = 0;
let dropped = 0;
let extra = 0;
let droppedBy = {};

function ipTag(ip) {
  const key = process.env.JWT_SECRET || 'kimfree-request-log';
  return crypto.createHmac('sha256', key).update(String(ip || '').replace(/^::ffff:/, '')).digest('hex').slice(0, 8);
}

function allow(now, status) {
  if (now - windowStart >= 60 * 1000) {
    if (dropped) {
      const by = Object.keys(droppedBy).sort().map((k) => `${k}:${droppedBy[k]}`).join(' ');
      console.warn(`[요청] 직전 1분 동안 ${dropped}건은 기록을 생략했어요(1분 ${MAX_PER_MIN}줄 제한) 상태별 ${by}`);
    }
    windowStart = now; count = 0; dropped = 0; extra = 0; droppedBy = {};
  }
  if (count < MAX_PER_MIN) { count += 1; return true; }
  if (status !== 404 && extra < PRIORITY_EXTRA) { extra += 1; return true; }
  dropped += 1;
  const key = status >= 500 ? '5xx' : String(status);
  droppedBy[key] = (droppedBy[key] || 0) + 1;
  return false;
}

function line(req, status) {
  const path = String(req.originalUrl || req.url || '').split('?')[0].replace(CTRL_RE, '').slice(0, 120);
  const ua = String(req.get('user-agent') || '-').replace(CTRL_RE, '').slice(0, 80);
  return `[요청] ${status} ${req.method} ${path} ip=${ipTag(req.ip)} ua=${ua}`;
}

function requestLog(req, res, next) {
  res.on('finish', () => {
    const status = res.statusCode;
    if (!LOG_STATUS(status) || !allow(Date.now(), status)) return;
    (status >= 500 ? console.error : console.warn)(line(req, status));
  });
  next();
}

module.exports = { requestLog, ipTag, LOG_STATUS, _line: line };
