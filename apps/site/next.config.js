// @ts-check
const nextra = require('nextra').default;
const withNextra = nextra({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static-export build: produces ./out/ instead of a Next.js runtime.
  // Consumed by apps/smartchats's prebuild step which copies out/ into
  // apps/smartchats/public/_site/ for embedded serving.
  output: 'export',
  // Resolve /docs/foo → /docs/foo/index.html on disk (matches Nextra's expectations).
  trailingSlash: true,
  // Static export can't optimize images at request time.
  images: { unoptimized: true },
  // CRITICAL for embedded mode: emit asset URLs prefixed with /_site so the
  // host (apps/smartchats) doesn't intercept /_next/* with its own bundle.
  // The static export lives at public/_site/, so its CSS/JS get served from
  // /_site/_next/static/...  basePath stays unset — internal docs links use
  // root-relative URLs (/docs/foo/) that the host's rewrites handle.
  assetPrefix: '/_site',
};

module.exports = withNextra(nextConfig);
