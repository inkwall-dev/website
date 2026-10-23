// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://inkwall.dev',
  integrations: [sitemap()],
  // Fully static: Cloudflare Pages serves dist/ as is.
  output: 'static',
  trailingSlash: 'ignore',
});
