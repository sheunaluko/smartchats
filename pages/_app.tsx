// _app.tsx for the Pages Router (which Nextra v3 uses for /docs/*).
// The App Router landing page at / isn't affected by this file — Next.js
// uses each router's wrapper independently for its own routes.

import 'nextra-theme-docs/style.css';
import type { AppProps } from 'next/app';

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
