import fs from 'node:fs';

const p = process.argv[2];
const names = process.argv.slice(3);
let h = fs.readFileSync(p, 'utf-8');
let count = 0;
const wrap = (name) => {
  const re = new RegExp('<mat-menu #' + name + '="matMenu"([^>]*)>', 'g');
  let m;
  const matches = [];
  while ((m = re.exec(h)) !== null) {
    matches.push({ idx: m.index, end: m.index + m[0].length });
  }
  // process from end to start to keep indexes stable
  for (let i = matches.length - 1; i >= 0; i--) {
    const { end } = matches[i];
    const closeIdx = h.indexOf('</mat-menu>', end);
    if (closeIdx < 0) continue;
    // skip if already wrapped
    const body = h.slice(end, closeIdx);
    if (body.includes('matMenuContent')) continue;
    h = h.slice(0, end) + '\n<ng-template matMenuContent>' + body + '</ng-template>\n' + h.slice(closeIdx);
    count++;
  }
};
for (const n of names) wrap(n);
fs.writeFileSync(p, h);
console.log('wrapped', count, 'menus');
console.log('<mat-menu:', (h.match(/<mat-menu /g) || []).length);
console.log('matMenuContent:', (h.match(/matMenuContent/g) || []).length);
