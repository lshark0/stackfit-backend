-- STACKFIT DB 스키마 (PostgreSQL)
-- schema.sql(SQLite)과 동일한 구조를 PostgreSQL 문법으로 이식한 버전입니다.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('freelancer','company')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS freelancer_profiles (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  role_title  TEXT NOT NULL DEFAULT '',
  years       TEXT NOT NULL DEFAULT '',
  rate        TEXT NOT NULL DEFAULT '',
  stack_json  TEXT NOT NULL DEFAULT '[]',
  summary     TEXT NOT NULL DEFAULT '',
  verified    INTEGER NOT NULL DEFAULT 0,
  completion  INTEGER NOT NULL DEFAULT 50,
  resume_filename TEXT,
  resume_original_name TEXT
);

CREATE TABLE IF NOT EXISTS companies (
  user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  contact_person  TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS jobs (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  stack_json  TEXT NOT NULL DEFAULT '[]',
  period      TEXT NOT NULL DEFAULT '협의',
  rate        TEXT NOT NULL DEFAULT '협의',
  work_type   TEXT NOT NULL DEFAULT '협의',
  location    TEXT NOT NULL DEFAULT '협의',
  category    TEXT NOT NULL DEFAULT '인프라',
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS applications (
  id            SERIAL PRIMARY KEY,
  job_id        INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  freelancer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','accepted','rejected')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_id, freelancer_id)
);

CREATE TABLE IF NOT EXISTS saved_jobs (
  id            SERIAL PRIMARY KEY,
  freelancer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id        INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(freelancer_id, job_id)
);

CREATE TABLE IF NOT EXISTS proposals (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  freelancer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id        INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','accepted','declined')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id            SERIAL PRIMARY KEY,
  job_id        INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  company_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  freelancer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  rate          TEXT NOT NULL DEFAULT '협의',
  period        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT '진행중' CHECK (status IN ('진행중','완료','중단')),
  stage         INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversations (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  freelancer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id        INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, freelancer_id, job_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id              SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag         TEXT NOT NULL DEFAULT '알림',
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  is_read     INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company_id);
CREATE INDEX IF NOT EXISTS idx_applications_job ON applications(job_id);
CREATE INDEX IF NOT EXISTS idx_applications_freelancer ON applications(freelancer_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
