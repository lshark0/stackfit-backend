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

1. https://console.cloud.google.com 접속 → 로그인
2. 상단에서 **새 프로젝트** 생성 (이름: STACKFIT 등 자유롭게)
3. 왼쪽 메뉴 **API 및 서비스 → OAuth 동의 화면**
   - User Type: **외부** 선택 → 만들기
   - 앱 이름: 스택핏, 사용자 지원 이메일: 본인 이메일, 개발자 연락처: 본인 이메일 입력 후 저장
   - 범위(Scopes)는 기본값 그대로 두고 계속 진행
   - 테스트 사용자 단계는 건너뛰어도 됨 (나중에 "게시" 상태로 전환 가능)
4. 왼쪽 메뉴 **사용자 인증 정보 → + 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**
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
   - **이메일** 항목을 "필수 동의" 또는 "선택 동의"로 설정 (검수 필요할 수 있음 — 카카오 정책상 이메일 제공은 별도 심사 대상)
   - 이메일 동의가 어렵다면, 코드가 이메일이 없을 때 자동으로 임시 이메일(`kakao_아이디@stackfit.local`)을 만들어 처리하므로 당장은 건너뛰어도 동작은 합니다
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
