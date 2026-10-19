// 요금제(정식 출시 전 안내용): 기업 월 구독 3종 + 프리랜서 프리미엄.
// 아직 결제는 받지 않고 '사전 신청'만 받습니다. 가격은 사업계획서의 가격(안)이며 출시 때 바뀔 수 있습니다.
// 공고 등록·인재 검색·추천 %(기업)와 지원·제안 받기·채팅·계약 관리(프리랜서) 같은 기본 기능은 계속 무료입니다.
// 채용·계약이 성사돼도 수수료는 받지 않습니다. 수익은 공고 노출·구독 같은 정보·광고 이용료뿐이고,
// 제안권도 수락 여부와 관계없이 '보낼 때' 차감되는 월 정액 이용 한도입니다(성과 연동 과금 없음).
const PLANS = [
  {
    id: 'company_starter', role: 'company', name: '스타터', price: 49000, period: '월',
    summary: '공고를 가끔 올리는 소규모 기업',
    features: ['프리미엄 등록 월 2건 (14일 추천 상단 고정·급구 배지)', '제안권 월 10회 (제안을 보낼 때 차감)', '인재풀 분석 리포트 월 1건'],
  },
  {
    id: 'company_pro', role: 'company', name: '프로', price: 199000, period: '월', recommended: true,
    summary: '매달 여러 프로젝트 인력을 구하는 SI·수행사',
    features: ['프리미엄 등록 월 10건', '제안권 월 50회', '인재풀 분석 리포트 월 5건', '채용 통계 리포트 (공고별 지원·제안·계약 현황)'],
  },
  {
    id: 'company_business', role: 'company', name: '비즈니스', price: 490000, period: '월',
    summary: '상시 채용이 많은 기업',
    features: ['프리미엄 등록·제안권·인재풀 분석 리포트 무제한', '앱 홈 상단 노출 광고 포함', '채용 통계 리포트'],
  },
  {
    id: 'freelancer_premium', role: 'freelancer', name: '프리랜서 프리미엄', price: 9900, period: '월', vatIncluded: true,
    summary: '더 많은 기업에게 먼저 보이고 싶은 프리랜서',
    features: [
      '인재 검색·추천 목록 상단 노출과 프리미엄 표시',
      '내 기술에 맞는 새 공고 우선 알림',
      '지원서 강조 표시 (기업 지원자 목록 상단)',
      'AI 상담·경력기술서 AI 분석 이용 한도 확대',
      '프로필 경쟁력 리포트 (내 기술의 공고 수요·추천 점수 분석)',
    ],
  },
];
const PLAN_IDS = PLANS.map((p) => p.id);
// 친구 초대 보상: '1개월 이용권' 1개 = 정식 출시 후 아래 요금제를 1개월 무료로 쓰는 이용권(받는 사람의 회원 유형 기준)
const REFERRAL_PASS = {
  company: { planId: 'company_starter', label: '기업 구독 스타터 1개월' },
  freelancer: { planId: 'freelancer_premium', label: '프리랜서 프리미엄 1개월' },
};
const referralPassFor = (role) => REFERRAL_PASS[role] || REFERRAL_PASS.freelancer;
const planById = (id) => PLANS.find((p) => p.id === id) || null;

module.exports = { PLANS, PLAN_IDS, planById, REFERRAL_PASS, referralPassFor };
