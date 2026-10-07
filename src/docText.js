// Word(.docx) / PowerPoint(.pptx) 파일에서 본문 텍스트만 뽑아냅니다. (AI 프로필 자동 작성용)
// 두 형식 모두 ZIP 안에 XML이 들어 있는 구조라, 외부 라이브러리 없이 Node 내장 zlib으로 풉니다.
// 구버전 .doc/.ppt와 한글(.hwp)은 지원하지 않습니다.
const zlib = require('zlib');

const MAX_ENTRY_BYTES = 20 * 1024 * 1024; // 압축 폭탄 방지: 항목 하나당 풀린 크기 상한
const MAX_TEXT_CHARS = 60000;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024; // 압축 폭탄 방지: 파일 전체에서 풀어내는 크기 합계 상한
const MAX_SLIDES = 300; // 슬라이드 수천 장짜리 파일로 서버 메모리를 고갈시키는 것 방지
const MAX_ENTRIES = 5000;

function readZipEntries(buf) {
  // End of Central Directory 레코드를 파일 끝에서부터 찾습니다.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: EOCD not found');
  const count = buf.readUInt16LE(eocd + 10);
  if (count > MAX_ENTRIES) throw new Error('zip: too many entries');
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(buf, entry) {
  const p = entry.localOffset;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error('zip: bad local header');
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const data = buf.subarray(start, start + entry.compSize);
  if (entry.method === 0) return data.subarray(0, MAX_ENTRY_BYTES);
  if (entry.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
  throw new Error('zip: unsupported compression');
}

function decodeXmlText(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

// <w:t>, <a:t> 같은 텍스트 태그만 모으고, 문단 끝(</w:p>, </a:p>)마다 줄을 바꿉니다.
function xmlToText(xml, ns) {
  const out = [];
  const re = new RegExp(`<${ns}:t(?:\\s[^>]*)?>([^<]*)</${ns}:t>|</${ns}:p>|<${ns}:tab/>|<${ns}:br/>`, 'g');
  let m;
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) out.push(decodeXmlText(m[1]));
    else if (m[0].includes('tab')) out.push('\t');
    else out.push('\n');
  }
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

// ext: '.docx' 또는 '.pptx'. 지원하지 않는 형식이면 null을 돌려줍니다.
function extractOfficeText(buf, ext) {
  const entries = readZipEntries(buf);
  let text = '';
  if (ext === '.docx') {
    const e = entries.get('word/document.xml');
    if (!e) return '';
    text = xmlToText(readEntry(buf, e).toString('utf8'), 'w');
  } else if (ext === '.pptx') {
    const slides = [...entries.keys()]
      .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
      .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));
    let total = 0;
    const parts = [];
    for (const k of slides.slice(0, MAX_SLIDES)) {
      const raw = readEntry(buf, entries.get(k));
      total += raw.length;
      if (total > MAX_TOTAL_BYTES) break;
      parts.push(xmlToText(raw.toString('utf8'), 'a'));
    }
    text = parts.join('\n\n');
  } else {
    return null;
  }
  return text.slice(0, MAX_TEXT_CHARS);
}

module.exports = { extractOfficeText };
