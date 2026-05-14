'use client';

import React from 'react';
import {
  Box,
  Typography,
  Slider,
  Switch,
  Button,
  IconButton,
  Fade,
  Tooltip,
  Paper,
} from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import CloseIcon from '@mui/icons-material/Close';

export interface PhysicsSettings {
  gravity: number;
  scalingRatio: number;
  slowDown: number;
  barnesHutOptimize: boolean;
  barnesHutTheta: number;
  edgeWeightInfluence: number;
  linLogMode: boolean;
  strongGravityMode: boolean;
  outboundAttractionDistribution: boolean;
  adjustSizes: boolean;
  duration: number;
}

export const DEFAULT_PHYSICS: PhysicsSettings = {
  gravity: 1,
  scalingRatio: 2,
  slowDown: 100,
  barnesHutOptimize: true,
  barnesHutTheta: 0.5,
  edgeWeightInfluence: 0,
  linLogMode: false,
  strongGravityMode: false,
  outboundAttractionDistribution: false,
  adjustSizes: false,
  duration: 2000,
};

const PARAM_HINTS: Record<string, string> = {
  gravity: 'Pulls all nodes toward the center. Higher = tighter cluster. 0 = free floating.',
  scalingRatio: 'Repulsion force between nodes. Higher = more spread out. Lower = denser.',
  slowDown: 'Dampening factor. Higher = slower, smoother convergence. Prevents jitter.',
  barnesHutTheta: 'Barnes-Hut accuracy. Lower = more accurate but slower. 0.5 is standard.',
  edgeWeightInfluence: 'How much edge weights affect attraction. 0 = ignore weights. 1 = proportional.',
  duration: 'How long the simulation runs before auto-stopping.',
  barnesHutOptimize: 'Approximates repulsion for better performance on large graphs (100+ nodes).',
  strongGravityMode: 'Gravity that doesn\'t weaken with distance. Pulls outliers in hard.',
  linLogMode: 'Logarithmic attraction. Makes clusters tighter and gaps between them wider.',
  outboundAttractionDistribution: 'Distributes attraction along outbound edges. Useful for directed graphs.',
  adjustSizes: 'Prevents node overlap by factoring in node sizes during repulsion.',
};

interface PhysicsPanelProps {
  settings: PhysicsSettings;
  onChange: (settings: PhysicsSettings) => void;
  onRun: () => void;
  onStop: () => void;
  isRunning: boolean;
}

const tinySlider = {
  height: 4,
  '& .MuiSlider-thumb': { width: 10, height: 10 },
  '& .MuiSlider-rail': { height: 2 },
  '& .MuiSlider-track': { height: 2 },
};

const ParamRow: React.FC<{
  label: string;
  hint: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}> = ({ label, hint, value, display, min, max, step, onChange }) => (
  <Box sx={{ mb: 0.5 }}>
    <Tooltip title={hint} placement="right" arrow>
      <Typography sx={{ fontSize: '0.65rem', color: 'text.secondary', cursor: 'help', lineHeight: 1.2 }}>
        {label}: <b>{display}</b>
      </Typography>
    </Tooltip>
    <Slider
      value={value}
      onChange={(_, v) => onChange(v as number)}
      min={min}
      max={max}
      step={step}
      size="small"
      sx={tinySlider}
    />
  </Box>
);

const ToggleRow: React.FC<{
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, hint, checked, onChange }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.25 }}>
    <Tooltip title={hint} placement="right" arrow>
      <Typography sx={{ fontSize: '0.65rem', color: 'text.secondary', cursor: 'help' }}>
        {label}
      </Typography>
    </Tooltip>
    <Switch
      size="small"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      sx={{ '& .MuiSwitch-switchBase': { p: '3px' }, '& .MuiSwitch-thumb': { width: 12, height: 12 } }}
    />
  </Box>
);

