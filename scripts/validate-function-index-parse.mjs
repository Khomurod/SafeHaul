#!/usr/bin/env node
/** Quick check that deploy-functions-incremental export parsing matches functions/index.js */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(fileURLToPath(import.meta.url));
const indexPath = join(root, '../functions/index.js');
const src = readFileSync(indexPath, 'utf8');

function modulePathToFile(rel) {
  let n = rel.replace(/^\.\//, '');
  if (!n.endsWith('.js')) n += '.js';
  return join('functions', n).replace(/\\/g, '/');
}

const varToFile = new Map();
const reRequire = /(?:const|let|var)\s+(\w+)\s*=\s*require\(['"](\.\/[^'"]+)['"]\)/g;
let m;
while ((m = reRequire.exec(src))) {
  varToFile.set(m[1], modulePathToFile(m[2]));
}

const exportToFile = new Map();
const reExportVar = /exports\.(\w+)\s*=\s*(\w+)\.(\w+)/g;
while ((m = reExportVar.exec(src))) {
  const f = varToFile.get(m[2]);
  if (f) exportToFile.set(m[1], f);
}
const reExportReq = /exports\.(\w+)\s*=\s*require\(['"](\.\/[^'"]+)['"]\)\.(\w+)/g;
while ((m = reExportReq.exec(src))) {
  exportToFile.set(m[1], modulePathToFile(m[2]));
}

const raw = new Set([...src.matchAll(/exports\.(\w+)\s*=/g)].map((x) => x[1]));
const ok = exportToFile.size === raw.size && [...raw].every((n) => exportToFile.has(n));
console.log(ok ? 'OK' : 'FAIL', '| mapped', exportToFile.size, '| raw', raw.size);
if (!ok) {
  const missing = [...raw].filter((n) => !exportToFile.has(n));
  console.log('Missing from map:', missing.join(', ') || '(none)');
  process.exit(1);
}
