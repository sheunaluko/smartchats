'use client';

/**
 * ThemeContext — delegates to DesignPackProvider + DesignPackBridge.
 *
 * Preserves the existing API (ThemeContextProvider default export,
 * useColorMode hook) so no downstream imports break. Under the hood,
 * everything is driven by DesignPack tokens injected as CSS variables.
 */

import React from 'react';
import { DesignPackProvider } from '../core/DesignPackContext';
import { DesignPackBridge, useColorMode } from '../core/DesignPackBridge';
import { VizMotifProvider } from '../core/VizMotifContext';

export { useColorMode };

export default function ThemeContextProvider({ children }: { children: React.ReactNode }) {
  return (
    <DesignPackProvider>
      <DesignPackBridge>
        <VizMotifProvider>
          {children}
        </VizMotifProvider>
      </DesignPackBridge>
    </DesignPackProvider>
  );
}
