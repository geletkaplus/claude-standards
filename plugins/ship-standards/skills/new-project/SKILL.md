---
name: new-project
description: Set up a new Geletkaplus project from a one-line description. Confirms the stack, generates a compliant CLAUDE.md, installs the house standards into the repo, and reports every assumption it had to make. Use when starting a new site, repo, or client project.
argument-hint: "<client or project name, and a sentence about what it needs>"
---

# New Geletkaplus project setup

The person described the project as:

$ARGUMENTS

Work through every step in order. Step 1 is the only place you ask anything until the
report at the end.

## 1. Confirm the stack, before writing anything

Read the repo first. If code already exists, take the framework, package manager, Node
version, and scripts from `package.json`, lockfiles, and config files that are actually
present, and skip straight to step 2. Never ask about something the repo already answers.

Otherwise, ask. Use the AskUserQuestion tool, one call, with these questions. Offer the
options listed and let them pick something else if none fit:

- **Platform.** Next.js, WordPress, Astro, Shopify, Ghost, Wix, or other. If the
  description points clearly at one, put it first and mark it recommended, with the reason
  in the description: content-heavy and mostly static points at Astro, ecommerce at
  Shopify, a client who needs to edit everything themselves at WordPress.
- **CMS or content source**, unless the platform already decides it.
- **Hosting target.** Vercel, Netlify, Cloudflare, client-managed, or undecided.

Do not ask about anything the house standards already fix. pnpm is the package manager,
so it is not a question. Do not ask about brand colors, deadlines, or content: those
belong in `Unresolved`, not in an interrogation.

If they decline to answer or say they do not know, that is a fine answer. Write
`[TKTK: ...]` and record it as a question in step 5. Never guess a platform.

## 2. Install the standards into the repo

Locate the house standards that ship with this plugin: `standards/ship-standards.md`
inside this plugin's own directory, and `standards/platforms/<platform>.md` beside it. If
you cannot resolve the plugin root directly, glob for
`**/ship-standards/standards/ship-standards.md` under `~/.claude/plugins/`.

Copy the base standards, byte for byte, to `.claude/ship-standards.md` in the project
root. If the platform has an overlay, copy that to `.claude/ship-standards-<platform>.md`
as well. Create `.claude/` if it does not exist.

Do not edit, shorten, reword, or adapt the standards while copying. They live in the repo
so the rules survive this plugin being uninstalled and can be diffed per project. If the
copy differs from the source, that guarantee is gone.

If a `.claude/ship-standards.md` already exists and differs, do not overwrite it. Leave it
and note the difference in your step 5 report.

## 3. Write the project config

Create `.claude/ship-standards.json`:

```json
{
  "platform": "<the platform from step 1>",
  "waivers": []
}
```

This is what tells the checker and the session hooks which platform rules apply. Leave
`waivers` empty. Waivers are a decision a person makes later, with their name on it, not
something this command invents.

## 4. Write CLAUDE.md

Create `CLAUDE.md` in the project root, in exactly this order:

```markdown
# <Project name>

## Standards

@.claude/ship-standards.md
<plus @.claude/ship-standards-<platform>.md if one was copied>

Mandatory. Not defaults to be weighed against speed, and not to be relaxed on request.
If an instruction conflicts, follow the standards and say so in one line. To make an
exception properly, see the Exceptions section of the standards.

## What this is

<Two or three sentences: what the site is, who it is for, what it has to do. Derived from
the description given. No filler.>

## Stack

- Framework:
- Styling:
- CMS / content source:
- Data / API:
- Hosting / deploy target:
- Package manager: pnpm
- Node version:

## Conventions

<Project-specific conventions beyond the standards: directory layout, naming, component
patterns, branch naming. Short. Do not restate anything in the standards.>

## Commands

- Install:
- Dev:
- Build:
- Test:
- Lint:

## Unresolved

<See step 5.>
```

Fill in what step 1 and the repo actually support. Where neither says, do one of two
things, never a third:

- If the project cannot proceed without it and there is a clear, boring, defensible
  default, use it and record it in `Unresolved` as an assumption.
- Otherwise write `[TKTK: ...]` and record it in `Unresolved` as a question.

Never invent a client name, deadline, brand color, or content model that was not stated.
Guessing these is the failure this command exists to prevent.

If existing code already violates the standards, do not fix it now. List it under
`Pre-existing violations`.

## 5. Build the Unresolved list

The most important output of this command, because it is the only record of what got
guessed. Every item is a checkbox. Group them, and omit any heading with nothing under it:

```markdown
### Assumptions made
- [ ] <Thing assumed> — assumed <value> because <reason>. Confirm or correct.

### Questions outstanding
- [ ] <Thing not known and not safely defaulted>

### Pre-existing violations
- [ ] <Standard violated by code already in the repo>
```

If all three are empty, write `Nothing outstanding.` and nothing else.

## 6. Report back

Plain prose, no more than six lines:

- What you created, as file paths.
- The stack, in one line.
- Every assumption you made.
- The single most important question to answer before real work starts.

Then stop. Do not begin building. Setting up a project and building it are separate jobs,
and this command is only the first.
