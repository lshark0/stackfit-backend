// 지원·제안이 어디서 시작됐는지(심사 의견: '추천부터 계약까지' 소요 시간·성사율을 출처별로 비교).
//  reco = 추천 목록(추천 % 카드), search = 검색·목록·비슷한 공고, alert = 알림·푸시 링크, other = 그 밖(직접 진입 등)
const CONTACT_SOURCES = ['reco', 'search', 'alert', 'other'];
const normalizeSource = (v) => (CONTACT_SOURCES.includes(v) ? v : 'other');
const SOURCE_LABEL = { reco: '추천 목록', search: '검색·목록', alert: '알림', other: '기타' };

module.exports = { CONTACT_SOURCES, normalizeSource, SOURCE_LABEL };
