# Inherited Codebases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ship-standards enforcement opt-in per repo, and scope enforcement to touched files on inherited codebases.

**Architecture:** `run-checks.js` learns to compute a touched-file list from git and to honor a `scope` setting in `.claude/ship-standards.json`; `gate.js` exits silently in repos with no config file; the reusable CI workflow passes the PR base ref through. Everything else is docs and one new skill.

**Tech Stack:** Node (no dependencies, matching the existing zero-dep scripts), `node --test` for the test suite, GitHub Actions reusable workflow.

**Spec:** `docs/superpowers/specs/2026-09-22-inherited-codebases-design.md`

## Global Constraints

- No new npm dependencies; the plugin's scripts are dependency-free by design.
- All scripts stay `'use strict'` CommonJS, matching the existing files.
- The gate must fail open: any git error or crash means a full-repo scan or exit 0, never a block.
- Comment style: explain constraints, not mechanics, matching the existing files.
- Rule ids and severities stay unchanged; no new severities.
- One refinement over the spec, decided during planning: the checker reads `scope` from `.claude/ship-standards.json` itself when running `--all`, so CI can pass `--touched-base` unconditionally without parsing JSON in bash. `--touched` remains as an explicit override. `--files` still wins over everything.

---

### Task 1: Test harness and touched-file computation in run-checks.js

**Files:**
- Create: `plugins/ship-standards/tests/helpers.js`
- Create: `plugins/ship-standards/tests/touched.test.js`
- Modify: `plugins/ship-standards/checks/run-checks.js`

**Interfaces:**
- Produces: `touchedFiles(root, baseRef)` in run-checks.js returning `{ files: string[] } | null` (null = git unavailable/failed, caller falls back to full scan). CLI flags `--touched` and `--touched-base <ref>`. `readConfig()` return gains `scope: 'touched' | 'repo'`.
- Produces (tests): `helpers.js` exports `makeRepo(files)` (temp dir, `git init`, commit all files, returns path), `writeFiles(root, files)`, and `runChecks(args, cwd)` (spawns `node checks/run-checks.js`, returns `{ code, json }`).

- [ ] **Step 1: Write the test helper**

```js
// plugins/ship-standards/tests/helpers.js
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHECKS = path.join(__dirname, '..', 'checks', 'run-checks.js');

function git(root, args) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
}

/* A real git repo in a temp dir: every scoping behavior under test depends on
 * actual git output, so stubbing git would test nothing. */
function makeRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gk-test-'));
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@test.invalid']);
  git(root, ['config', 'user.name', 'test']);
  writeFiles(root, files);
  git(root, ['add', '-A']);
  git(root, ['commit', '-m', 'legacy state', '--no-gpg-sign']);
  return root;
}

function commitAll(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-m', message, '--no-gpg-sign']);
}

function runChecks(args, cwd) {
  let raw = '';
  let code = 0;
  try {
    raw = execFileSync(process.execPath, [CHECKS].concat(args).concat(['--json']), {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    code = err.status;
    raw = String(err.stdout || '');
  }
  return { code, json: raw ? JSON.parse(raw) : null };
}

module.exports = { makeRepo, writeFiles, commitAll, runChecks, git };
```

- [ ] **Step 2: Write the failing tests**

