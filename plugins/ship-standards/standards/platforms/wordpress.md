# WordPress

- Escape on output, every time: `esc_html`, `esc_attr`, `esc_url`, `wp_kses_post`.
  Unescaped output is a must-level violation, not a style preference.
- Sanitise and verify on input: nonces on every form and AJAX handler, capability checks
  on every privileged action.
- `$wpdb->prepare` for every query with a variable in it. No string interpolation into SQL.
- `wp_enqueue_script` and `wp_enqueue_style` with real dependencies and versions. Never a
  hardcoded `<script>` or `<link>` in a template.
- Anything an editor should be able to change belongs in the CMS: a field, a block, a
  customiser setting, or an options page. Hardcoded editable copy is a violation here
  even more than elsewhere.
- Child theme or custom plugin. Never edit a parent theme or anything in `wp-content/plugins`
  you did not write.
- Prefix every global function, class, and option with the project's namespace.
- Keep template logic thin. Query and transform above, markup below.
