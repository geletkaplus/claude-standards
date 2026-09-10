#!/usr/bin/env node
'use strict';

/*
 * Geletkaplus ship-standards :: enforcement gate
 *
 * Wraps checks/run-checks.js for the two hook events that can actually block.
 *
 *   gate.js edit   PostToolUse on Write/Edit. Checks only the file just written,
 *                  at "build" stage, so [TKTK: ...] markers are still legal. Blocks
 *                  on lorem ipsum, px, and the rest, immediately, while there is
 *                  still context to fix it in.
 *
 *   gate.js done   Stop. Runs the full suite at "done" stage over the whole repo,
 *                  including unresolved TKTK markers. Blocks the session from
 *                  reporting completion while anything is outstanding.
 *
 * Blocking works by exiting 2 with the reason on stderr, which is fed back to
 * Claude to act on rather than shown as a crash.
 *
 * Two deliberate escape hatches:
 *   - stop_hook_active: if the Stop hook already fired once and Claude is working
 *     through the result, we do not block again. Without this you can build an
 *     inescapable loop, which is worse than a missed check.
 *   - SHIP_STANDARDS_SKIP=1 in the environment bypasses everything. A determined
 *     person can always disable a local hook, so it is better to give them a
 *     documented switch than to have them uninstall the plugin outright.
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

function runChecks(args, cwd) {
  try {
    execFileSync(process.execPath, [CHECKS].concat(args), {
      cwd: cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { clean: true, output: '' };
  } catch (err) {
    // Exit 1 means violations were found. Exit 3 means the suite itself broke,
    // which must never be treated as a violation.
    if (err && err.status === 1) {
      return { clean: false, output: String(err.stdout || '').trim() };
    }
    return { clean: true, output: '' };
  }
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

    const result = runChecks(['--all', '--stage', 'done', '--root', cwd], cwd);
    if (result.clean) process.exit(0);

    block(
      'This work is not finished. The Geletkaplus standards checks are failing:\n\n' +
      result.output +
      '\n\nFix every item above, then finish. Do not describe the work as done, ' +
      'complete, or ready while any of these remain. If something genuinely cannot ' +
      'be resolved now, say so explicitly and name it, rather than going quiet on it.\n'
    );
  }

  // PostToolUse
  const toolInput = input.tool_input || {};
  const file = toolInput.file_path || toolInput.path || toolInput.notebook_path;
  if (!file) process.exit(0);
  if (!CHECKABLE.has(path.extname(String(file)).toLowerCase())) process.exit(0);
  if (!fs.existsSync(file)) process.exit(0);

  const result = runChecks(['--files', String(file), '--stage', 'build', '--root', cwd], cwd);
  if (result.clean) process.exit(0);

  block(
    'That edit violates the Geletkaplus production standards:\n\n' +
    result.output +
    '\nFix it now, in this file, before moving on.\n'
  );
}

try {
  main();
} catch (err) {
  // A broken gate must never block work. Fail open, loudly enough to notice.
  process.stderr.write('ship-standards gate error (ignored): ' + (err && err.message) + '\n');
  process.exit(0);
}
