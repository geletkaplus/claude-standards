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
