const { signToken } = require('./auth');

// 이력서 등 업로드 파일용 서명된 임시 URL (5분 유효). 고정된 공개 URL 대신
// 요청 시점마다 새로 발급하여, 링크가 유출돼도 오래 남아있지 않게 합니다.
function signedFileUrl(filename) {
  if (!filename) return null;
  const token = signToken({ purpose: 'file_view', filename }, 300);
  return `/uploads/${filename}?token=${encodeURIComponent(token)}`;
}

module.exports = { signedFileUrl };
