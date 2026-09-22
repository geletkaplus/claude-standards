#!/usr/bin/env node
'use strict';

/*
 * Geletkaplus ship-standards :: check suite
 *
 * The single implementation of every mechanical standards check. Runs in two places:
 *   - locally, from the plugin's PostToolUse and Stop hooks (see scripts/gate.js)
 *   - in CI, from the reusable GitHub Actions workflow
 * Same code both times, so local and CI can never disagree.
 *
 * Usage:
 *   run-checks.js --all                      scan the whole repo
 *   run-checks.js --files a.css b.tsx        scan specific files
 *   run-checks.js --all --stage build        only checks that apply mid-build
 *   run-checks.js --all --fail-on should     exit 1 on should-level findings too
 *   run-checks.js --all --json               machine-readable output
 *
 * Stages:
 *   build  checks that must hold at all times, even in a half-finished repo
 *   done   everything, including "no unfinished markers left" (the default)
 *
 * Severity:
 *   must      never negotiable; blocks edits, blocks completion, fails CI
 *   should    real standards with real exceptions; reported and acknowledged
 *   consider  advice; printed once, gates nothing
 *
 * Exit codes: 0 clean at the failure threshold, 1 findings at or above it, 3 suite broke.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/* ------------------------------------------------------------------ config */

const MUST = 'must';
const SHOULD = 'should';
const CONSIDER = 'consider';
const RANK = { must: 3, should: 2, consider: 1 };

/*
 * Every rule's tier, in one table, because the alternative is severity decided at
 * each call site and drifting apart. Rule ids are "check/variant" so a waiver can
 * name either the whole check ("units") or one variant ("units/tracking").
 */
const SEVERITY = {
  'placeholders/fabricated': MUST,
  'placeholders/tktk': MUST,
  'units/px': MUST,
  'units/tracking': CONSIDER,
  'typography/heading-wrap': SHOULD,
  'tailwind/arbitrary-value': MUST,
  'dependencies/unpinned': SHOULD,
  'dependencies/package-manager': SHOULD,
  'dependencies/invalid': MUST,
  'env/undeclared': SHOULD,
  'type/default-face': SHOULD,
  'meta/unreasoned-ignore': SHOULD
};

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', '.svelte-kit', '.astro', '.cache',
  'dist', 'build', 'out', 'coverage', 'vendor', '.vercel', '.netlify',
  'storybook-static', '__snapshots__', '.turbo', 'public/build'
]);

const STYLE_EXT = new Set(['.css', '.scss', '.sass', '.less', '.styl', '.pcss']);
const CODE_EXT = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.astro', '.mjs', '.cjs'
]);
const CONTENT_EXT = new Set([
  '.html', '.htm', '.md', '.mdx', '.json', '.yml', '.yaml', '.php', '.twig',
  '.liquid', '.hbs', '.ejs', '.pug', '.njk', '.txt'
]);

const MAX_BYTES = 2 * 1024 * 1024; // skip anything bigger; it is not hand-written

/* ----------------------------------------------------------------- helpers */

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.isDirectory() && entry.name !== '.github') continue;
    }
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/*
 * touchedFiles() has to honor the same skip list as walk(), or a touched file inside
 * (say) dist/ or vendor/ gets scanned though a repo scan would never have found it —
 * one shared check so the two paths cannot drift apart.
 */
function isSkippedRelPath(relPath) {
  return relPath.split(path.sep).some((seg) => SKIP_DIRS.has(seg));
}

function readable(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_BYTES) return null;
    const text = fs.readFileSync(file, 'utf8');
    if (text.indexOf('\u0000') !== -1) return null; // binary
    return text;
  } catch (err) {
    return null;
  }
}

function lines(text) {
  return text.split(/\r?\n/);
}

function rel(file, root) {
  return path.relative(root, file) || file;
}

/*
 * This repo checks itself, and its own README and workflow have to quote the very
 * patterns the checks hunt for. So: detect the standards repo by the presence of the
 * source of truth at its known path, and skip only its documentation and its own
 * plugin directory. In a client repo none of this matches and everything is checked.
 */
