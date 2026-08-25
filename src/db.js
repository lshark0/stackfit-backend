const fs = require('fs');
const path = require('path');
const { hashPassword } = require('./auth');

const USE_POSTGRES = !!process.env.DATABASE_URL;

let run, get, all, initDb;

if (USE_POSTGRES) {
  // ---------- PostgreSQL (영구 저장, 운영/배포용) ----------
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  function toPgQuery(sql) {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  }

  async function query(sql, params = []) {
    return pool.query(toPgQuery(sql), params);
  }

  // id 대신 user_id를 기본키로 쓰는 테이블은 RETURNING id를 붙이면 안 됩니다.
  const NO_ID_TABLES = ['freelancer_profiles', 'companies'];
  function targetTable(sql) {
    const m = sql.match(/insert\s+into\s+([a-zA-Z_]+)/i);
    return m ? m[1] : null;
  }

  run = async (sql, params = []) => {
    const isInsert = /^\s*insert/i.test(sql);
    const hasReturning = /returning/i.test(sql);
    const skip = isInsert && NO_ID_TABLES.includes(targetTable(sql));
    const text = isInsert && !hasReturning && !skip ? `${sql} RETURNING id` : sql;
    const res = await query(text, params);
    return {
      lastInsertRowid: isInsert && !skip && res.rows[0] ? res.rows[0].id : undefined,
      changes: res.rowCount,
    };
  };
  get = async (sql, params = []) => {
    const res = await query(sql, params);
    return res.rows[0];
  };
  all = async (sql, params = []) => {
    const res = await query(sql, params);
    return res.rows;
  };

  initDb = async () => {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'schema-postgres.sql'), 'utf8');
    await pool.query(schema);
    await ensureColumnPg('freelancer_profiles', 'resume_filename', 'TEXT');
    await ensureColumnPg('freelancer_profiles', 'resume_original_name', 'TEXT');
    await ensureColumnPg('jobs', 'deadline', 'TEXT');
    await ensureColumnPg('users', 'oauth_provider', 'TEXT');
    await ensureColumnPg('users', 'oauth_id', 'TEXT');
    await seed();
    console.log('[stackfit] PostgreSQL 연결 및 스키마 준비 완료 (영구 저장)');
  };

  async function ensureColumnPg(table, column, ddl) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${ddl}`);
  }
} else {
  // ---------- SQLite (로컬 개발용, 데이터는 컨테이너/디스크가 살아있는 동안만 유지) ----------
  const { DatabaseSync } = require('node:sqlite');

  const DATA_DIR = path.join(__dirname, '..', 'data');
  const DB_PATH = path.join(DATA_DIR, 'stackfit.db');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const isNew = !fs.existsSync(DB_PATH);

  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA foreign_keys = ON;');

  run = async (sql, params = []) => db.prepare(sql).run(...params);
  get = async (sql, params = []) => db.prepare(sql).get(...params);
  all = async (sql, params = []) => db.prepare(sql).all(...params);

  initDb = async () => {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    db.exec(schema);
    try { db.exec('ALTER TABLE freelancer_profiles ADD COLUMN resume_filename TEXT'); } catch (e) {}
    try { db.exec('ALTER TABLE freelancer_profiles ADD COLUMN resume_original_name TEXT'); } catch (e) {}
    try { db.exec('ALTER TABLE jobs ADD COLUMN deadline TEXT'); } catch (e) {}
    try { db.exec('ALTER TABLE users ADD COLUMN oauth_provider TEXT'); } catch (e) {}
    try { db.exec('ALTER TABLE users ADD COLUMN oauth_id TEXT'); } catch (e) {}
    if (isNew) await seed();
    console.log('[stackfit] SQLite 로컬 DB 준비 완료 (data/stackfit.db, 로컬 개발 전용)');
  };
}

async function seed() {
  const demoUser = await get("SELECT id FROM users WHERE email = 'lee@stackfit.dev'");
  if (demoUser) {
    const hasProfile = await get('SELECT 1 AS ok FROM freelancer_profiles WHERE user_id = ?', [demoUser.id]);
    if (hasProfile) return; // 이미 정상적으로 시드된 상태
  }

  // 이전 시도가 중간에 실패해 일부 데이터만 남아있을 수 있으므로, 재시드 전에 깨끗이 비웁니다.
  const tablesInOrder = [
    'messages', 'conversations', 'notifications', 'projects',
    'proposals', 'saved_jobs', 'applications', 'jobs',
    'freelancer_profiles', 'companies', 'users',
  ];
  for (const t of tablesInOrder) {
    await run(`DELETE FROM ${t}`);
  }

  const mkUser = async (email, password, role) => {
    const { hash, salt } = hashPassword(password);
    const r = await run(
      'INSERT INTO users (email, password_hash, password_salt, role) VALUES (?,?,?,?)',
      [email, hash, salt, role]
    );
    return Number(r.lastInsertRowid);
  };

  const freelancers = [
    { email: 'lee@stackfit.dev', pw: 'demo1234', name: '이승학', role_title: '인프라 아키텍트', years: '26년차', rate: '희망 600만원/월', stack: ['AWS', 'Kubernetes', 'VMware', '스토리지설계'], verified: 1, summary: '공공/금융/제조 전 영역 인프라 설계 경험. 서버·스토리지 등급분류 및 DR 설계 다수 수행.' },
    { email: 'park@stackfit.dev', pw: 'demo1234', name: '박OO', role_title: '클라우드 엔지니어', years: '9년차', rate: '희망 480만원/월', stack: ['AWS', 'Terraform', 'OpenShift'], verified: 1, summary: '클라우드 네이티브 전환 프로젝트 리드 경험. Kubernetes 운영 자동화 전문.' },
    { email: 'lee2@stackfit.dev', pw: 'demo1234', name: '이OO', role_title: 'DBA / 데이터베이스', years: '14년차', rate: '희망 520만원/월', stack: ['Oracle', 'GoldenGate', 'MariaDB'], verified: 0, summary: '금융권 액티브-액티브 DB 구성 및 복제 운영 경험 보유.' },
    { email: 'choi@stackfit.dev', pw: 'demo1234', name: '최OO', role_title: '보안 컨설턴트', years: '11년차', rate: '희망 500만원/월', stack: ['정보보호', '감리', 'ISMS'], verified: 1, summary: '공공기관 정보보호 감리 및 ISMS-P 인증 컨설팅 다수 수행.' },
  ];
  const freelancerIds = [];
  for (const f of freelancers) {
    const uid = await mkUser(f.email, f.pw, 'freelancer');
    await run(
      'INSERT INTO freelancer_profiles (user_id, name, role_title, years, rate, stack_json, summary, verified, completion) VALUES (?,?,?,?,?,?,?,?,?)',
      [uid, f.name, f.role_title, f.years, f.rate, JSON.stringify(f.stack), f.summary, f.verified, 55 + f.stack.length * 5 + f.verified * 10]
    );
    freelancerIds.push(uid);
  }

  const companies = [
    { email: 'hr@hanbit.dev', pw: 'demo1234', name: '㈜한빛시스템', person: '채용 담당자', desc: '공공/금융 인프라 SI 전문 기업' },
    { email: 'hr@dfl.dev', pw: 'demo1234', name: '디지털파이낸스랩', person: '인사팀', desc: '금융 IT 솔루션 개발사' },
  ];
  const companyIds = [];
  for (const c of companies) {
    const uid = await mkUser(c.email, c.pw, 'company');
    await run('INSERT INTO companies (user_id, name, contact_person, description) VALUES (?,?,?,?)', [uid, c.name, c.person, c.desc]);
    companyIds.push(uid);
  }

  const jobs = [
    { company: 0, title: '공공기관 클라우드 전환 인프라 아키텍트', stack: ['AWS', 'Kubernetes', 'VMware', '인프라설계'], period: '6개월', rate: '600만원/월', work_type: '상주 · 주5일', location: '서울 종로', category: '인프라', description: '공공/금융권 인프라 운영 경험이 있는 아키텍트를 찾고 있습니다. 서버·스토리지 등급 분류, DR 설계, OS/미들웨어 업그레이드 계획 수립 업무를 함께 수행할 파트너를 모십니다.' },
    { company: 1, title: '금융권 스토리지 이중화 및 DR 설계', stack: ['Storage', 'DR설계', 'GoldenGate'], period: '4개월', rate: '550만원/월', work_type: '상주 · 주3일', location: '서울 여의도', category: '인프라', description: 'Active-Active/Standby DR 아키텍처 설계 및 복제 전략 수립 경험자를 찾습니다.' },
    { company: 0, title: 'OpenShift 기반 CMP 운영 엔지니어', stack: ['OpenShift', 'Kubernetes', 'MariaDB'], period: '12개월', rate: '520만원/월', work_type: '원격 가능', location: '원격', category: '클라우드', description: 'CMP 운영 및 장애 대응, 클러스터 관리를 담당할 엔지니어를 찾습니다.' },
    { company: 1, title: '정보시스템 감리 보조 컨설턴트', stack: ['감리', '문서화', '인프라설계'], period: '3개월', rate: '480만원/월', work_type: '상주 · 주5일', location: '세종', category: '인프라', description: '공공기관 정보시스템 감리 보조 업무를 수행할 컨설턴트를 모십니다.' },
  ];
  const jobIds = [];
  for (const j of jobs) {
    const r = await run(
      'INSERT INTO jobs (company_id, title, stack_json, period, rate, work_type, location, category, description) VALUES (?,?,?,?,?,?,?,?,?)',
      [companyIds[j.company], j.title, JSON.stringify(j.stack), j.period, j.rate, j.work_type, j.location, j.category, j.description]
    );
    jobIds.push(Number(r.lastInsertRowid));
  }

  await run(
    'INSERT INTO projects (job_id, company_id, freelancer_id, title, rate, period, status, stage) VALUES (?,?,?,?,?,?,?,?)',
    [jobIds[0], companyIds[0], freelancerIds[0], '국민신문고 인프라 아키텍처 설계', '600만원/월', '2026.06 - 2026.12', '진행중', 2]
  );
  await run(
    'INSERT INTO projects (job_id, company_id, freelancer_id, title, rate, period, status, stage) VALUES (?,?,?,?,?,?,?,?)',
    [null, companyIds[1], freelancerIds[0], 'CMP 3.0.5 고도화 운영 지원', '520만원/월', '2025.11 - 2026.03', '완료', 4]
  );

  const convR = await run(
    'INSERT INTO conversations (company_id, freelancer_id, job_id) VALUES (?,?,?)',
    [companyIds[0], freelancerIds[0], jobIds[0]]
  );
  const convId = Number(convR.lastInsertRowid);
  const msgs = [
    [companyIds[0], '안녕하세요, 프로필 잘 보았습니다. 인프라 아키텍처 설계 경험이 인상적이네요.'],
    [freelancerIds[0], '안녕하세요! 관심 가져주셔서 감사합니다. 편하실 때 프로젝트 상세 공유 부탁드립니다.'],
    [companyIds[0], '네, 다음주 화요일 오후 2시 미팅 가능하신가요?'],
  ];
  for (const [sender, body] of msgs) {
    await run('INSERT INTO messages (conversation_id, sender_id, body) VALUES (?,?,?)', [convId, sender, body]);
  }

  const alerts = [
    ['제안', '새로운 제안이 도착했어요', '한빛시스템에서 인프라 아키텍트 포지션을 제안했습니다.'],
    ['매칭', '공고 매칭률 갱신', '스토리지 이중화 프로젝트 매칭률이 갱신됐어요.'],
    ['정산', '정산 예정 안내', '국민권익위원회 프로젝트 8월 정산이 3일 후 예정되어 있어요.'],
  ];
  for (const [tag, title, body] of alerts) {
    await run('INSERT INTO notifications (user_id, tag, title, body) VALUES (?,?,?,?)', [freelancerIds[0], tag, title, body]);
  }

  console.log('[stackfit] 데모 데이터 시드 완료');
  console.log('[stackfit] 데모 로그인 — 프리랜서: lee@stackfit.dev / demo1234, 기업: hr@hanbit.dev / demo1234');
}

module.exports = { run, get, all, initDb, USE_POSTGRES };
