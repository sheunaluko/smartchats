'use client';

import React from 'react';
import type { ShellProps } from '../../core/types/shell';
import { MobileVoiceShell } from './MobileVoiceShell';

export function MobileVoiceQuietShell(props: ShellProps) {
  return <MobileVoiceShell {...props} />;
}
