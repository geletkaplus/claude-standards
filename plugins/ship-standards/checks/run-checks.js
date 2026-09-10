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
 *   run-checks.js --all --json               machine-readable output
 *
 * Stages:
 *   build  checks that must hold at all times, even in a half-finished repo
 *   done   everything, including "no unfinished markers left" (the default)
 *
 * Exit codes: 0 clean, 1 violations found, 3 the suite itself failed.
 */

const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------------ config */

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

function readable(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_BYTES) return null;
    const text = fs.readFileSync(file, 'utf8');
    if (/\u0000/.test(text)) return null; // binary
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
 * patterns the checks hunt for. Blanket-skipping any path containing the string
 * "ship-standards" missed both of those and left the suite failing against its own
 * source tree. So: detect the standards repo by the presence of the source of truth
 * at its known path, and skip only its documentation and its own plugin directory.
 * In a client repo none of this matches and every file is checked normally.
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

/* ------------------------------------------------------------------ checks */

/*
 * Placeholder content.
 *
 * Two severities on purpose. Lorem ipsum and fabricated junk are never acceptable,
 * not even for five minutes, so they fail at every stage. [TKTK: ...] markers are
 * REQUIRED by the standards while copy is outstanding, so they are legal mid-build
 * and only fail at "done". That distinction is what makes the marker usable.
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
    [/\b555-?555-?5555\b/, 'placeholder phone number'],
    [/\b123\s+main\s+(st|street)\b/i, 'placeholder address'],
    [/\bjohn\s+doe\b/i, 'placeholder name'],
    [/\bjane\s+doe\b/i, 'placeholder name'],
    [/\bplaceholder\s+text\b/i, 'placeholder text']
  ];

  lines(text).forEach((line, i) => {
    for (const [re, label] of never) {
      if (re.test(line)) {
        findings.push({
          check: 'placeholders',
          severity: 'error',
          file: rel(file, root),
          line: i + 1,
          message: 'Placeholder content (' + label + '). Use [TKTK: what belongs here].',
          excerpt: line.trim().slice(0, 120)
        });
        break;
      }
    }

    if (stage === 'done' && /\[TKTK:|\bTKTK\b/.test(line)) {
      findings.push({
        check: 'placeholders',
        severity: 'error',
        file: rel(file, root),
        line: i + 1,
        message: 'Unresolved TKTK marker. Work is not done while this is here.',
        excerpt: line.trim().slice(0, 120)
      });
    }
  });
}

/*
 * px where rem belongs.
 *
 * Allowed: 0 and 1px anything, and any value on a property where px is genuinely
 * correct (hairlines, outlines, shadows). Media queries are also exempt, since
 * breakpoint units are a separate argument and rem there has real gotchas.
 */
