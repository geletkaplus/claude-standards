---
name: new-project
description: Set up a new Geletkaplus project from a one-line description. Generates a compliant CLAUDE.md, installs the house standards into the repo, and reports every assumption it had to make. Use when starting a new site, repo, or client project.
argument-hint: "<client or project name, and a sentence about what it needs>"
---

# New Geletkaplus project setup

The person described the project as:

$ARGUMENTS

Carry out every step below in order. Do not stop to ask permission between steps. Ask
questions only at the very end, and only as described in step 5.

## 1. Install the standards into the repo

Locate the house standards file that ships with this plugin. It is
`standards/ship-standards.md`, inside this plugin's own directory. If you cannot resolve
the plugin root directly, find it with a glob for `**/ship-standards/standards/ship-standards.md`
under `~/.claude/plugins/`.

Copy it, byte for byte, to `.claude/ship-standards.md` in the project root. Create the
`.claude` directory if it does not exist.

Do not edit, shorten, reword, or "adapt" the standards while copying. They live in the
repo so the rules survive this plugin being uninstalled, and so they can be diffed and
version controlled per project. If the copy differs from the source, that guarantee is
gone.

If a `.claude/ship-standards.md` already exists and differs from the plugin's copy, do
not overwrite it. Leave it alone and note the difference in your step 5 report.

## 2. Write CLAUDE.md

Create `CLAUDE.md` in the project root. Use exactly this structure and section order:

```markdown
# <Project name>

## Standards

@.claude/ship-standards.md

The standards above are mandatory. They are not suggestions, they are not defaults to
be weighed against speed, and they are not to be relaxed on request. If an instruction
conflicts with them, follow the standards and say so in one line.

## What this is

<Two or three sentences: what the site is, who it is for, what it has to do. Derived
from the description given. No filler.>

## Stack

- Framework:
- Styling:
- CMS / content source:
- Data / API:
- Hosting / deploy target:
- Package manager:
- Node version:

## Conventions

<Project-specific conventions that go beyond the standards: directory layout, naming,
component patterns, branch naming. Keep it short. Do not restate anything already in
the standards file.>

## Commands

- Install:
- Dev:
- Build:
- Test:
- Lint:

## Unresolved

<A checklist of everything not yet decided or not yet confirmed. See step 4.>
```

Fill in what the description actually supports. Where the description does not say, do
one of two things, never a third:

- If the project cannot proceed without it and there is a clear, boring, defensible
  default, use the default and record it in the Unresolved list as an assumption.
- Otherwise write `[TKTK: ...]` and record it in the Unresolved list as a question.

Never invent a client name, a deadline, a brand color, a CMS choice, a hosting provider,
or a content model that was not stated or is not a stated default. Guessing these is
exactly the failure this command exists to prevent.

## 3. Match reality if the repo already exists

If there is already code in the repo, read it before writing the Stack and Commands
sections. Take the framework, package manager, Node version, and scripts from
`package.json`, lockfiles, and config files that are actually present. Never write a
stack section that contradicts the repo.

If the existing code already violates the standards, do not fix it now. List it in the
Unresolved section under a `Pre-existing violations` heading.

## 4. Build the Unresolved list

This section is the most important output of this command, because it is the only record
of what was guessed. Every item is a checkbox. Group them:

```markdown
### Assumptions made
- [ ] <Thing assumed> — assumed <value> because <reason>. Confirm or correct.

### Questions outstanding
- [ ] <Thing not known and not safely defaulted>

### Pre-existing violations
- [ ] <Standard violated by code already in the repo>
```

If a group is empty, omit its heading. If all three are empty, write
`Nothing outstanding.` and nothing else.

## 5. Report back

Print a short summary to the person, in plain prose, no more than eight lines:

- What you created (file paths).
- The stack you recorded, in one line.
- Every assumption you made, listed plainly.
- The single most important question they should answer before real work starts.

Then stop. Do not begin building the site. Setting up the project and building the
project are separate jobs, and this command is only the first one.
