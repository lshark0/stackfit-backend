// 평가 항목 — 계약이 끝난 프로젝트에서 기업과 프리랜서가 서로를 항목별로 평가합니다.
// 프론트엔드(public/index.html의 REVIEW_CRITERIA)와 같은 값이어야 합니다.
//
// 김프리만의 방식
//  - 항목별 별점(1~5)의 평균이 종합 평점이 됩니다(reviews.rating에는 반올림한 정수를 함께 저장).
//  - 재계약 의사(다시 함께 일하고 싶은지)를 따로 받아 '재계약 의사 N%'로 보여 줍니다.
//  - 강점 태그(최대 3개)를 골라 IT 프로젝트에서 실제로 중요한 강점을 쌓아 보여 줍니다.
//  - 블라인드 상호 평가: 양쪽이 모두 평가하거나 첫 평가 후 14일이 지나야 서로의 평가가 공개됩니다(보복성 평가 방지).

// 기업이 프리랜서를 평가할 때
const FREELANCER_CRITERIA = [
  { key: 'schedule', label: '일정을 잘 지켜요' },
  { key: 'communication', label: '소통이 빠르고 정확해요' },
  { key: 'expertise', label: '기술 전문성이 높아요' },
  { key: 'documentation', label: '문서화·인수인계가 꼼꼼해요' },
  { key: 'ownership', label: '책임감 있게 일해요' },
];
const FREELANCER_TAGS = [
  '장애 대응이 빨라요', '문서를 잘 남겨요', '신기술 습득이 빨라요', '고객 응대가 능숙해요',
  '설계·아키텍처에 강해요', '성능 튜닝을 잘해요', '보안을 꼼꼼히 챙겨요', '일정 관리가 철저해요',
];

// 프리랜서가 기업을 평가할 때
const COMPANY_CRITERIA = [
  { key: 'clarity', label: '요구사항이 명확해요' },
  { key: 'communication', label: '소통이 원활해요' },
  { key: 'environment', label: '근무 환경이 좋아요' },
  { key: 'payment', label: '대금을 약속대로 지급해요' },
  { key: 'respect', label: '프리랜서를 존중해요' },
];
const COMPANY_TAGS = [
  '대금 지급이 빨라요', '야근을 강요하지 않아요', '장비·환경 지원이 좋아요', '범위 변경을 합리적으로 조정해요',
  '담당자가 친절해요', '계약 조건을 잘 지켜요', '업무 인수인계가 잘 돼 있어요',
];

const REVEAL_DAYS = 14;

// 평가받는 쪽 역할(freelancer|company)에 맞는 항목·태그
function criteriaFor(revieweeRole) {
  return revieweeRole === 'company'
    ? { criteria: COMPANY_CRITERIA, tags: COMPANY_TAGS }
    : { criteria: FREELANCER_CRITERIA, tags: FREELANCER_TAGS };
}

module.exports = { FREELANCER_CRITERIA, FREELANCER_TAGS, COMPANY_CRITERIA, COMPANY_TAGS, REVEAL_DAYS, criteriaFor };
