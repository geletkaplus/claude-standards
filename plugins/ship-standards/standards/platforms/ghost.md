# Ghost

- Handlebars only. No build step that Ghost cannot serve, and no client framework bolted
  onto a theme.
- `{{#get}}` for anything beyond the current context. Do not fetch the Content API from
  the browser to render page content.
- Koenig card output is Ghost's markup, not yours. Style it, do not fight it, and do not
  restructure it in JavaScript after render.
- Respect the theme's `package.json` config block: custom settings there, not hardcoded
  values in templates.
- Run `gscan` before shipping. A theme that fails gscan does not ship.
- Content lives in Ghost. If an editor should change it, it is a post, a page, a tag, or
  a custom setting, never a template literal.
