# STACKFIT 백엔드 (MVP API 서버)

프론트엔드 프로토타입(스택핏 앱)과 짝을 이루는 실제 백엔드입니다. Node.js 내장 `node:sqlite`만 사용해서
DB 서버 설치 없이 바로 실행됩니다. (Node 22.5 이상 필요)

## 1. 실행 방법

```bash
cd stackfit-backend
npm install
npm start
# → http://localhost:4000 에서 API 서버 실행
```

첫 실행 시 `data/stackfit.db` 파일이 자동 생성되고, 데모 데이터가 시드됩니다.
데모 데이터를 초기화하려면 `data/stackfit.db` 파일을 삭제한 뒤 다시 실행하세요.

### 데모 로그인 계정

| 역할 | 이메일 | 비밀번호 |
|---|---|---|
| 프리랜서 (이승학) | lee@stackfit.dev | demo1234 |
| 기업 (한빛시스템) | hr@hanbit.dev | demo1234 |

## 2. ERD (개체-관계 요약)

```
users 1───1 freelancer_profiles      users 1───1 companies
  │                                       │
  │ 1                                     │ 1
  │        ┌── applications ──┐           │
  ▼ N      ▼ N                │           ▼ N
 jobs ─────┴──────────────────┘        jobs.company_id
  │  (job_id, freelancer_id)
  │
  ├── saved_jobs (freelancer_id, job_id)
  ├── proposals  (company_id, freelancer_id, job_id?)
  ├── projects   (company_id, freelancer_id, job_id?)
  └── conversations ── messages (conversation_id, sender_id)

users ──< notifications (user_id)
```

- `users`: 로그인 계정, `role`로 프리랜서/기업 구분
- `freelancer_profiles` / `companies`: 역할별 부가 정보 (users와 1:1)
- `jobs`: 기업이 등록한 공고
- `applications`: 프리랜서 → 공고 지원 (job_id, freelancer_id 유니크)
- `saved_jobs`: 프리랜서의 공고 즐겨찾기
- `proposals`: 기업 → 프리랜서 제안
- `projects`: 매칭 성사 후 계약 진행 단계 (stage 1~4)
- `conversations` / `messages`: 기업↔프리랜서 채팅
- `notifications`: 사용자별 알림

전체 컬럼 정의는 [`schema.sql`](./schema.sql)을 참고하세요.

## 3. 매치율(스택매치) 계산 로직

`src/match.js` — 공고 요구 기술스택 대비 프리랜서 보유 기술스택의 겹치는 비율을 기본으로,
보유 스택이 요구 스택보다 넓으면 소폭 가점을 줍니다. 프론트엔드의 "스택매치 게이지"와 동일한 개념입니다.

## 4. API 명세

Base URL: `http://localhost:4000/api`
인증이 필요한 요청은 헤더에 `Authorization: Bearer <token>` 을 포함합니다.

### 인증
| Method | Path | 설명 |
|---|---|---|
| POST | /auth/signup | 회원가입 `{email, password, role, name?, companyName?}` |
| POST | /auth/login | 로그인 `{email, password}` → `{token, user}` |
| GET | /auth/me | 내 계정 정보 (인증 필요) |

### 프로필
| Method | Path | 설명 |
|---|---|---|
| GET | /profile | 내 프로필 조회 (역할에 따라 프리랜서/기업, `resume_url` 포함) |
| PUT | /profile | 내 프로필 수정 (`stack`은 문자열 배열) |
| POST | /profile/resume | 경력기술서 PDF 업로드 (`multipart/form-data`, 필드명 `resume`, 최대 8MB, 프리랜서 전용) |
| DELETE | /profile/resume | 경력기술서 삭제 (프리랜서 전용) |

업로드된 파일은 `/uploads/파일명.pdf` 로 정적 제공됩니다 (`http://<서버주소>/uploads/...`, `/api` 접두어 없음에 유의).

### 공고
| Method | Path | 설명 |
|---|---|---|
| GET | /jobs?q=&category= | 공고 목록 (검색/카테고리 필터, 로그인 시 매치율·지원여부 포함) |
| GET | /jobs/:id | 공고 상세 |
| POST | /jobs | 공고 등록 (기업 전용) |
| POST | /jobs/:id/save | 공고 즐겨찾기 토글 (프리랜서 전용) |
| POST | /jobs/:id/apply | 공고 지원 (프리랜서 전용) |
| GET | /jobs/:id/applicants | 지원자 목록 (기업 전용, 본인 공고만, `resume_url` 포함) |
| PATCH | /jobs/:jobId/applicants/:applicationId | 지원 수락/거절 `{status: 'accepted'|'rejected'}` (기업 전용). 수락 시 `projects`에 자동으로 계약 건이 생성됩니다. |
| GET | /me/applications | 내가 지원한 공고 목록 (프리랜서 전용) |

