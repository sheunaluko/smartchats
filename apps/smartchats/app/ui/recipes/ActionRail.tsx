'use client';

import React from 'react';
import { Keyboard } from 'lucide-react';
import { Button } from '../Button';

type ActionRailProps = {
  onKeyboard: () => void;
};

export function ActionRail({ onKeyboard }: ActionRailProps) {
  return (
    <div className="safe-area-bottom sticky bottom-0 flex items-center justify-start px-4 py-4">
      <Button variant="ghost" size="lg" onClick={onKeyboard} aria-label="Open keyboard" className="rounded-full">
        <Keyboard size={18} />
      </Button>
    </div>
  );
}
