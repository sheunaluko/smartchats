/**
 * Appearance module: set_design_pack, set_color_mode, set_preset, set_voice
 *
 * Gives the agent control over visual theme, dark/light mode, and its own
 * TTS voice / model bundle. Uses window.__smartchats_appearance__ bridge
 * exposed by app3.tsx.
 *
 * The voice/model API has two levels:
 * - `set_preset(preset_id)` — the coarse handle. Atomically swaps the
 *   whole (aiModel, ttsProvider, ttsVoice) triple. Prefer this when the
 *   user says something like "sound snappier" / "be more accurate".
 * - `set_voice(voice)` — the fine handle. Just changes the voice; the
 *   model + provider follow the voice's catalog entry. Prefer this when
 *   the user names a specific voice.
 */

import { listAllVoices, findVoice, AGENT_PRESETS } from 'cortex';

declare var window: any;

const DESIGN_PACK_IDS = [
    'default', 'midnight', 'neon_terminal', 'zen', 'brutalist',
    'aurora', 'crypto_gold', 'creative', 'oled_black', 'dev_tools',
];

const VIZ_MOTIF_IDS = ['classic', 'glass', 'minimal', 'retro'];

// Voice list is derived at module-load from cortex's VOICE_CATALOG, so
// adding an OpenAI/Azure voice in `packages/cortex/src/voices.ts`
// automatically exposes it to the agent's `set_voice` tool — no edit here.
const AVAILABLE_VOICES = listAllVoices();
const VOICE_IDS = AVAILABLE_VOICES.map((v) => v.id);
const VOICE_LINE = AVAILABLE_VOICES
    .map((v) => `${v.id} [${v.provider}] (${v.description})`)
    .join(', ');

const PRESET_IDS = AGENT_PRESETS.map((p) => p.id);
const PRESET_LINE = AGENT_PRESETS
    .map((p) => `${p.id} — ${p.description}`)
    .join(' | ');

const SYSTEM_MSG = `
## Appearance & Voice

You can change the app's visual theme, dark/light mode, and your own
speaking voice / underlying model bundle.

Available design packs: ${DESIGN_PACK_IDS.join(', ')}
Available viz motifs: ${VIZ_MOTIF_IDS.join(', ')} (classic = standard charts, glass = frosted bars with blur, minimal = stripped-down scientific, retro = pixel/dot-matrix)
Available presets (atomic model + voice bundles): ${PRESET_LINE}
Available voices (fine-grained, changes voice only): ${VOICE_LINE}
Color modes: dark, light

Design packs control colors and tokens. Viz motifs control chart appearance/structure. They are independent — change either without affecting the other.

For voice/model changes, prefer set_preset when the user's ask is about
overall behavior ("be snappier", "be more accurate", "spend less"); use
set_voice when the user names a specific voice.

Use these when the user asks to change the look, theme, vibe, aesthetic, voice, or sound of the app.
You can also proactively suggest a theme, voice, or preset change when it fits the conversation.
`;

