-- STACKFIT DB 스키마 (PostgreSQL)
-- schema.sql(SQLite)과 동일한 구조를 PostgreSQL 문법으로 이식한 버전입니다.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('freelancer','company')),
  oauth_provider TEXT,
  oauth_id       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS freelancer_profiles (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  role_title  TEXT NOT NULL DEFAULT '',
  years       TEXT NOT NULL DEFAULT '',
  rate        TEXT NOT NULL DEFAULT '',
  stack_json  TEXT NOT NULL DEFAULT '[]',
  certs_json  TEXT NOT NULL DEFAULT '[]',   -- 보유 자격증 목록
  summary     TEXT NOT NULL DEFAULT '',
  verified    INTEGER NOT NULL DEFAULT 0,
  completion  INTEGER NOT NULL DEFAULT 20,
  resume_filename TEXT,
  resume_original_name TEXT,
  resume_data BYTEA,
  grade       TEXT
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
  deadline    TEXT,
  duty        TEXT,
  grade       TEXT,
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
  decline_reason TEXT,                            -- 프리랜서가 거절한 사유
  responded_at   TEXT,                            -- 수락/거절한 시각
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
  stage         INTEGER NOT NULL DEFAULT 1,   -- 1:계약체결 2:프로젝트진행 3:최종정산
  company_agreed    INTEGER NOT NULL DEFAULT 0,
  freelancer_agreed INTEGER NOT NULL DEFAULT 0,
  contract_filename      TEXT,
  contract_original_name TEXT,
  contract_data          BYTEA,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversations (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  freelancer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id        INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  company_last_read_id    INTEGER NOT NULL DEFAULT 0,
  freelancer_last_read_id INTEGER NOT NULL DEFAULT 0,
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

-- 프로젝트 완료 후 기업↔프리랜서 상호 리뷰/평점 ("찾아줘 세무사" 스타일 신뢰도 지표)
CREATE TABLE IF NOT EXISTS reviews (
  id            SERIAL PRIMARY KEY,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reviewer_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewee_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, reviewer_id)
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

-- 잡코리아 스타일: 기업이 프리랜서 프로필을 열람한 기록 ("이력서 열람현황")
CREATE TABLE IF NOT EXISTS profile_views (
  id            SERIAL PRIMARY KEY,
  freelancer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 잡코리아 스타일: 프리랜서가 관심있는 기업을 즐겨찾기
CREATE TABLE IF NOT EXISTS followed_companies (
  id            SERIAL PRIMARY KEY,
  freelancer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(freelancer_id, company_id)
);

-- 이랜서 스타일: 프리랜서가 참여했던 프로젝트 이력(포트폴리오)
CREATE TABLE IF NOT EXISTS portfolios (
  id            SERIAL PRIMARY KEY,
  freelancer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  client        TEXT NOT NULL DEFAULT '',
  role_title    TEXT NOT NULL DEFAULT '',
  period        TEXT NOT NULL DEFAULT '',
  stack_json    TEXT NOT NULL DEFAULT '[]',
  description   TEXT NOT NULL DEFAULT '',
  link_url      TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company_id);
CREATE INDEX IF NOT EXISTS idx_applications_job ON applications(job_id);
CREATE INDEX IF NOT EXISTS idx_applications_freelancer ON applications(freelancer_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON reviews(reviewee_id);
CREATE INDEX IF NOT EXISTS idx_profile_views_freelancer ON profile_views(freelancer_id);
CREATE INDEX IF NOT EXISTS idx_followed_companies_freelancer ON followed_companies(freelancer_id);
CREATE INDEX IF NOT EXISTS idx_portfolios_freelancer ON portfolios(freelancer_id);

-- 웹 푸시 알림 구독 정보 (기기별로 하나씩 저장됨)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL UNIQUE,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 서버 설정 저장소 (푸시 인증키 등을 환경변수 없이 DB에 보관)
CREATE TABLE IF NOT EXISTS app_settings (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
