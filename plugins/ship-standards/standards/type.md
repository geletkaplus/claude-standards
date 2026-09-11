# Choosing type

A reference, not a rule. The rule is in `ship-standards.md`: if you use one of the default
faces, say why it fits. This is where to look when the answer is "it doesn't."

## Name the adjective before you name the face

A bakery, a law firm, and a developer tool should not land on the same typeface. They only
do when the face gets picked before the brief. Decide the word first, austere or warm or
mechanical or editorial or brash, then go looking. If you cannot name the word, you are not
ready to pick the face.

## The setting matters more than the face

A well-set Public Sans beats a badly-set Cabinet Grotesk every time. Most of what reads as
generic is not the typeface, it is the defaults it was left at:

- Only 400 and 700, nothing between, and no optical sizing on faces that offer it.
- Uppercase labels with no added letter-spacing.
- 16px / 1.5 body on every project, whatever the face or the measure.
- Headings wrapping raggedly, because nothing sets `text-wrap: balance`.
- Display and body drawn from the same superfamily, which reads as safe rather than paired.

Set a type scale per project and choose weights deliberately. That single habit removes
more of the generic feeling than any change of typeface.

## Shortlist by voice

All of these are on Google Fonts. None of them are on the default list, which is the point.

| Voice | Faces |
|---|---|
| Industrial, editorial grotesque | Archivo, Chivo, Familjen Grotesk, Bricolage Grotesque |
| Quiet workhorse | Public Sans, Hanken Grotesk, Schibsted Grotesk, Instrument Sans |
| Warm, humanist | Karla, Epilogue, Source Sans 3 |
| Editorial serif, for reading | Newsreader, Literata, Spectral, Source Serif 4, Petrona |
| Display serif | Instrument Serif, Fraunces, Young Serif, Bodoni Moda |
| Character, use with restraint | Syne, Unbounded, Anybody, Darker Grotesque |
| Mono | JetBrains Mono, IBM Plex Mono, Martian Mono |

## Beyond Google Fonts

You are not limited to Google Fonts. Self-hosting is already house policy on Next.js
(`next/font`, never a CDN link), so the only real constraint is the licence.

- **Fontshare** (Indian Type Foundry): Satoshi, Switzer, General Sans, Cabinet Grotesk,
  Clash Display. Free for commercial use.
- **Uncut.wtf**: a curated free foundry, deliberately contemporary.
- **Velvetyne** and **Collletttivo**: libre foundries, more experimental. Good when the
  brief wants something with a point of view.

Read the licence for each face before it ships, and record it in the repo. "Free" covers a
lot of different terms.

## The default list

These are the faces the check flags. They are not bad typefaces. They are the ones that get
chosen when nobody chose:

Inter, Poppins, Montserrat, Playfair Display, Space Grotesk, DM Sans, DM Serif Display,
Plus Jakarta Sans, Manrope, Outfit, Sora, Raleway, Lato, Nunito, Nunito Sans, Work Sans,
Open Sans, Roboto.

Three pairings are an even stronger tell than any single face: Playfair Display over Lato,
Space Grotesk over Inter, and Poppins doing every job on its own.

Sometimes one of these is genuinely right. Inter is an excellent interface face for dense,
data-heavy screens. Roboto is correct when you are matching Android. That is exactly the
kind of reason the rule asks for, and it takes one line:

```css
/* ship-standards:ignore type Inter for the dashboard; it is built for dense UI at small sizes */
font-family: 'Inter', system-ui, sans-serif;
```
