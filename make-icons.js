// 生成 PWA 图标：icon-192 / icon-512 / icon-maskable-512 / apple-touch-icon
// 图案沿用桌面版的「草方块」像素画（见项目根目录 生成图标.js）。
// 想换图案：改下面的 ART / PAL，然后运行： node make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PAL = {
  G: '#7CB342', // 草地亮绿
  H: '#5E9438', // 草地暗绿
  D: '#96682F', // 泥土
  E: '#7B5226', // 泥土暗色斑点
  L: '#A87C3E', // 泥土亮色斑点
};

const ART = [
  'GGGG' + 'GGGG' + 'GGGG' + 'GGGG',
  'GGHG' + 'GGGG' + 'GGGH' + 'GGGG',
  'HGGG' + 'GGHG' + 'GGGG' + 'GGHG',
  'GGGH' + 'GGGG' + 'HGGG' + 'GGGG',
  'GGDG' + 'GGGD' + 'GGGG' + 'DGGD',
  'DGGD' + 'GGDG' + 'GGDD' + 'GGDG',
  'DDDD' + 'EDDD' + 'DDDE' + 'DDDD',
  'DDED' + 'DDDD' + 'DEDD' + 'DDDE',
  'DDDD' + 'DDDE' + 'DDDD' + 'DDDD',
  'DLDD' + 'DDDD' + 'DDDL' + 'DDDD',
  'DDDD' + 'DDLD' + 'DDDD' + 'DDDL',
  'DEDD' + 'DDED' + 'DDDD' + 'DEDD',
  'DDDD' + 'DDDD' + 'DEDD' + 'DDDD',
  'DLDD' + 'DDDL' + 'DDDD' + 'DDDD',
  'DDDD' + 'DEDD' + 'DDDD' + 'DEDD',
  'DDDD' + 'DDDD' + 'DLDD' + 'DDDD',
];

const N = ART.length;

function hexToRgba(h) {
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
    255,
  ];
}

// 画到 size x size；scale<1 时居中留白，底色用 bgColor（用于 maskable 安全区）
function render(size, scale, bgColor) {
  const buf = Buffer.alloc(size * size * 4);
  const bg = bgColor ? hexToRgba(bgColor) : [0, 0, 0, 0];
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = bg[0]; buf[i * 4 + 1] = bg[1];
    buf[i * 4 + 2] = bg[2]; buf[i * 4 + 3] = bg[3];
  }
  const inner = Math.round(size * scale);
  const off = Math.floor((size - inner) / 2);
  for (let y = 0; y < inner; y++) {
    const sy = Math.min(N - 1, Math.floor((y * N) / inner));
    for (let x = 0; x < inner; x++) {
      const sx = Math.min(N - 1, Math.floor((x * N) / inner));
      const [r, g, b, a] = hexToRgba(PAL[ART[sy][sx]]);
      const o = ((y + off) * size + (x + off)) * 4;
      buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = a;
    }
  }
  return buf;
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(rgba, w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = __dirname;
function write(name, size, scale, bg) {
  const p = path.join(out, name);
  fs.writeFileSync(p, encodePng(render(size, scale, bg), size, size));
  console.log('已生成: ' + name + ' (' + size + 'x' + size + ')');
}

write('icon-192.png', 192, 1, null);
write('icon-512.png', 512, 1, null);
write('icon-maskable-512.png', 512, 0.62, '#7CB342');
write('apple-touch-icon.png', 180, 1, null);