export const PhysicsPanel: React.FC<PhysicsPanelProps> = ({
  settings,
  onChange,
  onRun,
  onStop,
  isRunning,
}) => {
  const [open, setOpen] = React.useState(false);

  const update = (key: keyof PhysicsSettings, value: any) => {
    onChange({ ...settings, [key]: value });
  };

  return (
    <>
      {/* Trigger button — positioned absolutely over the Sigma canvas */}
      <IconButton
        size="small"
        onClick={() => setOpen(!open)}
        color={open ? 'primary' : 'default'}
        sx={{
          position: 'absolute',
          top: 8,
          left: 8,
          zIndex: 20,
          backgroundColor: 'background.paper',
          boxShadow: 1,
          '&:hover': { backgroundColor: 'action.hover' },
        }}
      >
        <TuneIcon sx={{ fontSize: 18 }} />
      </IconButton>

      {/* Fade-in panel */}
      <Fade in={open} mountOnEnter unmountOnExit>
        <Paper
          elevation={6}
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: 200,
            zIndex: 15,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            borderRadius: '8px 0 0 8px',
          }}
        >
          {/* Header */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1, pt: 0.5 }}>
            <Typography sx={{ fontSize: '0.7rem', fontWeight: 'bold', letterSpacing: 0.5, textTransform: 'uppercase' }}>
              Physics
            </Typography>
            <IconButton size="small" onClick={() => setOpen(false)}>
              <CloseIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Box>

          {/* Scrollable controls */}
          <Box sx={{ flex: 1, overflowY: 'auto', px: 1.5, pb: 1, pt: 0.5 }}>
            <ParamRow
              label="Gravity" hint={PARAM_HINTS.gravity}
              value={settings.gravity} display={String(settings.gravity)}
              min={0} max={20} step={0.5}
              onChange={(v) => update('gravity', v)}
            />
            <ParamRow
              label="Scaling" hint={PARAM_HINTS.scalingRatio}
              value={settings.scalingRatio} display={String(settings.scalingRatio)}
              min={0.1} max={500} step={0.5}
              onChange={(v) => update('scalingRatio', v)}
            />
            <ParamRow
              label="Slow Down" hint={PARAM_HINTS.slowDown}
              value={settings.slowDown} display={String(settings.slowDown)}
              min={0} max={500} step={50}
              onChange={(v) => update('slowDown', v)}
            />
            <ParamRow
              label="BH Theta" hint={PARAM_HINTS.barnesHutTheta}
              value={settings.barnesHutTheta} display={String(settings.barnesHutTheta)}
              min={0} max={2} step={0.1}
              onChange={(v) => update('barnesHutTheta', v)}
            />
            <ParamRow
              label="Edge Weight" hint={PARAM_HINTS.edgeWeightInfluence}
              value={settings.edgeWeightInfluence} display={String(settings.edgeWeightInfluence)}
              min={0} max={2} step={0.1}
              onChange={(v) => update('edgeWeightInfluence', v)}
            />
            <ParamRow
              label="Duration" hint={PARAM_HINTS.duration}
              value={settings.duration} display={`${(settings.duration / 1000).toFixed(1)}s`}
              min={500} max={15000} step={500}
              onChange={(v) => update('duration', v)}
            />

            <Box sx={{ borderTop: '1px solid', borderColor: 'divider', mt: 0.5, pt: 0.5 }}>
              <ToggleRow label="Barnes-Hut" hint={PARAM_HINTS.barnesHutOptimize} checked={settings.barnesHutOptimize} onChange={(v) => update('barnesHutOptimize', v)} />
              <ToggleRow label="Strong Gravity" hint={PARAM_HINTS.strongGravityMode} checked={settings.strongGravityMode} onChange={(v) => update('strongGravityMode', v)} />
              <ToggleRow label="LinLog Mode" hint={PARAM_HINTS.linLogMode} checked={settings.linLogMode} onChange={(v) => update('linLogMode', v)} />
              <ToggleRow label="Outbound Dist." hint={PARAM_HINTS.outboundAttractionDistribution} checked={settings.outboundAttractionDistribution} onChange={(v) => update('outboundAttractionDistribution', v)} />
              <ToggleRow label="Adjust Sizes" hint={PARAM_HINTS.adjustSizes} checked={settings.adjustSizes} onChange={(v) => update('adjustSizes', v)} />
            </Box>
          </Box>

          {/* Run/Stop button pinned at bottom */}
          <Box sx={{ px: 1, pb: 1 }}>
            {isRunning ? (
              <Button fullWidth size="small" variant="outlined" color="warning" startIcon={<StopIcon sx={{ fontSize: 14 }} />} onClick={onStop} sx={{ fontSize: '0.7rem', py: 0.5 }}>
                Stop
              </Button>
            ) : (
              <Button fullWidth size="small" variant="contained" startIcon={<PlayArrowIcon sx={{ fontSize: 14 }} />} onClick={onRun} sx={{ fontSize: '0.7rem', py: 0.5 }}>
                Run Layout
              </Button>
            )}
          </Box>
        </Paper>
      </Fade>
    </>
  );
};
