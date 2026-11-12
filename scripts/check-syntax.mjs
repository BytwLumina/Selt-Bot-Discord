import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;

function checkFile(file) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log('ok   ' + path.relative(root, file));
  } catch (e) {
    failed++;
    console.error('FAIL ' + path.relative(root, file));
    console.error(String(e.stderr || e.message));
  }
}

for (const dir of ['src', 'src/commands', 'test']) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) continue;
  for (const name of fs.readdirSync(full)) {
    if (!/\.(js|mjs)$/.test(name)) continue;
    checkFile(path.join(full, name));
  }
}

// Khối <script> trong web.html cũng phải parse được
const htmlPath = path.join(root, 'src', 'web.html');
if (fs.existsSync(htmlPath)) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const blocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const biggest = blocks.sort((a, b) => b.length - a.length)[0] || '';
  const tmp = path.join(os.tmpdir(), `web-html-check-${process.pid}.js`);
  fs.writeFileSync(tmp, biggest);
  checkFile(tmp);
  try { fs.rmSync(tmp, { force: true }); } catch {}
}

if (failed) {
  console.error(`\n${failed} file lỗi cú pháp`);
  process.exit(1);
}
console.log('\nTất cả file cú pháp đúng');
