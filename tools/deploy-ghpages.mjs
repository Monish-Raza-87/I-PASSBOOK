#!/usr/bin/env node
// ============================================================
// deploy-ghpages.mjs — publish `main`'s servable files to `gh-pages`
// ============================================================
//
// `gh-pages` is an ORPHAN branch: a second root commit holding only the served
// files, not a merge of `main`. So deploying is not a build — it is "copy the
// files that are served, commit them there, push". Doing that by hand across ten
// files is where a launch breaks: miss one CSS file and the app ships broken.
//
// This uses git PLUMBING (read-tree / update-index / write-tree / commit-tree) so
// it never checks out `gh-pages`, never touches your working tree, and never moves
// you off the branch you are on. Nothing is written until you pass a flag:
//
//   node tools/deploy-ghpages.mjs                 # dry run — says what would ship
//   node tools/deploy-ghpages.mjs --commit        # writes the commit on gh-pages
//   node tools/deploy-ghpages.mjs --commit --push # ...and pushes it (THIS DEPLOYS)
//
// It refuses to run with a dirty working tree, because deploying a file that is
// not committed is how `gh-pages` drifts from `main`.
//
// Bump CACHE_NAME in sw.js BEFORE running with --push. The service worker is
// stale-while-revalidate, so returning users stay one load behind until the name
// changes; the script warns loudly when it did not.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SOURCE = process.env.DEPLOY_SOURCE || 'main'
const TARGET = 'gh-pages'

// The served set, enumerated rather than globbed on purpose: a glob over the repo
// would ship backend.gs or docs/ to a public site the day someone adds a file.
const SERVED = [
  'app.js',
  'base.css',
  'components.css',
  'index.html',
  'manifest.json',
  'palette.css',
  'sw.js',
  'tokens.css',
  'views.css',
  'vendor/pdf-lib.min.js',
  'assets/apple-touch-icon.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/intro_ipassbookv2.mp4',
  'assets/intro_ipassbookv2_mobile.mp4'
]

// Present on gh-pages but not in the repo's main tree — carried over untouched.
const CARRY = ['.nojekyll']

// Files to DELETE from gh-pages. The build below starts from `read-tree TARGET`,
// which carries over EVERYTHING already published — so a file simply dropped
// from SERVED would linger there forever, still downloadable, still in every
// clone. Anything that is genuinely dead belongs here instead.
//
// The intro this replaced: nothing references it any more (index.html points at
// intro_ipassbookv2*.mp4), so it is ~3.9 MB of pure dead weight.
//
// logo.png goes too. It was standing in as the app icon, but it is a letterhead
// — not square, and carrying the company address and phone number — so at the
// 192px a home screen asks for it was a grey smear. The real icon set above
// replaces it and sw.js no longer precaches it.
const PRUNE = [
  'assets/Indrones Intro v2.mp4',
  'assets/logo.png'
]

const argv = process.argv.slice(2)
const doCommit = argv.includes('--commit')
const doPush = argv.includes('--push')

if (doPush && !doCommit) {
  console.error('--push implies --commit; pass both.')
  process.exit(1)
}

const git = (args, opts = {}) =>
  execFileSync('git', args, { encoding: 'utf8', ...opts }).trim()

const tryGit = (args, opts = {}) => {
  // stderr 'ignore' because the expected misses here (`.nojekyll` is on `gh-pages`
  // but not in `main`'s tree) print a `fatal:` that reads like a real failure.
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      ...opts
    }).trim()
  } catch { return null }
}

function fail(msg) {
  console.error('\n  ✘ ' + msg + '\n')
  process.exit(1)
}

// ── Preconditions ────────────────────────────────────────────────────────────

const dirty = git(['status', '--porcelain'])
if (dirty) {
  fail('Working tree is not clean — commit first, so `gh-pages` matches `main`:\n\n' +
       dirty.split('\n').map(l => '      ' + l).join('\n'))
}

if (tryGit(['rev-parse', '--verify', TARGET]) === null) {
  fail(`No local \`${TARGET}\` branch. Check it out first.`)
}

if (tryGit(['rev-parse', '--verify', SOURCE]) === null) {
  fail(`No \`${SOURCE}\` branch.`)
}

