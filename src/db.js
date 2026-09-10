const fs = require('fs');
const path = require('path');

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

  // id 컬럼이 없는(다른 기본키를 쓰는) 테이블은 RETURNING id를 붙이면 안 됩니다.
  const NO_ID_TABLES = ['freelancer_profiles', 'companies', 'app_settings'];
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
    await ensureColumnPg('freelancer_profiles', 'resume_data', 'BYTEA');
    await ensureColumnPg('conversations', 'company_last_read_id', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumnPg('conversations', 'freelancer_last_read_id', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumnPg('projects', 'company_agreed', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumnPg('projects', 'freelancer_agreed', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumnPg('projects', 'contract_filename', 'TEXT');
    await ensureColumnPg('projects', 'contract_original_name', 'TEXT');
    await ensureColumnPg('projects', 'contract_data', 'BYTEA');
    await ensureColumnPg('proposals', 'status', "TEXT NOT NULL DEFAULT 'sent'");
    await ensureColumnPg('proposals', 'decline_reason', 'TEXT');
    await ensureColumnPg('proposals', 'responded_at', 'TEXT');
    await migrateProjectStages();
    await ensureColumnPg('jobs', 'deadline', 'TEXT');
    await ensureColumnPg('jobs', 'duty', 'TEXT');
    await ensureColumnPg('jobs', 'grade', 'TEXT');
    await ensureColumnPg('freelancer_profiles', 'grade', 'TEXT');
    await ensureColumnPg('users', 'oauth_provider', 'TEXT');
    await ensureColumnPg('users', 'oauth_id', 'TEXT');
    await pool.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth ON users(oauth_provider, oauth_id) WHERE oauth_provider IS NOT NULL'
    );
    await removeDemoAccounts();
    await fixRoleToCompany('454145@hanmail.net');
    console.log('[김프리] PostgreSQL 연결 및 스키마 준비 완료 (영구 저장)');
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
    try { db.exec('ALTER TABLE freelancer_profiles ADD COLUMN resume_data BLOB'); } catch (e) {}
    try { db.exec('ALTER TABLE conversations ADD COLUMN company_last_read_id INTEGER NOT NULL DEFAULT 0'); } catch (e) {}
    try { db.exec('ALTER TABLE conversations ADD COLUMN freelancer_last_read_id INTEGER NOT NULL DEFAULT 0'); } catch (e) {}
    try { db.exec('ALTER TABLE projects ADD COLUMN company_agreed INTEGER NOT NULL DEFAULT 0'); } catch (e) {}
    try { db.exec('ALTER TABLE projects ADD COLUMN freelancer_agreed INTEGER NOT NULL DEFAULT 0'); } catch (e) {}
    try { db.exec('ALTER TABLE projects ADD COLUMN contract_filename TEXT'); } catch (e) {}
    try { db.exec('ALTER TABLE projects ADD COLUMN contract_original_name TEXT'); } catch (e) {}
    try { db.exec('ALTER TABLE projects ADD COLUMN contract_data BLOB'); } catch (e) {}
    try { db.exec("ALTER TABLE proposals ADD COLUMN status TEXT NOT NULL DEFAULT 'sent'"); } catch (e) {}
    try { db.exec('ALTER TABLE proposals ADD COLUMN decline_reason TEXT'); } catch (e) {}
    try { db.exec('ALTER TABLE proposals ADD COLUMN responded_at TEXT'); } catch (e) {}
    await migrateProjectStages();
    try { db.exec('ALTER TABLE jobs ADD COLUMN deadline TEXT'); } catch (e) {}
    try { db.exec('ALTER TABLE jobs ADD COLUMN duty TEXT'); } catch (e) {}
    try { db.exec('ALTER TABLE jobs ADD COLUMN grade TEXT'); } catch (e) {}
    try { db.exec('ALTER TABLE freelancer_profiles ADD COLUMN grade TEXT'); } catch (e) {}
    try { db.exec('ALTER TABLE users ADD COLUMN oauth_provider TEXT'); } catch (e) {}
    try { db.exec('ALTER TABLE users ADD COLUMN oauth_id TEXT'); } catch (e) {}
    try {
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth ON users(oauth_provider, oauth_id) WHERE oauth_provider IS NOT NULL');
    } catch (e) {}
    await removeDemoAccounts();
    await fixRoleToCompany('454145@hanmail.net');
    console.log('[김프리] SQLite 로컬 DB 준비 완료 (data/stackfit.db, 로컬 개발 전용)');
  };
}

// 프로젝트 단계를 4단계(계약체결/계약금정산/진행/최종정산)에서
// 3단계(계약체결/프로젝트진행/최종정산)로 한 번만 변환합니다.
// 계약금은 실제로 지급되지 않고 다음 달부터 월 정산이 시작되므로 '계약금 정산' 단계를 없앴습니다.
async function migrateProjectStages() {
  try {
    const done = await get("SELECT value FROM app_settings WHERE key = 'stage_v3_migrated'");
    if (done) return;
    // 1,2 → 1(계약 체결) / 3 → 2(프로젝트 진행) / 4 → 3(최종 정산)
    await run('UPDATE projects SET stage = 1 WHERE stage <= 2');
    await run('UPDATE projects SET stage = 2 WHERE stage = 3');
    await run('UPDATE projects SET stage = 3 WHERE stage = 4');
    // 이미 완료된 프로젝트는 양측이 계약에 동의한 것으로 간주합니다.
    await run("UPDATE projects SET company_agreed = 1, freelancer_agreed = 1 WHERE stage >= 2 OR status = '완료'");
    await run('INSERT INTO app_settings (key, value) VALUES (?,?)', ['stage_v3_migrated', '1']);
    console.log('[김프리] 프로젝트 단계를 3단계 체계로 변환했습니다.');
  } catch (e) {
    console.warn('[김프리] 프로젝트 단계 변환 건너뜀:', e.message);
  }
}

async function removeDemoAccounts() {
  const demoEmails = [
    'lee@stackfit.dev', 'park@stackfit.dev', 'lee2@stackfit.dev', 'choi@stackfit.dev',
    'hr@hanbit.dev', 'hr@dfl.dev',
  ];
  for (const email of demoEmails) {
    const user = await get('SELECT id FROM users WHERE email = ?', [email]);
    if (user) {
      await run('DELETE FROM users WHERE id = ?', [user.id]); // 연관 데이터는 CASCADE로 함께 삭제됨
      console.log(`[김프리] 데모 계정 삭제: ${email}`);
    }
  }
}

// 일회성 보정: 가입 시 역할을 잘못 선택한 특정 계정을 기업으로 전환합니다.
// (이미 기업으로 되어있으면 아무 일도 하지 않아 반복 실행해도 안전합니다.)
async function fixRoleToCompany(email) {
  const user = await get('SELECT id, role FROM users WHERE email = ?', [email]);
  if (!user || user.role === 'company') return;

  const already = await get('SELECT user_id FROM companies WHERE user_id = ?', [user.id]);
  if (!already) {
    const fp = await get('SELECT name FROM freelancer_profiles WHERE user_id = ?', [user.id]);
    await run('INSERT INTO companies (user_id, name) VALUES (?,?)', [user.id, (fp && fp.name) || '회사명 미입력']);
  }
  await run('DELETE FROM freelancer_profiles WHERE user_id = ?', [user.id]);
  await run("UPDATE users SET role = 'company' WHERE id = ?", [user.id]);
  console.log(`[김프리] 계정 역할 보정: ${email} → company`);
}

module.exports = { run, get, all, initDb, USE_POSTGRES };
