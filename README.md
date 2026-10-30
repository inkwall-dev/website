# website.inkwall.dev

The website of [Inkwall](https://github.com/inkwall-dev/inkwall): landing page, docs and blog. A
static [Astro](https://astro.build/) site on Cloudflare Pages. Node 22 (`.nvmrc`).

```sh
npm ci
npm run dev      # http://localhost:4321
npm run build    # type check, then build into dist/
```

## Content

| Path | What |
|---|---|
| `src/pages/index.astro` | Landing page, with the "Where things stand" table |
| `src/content/docs/` | Docs (Markdown; `order` sets the sidebar position) |
| `src/content/blog/` | Blog posts (Markdown; `draft: true` hides one) |
| `public/diagrams/` | Copies of the main repository's `docs/diagrams/*.svg` |

Say only what the current release does, and check commands and flags against the main repository.
When the diagrams change there: `cp ../inkwall/docs/diagrams/*.svg public/diagrams/`.

## Checks and deploys

`.github/workflows/site.yaml` builds every pull request and push to `main`: `npm ci`, `npm audit` of
what ships, `npm run build` (type check, then build), and an offline check of every internal link
and `#anchor` (lychee). Dependabot proposes npm and action updates weekly.

Cloudflare Pages is connected to this repository and deploys it: a preview for each pull request,
production (`website.inkwall.dev`) for `main`.

| Cloudflare setting | Value |
|---|---|
| Production branch | `main` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION` = `22` |

`public/_headers` sets the security headers.

## License

Apache License 2.0, like Inkwall.
