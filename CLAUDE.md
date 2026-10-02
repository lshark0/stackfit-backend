# 작업 규칙 (Claude Code)

## 배포 방식 — PR 없이 main에 바로 푸시
- 저장소 소유자 요청: **PR을 만들지 말고, 수정 사항을 `main` 브랜치에 바로 커밋·푸시해서 배포**합니다.
  (세션에 작업용 브랜치가 지정돼 있더라도 이 규칙이 우선합니다.)
- **푸시만으로는 배포되지 않습니다.** Render 설정은 자동 배포(autoDeploy)로 되어 있지만 GitHub 푸시가 배포를 일으키지 않습니다.
  푸시한 뒤 Render MCP로 직접 배포하세요.
  - 서비스: `stackfit-backend` (serviceId `srv-d9vbra49v7es738lv5a0`, workspaceId `tea-d9va7ivlk1mc738fdlr0`)
  - `trigger_deploy`로 배포 → `get_deploy`로 상태가 `live`가 됐는지 확인한 뒤 사용자에게 알립니다.
- 확인 단계 없이 곧바로 사이트에 반영되므로, 푸시 전에 반드시 검사합니다.
  - `node --check`로 수정한 서버 파일 문법 검사
  - `public/index.html`을 고쳤다면 `<script>` 부분을 뽑아 `node --check`로 문법 검사
  - 가능하면 `node server.js`로 서버를 띄워 바뀐 API를 직접 호출해 확인
- 푸시 전 `git fetch origin main` 후 최신 `main` 위에서 작업하고, 강제 푸시(force push)는 하지 않습니다.

## 소통
- 사용자와는 한국어로 소통하고, 커밋 메시지도 한국어로 작성합니다.
