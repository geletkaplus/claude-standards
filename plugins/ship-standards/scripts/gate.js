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
 *   gate.js done   Stop. Full suite at "done" stage over the repo. Blocks on must.
 *                  Should-level findings do not block; they are surfaced once so
 *                  they get named out loud instead of quietly skipped.
 *
 * Blocking works by exiting 2 with the reason on stderr, which is fed back to
 * Claude to act on rather than shown as a crash.
 *
 * Escape hatches, on purpose:
 *   - stop_hook_active: if Stop already fired once and Claude is working through
 *     the result, do not block again. Otherwise you can build an inescapable loop.
 *   - SHIP_STANDARDS_SKIP=1 bypasses everything. A determined person can disable a
 *     local hook anyway; a documented switch beats an uninstall at midnight.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
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

function block(message) {
  process.stderr.write(message);
  process.exit(2);
}

function main() {
  if (process.env.SHIP_STANDARDS_SKIP === '1') process.exit(0);
  if (!fs.existsSync(CHECKS)) process.exit(0);

  const input = readInput();
  const cwd = input.cwd || process.cwd();

  if (MODE === 'done') {
    // Already blocked once this turn; let Claude finish acting on that.
    if (input.stop_hook_active) process.exit(0);

    const result = runChecks(['--all', '--stage', 'done', '--root', cwd, '--json'], cwd);
    if (!result) process.exit(0);

    const must = result.findings.filter((f) => f.severity === 'must');
    if (must.length) {
      block(
        'Not done. These must be fixed:\n\n' + list(must) +
        '\n\nFix them, then finish. Do not call this complete while any remain.\n'
      );
    }

    const should = result.findings.filter((f) => f.severity === 'should');
    if (should.length) {
      block(
        'These are outstanding:\n\n' + list(should) +
        '\n\nFix them, or name each one you are leaving and why. Do not go quiet ' +
        'on them. If one is settled policy on this project, waive it in ' +
        '.claude/ship-standards.json with a reason and an approver.\n'
      );
    }

    process.exit(0);
  }

  // PostToolUse
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
