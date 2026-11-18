/**
 * 09_prepare_sword_back.js — 背视角剑仙素材清理与绿幕抠图（纯 Node，无第三方库）
 *
 * 用途：ImageGen 生成的背视角 master 是纯绿背景，但右下角带工具水印。
 *      本脚本先清掉右下角水印区域（该区域只有背景，不碰角色/剑），再把绿幕打成 alpha，
 *      输出游戏可直接加载的 RGBA PNG；同时保留一份清水印后的绿幕源图用于素材追溯。
 *
 * 用法：node scripts/09_prepare_sword_back.js <raw.png> <cut.png> <cleanGreen.png>
 *
 * 技术：Node 内置 zlib 解/编码 PNG；支持 colorType 2(RGB)/6(RGBA)、bitDepth 8、非隔行。
 * 注意：水印区域按当前 1024x1024 生成图硬编码；换图前必须重新确认坐标。
 */
const fs = require('fs');
const zlib = require('zlib');

/* ---------- CRC32（PNG chunk 校验用） ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* ---------- PNG 解码 ---------- */
function decodePNG(file) {
  const data = fs.readFileSync(file);
  if (data.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error('not PNG: ' + file);
  let off = 8, ihdr = null; const idat = [];
  while (off + 8 <= data.length) {
    const len = data.readUInt32BE(off);
    const type = data.toString('ascii', off + 4, off + 8);
    const chunk = data.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        w: chunk.readUInt32BE(0), h: chunk.readUInt32BE(4),
        depth: chunk[8], colorType: chunk[9], interlace: chunk[12]
      };
    } else if (type === 'IDAT') idat.push(chunk);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr || ihdr.depth !== 8 || ihdr.interlace !== 0 ||
      (ihdr.colorType !== 2 && ihdr.colorType !== 6)) {
    throw new Error(`unsupported PNG: depth=${ihdr && ihdr.depth} type=${ihdr && ihdr.colorType} interlace=${ihdr && ihdr.interlace}`);
  }
  const bpp = ihdr.colorType === 2 ? 3 : 4;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = ihdr.w * bpp;
  const out = Buffer.alloc(ihdr.h * stride);
  let p = 0;
  for (let y = 0; y < ihdr.h; y++) {
    const filter = raw[p++];
    const row = raw.slice(p, p + stride); p += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += ((a + b) >> 1);
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xFF;
    }
  }
  return { w: ihdr.w, h: ihdr.h, bpp, pixels: out };
}

/* ---------- PNG 编码（RGBA, filter 0） ---------- */
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const stride = w * 4;
  const rows = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    rows[y * (stride + 1)] = 0; // filter None
    rgba.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const clamp255 = v => Math.max(0, Math.min(255, Math.round(v)));

/* ---------- 主流程 ---------- */
const [rawPath, cutPath, cleanPath] = process.argv.slice(2);
if (!rawPath || !cutPath || !cleanPath) {
  console.error('usage: node scripts/09_prepare_sword_back.js <raw.png> <cut.png> <cleanGreen.png>');
  process.exit(2);
}
const img = decodePNG(rawPath);
const { w, h, bpp, pixels } = img;
if (w !== 1024 || h !== 1024) throw new Error(`expected 1024x1024, got ${w}x${h}`);

const clean = Buffer.alloc(w * h * 4);
for (let i = 0; i < w * h; i++) {
  const s = i * bpp, d = i * 4;
  clean[d] = pixels[s]; clean[d + 1] = pixels[s + 1]; clean[d + 2] = pixels[s + 2];
  clean[d + 3] = 255;
}

/* 1) 清掉右下角工具水印。角色剑尖最右到 x≈820，水印从 x≈900 开始，故 x>=845,y>=935 安全。 */
let wiped = 0;
for (let y = 935; y < h; y++) {
  for (let x = 845; x < w; x++) {
    const d = (y * w + x) * 4;
    clean[d] = 0; clean[d + 1] = 255; clean[d + 2] = 0; clean[d + 3] = 255;
    wiped++;
  }
}
fs.writeFileSync(cleanPath, encodePNG(w, h, clean));

/* 2) 绿幕抠图：纯绿透明；边缘绿色溢色按绿色优势衰减 alpha 并压回中性边。 */
const cut = Buffer.from(clean);
let keyed = 0, softened = 0;
for (let i = 0; i < w * h; i++) {
  const d = i * 4;
  const r = cut[d], g = cut[d + 1], b = cut[d + 2];
  const other = Math.max(r, b);
  const advantage = g - other;
  if (r < 80 && g > 180 && b < 80) {
    cut[d + 3] = 0; keyed++;
  } else if (g > 120 && advantage > 45) {
    const keep = Math.max(0, 1 - (advantage - 45) / 120);
    cut[d] = clamp255(r);
    cut[d + 1] = clamp255(other + (g - other) * (1 - keep) * 0.25);
    cut[d + 2] = clamp255(b);
    cut[d + 3] = clamp255(255 * keep);
    softened++;
  }
}
fs.writeFileSync(cutPath, encodePNG(w, h, cut));
console.log(`watermark cleared ${(wiped / (w * h) * 100).toFixed(2)}%, green keyed ${(keyed / (w * h) * 100).toFixed(2)}%, softened ${(softened / (w * h) * 100).toFixed(2)}%`);
console.log(`clean -> ${cleanPath}`);
console.log(`cut   -> ${cutPath}`);
