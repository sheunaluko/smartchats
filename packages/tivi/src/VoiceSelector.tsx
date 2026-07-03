/**
 * Voice Selector Widget
 * Allows browsing, testing, and selecting TTS voices
 * Supports both browser (WebSpeech) and OpenAI TTS providers
 */

'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box,
  TextField,
  Button,
  Typography,
  Stack,
  Chip,
  CircularProgress,
  ToggleButtonGroup,
  ToggleButton,
  Select,
  MenuItem,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import * as tts from './lib/tts';
import { getTiviSettings, updateTiviSettings } from './lib/settings';
import type { TiviSettings } from './lib/settings';
import { VOICE_CATALOG, listVoicesForProvider, findVoice, type VoiceInfo, type TTSProvider } from 'cortex';

// Memoized voice item component for performance
const VoiceItem = React.memo<{
  voice: SpeechSynthesisVoice;
  isSelected: boolean;
  isTesting: boolean;
  isAnyTesting: boolean;
  onTest: (voice: SpeechSynthesisVoice) => void;
  onSelect: (voice: SpeechSynthesisVoice) => void;
  showBorder: boolean;
}>(({ voice, isSelected, isTesting, isAnyTesting, onTest, onSelect, showBorder }) => {
  const theme = useTheme();

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        p: 2,
        gap: 1,
        borderBottom: showBorder ? `1px solid ${alpha(theme.palette.divider, 0.1)}` : 'none',
        background: isSelected ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
        '&:hover': {
          background: isSelected
            ? alpha(theme.palette.primary.main, 0.12)
            : alpha(theme.palette.action.hover, 0.04),
        },
        transition: 'background 0.2s',
      }}
    >
      {/* Voice Info */}
      <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography
            variant="body2"
            fontWeight={isSelected ? 600 : 400}
            sx={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {voice.name}
          </Typography>
          {isSelected && (
            <Chip label="Default" size="small" color="primary" sx={{ height: 20, fontSize: '0.7rem' }} />
          )}
        </Stack>
        <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
          <Chip
            label={voice.lang}
            size="small"
            variant="outlined"
            sx={{ height: 18, fontSize: '0.65rem' }}
          />
          <Chip
            label={voice.localService ? 'Local' : 'Remote'}
            size="small"
            variant="outlined"
            sx={{ height: 18, fontSize: '0.65rem' }}
          />
        </Stack>
      </Box>

      {/* Action Buttons — wraps to new row on narrow containers */}
      <Stack direction="row" spacing={1} sx={{ flex: '0 0 auto' }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={isTesting ? <CircularProgress size={14} /> : <VolumeUpIcon fontSize="small" />}
          onClick={() => onTest(voice)}
          disabled={isTesting || isAnyTesting}
          sx={{ minWidth: 80 }}
        >
          {isTesting ? 'Testing' : 'Test'}
        </Button>

        <Button
          size="small"
          variant={isSelected ? 'contained' : 'outlined'}
          color="primary"
          startIcon={isSelected ? <CheckCircleIcon fontSize="small" /> : undefined}
          onClick={() => onSelect(voice)}
          disabled={isSelected}
          sx={{ minWidth: 90 }}
        >
          {isSelected ? 'Selected' : 'Select'}
        </Button>
      </Stack>
    </Box>
  );
});

VoiceItem.displayName = 'VoiceItem';

/** Format a catalog voice as "DisplayName — description" for the selector list. */
function formatVoiceLabel(v: VoiceInfo): string {
  return `${v.displayName} — ${v.description}`;
}

/** Provider ids we surface a sub-tab for. Keep aligned with cortex's TTSProvider. */
const CLOUD_PROVIDERS: TTSProvider[] = Object.keys(VOICE_CATALOG) as TTSProvider[];

interface VoiceSelectorProps {
  /** Force a specific TTS provider and hide the toggle. Omit to show the toggle. */
  provider?: 'browser' | 'openai';
  /** Force a specific TTS backend and hide the toggle. */
  backend?: 'local' | 'firebase';
  /** Force a specific TTS model and hide the dropdown. */
  model?: string;
}

