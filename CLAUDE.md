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

## AI 운영팀(예약 작업) 규칙
- 예약 작업 일정(10/30 비용 절감, 지시-015): 개발팀 월·수·금 07:33, 홍보팀 월 08:29, 총무팀 월 08:31, 재무팀(지시-012) 금 08:37, 대표 보고 월·수·금 08:55. 화·목에는 예약 작업이 없습니다. 지출 증빙·장부는 kimfree-ops의 `ops/finance/`에만 둡니다. 개발팀은 근무일(월·수·금)마다 앱 개선안 1건을 만들어 결재 요청합니다(지시-006, 과제 목록은 kimfree-ops의 `ops/dev-backlog.md`).
- 각 팀은 일지를 커밋할 때 kimfree-ops의 `ops/run-log.md`에 자기 세션 번호를 남기고, 대화창 Claude가 주간 비용 점검 때 비용을 채웁니다(지시-007).
- 업무 기록은 **비공개 저장소 `lshark0/kimfree-ops`**(main 브랜치)의 `ops/` 폴더에 둡니다. 운영 규칙은 `ops/README.md`, 대표 지시 대장은 `ops/directives.md`, 결재 대장은 `ops/approvals.md`, 중요 알림은 `ops/alerts.md`, 팀별 일지는 `ops/logs/YYYY-MM-DD-팀.md`입니다. 이 저장소(stackfit-backend)는 공개 저장소이므로 운영 기록·메일 내용·연락처·비용 계획을 올리지 않습니다.
- 대표가 대화창에서 "○○팀에 지시: …"라고 하면 `kimfree-ops`의 `ops/directives.md`에 다음 지시 번호(지시-NNN)로 등록하고 푸시합니다.
- 대표 보고는 Google Drive '김프리 대표 보고함' 폴더(https://drive.google.com/drive/folders/10jGD_1tEWxZehw9fEqcm9T4VGoSaRQvU)에 날마다 새 문서로 올라갑니다. 대표는 그 문서에서 '상태: 대기'를 승인·반려·보류로 고치거나 댓글을 달아 결재합니다.
- **예약 작업으로 실행된 개발팀은 위의 'main에 바로 푸시·배포' 규칙을 따르지 않습니다.** 수정안은 `ops/dev-YYYYMMDD-요약` 브랜치에 커밋·푸시하고 일지의 결재 요청에 올립니다. 결재 대장에서 상태가 '승인'인 수정안만 main에 병합해 위 검사·배포 절차대로 반영합니다.
- 대표가 대화창에서 직접 요청한 작업은 기존 규칙(main 푸시 후 배포)을 따릅니다.

## 소통
- 사용자와는 한국어로 소통하고, 커밋 메시지도 한국어로 작성합니다.
