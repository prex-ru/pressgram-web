# Pressgram Web

A downstream fork of [Element Web](https://github.com/element-hq/element-web)
for [Pressgram](https://pressgram.ru), an independent Matrix-based messenger
for the Russian media community.

Upstream base: **v1.12.15**.

The fork layers Pressgram-specific customisations on top of unmodified
Element Web. Everything under `apps/web/` that differs from upstream is
summarised below; everything else is vanilla and tracks upstream.

## What this fork changes

| Area | Change |
|------|--------|
| Branding | App name, favicon, vector-icons, logos, welcome background, OpenGraph/Twitter metadata, `manifest.json`, noscript page — all recoloured to Pressgram Blue `#1071e0` |
| Theme | `apps/web/res/custom.css` — Leonardo-generated `pressgram-blue` palette remaps `--cpd-color-green-*` via our [compound-design-tokens fork](https://github.com/prex-ru/pressgram-compound-design-tokens); success-state tokens are restored to real green so encryption indicators keep their conventional meaning |
| Non-E2EE UX | Transport-only servers hide the "unencrypted" composer lock, the `mx_cryptoEvent` unsupported banner, and the "Не зашифровано" room-summary badge — the main Pressgram server disables E2EE at the homeserver level by design (`matrix_e2ee_filter`) |
| Deep-link invites | `/join/<server>[/<token>]` pretty URLs (`?server=&token=` query form supported too) — `apps/web/src/vector/app.tsx` overrides the default homeserver, writes a `pressgram_reg_token` cookie for MAS `registration_token.html` to pre-fill, and falls back to the default server on discovery failure |
| Unsupported browser | Custom Russian static page (`res/unsupported_browser.html`, `src/vector/static/incompatible-browser.html`, `static/unable-to-load.html`) + `pressgram-compat.js` localStorage seed + `init.tsx` delegation to `window.pressgramShowUnsupported` |
| Mobile guide | `src/vector/mobile_guide/index.html` is fully replaced with a Russian Pressgram-branded page that keeps the upstream ID contract so `mobileguide.js` continues to inject store URLs and deep-links |
| i18n | `welcome_to_element`, `voip.element_call`, `error.*`, `composer.placeholder*`, `timeline.m.room.encryption.*`, `labs.element_call_*`, and `room_list.empty.*` (shared-components) — Russian + English fallbacks |
| Config sample | `brand`/`branding`/`element_call.brand` set to Pressgram defaults, `default_country_code` set to RU |
| Dependencies | `pnpm.overrides` points `@vector-im/compound-design-tokens` at our fork (adds `pressgram-blue-*` palette without rebuilding upstream) |

## Building

```sh
pnpm install
pnpm -F element-web build
```

Output goes to `apps/web/webapp/`. Same as upstream Element Web —
deploy that directory under nginx with the standard SPA fallback:

```nginx
location / {
    try_files $uri /index.html;
}
```

The `/join/<server>[/<token>]` deep-link form requires the SPA fallback;
without it nginx returns 404 before the bundle can parse the path.

## Keeping in sync with upstream

```sh
git remote add upstream https://github.com/element-hq/element-web.git
git fetch upstream --tags
git rebase v1.12.16  # or the next tag
```

Pressgram-specific commits live on the `pressgram/main` branch and are
self-contained — the file-level surface is narrow enough that upstream
bumps should rebase cleanly unless upstream changes one of the touched
files (`app.tsx` `verifyServerConfig`, `init.tsx` `showIncompatibleBrowser`,
`webpack.config.ts` `CopyWebpackPlugin` patterns, `index.html`
template, or the i18n JSON buckets listed above).

## Related Pressgram forks

- [`prex-ru/pressgram-compound-design-tokens`](https://github.com/prex-ru/pressgram-compound-design-tokens) — compound-design-tokens fork with `pressgram-blue-*` palette
- [`prex-ru/pressgram-element-call`](https://github.com/prex-ru/pressgram-element-call) — element-call fork pulling the same compound override
- [`prex-ru/pressgram-mas`](https://github.com/prex-ru/pressgram-mas) — matrix-authentication-service fork (templates + translations)

## License

Inherits the upstream dual AGPL-3.0 / commercial licence — see
`LICENSE-AGPL-3.0` and `LICENSE-COMMERCIAL` in the project root.
