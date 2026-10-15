#!/usr/bin/env node
'use strict';

/*
 * Geletkaplus ship-standards :: enforcement gate
 *
 * Wraps checks/run-checks.js for the two hook events that can actually block.
 *
 *   gate.js edit   PostToolUse on Write/Edit. Checks the file just written at
 *                  "build" stage, so [TKTK: ...] is still legal. Blocks on must
 *                  only, while there is still context to fix it cheaply.
 *
 *   gate.js done   Stop. Full suite at "done" stage over the repo. Never blocks:
 *                  prints the outstanding findings as a plain list to the person,
 *                  and only when the list differs from the last one shown. An
 *                  open [TKTK: ...] waiting on client copy cannot be fixed by
 *                  nagging, so it is tallied, not argued about. CI is the gate.
 *
 * Blocking (edit mode only) works by exiting 2 with the reason on stderr, which
 * is fed back to Claude to act on rather than shown as a crash.
 *
 * Escape hatch, on purpose:
 *   - SHIP_STANDARDS_SKIP=1 bypasses everything. A determined person can disable a
 *     local hook anyway; a documented switch beats an uninstall at midnight.
 */

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODE = process.argv[2] === 'done' ? 'done' : 'edit';
const CHECKS = path.join(__dirname, '..', 'checks', 'run-checks.js');

const CHECKABLE = new Set([
  '.css', '.scss', '.sass', '.less', '.styl', '.pcss',
  '.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.astro', '.mjs', '.cjs',
  '.html', '.htm', '.md', '.mdx', '.json', '.php', '.twig', '.liquid', '.hbs',
  '.ejs', '.pug', '.njk'
]);

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8')) || {};
  } catch (err) {
    return {};
  }
}

/*
 * Always ask for JSON so the gate decides what blocks, rather than inferring it
 * from an exit code. The tiers live in one table in run-checks.js; this file only
 * decides what to do about them.
 */
function runChecks(args, cwd) {
  let raw = '';
  try {
    raw = execFileSync(process.execPath, [CHECKS].concat(args), {
      cwd: cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    // Exit 1 means findings, and stdout still holds them. Anything else means the
    // suite itself broke, which must never be treated as a violation.
    if (!err || err.status !== 1) return null;
    raw = String(err.stdout || '');
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function list(findings) {
  return findings
    .map((f) => '  ' + f.file + ':' + f.line + '  ' + f.message)
    .join('\n');
}

/*
 * Remembers the last list shown for this repo so an unchanged list stays quiet.
 * Keyed on rule, file, and line text rather than line number, so edits elsewhere
 * in a file do not make old findings look new. Losing the file is harmless; it
 * means the list is shown once more.
 */
function changedSinceLastShown(cwd, findings) {
  const key = crypto.createHash('sha1').update(String(cwd)).digest('hex').slice(0, 16);
  const statePath = path.join(os.tmpdir(), 'gk-ship-standards-tally-' + key);
  const digest = crypto.createHash('sha1')
    .update(findings.map((f) => f.rule + '|' + f.file + '|' + (f.excerpt || f.message))
      .sort().join('\n'))
    .digest('hex');
  let last = null;
  try { last = fs.readFileSync(statePath, 'utf8'); } catch (err) { /* first run */ }
  if (last === digest) return false;
  try { fs.writeFileSync(statePath, digest, 'utf8'); } catch (err) { /* non-fatal */ }
  return true;
}

function block(message) {
  process.stderr.write(message);
  process.exit(2);
}

function main() {
  if (process.env.SHIP_STANDARDS_SKIP === '1') process.exit(0);
  if (!fs.existsSync(CHECKS)) process.exit(0);

  const input = readInput();
  const cwd = input.cwd || process.cwd();

  // Enforcement is opt-in per repo: the config file is the switch, the same way a
  // waiver needs a name. Without it the standards are guidance, not a gate.
  const configPath = path.join(cwd, '.claude', 'ship-standards.json');
  if (!fs.existsSync(configPath)) process.exit(0);

  let scope = 'repo';
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (cfg && cfg.scope === 'touched') scope = 'touched';
  } catch (err) { /* invalid config already reported by the checker; treat as repo */ }

  if (MODE === 'done') {
    const args = ['--all', '--stage', 'done', '--root', cwd, '--json'];
    if (scope === 'touched') args.push('--touched');
    const result = runChecks(args, cwd);
    if (!result) process.exit(0);

    const open = result.findings.filter((f) => f.severity !== 'consider');
    if (!changedSinceLastShown(cwd, open)) process.exit(0);
    if (!open.length) process.exit(0);

    const rank = { must: 0, should: 1 };
    open.sort((a, b) => rank[a.severity] - rank[b.severity]);
    // systemMessage goes to the person, not back to Claude, so it informs without
    // starting a conversation about copy nobody here can supply.
    process.stdout.write(JSON.stringify({
      systemMessage: 'Not yet up to standard (' + open.length + '):\n' +
        open.map((f) => '  [' + f.severity + '] ' + f.file + ':' + f.line + '  ' +
          f.message).join('\n')
    }));
    process.exit(0);
  }

  // PostToolUse (edit mode)
  const toolInput = input.tool_input || {};
  const file = toolInput.file_path || toolInput.path || toolInput.notebook_path;
  if (!file) process.exit(0);
  if (!CHECKABLE.has(path.extname(String(file)).toLowerCase())) process.exit(0);
  if (!fs.existsSync(file)) process.exit(0);

  const result = runChecks(
    ['--files', String(file), '--stage', 'build', '--root', cwd, '--json'], cwd);
  if (!result) process.exit(0);

  const must = result.findings.filter((f) => f.severity === 'must');
  if (!must.length) process.exit(0);

  block('Standards violation:\n\n' + list(must) + '\n\nFix it in this file before moving on.\n');
}

try {
  main();
} catch (err) {
  // A broken gate must never block work. Fail open, loudly enough to notice.
  process.stderr.write('ship-standards gate error (ignored): ' + (err && err.message) + '\n');
  process.exit(0);
}
