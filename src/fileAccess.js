const { signToken } = require('./auth');

// 이력서 등 업로드 파일용 서명된 임시 URL (5분 유효). 고정된 공개 URL 대신
// 요청 시점마다 새로 발급하여, 링크가 유출돼도 오래 남아있지 않게 합니다.
// 파일 내용 자체는 DB에 저장되므로(서버 재배포와 무관하게 보존됨), 여기서는
// 파일명이 있으면 항상 링크를 발급하고, 실제 존재 여부는 다운로드 시점에 DB에서 확인합니다.
function signedFileUrl(filename) {
  if (!filename) return null;
  const token = signToken({ purpose: 'file_view', filename }, 300);
  return `/uploads/${filename}?token=${encodeURIComponent(token)}`;
}

// 기업 회원이 프리랜서의 경력기술서 파일을 받을 수 있는 경우(대표 결정, 2026-11-13):
//  - 그 프리랜서가 이 기업의 공고에 지원했거나
//  - 이 기업의 제안을 수락한 경우
// 경력기술서에는 연락처가 적혀 있는 경우가 많아, 연락처 공개 정책(제안 수락 후 공개)과 맞춥니다.
// 반환값: 열람 가능한 프리랜서 id의 Set
async function resumeVisibleSet(companyId, freelancerIds) {
  const { all } = require('./db'); // db 초기화 순서와 엮이지 않도록 사용할 때 불러옵니다
  const ids = [...new Set((freelancerIds || []).map(Number))].filter((id) => Number.isInteger(id));
  if (!ids.length || !Number.isInteger(Number(companyId))) return new Set();
  const ph = ids.map(() => '?').join(',');
  const rows = await all(
    `SELECT a.freelancer_id AS id FROM applications a JOIN jobs j ON j.id = a.job_id
      WHERE j.company_id = ? AND a.freelancer_id IN (${ph})
     UNION
     SELECT p.freelancer_id AS id FROM proposals p
      WHERE p.company_id = ? AND p.status = 'accepted' AND p.freelancer_id IN (${ph})`,
    [Number(companyId), ...ids, Number(companyId), ...ids]
  );
  return new Set(rows.map((r) => Number(r.id)));
}

module.exports = { signedFileUrl, resumeVisibleSet };
