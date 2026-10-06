# IT Free — Google Play 스토어 등록 가이드

IT Free는 이미 PWA(설치 가능한 웹앱)이므로, 네이티브 앱을 새로 만들지 않고
**TWA(Trusted Web Activity)** 방식으로 감싸서 Play 스토어에 올립니다.
Android Studio 없이 구글이 만든 무료 웹 도구 **PWABuilder**로 진행합니다.

- 배포 주소: `https://stackfit-backend.onrender.com`
- 권장 패키지 ID: **`com.markettier.itfree`** (한 번 정하면 영구히 변경 불가)
- 앱 아이콘: `public/icons/icon-512.png`

---

## 0단계 — 등록 전에 정할 것

| 항목 | 권장 | 이유 |
|---|---|---|
| 개발자 계정 | **조직(회사) 계정 — 마켓리어** | 개인 계정은 정식 출시 전에 **테스터 12명 이상이 14일 연속** 비공개 테스트를 해야 합니다. 조직 계정은 이 조건이 없고 스토어에 회사명이 표시됩니다. |
| 조직 계정 준비물 | **D-U-N-S 번호** | 무료 발급, 1~2주 소요 (한국평가데이터/dnb.co.kr). 사업자등록증, 회사 이메일·전화 필요 |
| 등록비 | $25 (1회) | |
| 서버 요금제 | Render **유료(Starter 이상)** | 무료 플랜은 15분간 접속이 없으면 서버가 잠들어 첫 실행에 30~50초가 걸립니다. 스토어 첫 리뷰가 "앱이 안 열린다"가 되기 쉽습니다. |

## 1단계 — Play Console 가입

1. https://play.google.com/console/signup → **조직** 선택 → D-U-N-S 번호 입력 → $25 결제
2. 본인·조직 인증(신분증, 사업자 정보)이 끝날 때까지 며칠 걸릴 수 있습니다.

## 2단계 — PWABuilder로 Android 패키지(.aab) 만들기

1. https://www.pwabuilder.com 에 `https://stackfit-backend.onrender.com` 입력 → **Start**
2. **Package for stores → Android → Generate Package**
3. 옵션
   - Package ID: `com.markettier.itfree`
   - App name: `IT Free` / Launcher name: `IT Free`
   - Signing key: **Create new** (자동 생성)
4. 다운로드된 zip 안의 `.aab`, `signing.keystore`, `signing-key-info.txt`를 **안전한 곳 2군데 이상에 백업**합니다.
   이 키를 잃어버리면 앱을 다시는 업데이트할 수 없습니다.

## 3단계 — Play Console에 앱 만들기 · 업로드

1. **앱 만들기** → 앱 이름 `IT Free`, 기본 언어 한국어, 앱, 무료
2. **테스트 → 내부 테스트 → 새 버전 만들기** → `.aab` 업로드
   (처음 올릴 때 **Play 앱 서명** 사용에 동의합니다. 구글이 최종 서명키를 보관합니다.)

## 4단계 — 웹사이트 소유 증명 (Digital Asset Links) ⚠️ 가장 많이 틀리는 단계

TWA가 주소창 없이 전체화면으로 열리려면, 웹사이트가 "이 앱은 우리 앱"이라고 증명해야 합니다.

1. Play Console → **설정 → 앱 무결성 → 앱 서명** 탭으로 이동
2. **"앱 서명 키 인증서"의 SHA-256 인증서 지문**을 복사합니다.
   - ⚠️ PWABuilder의 `signing-key-info.txt`에 있는 값은 **업로드 키**입니다.
     Play 앱 서명을 쓰면 사용자 폰에는 **구글이 다시 서명한 앱**이 설치되므로, 반드시 Play Console의 **앱 서명 키** 지문이 필요합니다.
   - 두 값을 모두 넣어두면 내부 테스트용·스토어 설치용 모두 정상 동작합니다.
3. `public/.well-known/assetlinks.json`의 `sha256_cert_fingerprints`에 붙여넣고 배포합니다.
   ```json
   "sha256_cert_fingerprints": [
     "앱 서명 키 SHA-256 (Play Console)",
     "업로드 키 SHA-256 (signing-key-info.txt)"
   ]
   ```
