# 배포 가이드

PC를 계속 켜둘 필요 없이 클라우드에 올려서 어디서나 접속하는 방법입니다. 무료 플랜 기준으로 정리했어요.

## ⚠️ 먼저 알아둘 점 (중요)

이 백엔드는 데이터를 SQLite 파일(`data/stackfit.db`)과 업로드된 이력서(`uploads/`)에 **로컬 디스크**로 저장합니다.
Render·Railway의 **무료 플랜은 대부분 디스크가 영구저장되지 않아**, 서버가 재시작(배포, 슬립 후 깨어남 등)되면
데이터가 초기화될 수 있어요. 데모/테스트 용도로는 충분하지만, 실제 서비스로 운영하려면
① 유료 플랜의 영구 디스크를 쓰거나 ② PostgreSQL 같은 관리형 DB로 옮기는 걸 권장합니다
(`schema.sql`은 표준 SQL이라 대부분 그대로 이식 가능해요).

## 옵션 A — Render.com (Docker 배포, 가장 간단)

1. 이 `stackfit-backend` 폴더를 GitHub 저장소로 올립니다 (`git init` → `git add .` → `git commit` → GitHub에 push).
2. [render.com](https://render.com) 가입 후 **New → Blueprint** 선택, 방금 만든 저장소를 연결합니다.
3. 저장소에 포함된 `render.yaml`을 자동으로 인식해서 `stackfit-backend` 웹 서비스가 생성됩니다.
4. 빌드가 끝나면 `https://stackfit-backend-xxxx.onrender.com` 형태의 URL이 발급됩니다.
5. 프론트엔드 앱(`stackfit-app.html`)의 **⚙ 서버 연결 설정**에 `https://stackfit-backend-xxxx.onrender.com/api`를 입력하면 끝!

> 무료 플랜은 일정 시간 요청이 없으면 서버가 잠들었다가, 다음 요청 시 10~30초 정도 걸려 깨어납니다. 첫 요청이 느려도 정상입니다.

## 옵션 B — Railway.app

1. GitHub 저장소 준비는 Render와 동일합니다.
2. [railway.app](https://railway.app) 가입 → **New Project → Deploy from GitHub repo**.
3. Root Directory를 `stackfit-backend`로 지정합니다 (레포 최상위가 이 폴더라면 생략).
4. Settings → Variables에서 `JWT_SECRET` 값을 직접 추가합니다 (무작위 문자열).
5. Deploy 완료 후 발급된 도메인을 프론트엔드 서버 주소에 `.../api`를 붙여 입력합니다.

## 로컬 Docker로 먼저 테스트해보기

클라우드에 올리기 전에 배포 환경과 동일하게 로컬에서 검증할 수 있습니다.

```bash
cd stackfit-backend
docker build -t stackfit-backend .
docker run -p 4000:4000 -e JWT_SECRET=local-test-secret stackfit-backend
```

`http://localhost:4000/api/health`가 `{"ok":true}`를 반환하면 정상입니다.

## 배포 후 체크리스트

- [ ] `JWT_SECRET`을 무작위 값으로 설정했는지 (기본값 그대로 쓰지 말 것)
- [ ] `/api/health`가 정상 응답하는지
- [ ] 프론트엔드 서버 연결 설정에 `.../api`까지 포함해서 입력했는지 (health 경로 제외)
- [ ] 데모 계정(`lee@stackfit.dev`, `hr@hanbit.dev`)으로 로그인이 되는지