```js
// plugins/ship-standards/tests/touched.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeRepo, writeFiles, runChecks } = require('./helpers');

const LEGACY_CSS = 'h1 { font-size: 24px; }\n';   // units/px must
const CLEAN_CSS = 'h1 { font-size: 1.5rem; text-wrap: balance; }\n';

test('touched scope: dirty file blocks, legacy file does not', () => {
  const root = makeRepo({ 'legacy.css': LEGACY_CSS, 'other.css': CLEAN_CSS });
  writeFiles(root, { 'new.css': 'p { margin: 13px; }\n' }); // untracked, dirty
  const { code, json } = runChecks(['--all', '--touched', '--root', root], root);
  assert.strictEqual(code, 1);
  const files = json.findings.map((f) => f.file);
  assert.ok(files.includes('new.css'));
  assert.ok(!files.includes('legacy.css'));
  assert.strictEqual(json.scope, 'touched');
});

test('touched scope: modified tracked file is touched', () => {
  const root = makeRepo({ 'legacy.css': LEGACY_CSS, 'edited.css': CLEAN_CSS });
  writeFiles(root, { 'edited.css': CLEAN_CSS + 'p { padding: 20px; }\n' });
  const { json } = runChecks(['--all', '--touched', '--root', root], root);
  const files = json.findings.map((f) => f.file);
  assert.ok(files.includes('edited.css'));
  assert.ok(!files.includes('legacy.css'));
});

test('config scope touched is honored without the flag', () => {
  const root = makeRepo({ 'legacy.css': LEGACY_CSS });
  writeFiles(root, {
    '.claude/ship-standards.json': '{ "scope": "touched" }',
    'new.css': 'p { margin: 13px; }\n'
  });
  const { json } = runChecks(['--all', '--root', root], root);
  const files = json.findings.map((f) => f.file);
  assert.ok(files.includes('new.css'));
  assert.ok(!files.includes('legacy.css'));
});

test('default scope is repo: legacy findings still report', () => {
  const root = makeRepo({ 'legacy.css': LEGACY_CSS });
  const { code, json } = runChecks(['--all', '--root', root], root);
  assert.strictEqual(code, 1);
  assert.strictEqual(json.scope, 'repo');
  assert.ok(json.findings.some((f) => f.file === 'legacy.css'));
});

test('non-git directory falls back to full scan', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gk-nogit-'));
  writeFiles(root, { 'legacy.css': LEGACY_CSS });
  const { json } = runChecks(['--all', '--touched', '--root', root], root);
  assert.strictEqual(json.scope, 'repo'); // fell back
  assert.ok(json.findings.some((f) => f.file === 'legacy.css'));
});

test('--files wins over --touched', () => {
  const root = makeRepo({ 'legacy.css': LEGACY_CSS });
  const { json } = runChecks(
    ['--files', 'legacy.css', '--touched', '--root', root], root);
  assert.ok(json.findings.some((f) => f.file === 'legacy.css'));
});

test('deleted touched file is dropped, not scanned', () => {
  const root = makeRepo({ 'gone.css': LEGACY_CSS, 'keep.css': CLEAN_CSS });
  fs.unlinkSync(path.join(root, 'gone.css'));
  const { code } = runChecks(['--all', '--touched', '--root', root], root);
  assert.strictEqual(code, 0);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test plugins/ship-standards/tests/touched.test.js`
Expected: FAIL — `--touched` is unknown (parsed as noise), `json.scope` is undefined.

- [ ] **Step 4: Implement in run-checks.js**

Add near the config section:

```js
const { execFileSync } = require('child_process');

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
    for (const row of gitLines(root, ['status', '--porcelain'])) {
      // porcelain: "XY path" or "XY old -> new"; keep the path that exists now.
      const p = row.slice(3);
      set.add(p.includes(' -> ') ? p.split(' -> ')[1] : p);
    }
    const files = [];
    for (const relPath of set) {
      const full = path.join(root, relPath);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) files.push(full);
    }
    return { files };
  } catch (err) {
    return null;
  }
}
```

In `readConfig()`, add to the returned object (both the success and no-file branches):

```js
scope: cfg.scope === 'touched' ? 'touched' : 'repo'
```

(no-file branch: `scope: 'repo'`).

In `parseArgs()`, add:

```js
else if (a === '--touched') opts.touched = true;
else if (a === '--touched-base') opts.touchedBase = argv[++i];
```

with `touched: false, touchedBase: null` in the defaults.

In `main()`, replace the file-selection block with:

```js
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
```

In the JSON output object, after `platform`, add:

```js
scope: scope,
filesChecked: files.length,
```

And in the human-readable clean line, include the scope when it is touched:
change the clean message to append `', touched files only'` when `scope === 'touched'`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test plugins/ship-standards/tests/touched.test.js`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add plugins/ship-standards/tests plugins/ship-standards/checks/run-checks.js
git commit -m "Add touched-file scoping to the check suite"
```

---

### Task 2: Scope the repo-wide checks (dependencies, env)

**Files:**
- Modify: `plugins/ship-standards/checks/run-checks.js`
- Test: `plugins/ship-standards/tests/touched.test.js` (append)

