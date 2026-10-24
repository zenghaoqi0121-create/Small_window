// Read-only ASAR inspection for verifying the installed Harness contract.
import fs from 'node:fs';
const [archive, ...patterns] = process.argv.slice(2);
if (!archive || !patterns.length) throw new Error('Usage: node scripts/inspect-harness.mjs <app.asar> <path-fragment>...');
const fd = fs.openSync(archive, 'r');
try {
  const prefix = Buffer.alloc(16);
  fs.readSync(fd, prefix, 0, 16, 0);
  const bytes = Buffer.alloc(prefix.readUInt32LE(12));
  fs.readSync(fd, bytes, 0, bytes.length, 16);
  const root = JSON.parse(bytes.toString());
  const base = 8 + prefix.readUInt32LE(4);
  function walk(node, path = '') {
    for (const [key, entry] of Object.entries(node.files ?? {})) {
      const name = `${path}/${key}`;
      if (entry.files) walk(entry, name);
      else if (patterns.some(p => name.includes(p))) {
        console.log(`FILE ${name}`);
        if (entry.unpacked) { console.log('(unpacked)'); continue; }
        const data = Buffer.alloc(entry.size);
        fs.readSync(fd, data, 0, data.length, base + Number(entry.offset));
        console.log(data.toString());
      }
    }
  }
  walk(root);
} finally { fs.closeSync(fd); }
