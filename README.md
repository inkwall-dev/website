# inkwall.dev

The website of [Inkwall](https://github.com/inkwall-dev/inkwall): landing page, docs and blog.
Built with [Astro](https://astro.build/) as a fully static site, served by Cloudflare Pages.

```sh
npm ci
npm run dev      # http://localhost:4321
npm run build    # type check, then build into dist/
```

Node 22 (`.nvmrc`).

## Content

| Path | What |
|---|---|
| `src/pages/index.astro` | Landing page, including the "Where things stand" table |
| `src/content/docs/` | Docs pages (Markdown; `order` sets the sidebar position) |
| `src/content/blog/` | Blog posts (Markdown; `draft: true` hides one) |
| `public/diagrams/` | Diagrams, copied from the main repository |

Keep the site honest about status: say what works today, and mark the rest as in progress or
planned. Commands and flags shown on the site should be checked against the main repository.

The diagrams are copies of `docs/diagrams/*.svg` in the main repository. When those change, copy
them again:

```sh
cp ../inkwall/docs/diagrams/*.svg public/diagrams/
```

## Deploying

Cloudflare Pages, connected to this repository:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION` = `22` |
| Custom domain | `inkwall.dev` |

Pull requests get preview deployments. `public/_headers` sets the security headers: the site loads
nothing from other origins and runs no scripts.

## License

Apache License 2.0, like Inkwall.
