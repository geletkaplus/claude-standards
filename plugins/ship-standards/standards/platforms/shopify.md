# Shopify

- Online Store 2.0: sections, blocks, and JSON templates. No hardcoded content in a
  Liquid template that a merchant should be editing in the theme editor.
- Every section gets a schema with real, labelled settings. Settings named `text_1`
  are not a content model.
- Use the theme's existing CSS custom properties and section settings for type and
  colour. Do not introduce a parallel styling system in a section.
- Translate with locale files. No user-facing string literal in a template.
- Respect the cart and checkout APIs. Never scrape or reconstruct cart state.
- Never edit a theme in the Shopify admin code editor. Work in git, deploy with the CLI.
- App blocks over app embeds where the merchant should control placement.
