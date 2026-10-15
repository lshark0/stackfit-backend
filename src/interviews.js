const { run, get, all } = require('./db');
const { addNotification, pushTo } = require('./notify');
const { maskContacts, isPairConnected } = require('./contactGuard');

// 채팅 중 잡는 인터뷰 일정. 시각은 한국시간 기준 'YYYY-MM-DD HH:MM' 문자열로 저장하고 비교합니다.
const MODES = { offline: '대면', online: '화상', phone: '전화' };
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const KST_MS = 9 * 3600 * 1000;

// 지금(또는 지금부터 offsetMin분 뒤)의 한국시간 'YYYY-MM-DD HH:MM'
function kstStamp(offsetMin = 0) {
  return new Date(Date.now() + KST_MS + offsetMin * 60000).toISOString().slice(0, 16).replace('T', ' ');
}

// 화면에서 받은 날짜·시간을 검사해 저장 형식으로 바꿉니다. 잘못되면 null.
function toInterviewAt(date, time) {
  const d = String(date || '').trim();
  const t = String(time || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(t)) return null;
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, day, hh, mm));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== day
    || probe.getUTCHours() !== hh || probe.getUTCMinutes() !== mm) return null;
  return `${d} ${t}`;
}

// '2026-10-12 21:30' → '10월 12일(월) 오후 9:30'
function formatKo(at) {
  const [d, t] = String(at).split(' ');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  const dow = DOW[new Date(Date.UTC(y, m - 1, day)).getUTCDay()];
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${m}월 ${day}일(${dow}) ${hh < 12 ? '오전' : '오후'} ${h12}:${String(mm).padStart(2, '0')}`;
}

function placeLabel(iv) {
  if (iv.mode === 'online') return '화상 인터뷰';
  if (iv.mode === 'phone') return '전화 인터뷰';
  return iv.place || '대면 인터뷰';
}

// 대화 상대와 내 이름(알림 문구용)
async function participants(conv, userId) {
  const meIsCompany = userId === conv.company_id;
  const me = meIsCompany
    ? await get('SELECT name FROM companies WHERE user_id = ?', [userId])
    : await get('SELECT name FROM freelancer_profiles WHERE user_id = ?', [userId]);
  return { counterpartId: meIsCompany ? conv.freelancer_id : conv.company_id, myName: (me && me.name) || '상대방' };
}

function publicView(iv) {
  if (!iv) return null;
  return {
    id: iv.id,
    interview_at: iv.interview_at,
    date: iv.interview_at.slice(0, 10),
    time: iv.interview_at.slice(11, 16),
    label: formatKo(iv.interview_at),
    mode: iv.mode,
    modeLabel: MODES[iv.mode] || '대면',
    place: iv.place,
    link: iv.link,
    note: iv.note,
    status: iv.status,
    created_by: iv.created_by,
    past: iv.interview_at < kstStamp(),
  };
}

async function getInterview(conversationId) {
  return publicView(await get('SELECT * FROM interviews WHERE conversation_id = ?', [conversationId]));
}

// 대화방에 인터뷰 카드 메시지를 남기고, 상대에게 알림·푸시를 보냅니다.
async function announce(conv, userId, iv, action) {
  const verb = { created: '잡았어요', updated: '변경했어요', cancelled: '취소했어요' }[action];
  const body = action === 'cancelled'
    ? `📅 인터뷰 취소: ${formatKo(iv.interview_at)}`
    : `📅 인터뷰 일정: ${formatKo(iv.interview_at)} · ${placeLabel(iv)}`;
  const meta = {
    action, interview_at: iv.interview_at, mode: iv.mode, place: iv.place,
    link: iv.link, note: iv.note,
  };
  await run('INSERT INTO messages (conversation_id, sender_id, body, kind, meta_json) VALUES (?,?,?,?,?)',
    [conv.id, userId, body, 'interview', JSON.stringify(meta)]);

  const { counterpartId, myName } = await participants(conv, userId);
  const title = `${myName}님이 인터뷰 일정을 ${verb}`;
  const detail = action === 'cancelled' ? formatKo(iv.interview_at) : `${formatKo(iv.interview_at)} · ${placeLabel(iv)}`;
  await addNotification(counterpartId, { tag: '인터뷰', title, body: detail.slice(0, 80), link: `chatRoom:${conv.id}` });
  pushTo(counterpartId, { kind: 'chat', title: `📅 ${title}`, body: detail.slice(0, 100), tag: `interview-${conv.id}`, link: `chatRoom:${conv.id}` });
}

// 인터뷰 잡기·변경. 잘못된 값이면 { error } 를 돌려줍니다.
async function saveInterview(conv, userId, input) {
  const at = toInterviewAt(input.date, input.time);
  if (!at) return { error: '날짜와 시간을 정확히 선택해주세요.' };
  if (at <= kstStamp()) return { error: '지난 시간으로는 인터뷰를 잡을 수 없어요.' };
  if (at > kstStamp(366 * 24 * 60)) return { error: '1년 이내의 날짜로 잡아주세요.' };

  const mode = MODES[input.mode] ? input.mode : 'offline';
  const placeRaw = String(input.place || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  let link = String(input.link || '').trim();
  let note = String(input.note || '').trim().slice(0, 300);
  // 매칭 전에는 메모·장소에 적은 연락처도 채팅과 똑같이 가립니다(직접 거래 방지).
  const connected = await isPairConnected(conv.company_id, conv.freelancer_id);
  if (!connected) note = maskContacts(note).text;
  const place = connected ? placeRaw : maskContacts(placeRaw).text;
  if (mode === 'offline' && !place) return { error: '인터뷰 장소를 입력해주세요.' };
  if (mode === 'online' && link && !connected && maskContacts(link).masked) {
    return { error: '메신저 링크는 제안 수락·합격 후에 공유할 수 있어요. 화상 회의 링크(Google Meet·Zoom 등)를 넣어주세요.' };
  }
  if (mode === 'online' && link) {
    // 화상 회의 링크는 https 주소만 받습니다(다른 형식의 링크로 앱 밖 실행을 유도하는 것 방지).
    let ok = false;
    try { const u = new URL(link); ok = u.protocol === 'https:' && !!u.hostname && link.length <= 300; } catch (e) { ok = false; }
    if (!ok) return { error: '화상 회의 링크는 https://로 시작하는 주소만 넣을 수 있어요.' };
  } else if (mode !== 'online') {
    link = '';
  }

  const existing = await get('SELECT * FROM interviews WHERE conversation_id = ?', [conv.id]);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const action = existing && existing.status === 'scheduled' ? 'updated' : 'created';
  if (existing) {
    if (existing.status === 'scheduled' && existing.interview_at === at && existing.mode === mode
      && existing.place === place && existing.link === link && existing.note === note) {
      return { interview: publicView(existing), unchanged: true };
    }
    // 시간이 바뀌면 1시간 전 알림을 다시 보낼 수 있게 reminded를 되돌립니다.
    await run(
      `UPDATE interviews SET interview_at=?, mode=?, place=?, link=?, note=?, status='scheduled', created_by=?,
         reminded = CASE WHEN interview_at = ? AND status = 'scheduled' THEN reminded ELSE 0 END, updated_at=? WHERE id=?`,
      [at, mode, place, link, note, userId, at, now, existing.id]
    );
  } else {
    try {
      await run(
        'INSERT INTO interviews (conversation_id, created_by, interview_at, mode, place, link, note) VALUES (?,?,?,?,?,?,?)',
        [conv.id, userId, at, mode, place, link, note]
      );
    } catch (e) {
      if (e && (e.code === '23505' || /UNIQUE/i.test(e.message || ''))) return { error: '방금 상대가 일정을 잡았어요. 화면을 새로고침해주세요.' };
      throw e;
    }
  }
  const saved = await get('SELECT * FROM interviews WHERE conversation_id = ?', [conv.id]);
  await announce(conv, userId, saved, action);
  return { interview: publicView(saved) };
}

async function cancelInterview(conv, userId) {
  const existing = await get('SELECT * FROM interviews WHERE conversation_id = ?', [conv.id]);
  if (!existing || existing.status !== 'scheduled') return { error: '취소할 인터뷰 일정이 없어요.' };
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await run("UPDATE interviews SET status='cancelled', updated_at=? WHERE id=?", [now, existing.id]);
  await announce(conv, userId, existing, 'cancelled');
  return { interview: publicView({ ...existing, status: 'cancelled' }) };
}

// 인터뷰 1시간 전 알림: 5분마다 확인하고, 양쪽 모두에게 한 번만 보냅니다.
async function sendInterviewReminders() {
  const rows = await all(
    `SELECT i.id, i.conversation_id, i.interview_at, i.mode, i.place, c.company_id, c.freelancer_id
     FROM interviews i JOIN conversations c ON c.id = i.conversation_id
     WHERE i.status = 'scheduled' AND i.reminded = 0 AND i.interview_at > ? AND i.interview_at <= ?`,
    [kstStamp(), kstStamp(60)]
  );
  for (const r of rows) {
    const claimed = await run('UPDATE interviews SET reminded = 1 WHERE id = ? AND reminded = 0', [r.id]);
    if (!claimed.changes) continue;
    const body = `${formatKo(r.interview_at)} · ${placeLabel(r)}`;
    for (const uid of [r.company_id, r.freelancer_id]) {
      await addNotification(uid, { tag: '인터뷰', title: '곧 인터뷰가 있어요', body, link: `chatRoom:${r.conversation_id}` });
      pushTo(uid, { kind: 'chat', title: '⏰ 1시간 뒤 인터뷰', body, tag: `interview-remind-${r.id}`, link: `chatRoom:${r.conversation_id}` });
    }
  }
}

module.exports = { getInterview, saveInterview, cancelInterview, sendInterviewReminders, toInterviewAt, formatKo, kstStamp };
