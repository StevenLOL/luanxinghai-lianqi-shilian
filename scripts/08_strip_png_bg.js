/**
 * 08_strip_png_bg.js — 纯 Node 实现 PNG 白底抠图（无需 Pillow / 第三方库）
 *
 * 用途：AI 生成的水墨素材是 RGB 白底（含浅灰水墨晕染），直接用会有白色方块。
 *      本脚本从图像四边做 flood-fill，只把「连通到边缘的浅色低饱和像素」设为透明，
 *      角色内部被深色描边包围的浅色衣袍得以保留。
 *
 * 用法：node scripts/08_strip_png_bg.js [输入目录]
 *       默认处理 scripts/assets/*.png，输出 <原名>_cut.png
 *
 * 技术：Node 内置 zlib 解/编码 PNG；支持 colorType 2(RGB)/6(RGBA)、bitDepth 8、非隔行。
 */
const fs = require('fs');
const path = require('path');
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

/* ---------- 背景判定：浅色 + 低饱和 ---------- */
function isBg(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const bright = (r + g + b) / 3;
  return bright > 202 && (mx - mn) < 42;   // 白/浅灰水墨晕染
}

/* ---------- 主流程：边缘 flood fill 抠图 ---------- */
function strip(src, dst) {
  const img = decodePNG(src);
  const { w, h, bpp, pixels } = img;
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * bpp, d = i * 4;
    rgba[d] = pixels[s]; rgba[d + 1] = pixels[s + 1]; rgba[d + 2] = pixels[s + 2];
    rgba[d + 3] = 255;
  }
  // BFS from all border pixels
  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  const push = (idx) => {
    if (visited[idx]) return;
    const d = idx * 4;
    if (!isBg(rgba[d], rgba[d + 1], rgba[d + 2])) return;
    visited[idx] = 1; queue[tail++] = idx;
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (head < tail) {
    const idx = queue[head++];
    const x = idx % w, y = (idx / w) | 0;
    if (x > 0) push(idx - 1);
    if (x < w - 1) push(idx + 1);
    if (y > 0) push(idx - w);
    if (y < h - 1) push(idx + w);
  }
  let cleared = 0;
  for (let i = 0; i < w * h; i++) {
    if (visited[i]) { rgba[i * 4 + 3] = 0; cleared++; }
  }
  fs.writeFileSync(dst, encodePNG(w, h, rgba));
  console.log(`${path.basename(src)} -> ${path.basename(dst)}  透明像素 ${(cleared / (w * h) * 100).toFixed(1)}%`);
}

/* ---------- 入口 ---------- */
const dir = process.argv[2] || path.join(__dirname, 'assets');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.png') && !f.includes('_cut'));
if (!files.length) { console.error('no png found in', dir); process.exit(1); }
for (const f of files) strip(path.join(dir, f), path.join(dir, f.replace('.png', '_cut.png')));
console.log('done.');
