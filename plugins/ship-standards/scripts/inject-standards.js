#!/usr/bin/env node
'use strict';

/*
 * Geletkaplus ship-standards :: context injection hook
 *
 * Runs on SessionStart and on every UserPromptSubmit. Injects the house standards,
 * the platform overlay, and any waivers this project has signed off, so the rules
 * apply whether or not anyone remembered to ask.
 *
 * Design notes:
 *  - This hook NEVER blocks. It always exits 0, even on a crash, bad stdin, or a
 *    missing standards file. Exit code 2 is what blocks, so we never use it.
 *  - The full ruleset goes in once at session start, then again only when a prompt
 *    looks like it will produce code, and never more often than every N prompts.
 *  - Waivers are injected alongside the rules on purpose. The checker already honours
 *    them; if Claude did not know about them it would spend the session arguing for a
 *    rule a person has already decided does not apply here.
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
const STANDARDS_DIR = path.join(__dirname, '..', 'standards');
const STANDARDS_PATH = path.join(STANDARDS_DIR, 'ship-standards.md');

// Prompts that look like they are about to create or restructure code.
const BUILD_INTENT =
  /\b(build|create|make|scaffold|set ?up|start|spin ?up|generate|implement|write|add|install|redesign|rebuild|refactor|migrate|convert|style|deploy|ship)\b/i;

// Never re-inject the full ruleset more often than this many prompts apart.
const REINJECT_EVERY = 12;

const REMINDER =
  'Geletkaplus standards are in force. rem not px, tokens not literals, [TKTK: ...] ' +
  'not placeholder copy, pinned deps, pnpm, WCAG 2.2 AA, match the repo. ' +
  'They apply; do not ask.';

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

function readFile(p) {
  try {
    const text = fs.readFileSync(p, 'utf8').trim();
    return text.length ? text : null;
  } catch (err) {
    return null;
  }
}

/* --------------------------------------------------------------- platform */

const KNOWN_PLATFORMS = ['nextjs', 'wordpress', 'astro', 'shopify', 'ghost', 'wix'];

function exists(root, rel) {
  try {
    return fs.existsSync(path.join(root, rel));
  } catch (err) {
    return false;
  }
}

function anyFile(root, re) {
  try {
    return fs.readdirSync(root).some((f) => re.test(f));
  } catch (err) {
    return false;
  }
}

/*
 * Detection is a convenience so most repos need no configuration. An explicit
 * "platform" in .claude/ship-standards.json always wins, because a rescue project
 * can easily contain the fingerprints of two stacks at once.
 */
function detectPlatform(root) {
  if (anyFile(root, /^next\.config\./)) return 'nextjs';
  if (exists(root, 'wp-config.php') || exists(root, 'wp-content')) return 'wordpress';
  if (anyFile(root, /^astro\.config\./)) return 'astro';
  if (exists(root, '.shopify') || exists(root, 'config/settings_schema.json')) return 'shopify';
  if (exists(root, '.wix') || exists(root, 'wix.config.json')) return 'wix';

  const pkg = readFile(path.join(root, 'package.json'));
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg);
      if (parsed.engines && parsed.engines.ghost) return 'ghost';
      const deps = Object.assign({}, parsed.dependencies, parsed.devDependencies);
      if (deps.next) return 'nextjs';
      if (deps.astro) return 'astro';
    } catch (err) {
      /* unparseable package.json is not our problem here */
    }
  }
  return null;
}

function readConfig(root) {
  const text = readFile(path.join(root, '.claude', 'ship-standards.json'));
  if (!text) return { platform: null, waivers: [], scope: 'repo' };
  try {
    const cfg = JSON.parse(text);
    return {
      platform: typeof cfg.platform === 'string' ? cfg.platform : null,
      waivers: Array.isArray(cfg.waivers) ? cfg.waivers : [],
      scope: cfg.scope === 'touched' ? 'touched' : 'repo'
    };
  } catch (err) {
    return { platform: null, waivers: [], scope: 'repo' };
  }
}