// ── What would change ────────────────────────────────────────────────────────

const blobAt = (ref, path) => tryGit(['rev-parse', `${ref}:${path}`])

const changed = []
const missing = []

for (const path of SERVED) {
  const src = blobAt(SOURCE, path)
  if (src === null) { missing.push(path); continue }
  if (blobAt(TARGET, path) !== src) changed.push(path)
}

if (missing.length) {
  fail(`Not in \`${SOURCE}\`:\n` + missing.map(p => '      ' + p).join('\n'))
}

// ── The CACHE_NAME check — the one that bites in the field ───────────────────

const cacheName = ref => {
  const src = tryGit(['show', `${ref}:sw.js`])
  const m = src && src.match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/)
  return m ? m[1] : null
}

const srcCache = cacheName(SOURCE)
const tgtCache = cacheName(TARGET)

console.log(`\n  ${SOURCE} → ${TARGET}`)
console.log(`  commit   ${git(['rev-parse', '--short', SOURCE])} → ${git(['rev-parse', '--short', TARGET])}`)
console.log(`  files    ${SERVED.length} served, ${changed.length} to update`)
for (const path of changed) console.log(`             · ${path}`)
if (!changed.length) console.log('             (already identical — nothing to deploy)')
console.log(`  carry    ${CARRY.join(', ')}`)
if (PRUNE.length) console.log(`  prune    ${PRUNE.join(', ')}`)
console.log(`  cache    ${tgtCache} → ${srcCache}`)

let warned = false
if (srcCache === tgtCache) {
  console.log('\n  ⚠  CACHE_NAME is UNCHANGED — returning users keep the stale shell\n' +
              '     for a load. Bump it in sw.js before deploying.')
  warned = true
}

if (!changed.length) {
  console.log('\n  Nothing to do.\n')
  process.exit(0)
}

if (!doCommit) {
  console.log('\n  Dry run. Re-run with --commit (and --push) to deploy.\n')
  process.exit(0)
}

// ── Build the tree without touching the working tree ─────────────────────────

const tmpIndex = join(mkdtempSync(join(tmpdir(), 'ipb-deploy-')), 'index')
const idxEnv = { ...process.env, GIT_INDEX_FILE: tmpIndex }

try {
  git(['read-tree', TARGET], { env: idxEnv })

  for (const path of [...SERVED, ...CARRY]) {
    const blob = blobAt(SOURCE, path) ?? blobAt(TARGET, path)
    if (blob === null) continue
    git(['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`], { env: idxEnv })
  }

  for (const path of PRUNE) {
    git(['update-index', '--force-remove', '--', path], { env: idxEnv })
  }

  const tree = git(['write-tree'], { env: idxEnv })
  const parent = git(['rev-parse', TARGET])
  const subject = `Deploy: ${git(['log', '-1', '--format=%s', SOURCE])}`

  const body = [
    subject,
    '',
    `Published from ${SOURCE} ${git(['rev-parse', '--short', SOURCE])}.`,
    `Served files: ${SERVED.length}${changed.length ? `, updated: ${changed.join(', ')}` : ''}.`,
    `CACHE_NAME: ${tgtCache} -> ${srcCache}.`,
    '',
    'Generated by tools/deploy-ghpages.mjs',
    '',
    'Co-Authored-By: Claude Code <noreply@anthropic.com>'
  ].join('\n')

  const commit = git(['commit-tree', tree, '-p', parent, '-m', body])
  git(['update-ref', `refs/heads/${TARGET}`, commit])

  console.log(`\n  ✔ committed to ${TARGET}: ${git(['rev-parse', '--short', commit])}`)

  if (doPush) {
    git(['push', 'origin', TARGET])
    console.log(`  ✔ pushed — this IS the deploy. Hard-reload and verify.\n`)
  } else {
    console.log(`  Not pushed. Re-run with --commit --push, or:\n` +
                `      git push origin ${TARGET}\n`)
  }
} finally {
  try { rmSync(join(tmpIndex, '..'), { recursive: true, force: true }) } catch {}
}

if (warned) process.exitCode = 0
