'use client';

import React, { useState, useCallback } from 'react';
import {
  Box,
  TextField,
  IconButton,
  Slider,
  Typography,
  Chip,
  CircularProgress,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import type { GraphMode } from './lib/types';

interface SearchBarProps {
  onSearch: (query: string) => void;
  onClear: () => void;
  isSearching: boolean;
  mode: GraphMode;
  onModeChange: (mode: GraphMode) => void;
  depth: number;
  onDepthChange: (depth: number) => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  onSearch,
  onClear,
  isSearching,
  mode,
  onModeChange,
  depth,
  onDepthChange,
}) => {
  const [query, setQuery] = useState('');

  const handleSearch = useCallback(() => {
    if (query.trim()) {
      onSearch(query.trim());
    }
  }, [query, onSearch]);

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  }, [handleSearch]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, p: 1 }}>
      {/* Search input row */}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Search knowledge graph..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyPress={handleKeyPress}
          disabled={isSearching}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
        />
        <IconButton
          onClick={handleSearch}
          disabled={!query.trim() || isSearching}
          color="primary"
          size="small"
        >
          {isSearching ? <CircularProgress size={20} /> : <SearchIcon />}
        </IconButton>
        <IconButton onClick={onClear} size="small" color="default">
          <ClearIcon />
        </IconButton>
      </Box>

      {/* Controls row */}
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', px: 0.5 }}>
        {/* Mode toggle */}
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Chip
            label="Replace"
            size="small"
            variant={mode === 'replace' ? 'filled' : 'outlined'}
            color={mode === 'replace' ? 'primary' : 'default'}
            onClick={() => onModeChange('replace')}
            sx={{ cursor: 'pointer' }}
          />
          <Chip
            label="Accumulate"
            size="small"
            variant={mode === 'accumulate' ? 'filled' : 'outlined'}
            color={mode === 'accumulate' ? 'primary' : 'default'}
            onClick={() => onModeChange('accumulate')}
            sx={{ cursor: 'pointer' }}
          />
        </Box>

        {/* Depth slider */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 140 }}>
          <Typography variant="caption" color="text.secondary" noWrap>
            Depth: {depth}
          </Typography>
          <Slider
            value={depth}
            onChange={(_, v) => onDepthChange(v as number)}
            min={1}
            max={5}
            step={1}
            size="small"
            sx={{ width: 80 }}
          />
        </Box>
      </Box>
    </Box>
  );
};
