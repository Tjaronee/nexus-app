// Draws the app icons (a white check mark on the accent colour) as PNGs.
// Run with `npm run icons`; the output is committed, so this only needs
// rerunning when the design changes.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const BACKGROUND = [0x2f, 0x6f, 0x5e];
const FOREGROUND = [0xff, 0xff, 0xff];
// Check mark as a polyline in unit coordinates, kept inside the central 60%
// so it survives the circle mask Android applies to maskable icons.
const CHECK = [
  [0.3, 0.52],
  [0.44, 0.66],
  [0.71, 0.36],
];
const STROKE = 0.085;
const SAMPLES = 4;

/** Distance from point p to segment ab. @param {number[]} p @param {number[]} a @param {number[]} b */
function distToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** @param {number} x @param {number} y */
function inCheck(x, y) {
  for (let i = 0; i < CHECK.length - 1; i++) {
    if (distToSegment([x, y], CHECK[i], CHECK[i + 1]) <= STROKE / 2) return true;
  }
  return false;
}

/** @param {string} type @param {Buffer} data */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** @param {number} size */
function png(size) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3); // filter byte 0, then RGB
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          if (inCheck((x + (sx + 0.5) / SAMPLES) / size, (y + (sy + 0.5) / SAMPLES) / size)) hits++;
        }
      }
      const a = hits / (SAMPLES * SAMPLES);
      for (let c = 0; c < 3; c++) {
        row[1 + x * 3 + c] = Math.round(BACKGROUND[c] * (1 - a) + FOREGROUND[c] * a);
      }
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('icons', { recursive: true });
for (const [name, size] of /** @type {const} */ ([
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
])) {
  writeFileSync(`icons/${name}`, png(size));
}
