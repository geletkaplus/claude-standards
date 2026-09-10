# claude-standards

Geletkaplus house standards for Claude Code, plus the CI that enforces them.

The point of this repo: whoever is driving a build, and however fast they are moving,
the production rules are already in the session before they type anything, and nothing
that violates them can reach a production branch quietly.

## What is in here

```
claude-standards/
├── .claude-plugin/marketplace.json       makes this repo installable as a plugin source
├── .github/workflows/checks.yml          reusable CI workflow, called by client repos
└── plugins/ship-standards/
    ├── .claude-plugin/plugin.json
    ├── standards/ship-standards.md       the rules themselves (single source of truth)
    ├── checks/run-checks.js              every mechanical check, one implementation
    ├── hooks/hooks.json                  wires the hooks to four events
    ├── scripts/inject-standards.js       puts the rules into context automatically
    ├── scripts/gate.js                   blocks edits and completion that violate them
    ├── skills/new-project/SKILL.md       the /new-project generator command
    └── templates/
        ├── project-settings.json         drop-in Claude Code config for client repos
        └── client-workflow.yml           drop-in CI workflow for client repos
```

Two files carry all the actual policy: `standards/ship-standards.md` is what humans and
Claude read, `checks/run-checks.js` is what machines enforce. Everything else is plumbing
that points at one of those two.

## The four layers

**Rules always present.** A `SessionStart` hook puts the full ruleset into context when a
session opens. A `UserPromptSubmit` hook adds a one-line reminder before every prompt and
re-injects the full ruleset when a prompt looks like it will produce code, throttled to at
most once every twelve prompts. Nobody has to invoke, remember, or read anything.

**Violations blocked as they happen.** A `PostToolUse` hook checks each file the moment it
is written and refuses the edit if it breaks a rule, while there is still context to fix it
cheaply. It runs at `build` stage, so `[TKTK: ...]` markers are legal here.

**Completion blocked while anything is outstanding.** A `Stop` hook runs the full suite over
the repo at `done` stage, unresolved `TKTK` markers included, and refuses to let the session
report itself finished until it is clean.

**CI as the gate that cannot be bypassed.** The first three run on someone's machine and can
be turned off. CI runs on push, is controlled entirely by whoever owns the repo, and does not
care which tool wrote the code.

Local hooks and CI run the identical script, so they cannot disagree. That matters more than
it sounds: the fastest way to make people ignore checks is to have local pass and CI fail.

## What gets checked

| Check | Catches | Stage |
|---|---|---|
| `placeholders` | lorem ipsum, filler latin, `555-555-5555`, `example@example.com`, `John Doe`, unreplaced template copy | always |
| `placeholders` | unresolved `[TKTK: ...]` markers | done only |
| `units` | `px` outside hairlines, outlines, shadows, and media queries | always |
| `dependencies` | `^`, `~`, `latest`, wildcards and open ranges in package.json | always |
| `env` | `process.env.X` / `import.meta.env.X` missing from `.env.example` | always |

Two exemptions worth knowing about, both there so the checks stay worth listening to:

- `env` ignores platform and runtime variables (`PORT`, `CI`, `NODE_ENV`, `VERCEL_*`,
  `GITHUB_*`, `npm_*`, and the like). Nobody puts those in `.env.example`, and flagging
  them made the check fire on every config file. A `ship-standards:ignore` comment on the
  line exempts anything else deliberately.
- `units` exempts a declaration, not a whole line, so
  `padding: 24px; border: 1px solid` is still caught. Media and container queries are
  exempt outright.

This repo is checked by its own suite. Its README and workflow quote the patterns the
checks look for, so when the source of truth is present at
`plugins/ship-standards/standards/ship-standards.md`, its own docs and plugin directory
are skipped. That detection does not match in a client repo, where everything is checked.

Run it by hand any time:

```bash
node plugins/ship-standards/checks/run-checks.js --all --root /path/to/project
node plugins/ship-standards/checks/run-checks.js --all --stage build --json
```

## Install

Push this repo to GitHub, then on each machine:

```bash
claude plugin marketplace add geletkaplus/claude-standards
claude plugin install ship-standards@geletkaplus
```

To skip the per-machine install on a given project, copy
`plugins/ship-standards/templates/project-settings.json` to `.claude/settings.json` in that
repo and commit it. Anyone who opens that repo in Claude Code loads the plugin
automatically.

## Turn on CI for a client repo

Copy `plugins/ship-standards/templates/client-workflow.yml` to
`.github/workflows/standards.yml` in the client repo and commit it. That is the whole
setup; the checks themselves stay centralised here.

While this repo is public the template works as it stands. If it is ever made private, a
client repo's `GITHUB_TOKEN` is scoped to itself and cannot check this one out; pass a
read-only PAT or GitHub App token through the workflow's `standards_token` secret instead.
The `Settings > Actions > General > Access` option governs reusable-workflow access, not
the checkout, so it is not a substitute.

Once it has run green a few times, pin `@main` to a tag in the client workflow so a rule
change here cannot turn a client's pipeline red without warning.

## Test it

```bash
# Hook injection: should print JSON containing the standards.
echo '{"hook_event_name":"SessionStart","session_id":"t1"}' \
  | node plugins/ship-standards/scripts/inject-standards.js full

# The suite against itself: should be clean.
node plugins/ship-standards/checks/run-checks.js --all --stage done --root .

# Enforcement: should exit 2 and explain why.
printf '.card { padding: 24px; }\n' > /tmp/gk-test.css
echo '{"cwd":"/tmp","tool_input":{"file_path":"/tmp/gk-test.css"}}' \
  | node plugins/ship-standards/scripts/gate.js edit
```

Then in a real session, ask for something rushed and sloppy and watch what happens. That is
the only test that tells you whether any of this holds up in practice.

## Escape hatches, on purpose

`SHIP_STANDARDS_SKIP=1` in the environment bypasses the local gate entirely. Anyone can
disable a local hook anyway, and a documented switch is better than someone uninstalling the
plugin the first time it gets in their way at midnight. CI is the layer that has no such
switch, which is why CI is the one that matters.

The `Stop` hook honours `stop_hook_active`, so it blocks once and then lets the session work
through the result. Without that you can build an inescapable loop, which is worse than a
missed check.

Both scripts fail open. A broken hook, a missing standards file, malformed input, or a crash
all result in exit 0 and no interference.

## Iterating

1. Change `standards/ship-standards.md`, `checks/run-checks.js`, or both. Keep them agreeing
   with each other; a rule nobody checks is decoration, and a check no rule explains is
   infuriating.
2. Bump `version` in `plugins/ship-standards/.claude-plugin/plugin.json` and
   `.claude-plugin/marketplace.json`.
3. Commit, push, tag. Others pick it up with `claude plugin update ship-standards`; CI picks
   it up on the next run, or at the next tag bump if pinned.

Keep the prose rules short. Every line is injected into context repeatedly, so vague advice
costs tokens on every turn and changes nothing. A rule earns its place if a person could
objectively tell whether it was followed.

## Not built yet

- **Architecture review.** Mechanical checks cannot tell you the structure is wrong. A QA
  subagent on `Stop`, reporting rather than blocking, is the next honest step.
- **Accessibility scanning.** The standards require WCAG 2.2 AA but nothing here verifies it.
  Real coverage means axe-core or Lighthouse CI against a built preview, which needs the
  project to actually build, so it belongs in the CI workflow rather than in a hook.
- **CMS wiring verification.** Currently only partially covered, via the `env` check. Proving
  an endpoint really returns data needs credentials CI will not always have.
