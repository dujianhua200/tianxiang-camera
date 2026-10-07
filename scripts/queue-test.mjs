/* 补传队列测试：正常截断 + localStorage 配额降级
 * 运行：node scripts/queue-test.mjs   （需先 npm install）
 * 编译 src/lib/cloud.ts 为 CommonJS 后，用配额受限的 localStorage mock 验证：
 *  1. 正常路径：7 张进队只保留最近 5 张
 *  2. 配额紧张：超配额不抛异常，且最新一张永远保留
 *  3. 配额极小：一张都存不下时不抛异常、队列为空
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const dir = mkdtempSync(join(tmpdir(), 'txq-'));
writeFileSync(
  join(dir, 'shim.d.ts'),
  'interface Window { AndroidBridge?: any; __txAsyncDone?: (id: number, ret: string) => void; }\ndeclare var window: Window & typeof globalThis;\n'
);
execSync(
  `npx tsc src/lib/cloud.ts "${join(dir, 'shim.d.ts')}" --outDir "${dir}" --module commonjs --target es2020 --lib es2020,dom --skipLibCheck`,
  { stdio: 'pipe' }
);

global.window = {};
function makeLS(quota) {
  const store = new Map();
  const sizeOf = () => {
    let s = 0;
    for (const v of store.values()) s += v.length;
    return s;
  };
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      const v2 = String(v);
      const next = sizeOf() - (store.has(k) ? store.get(k).length : 0) + v2.length;
      if (next > quota) {
        const e = new Error('QuotaExceededError');
        e.name = 'QuotaExceededError';
        throw e;
      }
      store.set(k, v2);
    },
    removeItem: (k) => store.delete(k),
  };
}
const fresh = () => createRequire(join(dir, 'x.js'))(join(dir, 'cloud.js'));
const item = (tag, n) => ({ meta: { fileName: tag }, image: 'x'.repeat(n) });

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) {
    pass++;
    console.log('  ✓', name);
  } else {
    fail++;
    console.log('  ✗', name);
  }
};

global.localStorage = makeLS(1e9);
let c = fresh();
for (let i = 1; i <= 7; i++) c.enqueue(item('p' + i, 10));
let q = c.readQueue();
ok('7张进队只剩5张', q.length === 5);
ok('保留的是最新的5张', q[0].meta.fileName === 'p3' && q[4].meta.fileName === 'p7');

global.localStorage = makeLS(700);
c = fresh();
c.enqueue(item('A', 300));
c.enqueue(item('B', 300));
c.enqueue(item('C', 300));
q = c.readQueue();
ok('超配额不抛异常', true);
ok('最新一张 C 一定在', q.some((x) => x.meta.fileName === 'C'));
ok('队列按时间有序', q.length >= 1 && q[q.length - 1].meta.fileName === 'C');

global.localStorage = makeLS(50);
c = fresh();
let threw = false;
try {
  c.enqueue(item('Z', 300));
} catch {
  threw = true;
}
ok('极小配额不抛异常', !threw);
ok('存不下时队列为空', c.readQueue().length === 0);

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
