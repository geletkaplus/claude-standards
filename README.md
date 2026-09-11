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
    ├── standards/
    │   ├── ship-standards.md             the rules themselves (single source of truth)
    │   ├── type.md                       typeface reference, consulted not injected
    │   └── platforms/*.md                per-stack overlays, layered on the base
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
is written and refuses the edit on a `must`, while there is still context to fix it
cheaply. It runs at `build` stage, so `[TKTK: ...]` markers are legal here.

**Completion blocked while anything is outstanding.** A `Stop` hook runs the full suite over
the repo at `done` stage, unresolved `TKTK` markers included. A `must` blocks outright; a
`should` blocks once, so it gets named rather than quietly skipped.

**CI as the gate that cannot be bypassed.** The first three run on someone's machine and can
be turned off. CI runs on push, is controlled entirely by whoever owns the repo, and does not
care which tool wrote the code.

Local hooks and CI run the identical script, so they cannot disagree. That matters more than
it sounds: the fastest way to make people ignore checks is to have local pass and CI fail.

## Severity

Every rule carries a tier, so the tool can be strict about the things that matter and
quiet about the things that are judgment calls.

| Tier | Blocks an edit | Blocks completion | Fails CI |
|---|---|---|---|
| `must` | yes | yes | yes |
| `should` | no | surfaced once, to be named out loud | only with `fail-on: should` |
| `consider` | no | no | no |

A `should` is not permission to skip a rule. It is permission to skip it *out loud*.
The `Stop` gate blocks once on outstanding `should` findings, which forces them to be
named rather than quietly dropped, then lets the session proceed.

## What gets checked

| Rule | Tier | Catches |
|---|---|---|
| `placeholders/fabricated` | must | lorem ipsum, filler latin, `555-555-5555`, `John Doe`, unreplaced template copy |
| `placeholders/tktk` | must | unresolved `[TKTK: ...]` markers (at `done` stage only) |
| `units/px` | must | `px` outside hairlines, outlines, shadows, and media queries |
| `units/tracking` | consider | `px` or `rem` on `letter-spacing` / `word-spacing`, which want `em` |
| `typography/heading-wrap` | should | A rule that sizes an `h1`-`h6` but never sets `text-wrap` |
| `dependencies/unpinned` | should | `^`, `~`, `latest`, wildcards and open ranges |
| `dependencies/package-manager` | should | a stray `package-lock.json` or `yarn.lock`, or a non-pnpm `packageManager` |
| `env/undeclared` | should | `process.env.X` missing from `.env.example` |
| `type/default-face` | should | Inter, Poppins, Montserrat, Playfair Display and the rest of the default list |

`units/px` is a must because fixed pixel sizing ignores the reader's font-size setting,
which makes it an accessibility problem rather than a matter of taste.

`type/default-face` reads the first face in a stack only, since everything after it is a
fallback, and covers `font-family`, Google Fonts links, and `next/font/google` imports. It
is a `should` because those faces are not bad, they are just what gets chosen when nobody
chose. Satisfy it with a one-line reason, not a different font:
`/* ship-standards:ignore type Inter for the dashboard; built for dense UI */`.
Alternatives grouped by voice live in `standards/type.md`.

`env` skips platform and runtime variables (`PORT`, `CI`, `VERCEL_*`, `GITHUB_*`, `npm_*`),
because nobody declares those. `units` exempts a single declaration rather than a whole
line, so `padding: 24px; border: 1px solid` is still caught.

Run it by hand any time:

```bash
node plugins/ship-standards/checks/run-checks.js --all --root /path/to/project
node plugins/ship-standards/checks/run-checks.js --all --stage build --json
node plugins/ship-standards/checks/run-checks.js --all --fail-on should
```

## Platform overlays

The base rules are universal. Each platform adds its own on top, from
`standards/platforms/`: Next.js, WordPress, Astro, Shopify, Ghost, and Wix.

The platform comes from `.claude/ship-standards.json`, falling back to detection
(`next.config.*`, `wp-config.php`, `astro.config.*`, `config/settings_schema.json`,
`engines.ghost`, and so on). Explicit always wins, because a rescue project often carries
the fingerprints of two stacks at once.

The Wix overlay is deliberately mostly subtraction. Content honesty and accessibility
still apply in full; the build, dependency, and unit rules mostly do not, because there is
no build to control. Saying so plainly beats pretending, which just teaches people to
ignore the tool.

## Exceptions

Three ways a rule stops applying, in order of preference.

**Platform.** If the stack genuinely cannot do it, the overlay handles it. No per-project
work.

**Waiver.** Someone decides a rule does not apply to this project, and signs for it:

```jsonc
// .claude/ship-standards.json
{
  "platform": "wordpress",
  "waivers": [{
    "rule": "units/px",
    "scope": "themes/acme/**",
    "reason": "Client's design system is px-based; they will not fund a conversion.",
    "approved_by": "Doug Leinen"
  }]
}
```

`rule` matches a whole check (`units`) or one variant (`units/px`). `scope` is an optional
glob. **A waiver with no `reason` and `approved_by` is ignored entirely**, which is what
keeps this from becoming a mute button.

Waived findings still print, under a `Waived` heading with the approver's name, so nobody
forgets they exist or who signed.

Critically, the injection hook reads this same file and tells Claude what has been waived.
Otherwise the checker would allow something the session would keep arguing about.

**Inline.** One spot, one line:

```css
/* ship-standards:ignore units — Ghost injects this and it cannot be themed */
.kg-card { padding: 24px; }
```

The reason is mandatory. An ignore without one is not honored, and gets reported as its
own `should` finding.

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
# The suite against itself: should be clean.
node plugins/ship-standards/checks/run-checks.js --all --stage done --root .

# Injection: should print the base rules plus any platform overlay.
echo '{"hook_event_name":"SessionStart","cwd":"'"$PWD"'"}' \
  | node plugins/ship-standards/scripts/inject-standards.js full

# Enforcement: should exit 2 on a must.
printf '.card { padding: 24px; }\n' > /tmp/gk-test.css
echo '{"cwd":"/tmp","tool_input":{"file_path":"/tmp/gk-test.css"}}' \
  | node plugins/ship-standards/scripts/gate.js edit
```

