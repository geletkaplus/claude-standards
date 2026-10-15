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
    const stdout = execFileSync(process.execPath, [GATE, mode], {
      cwd, input: JSON.stringify(input), encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status, stdout: String(err.stdout || ''), stderr: String(err.stderr || '') };
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
  assert.strictEqual(r.stdout, '');
});

test('scope touched: done gate lists dirty-file musts without blocking', () => {
  const root = makeRepo({ [CONFIG]: '{ "scope": "touched" }' });
  writeFiles(root, { 'new.css': BAD_CSS });
  const r = runGate('done', { cwd: root }, root);
  assert.strictEqual(r.code, 0);
  assert.match(JSON.parse(r.stdout).systemMessage, /new\.css/);
});

test('done gate lists open TKTKs without blocking', () => {
  const root = makeRepo({ [CONFIG]: '{}', 'a.html': '<p>[TKTK: hero copy from client]</p>\n' });
  const r = runGate('done', { cwd: root }, root);
  assert.strictEqual(r.code, 0);
  assert.match(JSON.parse(r.stdout).systemMessage, /a\.html:1/);
});

test('done gate stays quiet when the list has not changed', () => {
  const root = makeRepo({ [CONFIG]: '{}', 'a.html': '<p>[TKTK: hero copy from client]</p>\n' });
  assert.notStrictEqual(runGate('done', { cwd: root }, root).stdout, '');
  assert.strictEqual(runGate('done', { cwd: root }, root).stdout, '');
  writeFiles(root, { 'b.css': BAD_CSS });
  assert.match(JSON.parse(runGate('done', { cwd: root }, root).stdout).systemMessage, /b\.css/);
});
