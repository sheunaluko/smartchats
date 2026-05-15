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
};

module.exports = withNextra(nextConfig);