4. 확인: `https://stackfit-backend.onrender.com/.well-known/assetlinks.json` 이 열리는지,
   https://developers.google.com/digital-asset-links/tools/generator 에서 검증

증명이 안 되면 앱 상단에 브라우저 주소창이 계속 보입니다.

## 5단계 — 스토어 등록정보

| 항목 | 내용 |
|---|---|
| 앱 이름 | IT Free |
| 짧은 설명 (80자) | IT 프리랜서와 기업을 기술스택·업무·등급으로 자동 매칭하는 구인구직 플랫폼 |
| 카테고리 | 비즈니스 |
| 아이콘 | 512×512 PNG (`public/icons/icon-512.png`) |
| 그래픽 이미지 | 1024×500 PNG (배너) |
| 스크린샷 | 휴대폰 2~8장 (홈 추천, 공고 상세, 인재 상세, 채팅, 프로젝트 관리 권장) |
| 연락처 이메일 | lshark4541@gmail.com |
| 개인정보처리방침 | `https://stackfit-backend.onrender.com/privacy.html` |

자세한 설명 예시 첫 문단:
> IT Free는 SI·SM·인프라 프로젝트를 찾는 IT 프리랜서와 인재를 찾는 기업을 연결합니다.
> 공고의 요구 기술스택·업무·등급을 프리랜서 프로필과 비교해 추천 %와 스택매치 %로 보여주고,
> 지원·제안·채팅·계약 진행까지 한 앱에서 관리할 수 있습니다.

## 6단계 — 정책 항목 (앱 콘텐츠)

- **개인정보처리방침**: 위 URL
- **계정 삭제**: 앱 안에서 마이페이지 → 회원탈퇴 / 웹 요청 URL `https://stackfit-backend.onrender.com/delete-account.html`
- **데이터 보안** (사실대로 체크)
  - 수집: 이메일, 이름, 전화번호, 생년월일·성별(선택), 이력서 파일, 회사 정보, 앱 내 메시지
  - 목적: 앱 기능(매칭·계정 관리), 커뮤니케이션
  - 제3자 공유: 없음 (지원·제안한 상대방에게만 표시)
  - 전송 중 암호화: 예 (HTTPS) / 삭제 요청 가능: 예
- **콘텐츠 등급**: 설문 작성 (사용자 간 소통 기능 있음 → 채팅 있음으로 답변)
- **타겟층**: 만 18세 이상 권장 (구인구직 서비스)
- **광고 포함**: 아니요
- **앱 액세스(심사용 계정)**: 로그인이 필요하므로 **기업용 1개 + 프리랜서용 1개** 테스트 계정의 이메일·비밀번호를 적어둡니다.
  심사자가 둘러볼 수 있도록 테스트 공고·프로필을 미리 채워두세요.

## 7단계 — 출시

1. 내부 테스트로 설치 → 주소창 없이 열리는지, 로그인·푸시·파일 업로드 확인
2. **프로덕션 → 새 버전 만들기**에서 같은 `.aab`를 승격하고 **검토를 위해 제출**
3. 심사: 보통 수일 ~ 2주. 반려 사유는 대부분 데이터 보안 항목 누락, 심사용 계정 없음, 스크린샷 문제입니다.

## 출시 후 운영

- **웹(프론트엔드·서버)만 고친 경우 스토어 재업로드가 필요 없습니다.** TWA는 매번 실제 웹사이트를 불러오므로
  Render에 배포하면 설치된 앱에도 바로 반영됩니다.
- 앱 이름·아이콘(런처)·패키지 설정을 바꿀 때만 PWABuilder로 새 `.aab`를 만들고
  **같은 서명키**로 버전 코드를 올려 업로드합니다.

## 스토어 유입 추적

스토어 설명의 링크나 홍보 글에는 채널별 링크를 쓰면, 관리자 계정의
**마이페이지 → 관리자 → 가입 경로 통계**에서 채널별 가입 수를 볼 수 있습니다.
(같은 화면의 "채널별 공유 링크 만들기"로 링크를 만들 수 있습니다.)

예) `https://stackfit-backend.onrender.com/?utm_source=okky&utm_medium=social&utm_campaign=ta_post_1`
