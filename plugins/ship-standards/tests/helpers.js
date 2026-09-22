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
