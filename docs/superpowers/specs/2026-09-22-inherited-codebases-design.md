# Inherited codebases: touched-file scoping for ship-standards

**Date:** 2026-09-22
**Status:** Approved design, awaiting implementation plan

## Problem

The `done` gate scans the whole repo and the `edit` gate scans the whole file just
written. On an inherited codebase the full-repo scan surfaces hundreds of pre-existing
violations the current work never created, which either blocks all progress or trains
people to switch the gate off. The goal: stay out of the way of legacy debt without
ignoring the standards on work actually being done.

## Decision

Boy-scout rule, at file granularity. A file you touch comes fully up to standard.
A file you do not touch is left alone. Because the unit is the whole file, no
findings baseline is needed; the only state required is a reliable definition of
"touched," which git already provides.

## How a repo becomes inherited

A person declares it in `.claude/ship-standards.json`:

```json
{ "scope": "touched" }
```

- Default is `"repo"` (current behavior, full-repo scan).
- No auto-detection. Accepting legacy debt is a human call, same as a waiver.
- Any value other than `"touched"` or `"repo"` is treated as `"repo"`.

**Discovery hint:** when a full-repo `done` scan finds must-level violations only in
files git reports as never modified by the current work, the gate appends one line:
"If this is an inherited codebase, set `scope: \"touched\"` in
`.claude/ship-standards.json`." It still blocks; the hint just names the fix.

## What "touched" means

The union of:

1. Files changed relative to the merge-base with the default branch:
   `git merge-base <default> HEAD` then `git diff --name-only <base>`.
2. Working-tree changes and untracked files: `git status --porcelain`.

The default branch is resolved from `origin/HEAD`, falling back to `main`, then
`master`. In CI, the diff base is the PR base ref instead of a locally resolved
default branch.

**Failure mode:** not a git repo, or any git command fails, means fall back to a
full-repo scan. Fail open on the git call only; never treat a git error as "nothing
touched" (which would silently disable all checks).

Deleted files appear in git output but no longer exist; they are dropped from the
list, not scanned.

## Changes by file

### `checks/run-checks.js`

- New flag `--touched`. When present (and `--files` is not), the checker computes
  the touched-file list itself via git, so gate.js and CI share one implementation.
- Per-file checks run only on the touched list.
- Repo-wide checks scope too:
  - `dependencies/*` runs only if `package.json`, `package-lock.json`, or
    `yarn.lock` is touched.
  - `env/undeclared` reports only variables referenced from touched files. The
    `.env.example` file itself is always read regardless of touched status.
- `--files` and `--touched` together: `--files` wins (explicit beats inferred).
- JSON output gains `"scope": "touched" | "repo"` and, when touched, the count of
  files scanned vs. files in the repo, so a suspiciously small scan is visible.
- In CI, the base ref arrives as `--touched-base <ref>`; without it, `--touched`
  resolves the base itself as above.

### `scripts/gate.js`

- `edit` mode: unchanged. It already checks exactly the file just written, which is
  the boy-scout rule.
- `done` mode: reads `scope` from `.claude/ship-standards.json` (via the same
  config read the checker uses) and passes `--touched` when it is `"touched"`.
- Adds the discovery hint described above when scope is `"repo"`.

### `templates/client-workflow.yml`

- `fetch-depth: 0` (or enough history to reach the merge base).
- On pull requests, passes `--touched --touched-base origin/${{ github.base_ref }}`.
- On pushes to the default branch, keeps the full-repo scan when scope is `"repo"`;
  when scope is `"touched"`, diffs against the previous commit of the push range.

### `standards/ship-standards.md`

New subsection under **Exceptions**, "Inherited codebases":

- Files you touch come fully up to standard; files you do not touch are left alone.
- `scope: "touched"` is set by a person, like a waiver.
- The expensive case (one-line fix in a large legacy file) is handled by the
  existing mechanisms, in order of preference: a scoped waiver
  (`"rule": "units", "scope": "legacy/**"`) or an inline
  `ship-standards:ignore`. Do not switch the gate off; put a name on the exemption.

### `scripts/inject-standards.js`

- When the project config says `scope: "touched"`, the injected context states it in
  one line so Claude knows the standard of care without re-deriving it.

## Error handling

| Condition | Behavior |
| --- | --- |
| Not a git repo | Full-repo scan (fall back, note in output) |
| git command fails | Full-repo scan, stderr note, never exit 3 |
| Config unreadable / invalid JSON | Existing behavior: scope defaults to `"repo"` |
| Touched file deleted | Dropped from scan list |
| `--files` given with `--touched` | `--files` wins |

## Testing

Fixture repo (created in a temp dir by the test script, with real git history):
a committed "legacy" file full of violations, plus a dirty file with violations.

1. `scope: touched`: dirty file's musts block; legacy file's do not.
2. `scope: repo` (or absent): both block, and the discovery hint appears when the
   only offenders are untouched files.
3. Dependencies check fires only when `package.json` is touched.
4. `env/undeclared` fires only for variables referenced from touched files.
5. Non-git directory: falls back to full scan.
6. Untracked new file is treated as touched.
7. CI path: `--touched-base` against a fixture branch scopes to the branch diff.

## Out of scope

- Line-level baselines or finding snapshots. File granularity was the decision.
- Auto-detecting inherited repos.
- Any change to severities, waivers, or the inline-ignore mechanism.