let SELF_REPO = false;

const SELF_IGNORE = [
  'README.md',
  '.github',
  path.join('plugins', 'ship-standards')
];

function detectSelfRepo(root) {
  return fs.existsSync(
    path.join(root, 'plugins', 'ship-standards', 'standards', 'ship-standards.md')
  );
}

function skipSelf(file, root) {
  if (!SELF_REPO) return false;
  const r = rel(file, root);
  return SELF_IGNORE.some((p) => r === p || r.startsWith(p + path.sep));
}

/* --------------------------------------------------------- project config */

/*
 * .claude/ship-standards.json carries the two things that are the project's call
 * rather than the house's: which platform it is on, and which rules a person has
 * signed off waiving. Read here and, deliberately, also read by the injection hook,
 * so the checker and Claude's context cannot end up disagreeing about what applies.
 */
function readConfig(root) {
  const text = readable(path.join(root, '.claude', 'ship-standards.json'));
  if (!text) return { platform: null, waivers: [], scope: 'repo' };
  try {
    const cfg = JSON.parse(text);
    return {
      platform: typeof cfg.platform === 'string' ? cfg.platform : null,
      waivers: Array.isArray(cfg.waivers) ? cfg.waivers : [],
      scope: cfg.scope === 'touched' ? 'touched' : 'repo'
    };
  } catch (err) {
    return { platform: null, waivers: [], invalid: true, scope: 'repo' };
  }
}

/* ------------------------------------------------------------- touched files */

function gitLines(root, args) {
  return execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
  }).split('\n').map((l) => l.trim()).filter(Boolean);
}

/*
 * The boy-scout unit is the file: everything changed since the merge-base with the
 * default branch, plus anything dirty or untracked right now. Any git failure returns
 * null and the caller runs a full scan instead — a git error must never read as
 * "nothing was touched", which would silently disable every check.
 */
