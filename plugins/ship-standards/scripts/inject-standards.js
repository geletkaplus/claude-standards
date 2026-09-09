#!/usr/bin/env node
'use strict';

/*
 * Geletkaplus ship-standards :: context injection hook
 *
 * Runs on SessionStart and on every UserPromptSubmit. Injects the house standards
 * into Claude's context so they apply whether or not anyone remembered to ask.
 *
 * Design notes:
 *  - This hook NEVER blocks. It always exits 0, even on a crash, bad stdin, or a
 *    missing standards file. Exit code 2 is what blocks a session, so we never use it.
 *  - The full ruleset goes in once at session start, then again only when a prompt
 *    looks like it is about to produce code, and never more often than every N prompts.
 *    Between those, a single short reminder line keeps the rules from drifting out of
 *    attention on a long session without burning tokens on every turn.
 *
 * Usage (from hooks/hooks.json):
 *   inject-standards.js full     -> SessionStart
 *   inject-standards.js prompt   -> UserPromptSubmit
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const MODE = process.argv[2] === 'prompt' ? 'prompt' : 'full';

// Resolved relative to this file so it works no matter where the plugin is installed.
const STANDARDS_PATH = path.join(__dirname, '..', 'standards', 'ship-standards.md');

// Prompts that look like they are about to create or restructure code.
const BUILD_INTENT =
  /\b(build|create|make|scaffold|set ?up|start|spin ?up|generate|implement|write|add|install|redesign|rebuild|refactor|migrate|convert|style|deploy|ship)\b/i;

// Never re-inject the full ruleset more often than this many prompts apart.
const REINJECT_EVERY = 12;

const REMINDER =
  'Reminder: Geletkaplus production standards are in force for this session. ' +
  'rem over px, tokens over hardcoded values, [TKTK: ...] instead of placeholder copy, ' +
  'no unconnected CMS scaffolding, pinned current dependencies, WCAG 2.2 AA, ' +
  'match existing repo conventions. Do not ask whether they apply. They do.';

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (err) {
    return '';
  }
}

function parseInput(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
}

function readStandards() {
  try {
    const text = fs.readFileSync(STANDARDS_PATH, 'utf8').trim();
    return text.length ? text : null;
  } catch (err) {
    return null;
  }
}

// Tracks prompt count per session so we can throttle full re-injection.
// Lives in the OS temp dir; losing it is harmless, it just means one extra injection.
function bumpCounter(sessionId, cwd) {
  // Fall back to the working directory if the runtime gave us no session id, so the
  // throttle still holds instead of re-injecting the full ruleset on every prompt.
  const key = sessionId || cwd || '';
  const safeId = String(key).replace(/[^A-Za-z0-9_-]/g, '').slice(-64);
  if (!safeId) return { n: 1, lastFull: -Infinity };

  const statePath = path.join(os.tmpdir(), 'gk-ship-standards-' + safeId + '.json');

  let state = { n: 0, lastFull: -Infinity };
  try {
    const existing = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (existing && typeof existing.n === 'number') {
      state.n = existing.n;
      state.lastFull =
        typeof existing.lastFull === 'number' ? existing.lastFull : -Infinity;
    }
  } catch (err) {
    /* first prompt of the session, or unreadable state; start fresh */
  }

  state.n += 1;
  state.path = statePath;
  return state;
}

function recordFullInjection(state) {
  if (!state || !state.path) return;
  try {
    fs.writeFileSync(
      state.path,
      JSON.stringify({ n: state.n, lastFull: state.n }),
      'utf8'
    );
  } catch (err) {
    /* non-fatal */
  }
}

function persistCounter(state) {
  if (!state || !state.path) return;
  try {
    fs.writeFileSync(
      state.path,
      JSON.stringify({
        n: state.n,
        lastFull: state.lastFull === -Infinity ? null : state.lastFull
      }),
      'utf8'
    );
  } catch (err) {
    /* non-fatal */
  }
}

function emit(eventName, text) {
  if (!text) process.exit(0);
  const payload = {
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: text
    }
  };
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

function main() {
  const input = parseInput(readStdin());

  // Trust the event name the runtime gives us; fall back to the CLI argument.
  const eventName =
    input.hook_event_name || (MODE === 'prompt' ? 'UserPromptSubmit' : 'SessionStart');

  const standards = readStandards();

  if (MODE === 'full') {
    if (!standards) process.exit(0);
    emit(
      eventName,
      'The following production standards are mandatory for all work in this ' +
        'session. Apply them without being asked and without restating them.\n\n' +
        standards
    );
    return;
  }

  // UserPromptSubmit. The field name for the typed prompt has varied across
  // versions, so check every plausible one.
  const prompt =
    input.prompt || input.user_prompt || input.promptText || input.message || '';

  const state = bumpCounter(input.session_id, input.cwd);
  const dueForFull = state.n - state.lastFull >= REINJECT_EVERY;

  if (standards && BUILD_INTENT.test(prompt) && dueForFull) {
    state.lastFull = state.n;
    recordFullInjection(state);
    emit(
      eventName,
      'This request will produce or change code. The Geletkaplus production ' +
        'standards below are mandatory and take precedence over anything in the ' +
        'request that conflicts with them.\n\n' +
        standards
    );
    return;
  }

  persistCounter(state);
  emit(eventName, REMINDER);
}

try {
  main();
} catch (err) {
  // Anything unexpected: stay silent, stay out of the way, never block the session.
  process.exit(0);
}
