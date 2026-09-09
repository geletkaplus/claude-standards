# claude-standards

Geletkaplus house standards for Claude Code, packaged as an installable plugin.

The point of this repo: whoever is driving a build, and however fast they are moving,
the production rules are already in the session before they type anything.

## What is in here

```
claude-standards/
├── .claude-plugin/
│   └── marketplace.json              the marketplace manifest, so this repo is installable
└── plugins/
    └── ship-standards/
        ├── .claude-plugin/plugin.json
        ├── standards/ship-standards.md   the rules themselves (single source of truth)
        ├── hooks/hooks.json              wires the injection hook to two events
        ├── scripts/inject-standards.js   reads the rules, injects them into context
        ├── skills/new-project/SKILL.md   the /new-project generator command
        └── templates/project-settings.json   drop-in config for client repos
```

`standards/ship-standards.md` is the only place the rules live. The hook injects that
file, and `/new-project` copies that file. Change the rules in one place and both
mechanisms follow.

## The two mechanisms

**Automatic injection.** A `SessionStart` hook puts the full ruleset into context when a
session opens. A `UserPromptSubmit` hook then adds a one-line reminder before every
prompt, and re-injects the full ruleset when a prompt looks like it is about to produce
code (throttled to once every 12 prompts, so a long session does not bloat). Nobody has
to invoke anything, remember anything, or read anything for this to work.

**`/new-project`.** A generator command. Someone types
`/new-project Riverbend Bakery, warm rustic feel, blog and online ordering` and it copies
the standards into the repo, writes a `CLAUDE.md` that imports them, fills in what the
description supports, and lists every assumption it had to make in an `Unresolved`
section. That last part is the useful bit: it is a written record of what got guessed,
instead of a guess buried in the code a week later.

## Install

Push this repo to GitHub, then, on each machine:

```bash
claude plugin marketplace add OWNER/claude-standards
claude plugin install ship-standards@geletkaplus
```

To skip the per-machine install on a given client project, copy
`plugins/ship-standards/templates/project-settings.json` to `.claude/settings.json` in
that repo (fix the `OWNER/` path first) and commit it. Anyone who opens that repo in
Claude Code loads the plugin automatically.

## Test it

Worth doing once before trusting it.

```bash
# The hook should print JSON containing the standards.
echo '{"hook_event_name":"SessionStart","session_id":"test1"}' \
  | node plugins/ship-standards/scripts/inject-standards.js full

# A build-shaped prompt should get the full ruleset.
echo '{"hook_event_name":"UserPromptSubmit","session_id":"test2","prompt":"build me a landing page"}' \
  | node plugins/ship-standards/scripts/inject-standards.js prompt

# A chatty prompt should get only the short reminder.
echo '{"hook_event_name":"UserPromptSubmit","session_id":"test2","prompt":"what did we name that file"}' \
  | node plugins/ship-standards/scripts/inject-standards.js prompt
```

Then in a real Claude Code session, run `/context` (or just ask Claude what standards
apply) to confirm the rules actually landed in context.

## Iterating

1. Edit `standards/ship-standards.md`.
2. Bump `version` in both `plugins/ship-standards/.claude-plugin/plugin.json` and
   `.claude-plugin/marketplace.json`.
3. Commit and push. Others pick it up with `claude plugin update ship-standards`.

Keep the rules short and specific. Every line is injected into context repeatedly, so
vague advice costs tokens on every turn and changes nothing. A rule earns its place if a
person could objectively tell whether it was followed.

## Deliberately not here yet

This version only makes sure the rules are present and seen. It does not stop anyone from
violating them. The blocking layer comes next: `PostToolUse` hooks that fail on `[TKTK:`
markers left at completion, on `px` in stylesheets, on unpinned dependencies, plus a QA
subagent on `Stop`. Those go in `hooks/hooks.json` alongside the existing entries.

Design note for that layer: the standards deliberately mandate a single greppable
placeholder marker, `[TKTK: ...]`. That means the entire lorem ipsum problem reduces to
one regex over the diff, rather than trying to detect improvised filler prose.

## Notes

- The injection hook can never block a session. It exits 0 on every path, including a
  crash, malformed stdin, or a missing standards file. Only exit code 2 blocks, and the
  script never uses it.
- It requires `node` on PATH.
- Session state for injection throttling is a small file in the OS temp directory. Losing
  it is harmless.