**Interfaces:**
- Consumes: `scope` and `files` from Task 1's `main()`.
- Produces: `checkDeps(root, stage, findings, scoped)` and unchanged `checkEnv(files, root, stage, findings)` (env is already file-driven; passing the touched list scopes it for free).

- [ ] **Step 1: Write the failing tests**

Append to `touched.test.js`:

```js
const BAD_PKG = JSON.stringify({ dependencies: { react: '^18.0.0' } }, null, 2);

test('deps check skipped when package.json untouched', () => {
  const root = makeRepo({ 'package.json': BAD_PKG, 'a.css': CLEAN_CSS });
  writeFiles(root, { 'new.css': CLEAN_CSS });
  const { json } = runChecks(['--all', '--touched', '--root', root], root);
  assert.ok(!json.findings.some((f) => f.check === 'dependencies'));
});

test('deps check runs when package.json is touched', () => {
  const root = makeRepo({ 'a.css': CLEAN_CSS });
  writeFiles(root, { 'package.json': BAD_PKG });
  const { json } = runChecks(['--all', '--touched', '--root', root], root);
  assert.ok(json.findings.some((f) => f.rule === 'dependencies/unpinned'));
});

test('env check only reports vars referenced from touched files', () => {
  const root = makeRepo({
    'legacy.js': 'export default { css: process.env.OLD_KEY };\n',
    '.env.example': ''
  });
  writeFiles(root, { 'new.js': 'export default { css: process.env.NEW_KEY };\n' });
  const { json } = runChecks(['--all', '--touched', '--root', root], root);
  const env = json.findings.filter((f) => f.rule === 'env/undeclared');
  assert.ok(env.some((f) => f.message.startsWith('NEW_KEY')));
  assert.ok(!env.some((f) => f.message.startsWith('OLD_KEY')));
});
```

Note: the `.js` files reference `css` in the line so `checkUnits`' code-line filter is irrelevant; they are clean either way. `env/undeclared` matching is on `process.env.X` and needs no styling context.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node --test plugins/ship-standards/tests/touched.test.js`
Expected: the two "skipped/only touched" tests FAIL (deps and env currently scan repo-wide regardless).

- [ ] **Step 3: Implement**

`checkEnv` already takes `files` and only scans those, so it is scoped by Task 1 automatically — verify, do not change. For deps, in `main()` replace:

```js
if (opts.all || !opts.files.length) {
  checkDeps(root, opts.stage, findings);
  checkEnv(files, root, opts.stage, findings);
}
```

with:

```js
if (opts.all || !opts.files.length) {
  // On a touched scan, dependency rules only apply if someone touched the
  // dependency files; legacy lockfile sins belong to the legacy.
  const depFiles = ['package.json', 'package-lock.json', 'yarn.lock'];
  const depsTouched = scope !== 'touched' ||
    files.some((f) => depFiles.includes(rel(f, root)));
  if (depsTouched) checkDeps(root, opts.stage, findings);
  checkEnv(files, root, opts.stage, findings);
}
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `node --test plugins/ship-standards/tests/touched.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/ship-standards/checks/run-checks.js plugins/ship-standards/tests/touched.test.js
git commit -m "Scope dependency and env checks to touched files"
```

---

### Task 3: Opt-in activation and scope pass-through in gate.js

**Files:**
- Modify: `plugins/ship-standards/scripts/gate.js`
- Create: `plugins/ship-standards/tests/gate.test.js`

**Interfaces:**
- Consumes: `--touched` flag and `scope` JSON field from Task 1.
- Produces: gate behavior only; no exported API. Gate stdin protocol unchanged: JSON with `cwd`, `tool_input`, `stop_hook_active`.

- [ ] **Step 1: Write the failing tests**

```js
// plugins/ship-standards/tests/gate.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { makeRepo, writeFiles } = require('./helpers');

const GATE = path.join(__dirname, '..', 'scripts', 'gate.js');

