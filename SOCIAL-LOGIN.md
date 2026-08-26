# 소셜 로그인 설정 가이드 (구글 · 네이버 · 카카오)

STACKFIT 코드에는 이미 구글/네이버/카카오 로그인이 전부 구현되어 있습니다. 각 플랫폼에서
**Client ID / Client Secret**만 발급받아 Render 환경변수에 넣어주시면 바로 작동합니다.

공통으로 등록해야 할 **콜백(리다이렉트) 주소**는 아래와 같습니다 (플랫폼마다 다름에 유의):

| 플랫폼 | 콜백 URL |
|---|---|
| 구글 | `https://stackfit-backend.onrender.com/api/auth/oauth/google/callback` |
| 네이버 | `https://stackfit-backend.onrender.com/api/auth/oauth/naver/callback` |
| 카카오 | `https://stackfit-backend.onrender.com/api/auth/oauth/kakao/callback` |

---

## 1. 구글 (Google)

> 참고: 구글이 최근 콘솔 UI를 개편해서, 예전의 "OAuth 동의 화면" 한 페이지가
> **브랜딩 / 대상 / 클라이언트** 세 메뉴로 나뉘었습니다. 아래는 새 UI 기준입니다.

1. https://console.cloud.google.com 접속 → 로그인
2. 상단에서 **새 프로젝트** 생성 (이름: STACKFIT 등 자유롭게)
3. 왼쪽 메뉴 **Google 인증 플랫폼 → 브랜딩**
   - 앱 이름: 스택핏, 사용자 지원 이메일: 본인 이메일 입력 후 저장
4. 왼쪽 메뉴 **대상** (예전 "User Type" 선택이 이 메뉴로 옮겨졌습니다)
   - **External(외부)** 선택
   - 게시 상태는 테스트 단계로 두어도 본인 계정으로는 바로 로그인 테스트가 가능합니다
5. 왼쪽 메뉴 **클라이언트 → 클라이언트 만들기** (또는 개요 화면의 "OAuth 클라이언트 만들기" 버튼)
   - 애플리케이션 유형: **웹 애플리케이션**
   - 승인된 리디렉션 URI에 위 표의 구글 콜백 URL 추가
   - 만들기 클릭 → **클라이언트 ID**와 **클라이언트 보안 비밀번호(Secret)**가 표시됨 → 복사해두기

필요한 값: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

---

## 2. 네이버 (Naver)

1. https://developers.naver.com/apps/#/register 접속 → 네이버 계정 로그인
2. **애플리케이션 등록**
   - 애플리케이션 이름: 스택핏
   - 사용 API: **네이버 로그인** 체크
   - 제공 정보 선택: 최소 **이메일**, **이름**은 체크 (사용자 동의 시 제공)
3. 로그인 오픈 API 서비스 환경
   - 서비스 URL: `https://stackfit-backend.onrender.com`
   - Callback URL: 위 표의 네이버 콜백 URL 추가
4. 등록 완료하면 **Client ID**, **Client Secret** 확인 가능

필요한 값: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`

> 참고: 네이버는 등록 직후 "검수 중" 상태로 뜨는 경우가 있는데, 개발/테스트 단계에서는 등록한 본인 계정으로는 바로 로그인 테스트가 가능합니다. 일반 사용자에게 공개하려면 별도 검수 신청이 필요할 수 있어요.

---

## 3. 카카오 (Kakao)

1. https://developers.kakao.com 접속 → 카카오 계정 로그인
2. **내 애플리케이션 → 애플리케이션 추가하기**
   - 앱 이름: 스택핏, 사업자명: 개인 이름으로도 가능
3. 생성된 앱 클릭 → 왼쪽 메뉴 **앱 설정 → 요약 정보**에서 **REST API 키** 확인 → 이게 Client ID입니다
4. 왼쪽 메뉴 **제품 설정 → 카카오 로그인**
   - 활성화 설정 **ON**
   - Redirect URI에 위 표의 카카오 콜백 URL 추가
5. 왼쪽 메뉴 **제품 설정 → 카카오 로그인 → 동의항목**
   - **카카오계정(이메일)** 항목은 최근 카카오 정책상 "비즈 앱 전환"(개인 본인인증)을 해야만
     설정할 수 있게 바뀌었습니다 (그냥 두면 "권한 없음"으로 회색 처리되어 있음)
   - **이 항목은 건너뛰어도 됩니다.** 코드가 애초에 이메일 권한을 요청하지 않도록 되어 있어서,
     신청 안 해도 에러 없이 로그인됩니다. 이메일이 없는 경우 임시 이메일
     (`kakao_아이디@stackfit.local`)을 자동으로 만들어 처리합니다.
   - 실제 이메일을 꼭 받고 싶다면, 카카오디벨로퍼스 우측 상단 **계정 설정 → 본인인증** 완료 후
     "비즈 앱 전환"을 신청하면 이메일 동의항목이 열립니다 (선택 사항, 나중에 해도 무방)
6. 왼쪽 메뉴 **보안**에서 **Client Secret** 발급 → 코드 생성 후 **사용함**으로 설정

필요한 값: `KAKAO_CLIENT_ID` (REST API 키), `KAKAO_CLIENT_SECRET`

---

## 4. 값 전달하기

위에서 얻은 6개 값(3개 플랫폼 × 2개)을 아래 형식으로 저에게 알려주시면, Render 환경변수에 등록하고
바로 배포해서 실제로 작동하는지 확인해드릴게요. 한 번에 다 준비 안 되면 구글만 먼저 주셔도 됩니다
(플랫폼별로 개별 활성화되는 구조라, 준비된 것부터 순서대로 켜도 문제없어요).

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
NAVER_CLIENT_ID=
NAVER_CLIENT_SECRET=
KAKAO_CLIENT_ID=
KAKAO_CLIENT_SECRET=
```

⚠️ Client Secret은 비밀번호와 같으니, 캡처화면을 다른 곳에 공유하거나 공개 저장소에 올리지 않도록 주의해주세요.
