import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const input = process.argv[2];
const outputDir = process.argv[3];
if (!input || !outputDir) throw new Error('Usage: node tools/extract-embedded-pngs.mjs <input> <output-dir>');

const bytes = fs.readFileSync(input);
const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const found = [];
let cursor = 0;

fs.mkdirSync(outputDir, { recursive: true });
while ((cursor = bytes.indexOf(signature, cursor)) !== -1) {
  let pos = cursor + signature.length;
  let end = -1;
  let width = 0;
  let height = 0;
  try {
    while (pos + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(pos);
      const type = bytes.toString('ascii', pos + 4, pos + 8);
      if (length > 128 * 1024 * 1024 || pos + 12 + length > bytes.length) break;
      if (type === 'IHDR' && length >= 8) {
        width = bytes.readUInt32BE(pos + 8);
        height = bytes.readUInt32BE(pos + 12);
      }
      pos += 12 + length;
      if (type === 'IEND') {
        end = pos;
        break;
      }
    }
  } catch {}
  if (end !== -1 && width > 0 && height > 0) {
    const png = bytes.subarray(cursor, end);
    const hash = crypto.createHash('sha256').update(png).digest('hex').slice(0, 12);
    const name = `${String(found.length + 1).padStart(3, '0')}-${width}x${height}-${hash}.png`;
    fs.writeFileSync(path.join(outputDir, name), png);
    found.push({ name, offset: cursor, length: png.length, width, height, hash });
    cursor = end;
  } else {
    cursor += signature.length;
  }
}

console.log(JSON.stringify(found, null, 2));

