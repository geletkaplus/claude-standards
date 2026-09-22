---
name: adopt-project
description: Adopt an existing codebase into the Geletkaplus standards. Confirms the platform, asks whether the code is inherited, writes the project config that turns enforcement on, and reports the existing debt. Use on any repo that predates the standards or was built elsewhere.
argument-hint: "<optionally, anything known about the project's history>"
---

# Adopt an existing project

The person said this about the project:

$ARGUMENTS

Enforcement is off until `.claude/ship-standards.json` exists; this command is how it
gets turned on for a repo that `/new-project` never touched. Work through the steps in
order.

## 1. Read the repo

Identify the platform from what is present: `next.config.*` means nextjs,
`wp-config.php` or `wp-content` means wordpress, `astro.config.*` means astro,
`config/settings_schema.json` or `.shopify` means shopify, `wix.config.json` means wix,
`engines.ghost` in package.json means ghost. If nothing matches, the platform is
unknown; that is a fine answer.

## 2. Ask the two questions that are a person's call

Use the AskUserQuestion tool, one call:

- **Is this codebase inherited?** Inherited means we did not build it, or it predates
  the standards: pre-existing violations are accepted debt, and only files we touch
  must come up to standard (the boy-scout rule). Not inherited means the whole repo is
  held to standard.
- **Platform**, only if step 1 could not determine it. Never guess a platform.

## 3. Write the config

Create `.claude/ship-standards.json`:

```json
{
  "platform": "<from step 1 or 2, omit the key entirely if unknown>",
  "scope": "<touched if inherited, otherwise omit the key>",
  "waivers": []
}
```

Leave `waivers` empty. Waivers are a later decision with a name on it. If the file
already exists, do not overwrite it; report what is already there instead and stop.

## 4. Run the first report

Find this plugin's checker (`checks/run-checks.js` beside this skill's directory; if
the plugin root is not resolvable, glob for `**/ship-standards/checks/run-checks.js`
under `~/.claude/plugins/`) and run:

`node <path>/run-checks.js --all --json --root <repo root>`

Run it WITHOUT touched scoping on purpose: adoption starts with eyes open, and this is
the one time the full debt is the point.

## 5. Report back

Plain prose, no more than eight lines:

- The config you wrote, as a path and its contents.
- The debt: counts by severity from the JSON (`counts.must`, `counts.should`,
  `counts.consider`), and the three files with the most findings.
- If inherited: one line saying enforcement now applies to touched files only.
- If not inherited: one line saying the listed musts now block completion, so the
  first task on this repo is paying them down or waiving them by name.

Then stop. Adopting a project and cleaning it up are separate jobs.
