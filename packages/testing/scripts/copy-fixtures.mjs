import fs from 'node:fs';
fs.mkdirSync('dist/fixtures', { recursive: true });
for (const f of fs.readdirSync('src/fixtures')) fs.copyFileSync(`src/fixtures/${f}`, `dist/fixtures/${f}`);
