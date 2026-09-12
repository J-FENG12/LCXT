import fs from 'node:fs';
import path from 'node:path';
import * as PE from 'pe-library';
import * as ResEdit from 'resedit';

const input = process.argv[2];
if (!input) throw new Error('Usage: node tools/inspect-runtime-resources.mjs <exe>');
const bytes = fs.readFileSync(input);
const exe = PE.NtExecutable.from(bytes, { ignoreCert: true });
const resources = PE.NtExecutableResource.from(exe);

const summary = resources.entries.map((entry) => ({
  type: entry.type,
  id: entry.id,
  lang: entry.lang,
  codepage: entry.codepage,
  size: entry.bin?.byteLength ?? entry.bin?.length ?? 0,
}));

console.log(JSON.stringify({
  file: path.basename(input),
  iconGroups: ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries).map((entry) => ({
    id: entry.id,
    lang: entry.lang,
    icons: entry.icons.map((icon) => ({ width: icon.width, height: icon.height, bitCount: icon.bitCount })),
  })),
  resourceTypes: Object.entries(Object.groupBy(summary, (entry) => String(entry.type))).map(([type, entries]) => ({
    type,
    count: entries.length,
    entries,
  })),
}, null, 2));

