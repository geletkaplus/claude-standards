# Astro

- Zero JavaScript is the default. Add a client directive only where an interaction needs
  it, and pick the narrowest one: `client:visible` over `client:load` unless it must be
  interactive before paint.
- Content Collections with a schema for anything repeated and structured. A folder of
  loose markdown with no schema is not a content model.
- `astro:assets` and `<Image />` for imagery, so it is optimised and correctly sized.
- Prefer a plain `.astro` component over pulling in a framework island. An island exists
  to carry interactivity, not to reuse a component you already know how to write.
- Server-render or prerender by default. Reach for SSR per route, not globally.
- Keep integrations minimal. Each one is a dependency and needs the same justification.
