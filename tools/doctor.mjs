// npm run doctor            what Motion Studio needs, and whether this machine has it
// npm run doctor -- --fix   install what's missing: the build, Playwright's browser, and (with winget or brew)
//                           ffmpeg and yt-dlp
// After `npm install`, this runs with --postinstall: it builds and fetches the browser, quietly, and never fails the
// install (set MOTION_SKIP_SETUP=1 to skip it).
import { checks, runFix } from '../server/doctor.mjs';
import { ROOT, PROJECT } from '../server/project.mjs';

const argv = process.argv.slice(2);
const post = argv.includes('--postinstall');
const fix = post || argv.includes('--fix');
if (post && process.env.MOTION_SKIP_SETUP) process.exit(0);

const print = (list) => {
  const w = Math.max(...list.map((c) => c.label.length));
  for (const c of list) {
    const mark = c.ok ? '✓' : c.required ? '✗' : '!';
    console.log(`  ${mark} ${c.label.padEnd(w)}  ${c.detail}${c.ok ? '' : `\n    ${' '.repeat(w)}  → ${c.fix}`}`);
  }
};

let list = checks();
if (!post) {
  console.log(`Motion Studio setup · studio ${ROOT}${PROJECT !== ROOT ? ` · project ${PROJECT}` : ''}`);
  print(list);
}

if (fix) {
  // npm install has just run under --postinstall, so only the build and the browser are its business
  const todo = list.filter((c) => !c.ok && (post ? ['build', 'browser'].includes(c.id) : true));
  for (const c of todo) {
    console.log(`\n→ ${c.label}: ${c.fix}`);
    if (!runFix(c)) console.log(`  not installed automatically here: run it yourself`);
  }
  if (todo.length) {
    list = checks();
    console.log('\nAfter fixing:');
    print(list);
  }
}

const bad = list.filter((c) => !c.ok);
if (post) process.exit(0);
if (!bad.length) console.log('\nAll set.');
else if (!fix) console.log(`\n${bad.length} to fix: npm run doctor -- --fix`);
process.exit(bad.some((c) => c.required) ? 1 : 0);
