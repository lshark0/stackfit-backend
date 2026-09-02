const fs = require('fs');
const path = require('path');
const { signToken } = require('./auth');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

// 이력서 등 업로드 파일용 서명된 임시 URL (5분 유효). 고정된 공개 URL 대신
// 요청 시점마다 새로 발급하여, 링크가 유출돼도 오래 남아있지 않게 합니다.
// Render 무료 플랜은 재배포 시 디스크가 초기화되어 이전에 올린 파일이 사라질 수 있으므로,
// 실제로 파일이 남아있는지 확인한 뒤에만 링크를 내려줍니다 (없으면 null → "다시 업로드해주세요" 안내).
function signedFileUrl(filename) {
  if (!filename) return null;
  if (!fs.existsSync(path.join(UPLOAD_DIR, filename))) return null;
  const token = signToken({ purpose: 'file_view', filename }, 300);
  return `/uploads/${filename}?token=${encodeURIComponent(token)}`;
}

module.exports = { signedFileUrl };
