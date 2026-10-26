// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://inkwall.dev',
  integrations: [sitemap()],
  markdown: {
    // Light and dark code colours; global.css picks one with the page's
    // colour scheme.
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
    },
  },
  // Fully static: Cloudflare Pages serves dist/ as is.
  output: 'static',
  trailingSlash: 'ignore',
});
