// Draws the HelloHR app icon (white "H" on indigo) as PNG files, no dependencies:  node tools/make-icons.js
const zlib = require('zlib'), fs = require('fs'), path = require('path');
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xFFFFFFFF; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(size, { maskable = false, round = true } = {}) {
  const raw = Buffer.alloc((size * 4 + 1) * size), r = size * 0.22, pad = maskable ? size * 0.18 : size * 0.2;
  const bar = size * 0.1, x0 = pad + size * 0.08, x1 = size - x0 - bar, top = pad + size * 0.04, bot = size - top;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4;
      // rounded-square mask (maskable icons are full bleed)
      const dx = Math.max(r - x, 0, x - (size - 1 - r)), dy = Math.max(r - y, 0, y - (size - 1 - r)), inside = maskable || !round || dx * dx + dy * dy <= r * r;
      if (!inside) { raw[o + 3] = 0; continue; }
      const t = y / size, g = [79 + (99 - 79) * t, 70 + (102 - 70) * t, 229 + (241 - 229) * t];   // indigo gradient
      const isH = (y >= top && y <= bot) && ((x >= x0 && x <= x0 + bar) || (x >= x1 && x <= x1 + bar) || (y >= size / 2 - bar / 2 && y <= size / 2 + bar / 2 && x >= x0 && x <= x1 + bar));
      const c = isH ? [255, 255, 255] : g; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const out = path.join(__dirname, '..', 'public', 'icons');
fs.writeFileSync(path.join(out, 'icon-192.png'), png(192)); fs.writeFileSync(path.join(out, 'icon-512.png'), png(512));
fs.writeFileSync(path.join(out, 'maskable-512.png'), png(512, { maskable: true })); fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), png(180, { maskable: true }));
console.log('icons written');