function runGate(mode, input, cwd) {
  try {
    execFileSync(process.execPath, [GATE, mode], {
      cwd, input: JSON.stringify(input), encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return { code: 0, stderr: '' };
  } catch (err) {
    return { code: err.status, stderr: String(err.stderr || '') };
  }
}

const BAD_CSS = 'h1 { font-size: 24px; }\n';
const CONFIG = '.claude/ship-standards.json';

test('no config file: edit gate exits 0 on a violating file', () => {
  const root = makeRepo({ 'a.css': BAD_CSS });
  const r = runGate('edit', { cwd: root, tool_input: { file_path: path.join(root, 'a.css') } }, root);
  assert.strictEqual(r.code, 0);
});

test('no config file: done gate exits 0 on a violating repo', () => {
  const root = makeRepo({ 'a.css': BAD_CSS });
  const r = runGate('done', { cwd: root }, root);
  assert.strictEqual(r.code, 0);
});

test('config present: edit gate blocks on must', () => {
  const root = makeRepo({ 'a.css': BAD_CSS, [CONFIG]: '{}' });
  const r = runGate('edit', { cwd: root, tool_input: { file_path: path.join(root, 'a.css') } }, root);
  assert.strictEqual(r.code, 2);
  assert.match(r.stderr, /units|rem/i);
});

test('scope touched: done gate ignores legacy musts', () => {
  const root = makeRepo({ 'legacy.css': BAD_CSS, [CONFIG]: '{ "scope": "touched" }' });
  const r = runGate('done', { cwd: root }, root);
  assert.strictEqual(r.code, 0);
});

test('scope touched: done gate blocks on dirty-file musts', () => {
  const root = makeRepo({ [CONFIG]: '{ "scope": "touched" }' });
  writeFiles(root, { 'new.css': BAD_CSS });
  const r = runGate('done', { cwd: root }, root);
  assert.strictEqual(r.code, 2);
  assert.match(r.stderr, /new\.css/);
});

test('scope repo: done gate hints at touched when only untouched files offend', () => {
  const root = makeRepo({ 'legacy.css': BAD_CSS, [CONFIG]: '{}' });
  const r = runGate('done', { cwd: root }, root);
  assert.strictEqual(r.code, 2);
  assert.match(r.stderr, /scope.*touched/i);
});
```

Note: `makeRepo` commits everything including the config file, so in the hint test `legacy.css` is committed and untouched.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test plugins/ship-standards/tests/gate.test.js`
Expected: the two no-config tests and the touched/hint tests FAIL (gate currently blocks everywhere and knows no scope).

- [ ] **Step 3: Implement in gate.js**

At the top of `main()` after the skip-env check:

```js
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
```

(Remove the now-duplicated `readInput`/`cwd` lines from the two mode branches.)

In `done` mode, build the args with scope:

```js
const args = ['--all', '--stage', 'done', '--root', cwd, '--json'];
if (scope === 'touched') args.push('--touched');
const result = runChecks(args, cwd);
```

After computing `must`, add the discovery hint (repo scope only):

```js
if (must.length) {
  let hint = '';
  if (scope !== 'touched' && result.scope === 'repo') {
    // If every offender is a committed, unmodified file, the debt predates this
    // work; name the fix instead of only dumping the list.
    const touchedResult = runChecks(
      ['--all', '--stage', 'done', '--root', cwd, '--touched', '--json'], cwd);
    if (touchedResult && touchedResult.scope === 'touched' &&
        !touchedResult.findings.some((f) => f.severity === 'must')) {
      hint = '\nAll of these predate the current work. If this is an inherited ' +
        'codebase, set "scope": "touched" in .claude/ship-standards.json.\n';
    }
  }
  block(
    'Not done. These must be fixed:\n\n' + list(must) +
    '\n\nFix them, then finish. Do not call this complete while any remain.\n' + hint
  );
}
```

`edit` mode needs no logic change beyond the shared opt-in exit above.

- [ ] **Step 4: Run all tests to verify they pass**

Run: `node --test plugins/ship-standards/tests/`
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/ship-standards/scripts/gate.js plugins/ship-standards/tests/gate.test.js
git commit -m "Make the gates opt-in per repo and scope-aware"
```

---

### Task 4: CI base-ref pass-through

**Files:**
- Modify: `.github/workflows/checks.yml`

**Interfaces:**
- Consumes: `--touched-base <ref>` from Task 1 (the checker only uses it when the client repo's config says `scope: "touched"`, so passing it unconditionally is safe).

- [ ] **Step 1: Update the project checkout for history**

In the "Check out the project" step, add:

```yaml
        with:
          fetch-depth: 0
```

- [ ] **Step 2: Pass the base ref on pull requests**

Replace the run line in "Run the checks" with:

```yaml
        run: |
          set +e
          BASE_ARGS=""
          if [ -n "${{ github.base_ref }}" ]; then
            BASE_ARGS="--touched-base origin/${{ github.base_ref }}"
          fi
          node .ship-standards/plugins/ship-standards/checks/run-checks.js \
            --all --stage "${{ inputs.stage }}" --fail-on "${{ inputs.fail-on }}" \
            --root "$GITHUB_WORKSPACE" $BASE_ARGS \
            > check-output.txt 2>&1
          echo "exit_code=$?" >> "$GITHUB_OUTPUT"
          cat check-output.txt
```

On pushes `github.base_ref` is empty and the checker resolves the merge-base itself from the fetched history, which covers the push case; a `scope: "repo"` project ignores the flag entirely.

- [ ] **Step 3: Verify syntax**

Run: `node -e "console.log(require('fs').readFileSync('.github/workflows/checks.yml','utf8').includes('touched-base'))"` and eyeball the YAML (no YAML parser in the repo; indentation is the risk).
Expected: `true`, and the workflow file remains valid YAML by inspection.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/checks.yml
git commit -m "Pass the PR base ref through CI for touched-file scoping"
```

---

### Task 5: Standards doc and injection awareness

**Files:**
- Modify: `plugins/ship-standards/standards/ship-standards.md` (Exceptions section)
- Modify: `plugins/ship-standards/scripts/inject-standards.js`

**Interfaces:**
- Consumes: `scope` field in `.claude/ship-standards.json`.

- [ ] **Step 1: Add the Inherited codebases subsection**

In `standards/ship-standards.md`, after the Exceptions list (the "Nothing else." paragraph), add:

```markdown
### Inherited codebases

On a codebase we did not build, the standard of care is the boy-scout rule: any file
you touch comes fully up to standard; files you do not touch are left alone. A person
turns this on by setting `"scope": "touched"` in `.claude/ship-standards.json`, the
same way a waiver carries a name.

When a one-line fix would drag a large legacy file into a full cleanup that the budget
does not cover, use the existing mechanisms, in order: a scoped waiver
(`"rule": "units", "scope": "legacy/**"`) or an inline `ship-standards:ignore` with a
reason. Do not switch the gate off; put a name on the exemption.
```

- [ ] **Step 2: Surface scope in the injected context**

In `inject-standards.js`, extend `readConfig()`'s returned object with
`scope: cfg.scope === 'touched' ? 'touched' : 'repo'` (and `scope: 'repo'` in the
no-file/error branches). In `buildStandards()`, after the waivers block:

```js
if (config.scope === 'touched') {
  parts.push('## Inherited codebase\n\n' +
    'This project is on the boy-scout rule: any file you touch comes fully up to ' +
    'standard; files you do not touch are left alone. Do not launch repo-wide ' +
    'cleanups unasked.');
}
```

- [ ] **Step 3: Verify by hand**

Run: `cd "$(mktemp -d)" && mkdir .claude && echo '{"scope":"touched"}' > .claude/ship-standards.json && echo '{}' | node /Users/dougleinen/code/claude-standards/plugins/ship-standards/scripts/inject-standards.js full | grep -o 'boy-scout rule'`
Expected: `boy-scout rule` printed.

- [ ] **Step 4: Run the full test suite (regression)**

Run: `node --test plugins/ship-standards/tests/`
Expected: PASS. (The standards doc edit adds prose the self-repo skip already exempts from its own checks.)

- [ ] **Step 5: Commit**

```bash
git add plugins/ship-standards/standards/ship-standards.md plugins/ship-standards/scripts/inject-standards.js
git commit -m "Document the boy-scout rule and inject inherited-scope context"
```

---

### Task 6: The adopt-project skill

**Files:**
- Create: `plugins/ship-standards/skills/adopt-project/SKILL.md`

**Interfaces:**
- Consumes: `run-checks.js --all --json` (Task 1's `scope`/`filesChecked` fields), the config shape `{ platform, scope, waivers }`.

- [ ] **Step 1: Write the skill**

```markdown
---
name: adopt-project
description: Adopt an existing codebase into the Geletkaplus standards. Confirms the platform, asks whether the code is inherited, writes the project config that turns enforcement on, and reports the existing debt. Use on any repo that predates the standards or was built elsewhere.
argument-hint: "<optionally, anything known about the project's history>"
---

# Adopt an existing project

The person said this about the project:

$ARGUMENTS

Enforcement is off until `.claude/ship-standards.json` exists; this command is how it
gets turned on for a repo that `/new-project` never touched. Work through the steps in
order.

## 1. Read the repo

Identify the platform from what is present: `next.config.*` means nextjs,
`wp-config.php` or `wp-content` means wordpress, `astro.config.*` means astro,
`config/settings_schema.json` or `.shopify` means shopify, `wix.config.json` means wix,
`engines.ghost` in package.json means ghost. If nothing matches, the platform is
unknown; that is a fine answer.

## 2. Ask the two questions that are a person's call

Use the AskUserQuestion tool, one call:

- **Is this codebase inherited?** Inherited means we did not build it, or it predates
  the standards: pre-existing violations are accepted debt, and only files we touch
  must come up to standard (the boy-scout rule). Not inherited means the whole repo is
  held to standard.
- **Platform**, only if step 1 could not determine it. Never guess a platform.

## 3. Write the config

Create `.claude/ship-standards.json`:

```json
{
  "platform": "<from step 1 or 2, omit the key entirely if unknown>",
  "scope": "<touched if inherited, otherwise omit the key>",
  "waivers": []
}
```

Leave `waivers` empty. Waivers are a later decision with a name on it. If the file
already exists, do not overwrite it; report what is already there instead and stop.

## 4. Run the first report

Find this plugin's checker (`checks/run-checks.js` beside this skill's directory; if
the plugin root is not resolvable, glob for `**/ship-standards/checks/run-checks.js`
under `~/.claude/plugins/`) and run:

`node <path>/run-checks.js --all --json --root <repo root>`

Run it WITHOUT touched scoping on purpose: adoption starts with eyes open, and this is
the one time the full debt is the point.

## 5. Report back

Plain prose, no more than eight lines:

- The config you wrote, as a path and its contents.
- The debt: counts by severity from the JSON (`counts.must`, `counts.should`,
  `counts.consider`), and the three files with the most findings.
- If inherited: one line saying enforcement now applies to touched files only.
- If not inherited: one line saying the listed musts now block completion, so the
  first task on this repo is paying them down or waiving them by name.

Then stop. Adopting a project and cleaning it up are separate jobs.
```

- [ ] **Step 2: Verify frontmatter parses**

Run: `head -6 plugins/ship-standards/skills/adopt-project/SKILL.md`
Expected: frontmatter with `name: adopt-project` matching the sibling `new-project` skill's shape.

- [ ] **Step 3: Commit**

```bash
git add plugins/ship-standards/skills/adopt-project/SKILL.md
git commit -m "Add the adopt-project skill for opting existing repos in"
```

---

### Task 7: Full-suite regression and self-check

**Files:**
- None created; verification only.

- [ ] **Step 1: Run the whole test suite**

Run: `node --test plugins/ship-standards/tests/`
Expected: PASS, 16 tests.

- [ ] **Step 2: Run the checker against this repo**

Run: `node plugins/ship-standards/checks/run-checks.js --all --root /Users/dougleinen/code/claude-standards`
Expected: exit 0. This repo has no `.claude/ship-standards.json`, the self-repo skip covers the plugin directory, and the new docs live inside skipped paths (`plugins/ship-standards`, or `docs/` which contains no checkable violations — verify; if the spec/plan trip a placeholder check on their own example text, add `ship-standards:ignore` lines with reasons rather than weakening the check).

- [ ] **Step 3: Confirm the no-config behavior end to end**

Run: `echo '{"cwd":"'$PWD'"}' | node plugins/ship-standards/scripts/gate.js done; echo "exit: $?"`
Expected: `exit: 0` (this repo has no config file, so the gate is off here — which is itself the Decision 1 behavior).

- [ ] **Step 4: Commit anything the self-check required, otherwise nothing**

```bash
git status --short
```

Expected: clean, or commit the ignore-line fixes with a one-line message.
```
