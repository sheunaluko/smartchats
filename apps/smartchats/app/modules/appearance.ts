/**
 * Appearance module: set_design_pack, set_color_mode, set_voice
 *
 * Gives the agent control over visual theme, dark/light mode, and TTS voice.
 * Uses window.__smartchats_appearance__ bridge exposed by app3.tsx.
 */

declare var window: any;

const DESIGN_PACK_IDS = [
    'default', 'midnight', 'neon_terminal', 'zen', 'brutalist',
    'aurora', 'crypto_gold', 'creative', 'oled_black', 'dev_tools',
];

const VIZ_MOTIF_IDS = ['classic', 'glass', 'minimal', 'retro'];

const OPENAI_VOICES: Record<string, string> = {
    alloy: 'Neutral, balanced',
    ash: 'Calm, measured',
    ballad: 'Smooth, melodic',
    coral: 'Warm, engaging',
    echo: 'Warm, conversational',
    fable: 'Expressive, storytelling',
    nova: 'Friendly, natural',
    onyx: 'Deep, authoritative',
    sage: 'Wise, steady',
    shimmer: 'Clear, bright',
    verse: 'Poetic, expressive',
    marin: 'Bright, cheerful',
    cedar: 'Grounded, natural',
};

const SYSTEM_MSG = `
## Appearance & Voice

You can change the app's visual theme, dark/light mode, and your own speaking voice.

Available design packs: ${DESIGN_PACK_IDS.join(', ')}
Available viz motifs: ${VIZ_MOTIF_IDS.join(', ')} (classic = standard charts, glass = frosted bars with blur, minimal = stripped-down scientific, retro = pixel/dot-matrix)
Available voices: ${Object.entries(OPENAI_VOICES).map(([k, v]) => `${k} (${v})`).join(', ')}
Color modes: dark, light

Design packs control colors and tokens. Viz motifs control chart appearance/structure. They are independent — change either without affecting the other.

Use these when the user asks to change the look, theme, vibe, aesthetic, voice, or sound of the app.
You can also proactively suggest a theme or voice change when it fits the conversation.
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
                description: `Change the TTS voice used when speaking to the user.`,
                name: 'set_voice',
                parameters: { voice: 'string' },
                fn: async (ops: any) => {
                    const { log } = ops.util;
                    const { voice } = ops.params;

                    if (!voice || !OPENAI_VOICES[voice]) {
                        return { error: `Invalid voice. Must be one of: ${Object.keys(OPENAI_VOICES).join(', ')}` };
                    }

                    log(`Setting voice to: ${voice}`);
                    const bridge = window?.__smartchats_appearance__;
                    if (!bridge?.updateTiviSettings) {
                        return { error: 'Appearance bridge not available' };
                    }

                    bridge.updateTiviSettings({ openaiVoice: voice });
                    return { success: true, voice, description: OPENAI_VOICES[voice], message: `Voice changed to ${voice}` };
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
