# inkwall.dev

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

## Pipeline

`.github/workflows/site.yaml`, on every pull request and push to `main`:

1. **Build**: `npm ci`, `npm audit` of what ships, `npm run build`, and an offline check of every
   internal link and `#anchor` (lychee).
2. **Deploy** to Cloudflare Pages: a pull request gets a preview URL (posted on it), `main` goes to
   production. Pull requests from forks are built, not deployed.

Dependabot proposes npm and action updates weekly. `public/_headers` sets the security headers.

### Cloudflare setup (once)

1. Create the Pages project for direct upload (not connected to Git, or every commit deploys twice):
   `npx wrangler@4.149.0 pages project create inkwall-website --production-branch main`
2. Create an API token with **Account → Cloudflare Pages → Edit**, for your account only.
3. Add the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. After the first deploy from `main`: Workers & Pages → `inkwall-website` → Custom domains → add
   `inkwall.dev`.

## License

Apache License 2.0, like Inkwall.
