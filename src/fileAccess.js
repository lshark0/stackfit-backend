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

module.exports = { signedFileUrl };
