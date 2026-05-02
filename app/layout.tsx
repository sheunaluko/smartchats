import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SmartChats — The future of agentic voice experiences. Now.',
  description:
    'SmartChats is an open source voice-native AI platform. Speak to write code, query a personal knowledge graph, search the web, and orchestrate frontier models — from a single conversation.',
  metadataBase: new URL('https://smartchats.ai'),
  openGraph: {
    title: 'SmartChats — The future of agentic voice experiences. Now.',
    description:
      'An open source voice-native AI platform. Voice in. Code, charts, knowledge — out.',
    url: 'https://smartchats.ai',
    siteName: 'SmartChats',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SmartChats — The future of agentic voice experiences. Now.',
    description:
      'An open source voice-native AI platform. Voice in. Code, charts, knowledge — out.',
  },
  icons: {
    icon: '/favicon.svg',
  },
};

export const viewport: Viewport = {
  themeColor: '#000000',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