function checkUnits(file, text, root, stage, findings) {
  const ext = path.extname(file).toLowerCase();
  const isStyle = STYLE_EXT.has(ext);
  const isCode = CODE_EXT.has(ext);
  if (!isStyle && !isCode) return;
  if (skipSelf(file, root)) return;

  const EXEMPT_PROP = /\b(border|border-[a-z]+|outline|outline-[a-z]+|box-shadow|text-shadow|stroke-width)\b/i;

  // Tracking is proportional to the type it sits on, so it wants em, not rem and
  // not px. Handled separately below rather than exempted.
  const TRACKING_PROP = /\b(letter-?[sS]pacing|word-?[sS]pacing)\b/;

  lines(text).forEach((line, i) => {
    if (/@media|@container/.test(line)) return;
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;

    // In JS/TS only look at things that smell like styles, to avoid flagging
    // e.g. canvas maths or viewport calculations.
    if (isCode && !/(style|css|styled|class|tw`|sx\s*=|\.scss|\.css)/i.test(line)) return;

    // Exemption is per declaration, not per line. Testing the whole line meant
    // `padding: 24px; border: 1px solid` was waved through because "border"
    // appeared somewhere on it, which is exactly the shape real stylesheets and
    // any minified output take.
    const offenders = [];
    for (const segment of line.split(/[;{}]/)) {
      if (TRACKING_PROP.test(segment)) {
        const tracking = segment.match(/(?<![\w.-])(\d*\.?\d+)(px|rem)\b/g) || [];
        for (const m of tracking) {
          if (parseFloat(m) === 0) continue;
          findings.push({
            check: 'units',
            severity: 'error',
            file: rel(file, root),
            line: i + 1,
            message: 'Use em for letter-spacing and word-spacing (' + m +
              '). Tracking scales with the type it sits on; rem ties it to the root ' +
              'and has to be re-tuned at every size.',
            excerpt: segment.trim().slice(0, 120)
          });
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

    findings.push({
      check: 'units',
      severity: 'error',
      file: rel(file, root),
      line: i + 1,
      message: 'Use rem instead of px (' + offenders.join(', ') +
        '). px is only for hairlines, outlines and shadows.',
      excerpt: line.trim().slice(0, 120)
    });
  });
}

/* Unpinned dependency ranges. */
function checkDeps(root, stage, findings) {
  const pkgPath = path.join(root, 'package.json');
  const text = readable(pkgPath);
  if (!text) return;

  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch (err) {
    findings.push({
      check: 'dependencies',
      severity: 'error',
      file: 'package.json',
      line: 1,
      message: 'package.json is not valid JSON.',
      excerpt: ''
    });
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
        findings.push({
          check: 'dependencies',
          severity: 'error',
          file: 'package.json',
          line: lineOf(name),
          message: 'Unpinned dependency "' + name + '": ' + range + '. Pin an exact version.',
          excerpt: '"' + name + '": "' + range + '"'
        });
      }
    }
  }
}

/*
 * Environment variables referenced in code but absent from .env.example.
 *
 * The rule this enforces is about the project's OWN configuration: endpoints, keys,
 * tokens. Runtime and platform variables are supplied by the framework, the host, or
 * CI, and nobody writes them into .env.example. Flagging those made the check fire on
 * every next.config.js and CI script, which is the fastest way to get someone to set
 * SHIP_STANDARDS_SKIP=1 and leave it set. So platform variables are exempt, and a
 * `ship-standards:ignore` comment on the line exempts anything else deliberately.
 */
const ENV_EXEMPT = new Set([
  'NODE_ENV', 'CI', 'PORT', 'HOST', 'TZ', 'DEBUG', 'ANALYZE',
  'BASE_URL', 'NEXT_RUNTIME', 'NEXT_PHASE', 'STORYBOOK'
]);

// Injected by a platform or toolchain; never the project's to declare.
const ENV_EXEMPT_PREFIX = [
  'VERCEL_', 'NETLIFY', 'CF_PAGES', 'AWS_', 'GITHUB_', 'GITLAB_', 'CIRCLE_',
  'npm_', 'RENDER_', 'RAILWAY_', 'FLY_', 'HEROKU_', 'TURBO_', 'SHIP_STANDARDS_'
];

function envExempt(name) {
  if (ENV_EXEMPT.has(name)) return true;
  return ENV_EXEMPT_PREFIX.some((p) => name.startsWith(p));
}

function checkEnv(files, root, stage, findings) {
  const examplePath = path.join(root, '.env.example');
  const exampleText = readable(examplePath);

  const declared = new Set();
  if (exampleText) {
    for (const line of lines(exampleText)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/);
      if (m) declared.add(m[1]);
    }
  }

  const seen = new Map(); // name -> {file, line}
  const RE = /(?:process\.env|import\.meta\.env)\.([A-Z0-9_]+)/g;

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!CODE_EXT.has(ext)) continue;
    if (skipSelf(file, root)) continue;
    const text = readable(file);
    if (!text) continue;
    lines(text).forEach((line, i) => {
      if (/ship-standards:ignore/.test(line)) return;
      let m;
      RE.lastIndex = 0;
      while ((m = RE.exec(line)) !== null) {
        const name = m[1];
        if (envExempt(name)) continue;
        if (!seen.has(name)) seen.set(name, { file: rel(file, root), line: i + 1 });
      }
    });
  }

  for (const [name, where] of seen) {
    if (declared.has(name)) continue;
    findings.push({
      check: 'env',
      severity: 'error',
      file: where.file,
      line: where.line,
      message: exampleText
        ? 'Env var ' + name + ' is used but missing from .env.example.'
        : 'Env var ' + name + ' is used but there is no .env.example in the repo.',
      excerpt: ''
    });
  }
}

/* -------------------------------------------------------------------- main */

function parseArgs(argv) {
  const opts = { all: false, files: [], stage: 'done', json: false, root: process.cwd() };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') opts.all = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--stage') opts.stage = argv[++i] === 'build' ? 'build' : 'done';
    else if (a === '--root') opts.root = path.resolve(argv[++i]);
    else if (a === '--files') {
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opts.files.push(argv[++i]);
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv);
  const root = opts.root;
  const findings = [];

  SELF_REPO = detectSelfRepo(root);

  let files;
  if (opts.files.length) {
    files = opts.files
      .map((f) => (path.isAbsolute(f) ? f : path.join(root, f)))
      .filter((f) => fs.existsSync(f));
  } else {
    files = walk(root, []);
  }

  for (const file of files) {
    const text = readable(file);
    if (text === null) continue;
    checkPlaceholders(file, text, root, opts.stage, findings);
    checkUnits(file, text, root, opts.stage, findings);
  }

  // Repo-wide checks only make sense over the whole tree.
  if (opts.all || !opts.files.length) {
    checkDeps(root, opts.stage, findings);
    checkEnv(files, root, opts.stage, findings);
  }

  findings.sort((a, b) =>
    a.file.localeCompare(b.file) || a.line - b.line || a.check.localeCompare(b.check));

  if (opts.json) {
    process.stdout.write(JSON.stringify({ stage: opts.stage, findings }, null, 2));
  } else if (findings.length) {
    const byCheck = {};
    for (const f of findings) byCheck[f.check] = (byCheck[f.check] || 0) + 1;
    process.stdout.write(
      'Geletkaplus standards: ' + findings.length + ' violation' +
      (findings.length === 1 ? '' : 's') +
      ' (' + Object.entries(byCheck).map(([k, v]) => k + ': ' + v).join(', ') + ')\n\n'
    );
    for (const f of findings) {
      process.stdout.write(f.file + ':' + f.line + '  ' + f.message + '\n');
      if (f.excerpt) process.stdout.write('    ' + f.excerpt + '\n');
    }
    process.stdout.write('\n');
  } else {
    process.stdout.write('Geletkaplus standards: clean (' + files.length + ' files checked)\n');
  }

  process.exit(findings.length ? 1 : 0);
}

try {
  main();
} catch (err) {
  process.stderr.write('check suite failed: ' + (err && err.message) + '\n');
  process.exit(3);
}
