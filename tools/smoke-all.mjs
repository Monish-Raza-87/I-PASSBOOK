// Runs every smoke suite.
//
//   node tools/smoke-all.mjs
//
// There is no build step and no test framework in this project, so this is the
// whole test command. Suites are independent node scripts; this just runs them
// in order and reports a single verdict.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const dir = new URL('.', import.meta.url);
const suites = fs.readdirSync(dir)
  .filter(f => /^smoke-.*\.mjs$/.test(f) && f !== 'smoke-all.mjs')
  .sort();

let failed = 0;
for (const suite of suites) {
  const run = spawnSync(process.execPath, [new URL(suite, dir).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
    { encoding: 'utf8' });
  const out = (run.stdout || '') + (run.stderr || '');
  const passes = (out.match(/^ {2}PASS/gm) || []).length;
  const skips = (out.match(/^SKIP/gm) || []).length;
  const okRun = run.status === 0;
  if (!okRun) failed++;

  console.log(`${okRun ? 'ok  ' : 'FAIL'}  ${suite.padEnd(24)} ${passes} passed${skips ? `, ${skips} skipped` : ''}`);
  if (!okRun) console.log(out.split('\n').filter(l => /FAIL|Error|error:/.test(l)).join('\n'));
}

console.log(failed ? `\n${failed} SUITE(S) FAILED\n` : '\nALL SUITES PASS\n');
process.exit(failed ? 1 : 0);
