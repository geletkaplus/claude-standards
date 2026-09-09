# Geletkaplus Production Standards

These rules are mandatory on every Geletkaplus project. They apply to a five-minute
change and to a full site build alike, and they stay in force without being restated.
If a request conflicts with a rule here, follow the rule and say so in one line.

## Definition of done

Work is not finished until all of these are true. Only say it is done when they are.

- No placeholder content of any kind remains.
- Every data source the site displays is actually connected and returning real data.
- The project builds clean, with no new warnings.
- Every interactive element is reachable and operable by keyboard.
- No rule below is knowingly violated.

## Sizing and styling

- Use `rem` for font sizes, spacing, and layout dimensions. `px` is allowed only for
  hairline borders, outlines, shadow offsets, and 1px rules.
- Never hardcode a color, font family, spacing step, or breakpoint at the point of use.
  Define it once as a custom property (or the stack's token equivalent) and reference it.
- Establish the type scale, spacing scale, and color tokens in one file before writing
  any component styles.
- Honor `prefers-reduced-motion` for any animation or transition longer than 200ms.

## Content

- Never write lorem ipsum, "Lorem", filler Latin, or invented sample copy.
- Where real copy is not available, write `[TKTK: what belongs here]`. That marker is the
  only acceptable placeholder, and it must be greppable and specific.
- Never fabricate names, testimonials, addresses, phone numbers, prices, hours,
  statistics, staff bios, or client logos. Use `[TKTK: ...]` instead.
- A placeholder image ships only with an adjacent `[TKTK: ...]` note in the markup.

## Data and CMS

- Do not scaffold a CMS integration you have not connected. Either wire it to a working
  endpoint and confirm it returns real data, or leave it out entirely.
- Never let a mock array, hardcoded fixture, or stubbed fetch stand in for a real data
  source without marking it `TKTK: not wired`.
- Endpoints and credentials come from environment variables. Never hardcode a key, token,
  or URL. Add every new variable to `.env.example` in the same change.
- Anything the client is expected to edit must be editable in the CMS. Do not hardcode
  copy that belongs to an editor.

## Dependencies

- Do not add a dependency without stating, in one line, why it is needed and what it
  replaces. Prefer the platform over a package.
- Check what the current stable version actually is at install time. Never install a
  version from memory.
- Pin versions. No floating major ranges.
- Do not add a package that duplicates capability already present in the project.
- Do not add a package with no release in the last two years.

## Accessibility

WCAG 2.2 AA is the floor, not the target.

- Semantic HTML first. A `div` with a click handler is not a button.
- Every image has meaningful `alt`, or `alt=""` when genuinely decorative.
- Every form control has an associated `<label>`. Placeholder text is not a label.
- Visible focus indicators everywhere. Never remove an outline without replacing it.
- Text contrast at least 4.5:1; large text and UI components at least 3:1.
- One `<h1>` per page, headings in order, no skipped levels.
- Any custom interactive component gets full keyboard support and correct ARIA roles, or
  it gets rebuilt out of native elements instead.

## Architecture

- Read the repo before writing to it. Match the conventions already there.
- One concern per file. Keep data fetching, presentation, and business logic separate.
- Split any component past roughly 200 lines.
- Do not introduce a new pattern, abstraction layer, or state library when something
  already in the project covers the case.
- Leave nothing dead behind: no commented-out code, unused files, unused exports, or
  orphaned routes.
- Follow the naming conventions already in use. Never mix conventions in one repo.

## When there is no time

Moving fast is fine. Skipping these is not. When there genuinely is not time to do
something properly, build the smaller correct thing, mark what is missing with
`[TKTK: ...]`, and state plainly what was left out. Never quietly ship the shortcut.
