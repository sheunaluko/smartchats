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
  async rewrites() {
    const rules = [];

    // AIO container path: when SMARTCHATS_INTERNAL_PROXY=1 is set at runtime
    // (the all-in-one image's entrypoint sets it), proxy /local-api/* to the
    // Express server running on container loopback. This lets the browser
    // talk to a single origin (port 3000) and the container expose only that
    // one port.
    const internalLocalUrl = process.env.SMARTCHATS_INTERNAL_LOCAL_URL ?? 'http://127.0.0.1:4242';
    if (process.env.SMARTCHATS_INTERNAL_PROXY) {
      rules.push({
        source: '/local-api/:path*',
        destination: `${internalLocalUrl}/:path*`,
      });
    }

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