export function createAppearanceModule() {
    return {
        id: 'appearance',
        name: 'Appearance & Voice',
        position: 55,
        system_msg: SYSTEM_MSG,
        functions: [
            {
                enabled: true,
                description: `Set the app's visual design theme.`,
                name: 'set_design_pack',
                parameters: { pack_id: 'string' },
                fn: async (ops: any) => {
                    const { log } = ops.util;
                    const { pack_id } = ops.params;

                    if (!pack_id || !DESIGN_PACK_IDS.includes(pack_id)) {
                        return { error: `Invalid pack_id. Must be one of: ${DESIGN_PACK_IDS.join(', ')}` };
                    }

                    log(`Setting design pack to: ${pack_id}`);
                    const bridge = window?.__smartchats_appearance__;
                    if (!bridge?.setDesignPack) {
                        return { error: 'Appearance bridge not available' };
                    }

                    bridge.setDesignPack(pack_id);
                    return { success: true, pack_id, message: `Theme changed to ${pack_id}` };
                },
                return_type: 'object',
            },
            {
                enabled: true,
                description: `Switch between dark and light color mode, or toggle.`,
                name: 'set_color_mode',
                parameters: { mode: 'string' },
                fn: async (ops: any) => {
                    const { log } = ops.util;
                    const { mode } = ops.params;

                    const bridge = window?.__smartchats_appearance__;
                    if (!bridge) {
                        return { error: 'Appearance bridge not available' };
                    }

                    if (mode === 'toggle') {
                        log('Toggling color mode');
                        bridge.toggleMode();
                        const newMode = bridge.getCurrentMode?.() || 'unknown';
                        return { success: true, mode: newMode, message: `Toggled to ${newMode} mode` };
                    }

                    if (mode !== 'dark' && mode !== 'light') {
                        return { error: 'Mode must be "dark", "light", or "toggle"' };
                    }

                    log(`Setting color mode to: ${mode}`);
                    bridge.setMode(mode);
                    return { success: true, mode, message: `Switched to ${mode} mode` };
                },
                return_type: 'object',
            },
            {
                enabled: true,
                description: `Atomically switch the (LLM model, TTS provider, TTS voice) bundle to a named preset from AGENT_PRESETS. Prefer this over set_voice when the user's ask is about overall behavior ("snappier", "more accurate", "cheaper").`,
                name: 'set_preset',
                parameters: { preset_id: 'string' },
                fn: async (ops: any) => {
                    const { log } = ops.util;
                    const { preset_id } = ops.params;

                    const preset = AGENT_PRESETS.find((p) => p.id === preset_id);
                    if (!preset) {
                        return { error: `Invalid preset_id. Must be one of: ${PRESET_IDS.join(', ')}` };
                    }

                    log(`Applying preset: ${preset.id} (model=${preset.aiModel}, voice=${preset.ttsVoice} [${preset.ttsProvider}])`);
                    const bridge = window?.__smartchats_appearance__;
                    if (!bridge?.applyPreset) {
                        return { error: 'Appearance bridge not available (applyPreset missing)' };
                    }

                    bridge.applyPreset(preset.id);
                    return {
                        success: true,
                        preset_id: preset.id,
                        ai_model: preset.aiModel,
                        tts_provider: preset.ttsProvider,
                        tts_voice: preset.ttsVoice,
                        message: `Preset changed to ${preset.name}: ${preset.description}`,
                    };
                },
                return_type: 'object',
            },
            {
                enabled: true,
                description: `Change the TTS voice used when speaking. Provider is inferred from the voice's catalog entry — Azure voice ids route to Azure automatically. Fine-grained; for overall behavior use set_preset.`,
                name: 'set_voice',
                parameters: { voice: 'string' },
                fn: async (ops: any) => {
                    const { log } = ops.util;
                    const { voice } = ops.params;

                    const voiceInfo = voice ? findVoice(voice) : null;
                    if (!voiceInfo) {
                        return { error: `Invalid voice. Must be one of: ${VOICE_IDS.join(', ')}` };
                    }

                    log(`Setting voice to: ${voice} [${voiceInfo.provider}]`);
                    const bridge = window?.__smartchats_appearance__;
                    if (!bridge?.updateTiviSettings) {
                        return { error: 'Appearance bridge not available' };
                    }

                    // Also update the routing provider so the cloud TTS layer
                    // dispatches to the right adapter. openaiVoice remains the
                    // legacy field name — the value is provider-agnostic.
                    bridge.updateTiviSettings({
                        openaiVoice: voice,
                        ttsCloudProvider: voiceInfo.provider,
                    });
                    return {
                        success: true,
                        voice,
                        provider: voiceInfo.provider,
                        description: voiceInfo.description,
                        message: `Voice changed to ${voice} (${voiceInfo.provider})`,
                    };
                },
                return_type: 'object',
            },
            {
                enabled: true,
                description: `Change the visualization motif for charts. Independent of design pack.`,
                name: 'set_viz_motif',
                parameters: { motif_id: 'string' },
                fn: async (ops: any) => {
                    const { log } = ops.util;
                    const { motif_id } = ops.params;

                    if (!motif_id || !VIZ_MOTIF_IDS.includes(motif_id)) {
                        return { error: `Invalid motif_id. Must be one of: ${VIZ_MOTIF_IDS.join(', ')}` };
                    }

                    log(`Setting viz motif to: ${motif_id}`);
                    const bridge = window?.__smartchats_appearance__;
                    if (!bridge?.setVizMotif) {
                        return { error: 'Appearance bridge not available' };
                    }

                    bridge.setVizMotif(motif_id);
                    return { success: true, motif_id, message: `Viz motif changed to ${motif_id}` };
                },
                return_type: 'object',
            },
        ],
    };
}
