# Wix

Most of this ruleset assumes you control the codebase. On Wix you largely do not, and
pretending otherwise trains people to ignore the standards. What still applies:

- Content honesty applies in full. No lorem ipsum, no fabricated names, prices, hours,
  testimonials, or statistics. `[TKTK: ...]` is still the only placeholder.
- Accessibility applies in full, within what the editor exposes: alt text on every image,
  meaningful link text, one H1, headings in order, and sufficient contrast on every
  chosen palette. Check the ones the editor will let you check.
- Velo code, where used, follows the architecture and dependency rules like any other code.
- Secrets belong in the Secrets Manager, never in page code.

What does not apply: the unit and token rules where the editor emits its own CSS, and the
build, dependency, and file-layout rules where there is no build to control. Do not open
waivers for these; they are simply out of scope on this platform.
