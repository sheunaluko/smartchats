// Nextra v3 theme config — only governs /docs/* (the marketing landing
// page at / is App Router and stays untouched). Pages Router setup means
// these settings live in a single file rather than spread across layouts.

import type { DocsThemeConfig } from 'nextra-theme-docs';

const config: DocsThemeConfig = {
  logo: <span style={{ fontWeight: 600, letterSpacing: '-0.01em' }}>SmartChats Docs</span>,
  project: { link: 'https://github.com/sheunaluko/smartchats' },
  docsRepositoryBase: 'https://github.com/sheunaluko/smartchats/tree/master/apps/smartchats-docs',
  footer: {
    content: (
      <span style={{ display: 'flex', width: '100%', justifyContent: 'space-between', opacity: 0.6 }}>
        <a href="https://smartchats.ai" style={{ color: 'inherit' }}>← back to smartchats.ai</a>
        <span>MIT licensed · {new Date().getFullYear()}</span>
      </span>
    ),
  },
  // The Pages-Router landing page lives at /, not /docs. Nextra's default
  // assumption is the docs ARE the site root — disable that by pointing
  // the homepage link explicitly.
  navbar: {
    extraContent: null,
  },
  sidebar: { defaultMenuCollapseLevel: 1 },
  toc: { float: true },
  feedback: { content: null },
  editLink: { content: 'Edit this page on GitHub →' },
  head: (
    <>
      <meta name="theme-color" content="#000000" />
    </>
  ),
};

export default config;
