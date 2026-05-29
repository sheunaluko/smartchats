// @ts-check

import NodePolyfillPlugin from 'node-polyfill-webpack-plugin';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  // Static export: produces out/ — a static HTML/JS/CSS bundle servable by
  // any static file server. The app has no API routes, server actions,
  // middleware, or dynamic routes (all pages compile as ○ Static), so an
  // export is fully equivalent to the standalone server. Lets us drop the
  // Next.js runtime from the production install: smartchats-local-server
  // (Express) serves out/ via express.static and handles /local-api/*
  // natively as same-origin routes — one binary, one port, no Next.js
  // runtime to ship.
  output: 'export',
  async rewrites() {
    const rules = [];

    // Dev-only: when `next dev` is serving the UI on this port, forward
    // /local-api/* to the Express server (which now mounts the API under
    // /local-api too — see smartchats-local-server/src/app.ts). Prefix is
    // PRESERVED in the destination so the Express path matches both in dev
    // and in prod (where Express serves the SPA directly, no Next.js).
    // Override upstream via SMARTCHATS_LOCAL_HOST / SMARTCHATS_LOCAL_PORT.
    const localHost = process.env.SMARTCHATS_LOCAL_HOST ?? '127.0.0.1';
    const localPort = process.env.SMARTCHATS_LOCAL_PORT ?? '4242';
    rules.push({
      source: '/local-api/:path*',
      destination: `http://${localHost}:${localPort}/local-api/:path*`,
    });

    // Embedded apps/site (static export). prebuild:site copies
    // apps/site/out/ → public/_site/. Map user-facing URLs to those
    // static files so the landing + docs live on the same Vercel
    // deployment as the app (no zones / no second project).
    rules.push(
      { source: '/', destination: '/_site/index.html' },
      { source: '/docs', destination: '/_site/docs/index.html' },
      { source: '/docs/:slug', destination: '/_site/docs/:slug/index.html' },
      { source: '/docs/:slug/', destination: '/_site/docs/:slug/index.html' },
      { source: '/privacy-policy', destination: '/_site/privacy-policy/index.html' },
      { source: '/privacy-policy/', destination: '/_site/privacy-policy/index.html' },
      { source: '/terms-of-service', destination: '/_site/terms-of-service/index.html' },
      { source: '/terms-of-service/', destination: '/_site/terms-of-service/index.html' },
    );

    return rules;
  },
  webpack: (config, { isServer }) => {
    config.resolve.extensions.push(".ts", ".tsx");
    config.resolve.fallback = { fs: false };

    // Webpack aliases — only tivi remains; @shared-lib + @lab-components/graph_viz
    // moved to proper workspace packages (smartchats-common, simi, graph-viz).
    config.resolve.alias = {
      ...config.resolve.alias,
      '@lab-components/tivi': path.resolve(__dirname, '../../packages/tivi/src'),
      'sharp$': false,
      'onnxruntime-node$': false,
    };

    if (!isServer) {
      config.externals = {
        ...config.externals,
        'onnxruntime-web': 'ort',
        'onnxruntime-web/wasm': 'ort',
      };
    }

    config.plugins.push(new NodePolyfillPlugin());

    return config;
  },
}

export default nextConfig;
