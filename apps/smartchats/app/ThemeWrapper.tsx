'use client';

import React from 'react';

export default function ThemeWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen min-w-screen text-sc-text flex flex-col">
      {children}
    </div>
  );
}
