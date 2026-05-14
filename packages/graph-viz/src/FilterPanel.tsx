'use client';

import React from 'react';
import { Box, Chip, Typography, Button } from '@mui/material';
import { getRelationColor } from './lib/constants';

interface FilterPanelProps {
  availableKinds: string[];
  visibleKinds: Set<string>;
  onToggle: (kind: string) => void;
  onShowAll: () => void;
  onShowNone: () => void;
}

export const FilterPanel: React.FC<FilterPanelProps> = ({
  availableKinds,
  visibleKinds,
  onToggle,
  onShowAll,
  onShowNone,
}) => {
  if (availableKinds.length === 0) return null;

  // When visibleKinds is empty, all are shown (no filter active)
  const noFilterActive = visibleKinds.size === 0;

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, px: 1, pb: 1, alignItems: 'center' }}>
      <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
        Relations:
      </Typography>

      {availableKinds.filter(k => typeof k === 'string').map((kind) => {
        const isVisible = noFilterActive || visibleKinds.has(kind);
        const color = getRelationColor(kind);
        return (
          <Chip
            key={kind}
            label={kind.replace(/_/g, ' ')}
            size="small"
            variant={isVisible ? 'filled' : 'outlined'}
            onClick={() => onToggle(kind)}
            sx={{
              cursor: 'pointer',
              backgroundColor: isVisible ? color : 'transparent',
              color: isVisible ? '#fff' : 'text.secondary',
              borderColor: color,
              '&:hover': {
                backgroundColor: isVisible ? color : `${color}22`,
              },
            }}
          />
        );
      })}

      <Button size="small" onClick={onShowAll} sx={{ minWidth: 'auto', fontSize: '0.7rem', px: 1 }}>
        All
      </Button>
      <Button size="small" onClick={onShowNone} sx={{ minWidth: 'auto', fontSize: '0.7rem', px: 1 }}>
        None
      </Button>
    </Box>
  );
};