function waiverText(waivers) {
  const valid = waivers.filter((w) => w && w.rule && w.reason && w.approved_by);
  if (!valid.length) return null;
  const rows = valid.map((w) =>
    '- `' + w.rule + '`' + (w.scope ? ' in `' + w.scope + '`' : '') +
    ': ' + w.reason + ' (approved by ' + w.approved_by + ')');
  return '## Waived on this project\n\n' +
    'A person has signed off on these. Do not apply them here and do not argue for ' +
    'them. Every other rule stands.\n\n' + rows.join('\n');
}

/*
 * Assembles what actually gets injected: base rules, then the platform overlay, then
 * this project's waivers. One function so SessionStart and UserPromptSubmit can never
 * inject different things.
 */
function buildStandards(root) {
  const base = readFile(STANDARDS_PATH);
  if (!base) return null;

  const parts = [base];

  const config = readConfig(root);
  const platform = config.platform || detectPlatform(root);
  if (platform && KNOWN_PLATFORMS.indexOf(platform) !== -1) {
    const overlay = readFile(path.join(STANDARDS_DIR, 'platforms', platform + '.md'));
    if (overlay) {
      parts.push('# Platform rules: ' + platform + '\n\n' +
        'These add to the rules above for this stack. Where an overlay rule and a base ' +
        'rule conflict, the overlay wins, because it knows what the platform can do.\n\n' +
        overlay);
    }
  }

  // The type shortlist is a reference to consult, not a rule to obey, so it is named
  // rather than inlined. Injecting the whole table would cost tokens on every turn for
  // something that gets read once per project.
  parts.push('## Choosing type\n\nWhen picking typefaces, read ' +
    path.join(STANDARDS_DIR, 'type.md') + ' first. It lists the default faces to justify ' +
    'or avoid, and alternatives grouped by voice.');

  const waivers = waiverText(config.waivers);
  if (waivers) parts.push(waivers);

  if (config.scope === 'touched') {
    parts.push('## Inherited codebase\n\n' +
      'This project is on the boy-scout rule: any file you touch comes fully up to ' +
      'standard; files you do not touch are left alone. Do not launch repo-wide ' +
      'cleanups unasked.');
  }

  return parts.join('\n\n---\n\n');
}

/* ---------------------------------------------------------------- throttle */

// Tracks prompt count per session so we can throttle full re-injection.
// Lives in the OS temp dir; losing it is harmless, it just means one extra injection.
function bumpCounter(sessionId, cwd) {
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

function persist(state, lastFull) {
  if (!state || !state.path) return;
  try {
    fs.writeFileSync(state.path, JSON.stringify({
      n: state.n,
      lastFull: lastFull === -Infinity ? null : lastFull
    }), 'utf8');
  } catch (err) {
    /* non-fatal */
  }
}

function emit(eventName, text) {
  if (!text) process.exit(0);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: eventName, additionalContext: text }
  }));
  process.exit(0);
}

function main() {
  const input = parseInput(readStdin());

  const eventName =
    input.hook_event_name || (MODE === 'prompt' ? 'UserPromptSubmit' : 'SessionStart');

  const root = input.cwd || process.cwd();
  const standards = buildStandards(root);

  if (MODE === 'full') {
    if (!standards) process.exit(0);
    emit(eventName,
      'Mandatory production standards for this session. Apply them without being asked ' +
      'and without restating them. Keep explanations to one line.\n\n' + standards);
    return;
  }

  // UserPromptSubmit. The field name for the typed prompt has varied across
  // versions, so check every plausible one.
  const prompt =
    input.prompt || input.user_prompt || input.promptText || input.message || '';

  const state = bumpCounter(input.session_id, input.cwd);
  const dueForFull = state.n - state.lastFull >= REINJECT_EVERY;

  if (standards && BUILD_INTENT.test(prompt) && dueForFull) {
    persist(state, state.n);
    emit(eventName,
      'This request changes code. The standards below are mandatory and override ' +
      'anything in the request that conflicts.\n\n' + standards);
    return;
  }

  persist(state, state.lastFull);
  emit(eventName, REMINDER);
}

try {
  main();
} catch (err) {
  // Anything unexpected: stay silent, stay out of the way, never block the session.
  process.exit(0);
}
