const multer = require('multer');

const ALLOWED_EXT = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.hwp'];
const EXT_LABEL = 'PDF, Word, PPT, 한글(HWP)';

const extOf = (name) => {
  const m = /\.[^.]+$/.exec(name || '');
  return m ? m[0].toLowerCase() : '';
};

// 파일 내용을 로컬 디스크가 아닌 메모리에 잠깐 올린 뒤 DB에 저장합니다.
// (Render 무료 플랜은 재배포 시 디스크가 초기화되어 파일이 사라지기 때문)
function createDocUpload() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_EXT.includes(extOf(file.originalname))) {
        return cb(new Error(`${EXT_LABEL} 파일만 업로드할 수 있어요.`));
      }
      cb(null, true);
    },
  });
}

// 확장자만 믿지 않고, 파일 앞부분이 실제 해당 형식의 시그니처인지 확인해 위장 업로드를 막습니다.
const MAGIC_BYTES = {
  '.pdf': [Buffer.from('%PDF-', 'ascii')],
  '.docx': [Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  '.pptx': [Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  '.doc': [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
  '.ppt': [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
  '.hwp': [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
};
function isValidDocument(buffer, ext) {
  const signatures = MAGIC_BYTES[ext];
  if (!signatures) return false;
  return signatures.some((sig) => buffer.subarray(0, sig.length).equals(sig));
}

// multer/busboy가 파일명을 latin1로 잘못 해석해 한글이 깨지는 문제를 바로잡습니다.
function fixFilenameEncoding(name) {
  try { return Buffer.from(name, 'latin1').toString('utf8'); } catch (e) { return name; }
}

module.exports = { ALLOWED_EXT, EXT_LABEL, extOf, createDocUpload, isValidDocument, fixFilenameEncoding };
