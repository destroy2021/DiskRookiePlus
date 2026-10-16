// 临时校验脚本：string-aware 剥离 JSONC 注释后用 JSON.parse（node 解析，避免 PowerShell 中文乱码）
import { readFileSync } from 'node:fs';

function stripJsonc(src) {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  return out;
}

const files = process.argv.slice(2);
let bad = 0;
for (const f of files) {
  const raw = readFileSync(f, 'utf8');
  try {
    const j = JSON.parse(stripJsonc(raw));
    console.log(`OK   ${f}`);
    if (j.tasks) {
      for (const t of j.tasks) console.log(`       task type=${t.type || '(none)'}  label=${t.label}`);
    }
    if (j.configurations) {
      for (const c of j.configurations) {
        console.log(`       launch type=${c.type}  request=${c.request}  name=${c.name}  preLaunchTask=${c.preLaunchTask || '(none)'}`);
      }
    }
  } catch (e) {
    bad++;
    console.log(`FAIL ${f}: ${e.message}`);
  }
}

// 交叉引用：launch 的 preLaunchTask 必须能在 tasks 里找到
const launch = JSON.parse(stripJsonc(readFileSync('.vscode/launch.json', 'utf8')));
const tasks = JSON.parse(stripJsonc(readFileSync('.vscode/tasks.json', 'utf8')));
const labels = new Set(tasks.tasks.map((t) => t.label));
console.log('\n=== preLaunchTask 交叉引用 ===');
for (const c of launch.configurations) {
  if (!c.preLaunchTask) continue;
  const ok = labels.has(c.preLaunchTask);
  if (!ok) bad++;
  console.log(`${ok ? 'RESOLVES' : 'BROKEN  '}  ${c.name} -> ${c.preLaunchTask}`);
}
console.log('\n=== dependsOn 交叉引用 ===');
for (const t of tasks.tasks) {
  const deps = [].concat(t.dependsOn || []);
  for (const d of deps) {
    if (typeof d !== 'string') continue;
    const ok = labels.has(d);
    if (!ok) bad++;
    console.log(`${ok ? 'RESOLVES' : 'BROKEN  '}  ${t.label} -> ${d}`);
  }
}
console.log(bad === 0 ? '\nALL REFERENCES RESOLVE' : `\n${bad} PROBLEM(S)`);
process.exit(bad === 0 ? 0 : 1);