function touchedFiles(root, baseRef) {
  try {
    const set = new Set();
    let base = baseRef || null;
    if (!base) {
      let def = null;
      try {
        def = gitLines(root, ['symbolic-ref', 'refs/remotes/origin/HEAD'])[0] || null;
      } catch (err) { /* no origin/HEAD; try local names */ }
      if (!def) {
        for (const name of ['main', 'master']) {
          try {
            gitLines(root, ['rev-parse', '--verify', '--quiet', name]);
            def = name;
            break;
          } catch (err) { /* not this one */ }
        }
      }
      if (def) {
        try {
          base = gitLines(root, ['merge-base', def, 'HEAD'])[0] || null;
        } catch (err) { /* unrelated histories; dirty files still count */ }
      }
    }
    if (base) {
      for (const f of gitLines(root, ['diff', '--name-only', base])) set.add(f);
    }
    /*
     * -z + --untracked-files=all: -z gives NUL-separated, unquoted paths so filenames
     * with special or non-ASCII characters survive intact instead of being C-style
     * quoted and silently dropped; --untracked-files=all expands an untracked
     * directory into its individual files instead of one collapsed "?? dir/" row,
     * which would otherwise make every file inside it invisible to the checker.
     */
    const raw = execFileSync(
      'git', ['status', '--porcelain', '-z', '--untracked-files=all'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const fields = raw.split('\0');
    for (let i = 0; i < fields.length; i++) {
      const entry = fields[i];
      if (!entry) continue;
      const isRenameOrCopy = entry[0] === 'R' || entry[0] === 'C' ||
        entry[1] === 'R' || entry[1] === 'C';
      const p = entry.slice(3);
      set.add(p);
      // Renames/copies carry the original path as the NEXT NUL-separated field;
      // consume it so it isn't mistaken for its own status entry, but the new
      // path (already added above) is the one that matters for scanning.
      if (isRenameOrCopy) i++;
    }
    const files = [];
    for (const relPath of set) {
      if (isSkippedRelPath(relPath)) continue;
      const full = path.join(root, relPath);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) files.push(full);
    }
    return { files };
  } catch (err) {
    return null;
  }
}

function globToRe(glob) {
  const s = String(glob);
  let re = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '*') {
      if (s[i + 1] === '*') {
        i++;
        if (s[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.indexOf(c) !== -1) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

/* A waiver for "units" covers "units/px"; one for "units/px" covers only that. */
function ruleMatches(waiverRule, ruleId) {
  if (!waiverRule) return false;
  return ruleId === waiverRule || ruleId.startsWith(waiverRule + '/');
}

function waiverFor(finding, waivers) {
  for (const w of waivers) {
    if (!ruleMatches(w && w.rule, finding.rule)) continue;
    if (!w.reason || !w.approved_by) continue; // unattributed waivers do not count
    if (w.scope) {
      const posix = finding.file.split(path.sep).join('/');
      if (!globToRe(w.scope).test(posix)) continue;
    }
    return w;
  }
  return null;
}

/* ------------------------------------------------------------------ checks */

function add(findings, rule, file, root, line, message, excerpt) {
  findings.push({
    rule: rule,
    check: rule.split('/')[0],
    severity: SEVERITY[rule] || SHOULD,
    file: root ? rel(file, root) : String(file),
    line: line,
    message: message,
    excerpt: excerpt || ''
  });
}

/*
 * Inline exemptions.
 *
 * `ship-standards:ignore <rule> <reason>` on the offending line or the line above.
 * The reason is mandatory. An ignore with no reason is not honoured, and says so,
 * because a reasonless ignore is just a mute button and spreads by copy-paste.
 */
const IGNORE_RE = /ship-standards:ignore\s+([a-z][a-z0-9/-]*)?\s*(.*)$/i;

function ignoreOn(lineText) {
  if (!lineText) return null;
  const m = String(lineText).match(IGNORE_RE);
  if (!m) return null;
  const reason = String(m[2] || '')
    .replace(/^[\s:,-]+/, '')
    .replace(/(\*\/|-->|\*\}|\}\})\s*$/, '')
    .trim();
  return { rule: m[1] || null, reason: reason, ok: reason.length >= 8 };
}

function suppressed(all, i, ruleId, file, root, findings) {
  const here = ignoreOn(all[i]) || ignoreOn(i > 0 ? all[i - 1] : '');
  if (!here) return false;
  if (here.rule && !ruleMatches(here.rule, ruleId)) return false;
  if (here.ok) return true;
  add(findings, 'meta/unreasoned-ignore', file, root, i + 1,
    'ship-standards:ignore needs a reason after the rule name.',
    String(all[i]).trim().slice(0, 120));
  return false;
}

/*
 * Placeholder content. Lorem ipsum and fabricated junk are never acceptable, so they
 * fail at every stage. [TKTK: ...] is REQUIRED by the standards while copy is
 * outstanding, so it is legal mid-build and only fails at "done".
 */
function checkPlaceholders(file, text, root, stage, findings) {
  const ext = path.extname(file).toLowerCase();
  if (!STYLE_EXT.has(ext) && !CODE_EXT.has(ext) && !CONTENT_EXT.has(ext)) return;
  if (skipSelf(file, root)) return;

  const never = [
    [/\blorem\s+ipsum\b/i, 'lorem ipsum'],
    [/\bdolor\s+sit\s+amet\b/i, 'filler latin'],
    [/\bconsectetur\s+adipiscing\b/i, 'filler latin'],
    [/\byour\s+(company|business|brand)\s+name\b/i, 'unreplaced template copy'],
    [/\bexample@example\.(com|org)\b/i, 'placeholder email'],
    [/\b555-?555-?5555\b/, 'placeholder phone'],
    [/\b123\s+main\s+(st|street)\b/i, 'placeholder address'],
    [/\bjohn\s+doe\b/i, 'placeholder name'],
    [/\bjane\s+doe\b/i, 'placeholder name'],
    [/\bplaceholder\s+text\b/i, 'placeholder text']
  ];

  const all = lines(text);
  all.forEach((line, i) => {
    for (const [re, label] of never) {
      if (re.test(line)) {
        if (!suppressed(all, i, 'placeholders/fabricated', file, root, findings)) {
          add(findings, 'placeholders/fabricated', file, root, i + 1,
            'Placeholder content (' + label + '). Use [TKTK: ...].',
            line.trim().slice(0, 120));
        }
        break;
      }
    }

    if (stage === 'done' && /\[TKTK:|\bTKTK\b/.test(line)) {
      if (!suppressed(all, i, 'placeholders/tktk', file, root, findings)) {
        add(findings, 'placeholders/tktk', file, root, i + 1,
          'Unresolved TKTK marker.', line.trim().slice(0, 120));
      }
    }
  });
}

/*
 * px where rem belongs, and tracking where em belongs.
 *
 * Exemption is per declaration, not per line: testing the whole line meant
 * `padding: 24px; border: 1px solid` was waved through because "border" appeared
 * somewhere on it, which is the shape real and minified stylesheets take.
 */
function checkUnits(file, text, root, stage, findings) {
  const ext = path.extname(file).toLowerCase();
  const isStyle = STYLE_EXT.has(ext);
  const isCode = CODE_EXT.has(ext);
  if (!isStyle && !isCode) return;
  if (skipSelf(file, root)) return;

  const EXEMPT_PROP = /\b(border|border-[a-z]+|outline|outline-[a-z]+|box-shadow|text-shadow|stroke-width)\b/i;
  const TRACKING_PROP = /\b(letter-?[sS]pacing|word-?[sS]pacing)\b/;

  const all = lines(text);
  all.forEach((line, i) => {
    if (/@media|@container/.test(line)) return;
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;
    if (isCode && !/(style|css|styled|class|tw`|sx\s*=|\.scss|\.css)/i.test(line)) return;

    // A Tailwind arbitrary value like p-[13px] is already reported, in full, by
    // checkTailwind. Reporting the px inside it again is the same defect twice.
    const subject = /\b(?:class|className|classList|class:list)\s*=/.test(line)
      ? line.replace(/\[[^\]]*\]/g, '')
      : line;

    const offenders = [];
    for (const segment of subject.split(/[;{}]/)) {
      if (TRACKING_PROP.test(segment)) {
        const tracking = segment.match(/(?<![\w.-])(\d*\.?\d+)(px|rem)\b/g) || [];
        for (const m of tracking) {
          if (parseFloat(m) === 0) continue;
          if (suppressed(all, i, 'units/tracking', file, root, findings)) continue;
          add(findings, 'units/tracking', file, root, i + 1,
            'Use em for tracking (' + m + '); it scales with the type it sits on.',
            segment.trim().slice(0, 120));
        }
        continue;
      }
      if (EXEMPT_PROP.test(segment)) continue;
      const matches = segment.match(/(?<![\w.-])(\d+(?:\.\d+)?)px\b/g);
      if (!matches) continue;
      for (const m of matches) {
        const n = parseFloat(m);
        if (n !== 0 && n !== 1) offenders.push(m);
      }
    }
    if (!offenders.length) return;
    if (suppressed(all, i, 'units/px', file, root, findings)) return;

    add(findings, 'units/px', file, root, i + 1,
      'Use rem, not px (' + offenders.join(', ') + ').', line.trim().slice(0, 120));
  });
}

/*
 * Default typefaces.
 *
 * These faces are not bad. They are the ones that get picked when nobody picked: the
 * median answer, reached for before the brief. So this is a should, not a must, and the
 * way to satisfy it is a one-line reason rather than a different font. Inter genuinely is
 * the right call for a dense data UI; saying so takes a sentence and ends the argument.
 *
 * Only the first face in a stack is considered. Everything after it is a fallback, and
 * flagging `'Archivo', Helvetica, Arial` for Arial would make the check worse than useless.
 */
const DEFAULT_FACES = new Set([
  'inter', 'poppins', 'montserrat', 'playfair display', 'space grotesk',
  'dm sans', 'dm serif display', 'plus jakarta sans', 'manrope', 'outfit',
  'sora', 'raleway', 'lato', 'nunito', 'nunito sans', 'work sans',
  'open sans', 'roboto'
]);

function normaliseFace(raw) {
  return String(raw)
    .trim()
    .replace(/^["\']|["\']$/g, '')
    .replace(/_/g, ' ')
    .replace(/\+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function flagFace(face, all, i, file, root, findings) {
  const name = normaliseFace(face);
  if (!DEFAULT_FACES.has(name)) return;
  if (suppressed(all, i, 'type/default-face', file, root, findings)) return;
  // Report the human name, not the raw token: "Plus Jakarta Sans", not Plus_Jakarta_Sans.
  const pretty = name.replace(/(^|\s)([a-z])/g, (m, a, b) => a + b.toUpperCase());
  add(findings, 'type/default-face', file, root, i + 1,
    pretty + ' is a default pick. Say why it fits here, or see standards/type.md.', '');
}

function checkType(file, text, root, stage, findings) {
  const ext = path.extname(file).toLowerCase();
  if (!STYLE_EXT.has(ext) && !CODE_EXT.has(ext) && ext !== '.html' && ext !== '.htm') return;
  if (skipSelf(file, root)) return;

  const all = lines(text);
  all.forEach((line, i) => {
    // Declared stacks. Only the first entry is a choice; the rest are fallbacks.
    const decl = line.match(/font-family\s*:\s*([^;{}]+)/i) ||
      line.match(/fontFamily\s*:\s*["\'`]([^"\'`]+)/);
    if (decl) flagFace(String(decl[1]).split(',')[0], all, i, file, root, findings);

    // Google Fonts links, which name the face before any CSS does.
    if (/fonts\.googleapis\.com/.test(line)) {
      const families = line.match(/family=([^&:"\'>)]+)/g) || [];
      for (const f of families) flagFace(f.slice('family='.length), all, i, file, root, findings);
    }

    // next/font/google imports name the face as an identifier: { Plus_Jakarta_Sans }
    if (/next\/font\/google/.test(line)) {
      const named = line.match(/\{([^}]+)\}/);
      if (named) {
        for (const ident of named[1].split(',')) flagFace(ident, all, i, file, root, findings);
      }
    }
  });
}

/*
 * Tailwind bracket syntax: a hardcoded value wearing a class name.
 *
 * Read out of class attributes only (className, class, :class, classList, cva/clsx
 * argument strings are all just strings, so the attribute is the reliable anchor),
 * because brackets are ordinary syntax everywhere else in a JS or template file.
 *
 * Two shapes are deliberately allowed: arbitrary *properties* (`[mask-type:luminance]`,
 * which have no utility to reach for) and arbitrary *variants* (`[&>li]:mt-2`,
 * `supports-[display:grid]:`), which select rather than set a value.
 */
function checkTailwind(file, text, root, stage, findings) {
  const ext = path.extname(file).toLowerCase();
  if (!CODE_EXT.has(ext) && !CONTENT_EXT.has(ext)) return;
  if (skipSelf(file, root)) return;
  if (text.indexOf('[') === -1) return;

  const ATTR = /\b(?:class|className|classList|class:list)\s*=\s*(?:\{?\s*)?(["'`])([\s\S]*?)\1/g;
  const all = lines(text);

  let m;
  while ((m = ATTR.exec(text)) !== null) {
    const value = m[2];
    const line = text.slice(0, m.index).split(/\r?\n/).length - 1;
    const offenders = [];

    for (const token of value.split(/\s+/)) {
      if (!token || token.indexOf('[') === -1) continue;
      // Variants are everything before the last colon that is not inside brackets.
      const utility = token.replace(/^(?:[^:\[\]]+:|\[[^\]]*\]:|[a-z-]+-\[[^\]]*\]:)+/i, '');
      const bracket = utility.match(/\[([^\]]*)\]/);
      if (!bracket) continue;
      if (/^--/.test(bracket[1])) continue;      // [--my-var:1rem], an arbitrary property
      if (/^[a-z-]+:/i.test(bracket[1])) continue; // [mask-type:luminance], likewise
      offenders.push(token);
    }

    if (!offenders.length) continue;
    if (suppressed(all, line, 'tailwind/arbitrary-value', file, root, findings)) continue;
    add(findings, 'tailwind/arbitrary-value', file, root, line + 1,
      'Tailwind bracket value (' + offenders.join(', ') + '). Put it on the theme scale.',
      offenders.join(' ').slice(0, 120));
  }
}

/*
 * Headlines that never got `text-wrap: balance`.
 *
 * Scoped to stylesheets and to rule blocks that actually style a heading element:
 * a selector naming a bare h1-h6, in a block that sets font-size (i.e. the block
 * that owns the heading's type, not some unrelated spacing tweak). Anything looser
 * guesses at which class is "a headline" and produces noise.
 */
function checkTypography(file, text, root, stage, findings) {
  if (!STYLE_EXT.has(path.extname(file).toLowerCase())) return;
  if (skipSelf(file, root)) return;

  const HEADING_SEL = /(^|[\s,>+~])h[1-6](?=$|[\s,>+~:.\[{])/i;
  const all = lines(text);

  let selector = '';
  let selectorLine = 0;
  let depth = 0;
  let block = '';
  let blockStart = 0;

  all.forEach((line, i) => {
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;
    for (const part of line.split(/(?=[{}])|(?<=[{}])/)) {
      if (part === '{') {
        // Conditional at-rules wrap rules rather than being one, so they are
        // transparent here: h1 inside @media is still a heading rule.
        if (/^\s*@(media|supports|container|layer|scope)\b/i.test(selector)) {
          selector = '';
          continue;
        }
        depth++;
        if (depth === 1) {
          blockStart = selectorLine;
          block = '';
        }
        continue;
      }
      if (part === '}') {
        if (depth === 1 && HEADING_SEL.test(selector) && !/@/.test(selector) &&
            /\bfont-size\s*:/.test(block) && !/\btext-wrap\s*:/.test(block)) {
          if (!suppressed(all, blockStart, 'typography/heading-wrap', file, root, findings)) {
            add(findings, 'typography/heading-wrap', file, root, blockStart + 1,
              'Heading rule sets font-size but no text-wrap; use balance.',
              selector.trim().slice(0, 120));
          }
        }
        if (depth > 0) depth--;
        selector = '';
        continue;
      }
      if (depth === 0) {
        if (!selector.trim() && part.trim()) selectorLine = i;
        selector += ' ' + part;
      } else {
        block += ' ' + part;
      }
    }
  });
}

/* Dependencies: pinned versions, and pnpm as the package manager. */
function checkDeps(root, stage, findings) {
  const pkgPath = path.join(root, 'package.json');
  const text = readable(pkgPath);
  if (!text) return;

  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch (err) {
    add(findings, 'dependencies/invalid', 'package.json', null, 1,
      'package.json is not valid JSON.', '');
    return;
  }

  const raw = lines(text);
  const lineOf = (name) => {
    const idx = raw.findIndex((l) => l.includes('"' + name + '"'));
    return idx === -1 ? 1 : idx + 1;
  };

  for (const field of ['dependencies', 'devDependencies']) {
    const deps = pkg[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, range] of Object.entries(deps)) {
      if (typeof range !== 'string') continue;
      if (/^(workspace:|file:|link:|https?:|git|github:|npm:)/.test(range)) continue;
      if (/^[\^~]|[*x]|\s-\s|\|\||>=|<=|^>|^</.test(range) || range === 'latest') {
        add(findings, 'dependencies/unpinned', 'package.json', null, lineOf(name),
          'Unpinned: ' + name + ' ' + range + '. Pin an exact version.',
          '"' + name + '": "' + range + '"');
      }
    }
  }

  // pnpm. A stray lockfile is the real tell: it means someone ran the wrong tool
  // and the next person to install gets a different tree.
  for (const lock of ['package-lock.json', 'yarn.lock']) {
    if (fs.existsSync(path.join(root, lock))) {
      add(findings, 'dependencies/package-manager', lock, null, 1,
        'Use pnpm. Delete ' + lock + ' and run pnpm install.', '');
    }
  }
  const pm = pkg.packageManager;
  if (typeof pm === 'string' && !/^pnpm@/.test(pm)) {
    add(findings, 'dependencies/package-manager', 'package.json', null,
      lineOf('packageManager'), 'Use pnpm. packageManager is ' + pm + '.',
      '"packageManager": "' + pm + '"');
  }
}

/*
 * Environment variables referenced in code but absent from .env.example.
 *
 * Platform and runtime variables are supplied by the framework, the host, or CI, and
 * nobody writes them into .env.example. Flagging them made this fire on every config
 * file, which is the fastest way to get the gate switched off for good.
 */
const ENV_EXEMPT = new Set([
  'NODE_ENV', 'CI', 'PORT', 'HOST', 'TZ', 'DEBUG', 'ANALYZE',
  'BASE_URL', 'NEXT_RUNTIME', 'NEXT_PHASE', 'STORYBOOK'
]);

const ENV_EXEMPT_PREFIX = [
  'VERCEL_', 'NETLIFY', 'CF_PAGES', 'AWS_', 'GITHUB_', 'GITLAB_', 'CIRCLE_',
  'npm_', 'RENDER_', 'RAILWAY_', 'FLY_', 'HEROKU_', 'TURBO_', 'SHIP_STANDARDS_'
];

function envExempt(name) {
  if (ENV_EXEMPT.has(name)) return true;
  return ENV_EXEMPT_PREFIX.some((p) => name.startsWith(p));
}

function checkEnv(files, root, stage, findings) {
  const exampleText = readable(path.join(root, '.env.example'));

  const declared = new Set();
  if (exampleText) {
    for (const line of lines(exampleText)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/);
      if (m) declared.add(m[1]);
    }
  }

  const seen = new Map();
  const RE = /(?:process\.env|import\.meta\.env)\.([A-Z0-9_]+)/g;

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!CODE_EXT.has(ext)) continue;
    if (skipSelf(file, root)) continue;
    const text = readable(file);
    if (!text) continue;
    const all = lines(text);
    all.forEach((line, i) => {
      let m;
      RE.lastIndex = 0;
      while ((m = RE.exec(line)) !== null) {
        const name = m[1];
        if (envExempt(name)) continue;
        if (suppressed(all, i, 'env/undeclared', file, root, findings)) continue;
        if (!seen.has(name)) seen.set(name, { file: rel(file, root), line: i + 1 });
      }
    });
  }

  for (const [name, where] of seen) {
    if (declared.has(name)) continue;
    add(findings, 'env/undeclared', where.file, null, where.line,
      exampleText
        ? name + ' missing from .env.example.'
        : name + ' used but there is no .env.example.', '');
  }
}

/* -------------------------------------------------------------------- main */

function parseArgs(argv) {
  const opts = {
    all: false, files: [], stage: 'done', json: false,
    root: process.cwd(), failOn: MUST, touched: false, touchedBase: null
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') opts.all = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--stage') opts.stage = argv[++i] === 'build' ? 'build' : 'done';
    else if (a === '--root') opts.root = path.resolve(argv[++i]);
    else if (a === '--fail-on') {
      const v = String(argv[++i] || '').toLowerCase();
      opts.failOn = RANK[v] ? v : MUST;
    } else if (a === '--files') {
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opts.files.push(argv[++i]);
    } else if (a === '--touched') opts.touched = true;
    else if (a === '--touched-base') opts.touchedBase = argv[++i];
  }
  return opts;
}

function render(group, heading, out) {
  if (!group.length) return;
  out.push(heading);
  for (const f of group) {
    out.push('  ' + f.file + ':' + f.line + '  ' + f.message);
    if (f.excerpt) out.push('      ' + f.excerpt);
  }
  out.push('');
}

function main() {
  const opts = parseArgs(process.argv);
  const root = opts.root;
  const findings = [];

  SELF_REPO = detectSelfRepo(root);
  const config = readConfig(root);

  let scope = 'repo';
  let files;
  if (opts.files.length) {
    files = opts.files
      .map((f) => (path.isAbsolute(f) ? f : path.join(root, f)))
      .filter((f) => fs.existsSync(f));
  } else {
    const wantTouched = opts.touched || config.scope === 'touched';
    let touched = null;
    if (wantTouched) touched = touchedFiles(root, opts.touchedBase);
    if (touched) {
      scope = 'touched';
      files = touched.files;
    } else {
      files = walk(root, []);
    }
  }

  for (const file of files) {
    const text = readable(file);
    if (text === null) continue;
    checkPlaceholders(file, text, root, opts.stage, findings);
    checkUnits(file, text, root, opts.stage, findings);
    checkTypography(file, text, root, opts.stage, findings);
    checkTailwind(file, text, root, opts.stage, findings);
    checkType(file, text, root, opts.stage, findings);
  }

  if (opts.all || !opts.files.length) {
    // On a touched scan, dependency rules only apply if someone touched the
    // dependency files; legacy lockfile sins belong to the legacy.
    const depFiles = ['package.json', 'package-lock.json', 'yarn.lock'];
    const depsTouched = scope !== 'touched' ||
      files.some((f) => depFiles.includes(rel(f, root)));
    if (depsTouched) checkDeps(root, opts.stage, findings);
    checkEnv(files, root, opts.stage, findings);
  }

  // Waivers demote rather than delete: a waived rule still shows, so nobody
  // forgets it is in force elsewhere or that someone put their name to it.
  const waived = [];
  const live = [];
  for (const f of findings) {
    const w = waiverFor(f, config.waivers);
    if (w) {
      f.waived = true;
      f.waiver = { reason: w.reason, approved_by: w.approved_by };
      waived.push(f);
    } else {
      live.push(f);
    }
  }

  const order = (a, b) =>
    RANK[b.severity] - RANK[a.severity] ||
    a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule);
  live.sort(order);
  waived.sort(order);

  const threshold = RANK[opts.failOn];
  const blocking = live.filter((f) => RANK[f.severity] >= threshold);

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      stage: opts.stage,
      platform: config.platform,
      scope: scope,
      filesChecked: files.length,
      failOn: opts.failOn,
      counts: {
        must: live.filter((f) => f.severity === MUST).length,
        should: live.filter((f) => f.severity === SHOULD).length,
        consider: live.filter((f) => f.severity === CONSIDER).length,
        waived: waived.length
      },
      findings: live,
      waivedFindings: waived
    }, null, 2));
    process.exit(blocking.length ? 1 : 0);
  }

  const out = [];
  if (config.invalid) out.push('.claude/ship-standards.json is not valid JSON; ignoring it.\n');

  render(live.filter((f) => f.severity === MUST), 'MUST (blocks):', out);
  render(live.filter((f) => f.severity === SHOULD), 'SHOULD (acknowledge or waive):', out);
  render(live.filter((f) => f.severity === CONSIDER), 'consider:', out);

  if (waived.length) {
    out.push('Waived (' + waived.length + '):');
    for (const f of waived) {
      out.push('  ' + f.file + ':' + f.line + '  ' + f.message +
        ' [' + f.waiver.approved_by + ': ' + f.waiver.reason + ']');
    }
    out.push('');
  }

  if (!live.length) {
    out.push('Geletkaplus standards: clean (' + files.length + ' files checked' +
      (config.platform ? ', platform ' + config.platform : '') +
      (scope === 'touched' ? ', touched files only' : '') + ').');
  }

  process.stdout.write(out.join('\n').replace(/\n+$/, '') + '\n');
  process.exit(blocking.length ? 1 : 0);
}

try {
  main();
} catch (err) {
  process.stderr.write('check suite failed: ' + (err && err.message) + '\n');
  process.exit(3);
}