### 인재풀 (기업 전용)
| Method | Path | 설명 |
|---|---|---|
| GET | /talents?q=&category=&jobId= | 인재 목록 (jobId 지정 시 해당 공고 기준 매치율) |
| GET | /talents/:userId | 인재 상세 |
| POST | /talents/:userId/propose | 제안 보내기 `{jobId?}` |

### 프로젝트
| Method | Path | 설명 |
|---|---|---|
| GET | /projects | 내 프로젝트 목록 (역할에 따라 자동 필터) |
| PATCH | /projects/:id/stage | 진행 단계 변경 `{stage: 1~4}` |

### 채팅
| Method | Path | 설명 |
|---|---|---|
| GET | /conversations | 내 대화 목록 (마지막 메시지·안읽음 수 포함) |
| POST | /conversations | 대화 시작/재사용 `{companyId 또는 freelancerId, jobId?}` |
| GET | /conversations/:id/messages | 메시지 목록 |
| POST | /conversations/:id/messages | 메시지 전송 `{body}` |

### 알림
| Method | Path | 설명 |
|---|---|---|
| GET | /notifications | 내 알림 목록 |
| PATCH | /notifications/:id/read | 알림 읽음 처리 |
| PATCH | /notifications/read-all | 전체 읽음 처리 |

## 5. 프론트엔드 프로토타입과 연결하기

기존 `stackfit-app.html`은 브라우저 메모리에만 데이터를 저장하는 목업입니다.
이 백엔드와 연결하려면 각 액션 함수(`applyToJob`, `sendMessage`, `postJob` 등)에서
`db.xxx` 배열을 직접 조작하는 대신 위 API를 `fetch`로 호출하도록 교체하면 됩니다.
CORS는 모든 origin에 대해 열려 있어(`Access-Control-Allow-Origin: *`) 별도 설정 없이 바로 호출 가능합니다.

## 6. 클라우드 배포

PC를 계속 켜둘 필요 없이 어디서나 접속하려면 [`DEPLOY.md`](./DEPLOY.md)를 참고하세요. Docker 이미지(`Dockerfile`)와
Render.com용 `render.yaml`이 포함되어 있어 바로 배포할 수 있습니다.

## 7. 데이터 영구 저장 (PostgreSQL)

`DATABASE_URL` 환경변수가 설정되어 있으면 자동으로 PostgreSQL을 사용합니다 (설정 안 하면 로컬 SQLite로 동작 — 로컬 개발용).
Render에 배포된 버전은 Render의 관리형 PostgreSQL(`stackfit-db`)에 연결되어 있어, 서버가 재배포/재시작되어도
가입한 계정·공고·채팅 등 데이터가 사라지지 않습니다.

⚠️ **Render 무료 PostgreSQL은 생성 후 30일이 지나면 만료되어 삭제됩니다.** 계속 쓰려면 만료 전에
Render 대시보드에서 유료 플랜으로 업그레이드하거나, 새 무료 DB를 만들어 `DATABASE_URL`을 갱신해야 합니다.

업로드된 이력서 PDF(`uploads/` 폴더)는 여전히 로컬 디스크에 저장되므로, 무료 플랜에서는 재배포 시 유실될 수 있습니다.
완전한 영구 저장이 필요하면 S3 등 오브젝트 스토리지 연동을 다음 단계로 고려하세요.

## 8. 콜드스타트 완화 (GitHub Actions)

`.github/workflows/keep-alive.yml`이 10분마다 `/api/health`를 호출해서 Render 무료 플랜이 잠들지 않게 합니다.
GitHub 저장소에 push되어 있기만 하면 별도 설정 없이 자동으로 동작합니다 (Actions 탭에서 실행 기록 확인 가능).
그래도 완전히 잠드는 걸 막지는 못할 수 있어(예: GitHub Actions 자체 지연), 100% 확실한 해결책은 유료 플랜(Starter 이상, 상시 구동)입니다.

## 9. 알려진 제한사항 (다음 단계 후보)

- 토큰 구현이 경량 HMAC 방식입니다. 운영 배포 전 검증된 JWT 라이브러리 사용을 권장합니다.
- 업로드 파일(이력서 PDF)은 아직 오브젝트 스토리지로 옮기지 않았습니다 (위 7번 참고).
- 결제/정산 연동, 실시간 채팅(WebSocket, 현재는 폴링 방식)은 아직 포함되어 있지 않습니다.
