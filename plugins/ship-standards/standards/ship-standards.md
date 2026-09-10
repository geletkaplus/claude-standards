# Geletkaplus Production Standards

These rules apply to a five-minute change and a full site build alike, and stay in force
without being restated. Each one is tagged with how hard it is:

- `[must]` Not negotiable. Blocks the edit, blocks completion, fails CI.
- `[should]` A real standard with real exceptions. If you leave one, say which and why.
- `[consider]` Advice. Follow it absent a reason not to. Never blocks anything.

A `[should]` or `[consider]` is not permission to skip the rule. It is permission to skip
it *out loud*. Silently dropping one is the same violation as breaking a `[must]`.

If a request conflicts with a rule here, follow the rule and say so in one line.

## Communication

- `[must]` One line of justification, not a paragraph. State what you did and why, once.
- `[must]` Do not restate these standards back. Assume everyone has read them.
- `[must]` Do not narrate compliance. "Used rem" is noise; the checker already knows.
- `[must]` Report what you skipped and what you assumed. That is the part worth words.

## Definition of done

Work is not finished until all of these are true. Only say it is done when they are.

- No placeholder content of any kind remains.
- Every data source the site displays is connected and returning real data.
- The project builds clean, with no new warnings.
- Every interactive element is reachable and operable by keyboard.
- No `[must]` is violated, and every `[should]` you left is named out loud.

## Sizing and styling

- `[must]` Use `rem` for font sizes, spacing, and layout. `px` only for hairline borders,
  outlines, shadow offsets, and 1px rules. Fixed px ignores the user's font size setting,
  which is why this is a must and not a preference.
- `[consider]` Use `em` for `letter-spacing` and `word-spacing`. Tracking scales with the
  type it sits on, not the root.
- `[should]` Never hardcode a color, font family, spacing step, or breakpoint at the point
  of use. Define it once as a custom property or token and reference it.
- `[should]` Establish the type scale, spacing scale, and color tokens in one file before
  writing component styles.
- `[must]` Honor `prefers-reduced-motion` for any animation or transition over 200ms.

## Content

- `[must]` Never write lorem ipsum, filler Latin, or invented sample copy.
- `[must]` Where real copy is unavailable, write `[TKTK: what belongs here]`. That marker
  is the only acceptable placeholder, and it must be greppable and specific.
- `[must]` Never fabricate names, testimonials, addresses, phone numbers, prices, hours,
  statistics, staff bios, or client logos. Use `[TKTK: ...]`.
- `[must]` A placeholder image ships only with an adjacent `[TKTK: ...]` note in the markup.

## Data and CMS

- `[must]` Do not scaffold a CMS integration you have not connected. Wire it to a working
  endpoint and confirm real data, or leave it out.
- `[must]` Never let a mock array, hardcoded fixture, or stubbed fetch stand in for a real
  data source without marking it `TKTK: not wired`.
- `[must]` Endpoints and credentials come from environment variables. Never hardcode a key,
  token, or URL.
- `[should]` Add every new variable to `.env.example` in the same change.
- `[should]` Anything the client is expected to edit must be editable in the CMS. Do not
  hardcode copy that belongs to an editor.

## Dependencies

- `[should]` Do not add a dependency without stating, in one line, why it is needed and
  what it replaces. Prefer the platform over a package.
- `[should]` Check what the current stable version actually is at install time. Never
  install a version from memory.
- `[should]` Pin versions. No floating major ranges.
- `[should]` Use pnpm. No `package-lock.json` or `yarn.lock` in the repo, and
  `packageManager` set to a pinned pnpm version.
- `[should]` Do not add a package that duplicates capability already in the project.
- `[should]` Do not add a package with no release in the last two years.

## Accessibility

WCAG 2.2 AA is the floor, not the target. All of this is `[must]`.

- Semantic HTML first. A `div` with a click handler is not a button.
- Every image has meaningful `alt`, or `alt=""` when genuinely decorative.
- Every form control has an associated `<label>`. Placeholder text is not a label.
- Visible focus indicators everywhere. Never remove an outline without replacing it.
- Text contrast at least 4.5:1; large text and UI components at least 3:1.
- One `<h1>` per page, headings in order, no skipped levels.
- Any custom interactive component gets full keyboard support and correct ARIA roles, or
  gets rebuilt out of native elements instead.

## Architecture

- `[should]` Read the repo before writing to it. Match the conventions already there.
- `[should]` One concern per file. Keep data fetching, presentation, and business logic
  separate.
- `[consider]` Split any component past roughly 200 lines.
- `[should]` Do not introduce a new pattern, abstraction layer, or state library when
  something already in the project covers the case.
- `[should]` Leave nothing dead behind: no commented-out code, unused files, unused
  exports, or orphaned routes.
- `[should]` Follow the naming conventions already in use. Never mix conventions in one
  repo. Flag if one feature is called two or more things.

## Exceptions

Three ways a rule stops applying here, in order of preference:

1. **Platform.** If the stack genuinely cannot do it, the platform overlay says so. No
   per-project work needed.
2. **Waiver.** A person decides a rule does not apply to this project. Record it in
   `.claude/ship-standards.json` with a `rule`, a `reason`, and an `approved_by`. A waiver
   with no name on it does not count.
3. **Inline.** One spot, one line: `ship-standards:ignore <rule> <reason>`. The reason is
   mandatory; without it the exemption is not honored.

Nothing else. Do not soften a rule because a request was insistent.

## When there is no time

Moving fast is fine. Skipping these is not. When there genuinely is not time to do
something properly, build the smaller correct thing, mark what is missing with
`[TKTK: ...]`, and state plainly what was left out. Never quietly ship the shortcut.