export function VoiceSelector({ provider: forcedProvider, backend: forcedBackend, model: forcedModel }: VoiceSelectorProps = {}) {
  const theme = useTheme();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchFilter, setSearchFilter] = useState('English');

  // TTS provider state. Includes 'cloud' for routing through the backend's
  // active cloud TTS provider (Azure / OpenAI / etc.), selected by the
  // active aiPreset. Legacy 'openai' is treated like 'cloud' by the runtime.
  const [ttsProvider, setTtsProvider] = useState<'browser' | 'openai' | 'cloud'>(() => {
    const initial = forcedProvider || getTiviSettings().ttsProvider;
    return (initial === 'cloud' || initial === 'openai' || initial === 'browser') ? initial : 'cloud';
  });
  const [ttsBackend, setTtsBackend] = useState<'local' | 'firebase'>(() => forcedBackend || getTiviSettings().ttsBackend);
  // openaiVoice is the legacy tivi field name — the value is provider-agnostic
  // (an id from VOICE_CATALOG). Renamed conceptually here to `voiceId`.
  const [voiceId, setVoiceId] = useState<string>(() => getTiviSettings().openaiVoice);
  const [openaiModel, setOpenaiModel] = useState<string>(() => forcedModel || getTiviSettings().openaiModel);

  // Which cloud TTS provider's catalog to show. Sourced from tivi's
  // `ttsCloudProvider` (the field written by store.applyPreset). Falls
  // back to whichever provider currently owns the selected voiceId, or
  // the first provider in the catalog.
  const [cloudProvider, setCloudProvider] = useState<TTSProvider>(() => {
    const explicit = getTiviSettings().ttsCloudProvider as TTSProvider | undefined;
    if (explicit && VOICE_CATALOG[explicit]) return explicit;
    return findVoice(voiceId)?.provider ?? CLOUD_PROVIDERS[0]!;
  });
  const cloudProviderVoices = useMemo(() => listVoicesForProvider(cloudProvider), [cloudProvider]);

  // Write forced values to settings on mount so TTS queue picks them up
  useEffect(() => {
    const updates: Partial<TiviSettings> = {};
    if (forcedBackend) updates.ttsBackend = forcedBackend;
    if (forcedModel) updates.openaiModel = forcedModel;
    if (forcedProvider) updates.ttsProvider = forcedProvider;
    if (Object.keys(updates).length > 0) updateTiviSettings(updates);
  }, [forcedBackend, forcedModel, forcedProvider]);

  // Load voices on mount
  useEffect(() => {
    async function loadVoices() {
      await tts.waitForVoices();
      const availableVoices = tts.getVoices();
      setVoices(availableVoices);

      // Get saved voice from tivi settings
      const savedVoiceURI = getTiviSettings().defaultVoiceURI;
      if (savedVoiceURI) {
        setSelectedVoiceURI(savedVoiceURI);
      }

      setIsLoading(false);
    }

    loadVoices();
  }, []);

  // Filter voices based on search
  const filteredVoices = useMemo(() => {
    if (!searchFilter.trim()) return voices;
    const filter = searchFilter.toLowerCase();
    return voices.filter(
      (voice) =>
        voice.name.toLowerCase().includes(filter) ||
        voice.lang.toLowerCase().includes(filter)
    );
  }, [voices, searchFilter]);

  const handleProviderChange = useCallback((_: any, value: 'browser' | 'cloud' | null) => {
    if (!value) return;
    setTtsProvider(value);
    updateTiviSettings({ ttsProvider: value });
  }, []);

  const handleBackendChange = useCallback((_: any, value: 'local' | 'firebase' | null) => {
    if (!value) return;
    setTtsBackend(value);
    updateTiviSettings({ ttsBackend: value });
  }, []);

  const handleCloudVoiceChange = useCallback((newVoiceId: string) => {
    const info = findVoice(newVoiceId);
    setVoiceId(newVoiceId);
    // Persist voice + provider together so the cloud TTS route stays
    // consistent (server picks the adapter off ttsCloudProvider).
    const updates: Partial<TiviSettings> = { openaiVoice: newVoiceId };
    if (info && info.provider !== cloudProvider) {
      setCloudProvider(info.provider);
      updates.ttsCloudProvider = info.provider;
    } else if (info) {
      updates.ttsCloudProvider = info.provider;
    }
    updateTiviSettings(updates);
  }, [cloudProvider]);

  const handleCloudProviderChange = useCallback((_: any, value: TTSProvider | null) => {
    if (!value || !VOICE_CATALOG[value]) return;
    setCloudProvider(value);
    // When user swaps provider, snap voice to the provider's first entry
    // rather than leaving a stale cross-provider id in settings.
    const first = listVoicesForProvider(value)[0];
    const updates: Partial<TiviSettings> = { ttsCloudProvider: value };
    if (first) {
      setVoiceId(first.id);
      updates.openaiVoice = first.id;
    }
    updateTiviSettings(updates);
  }, []);

  const handleOpenaiModelChange = useCallback((model: string) => {
    setOpenaiModel(model);
    updateTiviSettings({ openaiModel: model });
  }, []);

  const handleTestVoice = useCallback(async (voice: SpeechSynthesisVoice) => {
    setIsTesting(voice.voiceURI);
    try {
      await tts.speak({
        text: 'Hello, this is a test of this voice.',
        voiceURI: voice.voiceURI,
        rate: 1.0,
      });
    } catch (err) {
      console.error('Error testing voice:', err);
    } finally {
      setIsTesting(null);
    }
  }, []);

  const handleSelectVoice = useCallback((voice: SpeechSynthesisVoice) => {
    setSelectedVoiceURI(voice.voiceURI);
    updateTiviSettings({ defaultVoiceURI: voice.voiceURI });
  }, []);

  return (
    <Box sx={{ background: 'transparent' }}>
      <Stack spacing={2}>
        {/* TTS Provider Toggle — hidden when provider is forced */}
        {!forcedProvider && (
          <Box>
            <Typography variant="body2" gutterBottom sx={{ fontWeight: 500 }}>
              TTS Provider
            </Typography>
            <ToggleButtonGroup
              value={ttsProvider === 'openai' ? 'cloud' : ttsProvider}
              exclusive
              onChange={handleProviderChange}
              size="small"
              fullWidth
            >
              <ToggleButton value="browser">Browser (WebSpeech)</ToggleButton>
              <ToggleButton value="cloud">Cloud (Azure / OpenAI)</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        )}

        {(ttsProvider === 'openai' || ttsProvider === 'cloud') ? (
          /* ── Cloud TTS Settings (Azure / OpenAI) ── */
          <>
            {/* TTS Backend Toggle — hidden when backend is forced */}
            {!forcedBackend && (
            <Box>
              <Typography variant="body2" gutterBottom sx={{ fontWeight: 500 }}>
                TTS Backend
              </Typography>
              <ToggleButtonGroup
                value={ttsBackend}
                exclusive
                onChange={handleBackendChange}
                size="small"
                fullWidth
              >
                <ToggleButton value="local">Local (API Key)</ToggleButton>
                <ToggleButton value="firebase">Firebase</ToggleButton>
              </ToggleButtonGroup>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                {ttsBackend === 'local'
                  ? 'Uses your OpenAI API key from localStorage (OAAK)'
                  : 'Uses Firebase Cloud Function (requires auth)'}
              </Typography>
            </Box>
            )}

            {/* Cloud provider sub-toggle — driven by cortex's VOICE_CATALOG,
                so adding an Azure/OpenAI/... adapter surfaces here for free. */}
            {CLOUD_PROVIDERS.length > 1 && (
              <Box>
                <Typography variant="body2" gutterBottom sx={{ fontWeight: 500 }}>
                  Cloud Provider
                </Typography>
                <ToggleButtonGroup
                  value={cloudProvider}
                  exclusive
                  onChange={handleCloudProviderChange}
                  size="small"
                  fullWidth
                >
                  {CLOUD_PROVIDERS.map((p) => (
                    <ToggleButton key={p} value={p} sx={{ textTransform: 'capitalize' }}>
                      {p}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </Box>
            )}

            {/* Voice Selection */}
            <Box>
              <Typography variant="body2" gutterBottom sx={{ fontWeight: 500 }}>
                Voice
              </Typography>
              <Stack spacing={1}>
                {cloudProviderVoices.map((v) => (
                  <Box
                    key={v.id}
                    onClick={() => handleCloudVoiceChange(v.id)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      p: 1.5,
                      borderRadius: 1,
                      cursor: 'pointer',
                      border: `1px solid ${v.id === voiceId
                        ? theme.palette.primary.main
                        : alpha(theme.palette.divider, 0.2)}`,
                      background: v.id === voiceId
                        ? alpha(theme.palette.primary.main, 0.08)
                        : 'transparent',
                      '&:hover': {
                        background: v.id === voiceId
                          ? alpha(theme.palette.primary.main, 0.12)
                          : alpha(theme.palette.action.hover, 0.04),
                      },
                      transition: 'all 0.2s',
                    }}
                  >
                    <Typography variant="body2">
                      {formatVoiceLabel(v)}
                    </Typography>
                    {v.id === voiceId && (
                      <CheckCircleIcon fontSize="small" color="primary" />
                    )}
                  </Box>
                ))}
              </Stack>
            </Box>

            {/* Model Selection — OpenAI only (Azure model is fixed by the
                adapter). Hidden when a model is forced. */}
            {cloudProvider === 'openai' && !forcedModel && (
            <Box>
              <Typography variant="body2" gutterBottom sx={{ fontWeight: 500 }}>
                Model
              </Typography>
              <Select
                value={openaiModel}
                onChange={(e) => handleOpenaiModelChange(e.target.value)}
                size="small"
                fullWidth
              >
                <MenuItem value="gpt-4o-mini-tts">gpt-4o-mini-tts (expressive)</MenuItem>
                <MenuItem value="tts-1">tts-1 (faster, lower cost)</MenuItem>
                <MenuItem value="tts-1-hd">tts-1-hd (higher quality)</MenuItem>
              </Select>
            </Box>
            )}

            {/* Footer */}
            <Box sx={{ pt: 1, borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
              <Typography variant="caption" color="text.secondary">
                Voice: <strong>{voiceId}</strong>
                {cloudProvider === 'openai' && <> • Model: <strong>{openaiModel}</strong></>}
                {' '}• Provider: <strong style={{ textTransform: 'capitalize' }}>{cloudProvider}</strong>
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                Backend: <strong>{ttsBackend === 'local' ? 'Local (OAAK)' : 'Firebase'}</strong>
              </Typography>
            </Box>
          </>
        ) : (
          /* ── Browser TTS Voices ── */
          <>
            {isLoading ? (
              <Box sx={{ p: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                <CircularProgress size={20} />
                <Typography variant="body2" color="text.secondary">
                  Loading voices...
                </Typography>
              </Box>
            ) : (
              <>
                {/* Search Filter */}
                <TextField
                  fullWidth
                  size="small"
                  label="Filter voices"
                  placeholder="Search by name or language..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  sx={{
                    mb: 1,
                    '& .MuiOutlinedInput-root': {
                      background: alpha(theme.palette.background.paper, 0.5),
                    },
                  }}
                />

                {/* Voice List */}
                {filteredVoices.length === 0 ? (
                  <Box sx={{ p: 2, textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
                      No voices found matching &quot;{searchFilter}&quot;
                    </Typography>
                  </Box>
                ) : (
                  <Box
                    sx={{
                      maxHeight: 400,
                      overflowY: 'auto',
                      border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
                      borderRadius: 1,
                      background: alpha(theme.palette.background.paper, 0.3),
                    }}
                  >
                    <Stack spacing={0}>
                      {filteredVoices.map((voice, index) => (
                        <VoiceItem
                          key={voice.voiceURI}
                          voice={voice}
                          isSelected={voice.voiceURI === selectedVoiceURI}
                          isTesting={isTesting === voice.voiceURI}
                          isAnyTesting={isTesting !== null}
                          onTest={handleTestVoice}
                          onSelect={handleSelectVoice}
                          showBorder={index < filteredVoices.length - 1}
                        />
                      ))}
                    </Stack>
                  </Box>
                )}

                {/* Footer Info */}
                <Box sx={{ pt: 1, borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
                  <Typography variant="caption" color="text.secondary">
                    Showing {filteredVoices.length} of {voices.length} voice
                    {voices.length !== 1 ? 's' : ''}
                    {selectedVoiceURI && (
                      <>
                        {' '}
                        • Default:{' '}
                        <strong>{voices.find((v) => v.voiceURI === selectedVoiceURI)?.name}</strong>
                      </>
                    )}
                  </Typography>
                </Box>
              </>
            )}
          </>
        )}
      </Stack>
    </Box>
  );
}
