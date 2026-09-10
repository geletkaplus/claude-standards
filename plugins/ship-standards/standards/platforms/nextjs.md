# Next.js

- Server Components by default. Add `'use client'` only where an interaction, a browser
  API, or a stateful hook genuinely requires it, and push it as far down the tree as it
  will go.
- `next/image` for raster images, with explicit `width` and `height` or `fill` plus a
  sized container. No raw `<img>` for content imagery.
- `next/font` for webfonts. Never a `<link>` to a font CDN.
- Fetch on the server. A `useEffect` that fetches on mount is a bug unless the data
  genuinely cannot exist until after paint.
- Set an explicit caching intent on every fetch and route handler. Taking the default
  because you did not decide is not the same as choosing it.
- `NEXT_PUBLIC_` prefixes only on values that are genuinely safe in a browser bundle.
  Check each one before you add the prefix.
- `metadata` or `generateMetadata` on every route. No page ships without a title and
  description.
- Never disable the ESLint or TypeScript build steps in `next.config`.
