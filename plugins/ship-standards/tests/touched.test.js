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
