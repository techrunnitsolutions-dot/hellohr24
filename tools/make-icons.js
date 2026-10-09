// Builds every app icon from the HelloHR logo image (tools/logo-source.png), no dependencies:
//   node tools/make-icons.js [path-to-logo.png]
// The logo is cropped to its artwork, fitted on a white square and written for the web app (PWA), iOS home screen and the Android launcher.
const zlib = require('zlib'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');

// ---- minimal PNG reader (8-bit, non-interlaced) and writer ----
function readPng(buf) {
  let p = 8, w, h, ct, idat = [];
  while (p < buf.length) { const len = buf.readUInt32BE(p), t = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len); p += 12 + len;
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); if (d[8] !== 8 || d[12] !== 0) throw new Error('Use an 8-bit, non-interlaced PNG'); ct = d[9]; } else if (t === 'IDAT') idat.push(d); }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct]; if (!ch) throw new Error('Unsupported PNG colour type ' + ct);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[y * stride + x - ch] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= ch && y ? out[(y - 1) * stride + x - ch] : 0;
      let v = row[x]; if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + x] = v & 255;
    }
  }
  const rgba = Buffer.alloc(w * h * 4);   // normalise to RGBA, flattening transparency onto white
  for (let i = 0; i < w * h; i++) {
    let r, g, b, a = 255; const o = i * ch;
    if (ch === 1) r = g = b = out[o]; else if (ch === 2) { r = g = b = out[o]; a = out[o + 1]; } else { r = out[o]; g = out[o + 1]; b = out[o + 2]; if (ch === 4) a = out[o + 3]; }
    rgba[i * 4] = Math.round(r * a / 255 + 255 - a); rgba[i * 4 + 1] = Math.round(g * a / 255 + 255 - a); rgba[i * 4 + 2] = Math.round(b * a / 255 + 255 - a); rgba[i * 4 + 3] = 255;
  }
  return { w, h, d: rgba };
}
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xFFFFFFFF; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function writePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---- crop to the artwork, then scale it onto a white square with box-filter averaging (sharp when shrinking) ----
const src = readPng(fs.readFileSync(process.argv[2] || path.join(__dirname, 'logo-source.png')));
let x0 = src.w, y0 = src.h, x1 = 0, y1 = 0;
for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) { const o = (y * src.w + x) * 4; if (src.d[o] < 235 || src.d[o + 1] < 235 || src.d[o + 2] < 235) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
console.log(`logo ${src.w}x${src.h}, artwork ${cw}x${ch}`);
function square(size, fill) {   // fill = share of the square the artwork's width may use
  const out = Buffer.alloc(size * size * 4, 255), k = Math.min(size * fill / cw, size * fill / ch), tw = cw * k, th = ch * k, ox = (size - tw) / 2, oy = (size - th) / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x - ox, dy = y - oy; if (dx < -1 || dy < -1 || dx > tw + 1 || dy > th + 1) continue;
    const sx0 = x0 + dx / k, sx1 = x0 + (dx + 1) / k, sy0 = y0 + dy / k, sy1 = y0 + (dy + 1) / k;
    let r = 0, g = 0, b = 0, n = 0;
    for (let sy = Math.floor(sy0); sy <= Math.floor(sy1 - 1e-6); sy++) for (let sx = Math.floor(sx0); sx <= Math.floor(sx1 - 1e-6); sx++) {
      const px = Math.min(x1, Math.max(x0, sx)), py = Math.min(y1, Math.max(y0, sy)), wgt = (Math.min(sx + 1, sx1) - Math.max(sx, sx0)) * (Math.min(sy + 1, sy1) - Math.max(sy, sy0)); if (wgt <= 0) continue;
      const o = (py * src.w + px) * 4; r += src.d[o] * wgt; g += src.d[o + 1] * wgt; b += src.d[o + 2] * wgt; n += wgt;
    }
    if (n > 0) { const o = (y * size + x) * 4, cov = Math.min(1, n * k * k); out[o] = Math.round(r / n * cov + 255 * (1 - cov)); out[o + 1] = Math.round(g / n * cov + 255 * (1 - cov)); out[o + 2] = Math.round(b / n * cov + 255 * (1 - cov)); }
  }
  return writePng(size, size, out);
}
const put = (rel, buf) => { const f = path.join(ROOT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); };

// web app / iOS home screen (any = logo fills 82% of the width, maskable keeps it inside the 60% safe zone)
put('public/icons/icon-192.png', square(192, 0.82)); put('public/icons/icon-512.png', square(512, 0.82));
put('public/icons/maskable-512.png', square(512, 0.62)); put('public/icons/apple-touch-icon.png', square(180, 0.82));
// Android launcher: legacy square icons + adaptive-icon foreground (108dp, logo inside the safe zone), used by the APK build
const DENS = { mdpi: [48, 108], hdpi: [72, 162], xhdpi: [96, 216], xxhdpi: [144, 324], xxxhdpi: [192, 432] };
for (const [d, [icon, fg]] of Object.entries(DENS)) {
  put(`mobile/resources/android/mipmap-${d}/ic_launcher.png`, square(icon, 0.82)); put(`mobile/resources/android/mipmap-${d}/ic_launcher_round.png`, square(icon, 0.7));
  put(`mobile/resources/android/mipmap-${d}/ic_launcher_foreground.png`, square(fg, 0.5));
}
put('mobile/resources/icon-1024.png', square(1024, 0.82));
console.log('icons written');