End to end, install from a local path so you can iterate without pushing:

```bash
claude plugin marketplace add ~/code/claude-standards
claude plugin install ship-standards@geletkaplus
claude plugin details ship-standards     # check the token cost of the ruleset
```

Restart Claude Code, then in a scratch project ask for something rushed and sloppy and
watch what happens. That is the only test that says whether any of this holds up.

## Escape hatches, on purpose

`SHIP_STANDARDS_SKIP=1` in the environment bypasses the local gate entirely. It is the
blunt instrument of last resort; waivers and inline ignores exist so nobody needs it.
Anyone can disable a local hook anyway, and a documented switch beats someone uninstalling
the plugin the first time it gets in their way at midnight. CI has no such switch, which
is why CI is the one that matters.

The `Stop` hook honours `stop_hook_active`, so it blocks once and then lets the session work
through the result. Without that you can build an inescapable loop, which is worse than a
missed check.

Both scripts fail open. A broken hook, a missing standards file, malformed input, or a crash
all result in exit 0 and no interference.

## Iterating

1. Change `standards/ship-standards.md`, `checks/run-checks.js`, or both. Keep them
   agreeing with each other, tier included; a rule nobody checks is decoration, a check no
   rule explains is infuriating, and a rule whose tier differs between the two is worse
   than either.
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
- **Accessibility scanning.** The standards require WCAG 2.2 AA but nothing here verifies
  it. Real coverage means axe-core or Lighthouse CI against a built preview, which needs
  the project to build, so it belongs in CI rather than in a hook.
- **CMS wiring verification.** Only partially covered, via the `env` check. Proving an
  endpoint really returns data needs credentials CI will not always have.
- **Inherited projects.** A rescue repo trips every rule at once, and a first `Stop` with
  four hundred findings gets the gate switched off within the hour. What is needed is a
  baseline captured at intake, so only new violations block. Until that exists, start
  those projects with `fail-on: must` in CI and waive broadly.
