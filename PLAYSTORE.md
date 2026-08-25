# Google Play 스토어 등록 가이드

STACKFIT은 이미 PWA(설치 가능한 웹앱)이기 때문에, **네이티브 앱을 새로 만들 필요 없이** 지금 웹앱을
"TWA(Trusted Web Activity)"라는 방식으로 감싸서 Play 스토어에 올릴 수 있습니다. 코드 수정은 거의 없고,
Android Studio도 필요 없습니다 — 구글이 만든 무료 웹 도구 **PWABuilder**로 진행합니다.

## 준비물

- **Google Play 개발자 계정** ($25, 최초 1회만 결제하면 평생 사용) — https://play.google.com/console/signup
- 배포된 앱 주소: `https://stackfit-backend.onrender.com`
- 앱 아이콘은 이미 준비되어 있습니다 (`public/icons/`)

## 1단계 — PWABuilder로 Android 패키지(AAB) 만들기

1. https://www.pwabuilder.com 접속
2. 주소창에 `https://stackfit-backend.onrender.com` 입력 후 **Start**
3. PWABuilder가 manifest.json, 아이콘, 서비스워커를 자동으로 스캔합니다. 초록불이 대부분이면 정상입니다.
   (Service Worker 관련 경고가 떠도 진행에는 문제없습니다.)
4. **Package for stores** 클릭 → **Android** 선택
5. Package ID는 `com.stackfit.app` 추천 (원하는 값으로 바꿔도 됩니다. 한번 정하면 이후 변경 불가하니 신중히)
6. **Generate** 클릭하면 서명키(keystore)가 자동 생성되고, 잠시 후 `.aab` 파일과 `signing-key-info.txt`가 담긴 zip이 다운로드됩니다.
7. **`signing-key-info.txt`를 꼭 안전한 곳에 백업하세요.** 이 키를 잃어버리면 이후 앱 업데이트를 올릴 수 없습니다.

## 2단계 — 웹사이트 소유권 증명 (Digital Asset Links)

Play 스토어 앱이 우리 웹사이트를 "대신 보여주는" 것임을 구글에게 증명해야, 앱 실행 시 브라우저 주소창 없이
완전한 전체화면 앱처럼 보입니다 (이걸 안 하면 상단에 브라우저 주소창이 계속 보입니다).

1. 1단계에서 받은 zip 안의 `signing-key-info.txt`를 열어 **SHA256 fingerprint** 값을 복사합니다.
2. 저장소의 `public/.well-known/assetlinks.json` 파일을 열어, `sha256_cert_fingerprints` 안의
   플레이스홀더 문자열을 방금 복사한 값으로 교체합니다. `package_name`도 1단계에서 정한 Package ID와 일치해야 합니다.
3. 수정한 파일을 커밋 → push 하면 Render가 자동 배포하고,
   `https://stackfit-backend.onrender.com/.well-known/assetlinks.json`에서 바로 확인 가능합니다.
4. https://developers.google.com/digital-asset-links/tools/generator 에서 검증해볼 수 있습니다.

## 3단계 — Play Console에서 앱 등록

1. https://play.google.com/console 접속 → **앱 만들기**
2. 앱 이름: `스택핏` (또는 원하는 이름), 기본 언어: 한국어, 앱/게임: 앱, 무료/유료: 무료
3. **정책 → 개인정보처리방침** 항목에 아래 URL 입력 (이미 준비해뒀습니다):
   `https://stackfit-backend.onrender.com/privacy.html`
4. **프로덕션 → 새 버전 만들기**에서 1단계에서 받은 `.aab` 파일 업로드
5. **스토어 등록정보** 작성:
   - 짧은 설명 (80자 이내): "IT 프리랜서와 기업을 잇는 기술스택 매칭 플랫폼"
   - 자세한 설명, 스크린샷(휴대폰 화면 최소 2장, 실제 앱 화면 캡처하면 됩니다), 아이콘(512x512, `public/icons/icon-512.png` 사용 가능)
6. **콘텐츠 등급 설문** 작성 (앱 성격에 맞게 답변 — 채용/구인구직 카테고리는 대부분 "전체이용가"로 나옵니다)
7. **대상 층 및 콘텐츠**, **데이터 보안** 섹션에서 수집하는 개인정보 항목(이메일, 프로필 정보)을 사실대로 체크
8. 모든 섹션이 초록 체크로 바뀌면 **검토를 위해 제출**

## 4단계 — 심사 및 게시

- 심사는 보통 며칠~1~2주 정도 걸립니다 (첫 앱은 좀 더 걸릴 수 있음).
- 반려되면 사유가 이메일로 오는데, 대부분 개인정보처리방침 미비나 스크린샷 문제입니다.
- 승인되면 Play 스토어에 정식으로 노출되고, 이후 업데이트는 새 `.aab`를 다시 업로드하는 방식으로 진행합니다.

## 앱 업데이트 시 참고

- 웹앱 코드(프론트엔드)만 고치는 거라면 **Play 스토어에 새로 올릴 필요 없습니다.** TWA는 매번 실제 웹사이트를
  그대로 불러오기 때문에, `stackfit-backend.onrender.com`에 배포만 하면 기존에 설치된 앱에도 즉시 반영됩니다.
- Package ID, 앱 이름(패키지 레벨), 서명키를 바꾸는 경우에만 새 `.aab`를 다시 만들어 올려야 합니다.

## 대안: Bubblewrap CLI (더 세밀한 제어가 필요할 때)

PWABuilder 대신 커맨드라인 도구를 쓰고 싶다면 Android SDK/JDK 설치가 필요합니다:

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://stackfit-backend.onrender.com/manifest.json
bubblewrap build
```

일반적으로는 **PWABuilder 웹 도구가 훨씬 간단**하니 특별한 이유가 없다면 1~2단계 방식을 추천합니다.
