import { defineWorkflow } from 'simi';

export const modelSwitchFlow = defineWorkflow({
  id: 'model_switch_flow',
  app: 'smartchats',
  tags: ['smoke', 'settings'],
  // Bypass the onboarding explainer so the test targets the LLM pipeline,
  // not SmartChats' first-turn product flow.
  setupWorkflows: ['complete_onboarding'],
  steps: [
    // Wait for initialization
    { waitFor: 'state.agent !== null && state.aiModel !== ""', timeout: 10000 },

    // ── Round 1: OpenAI (gpt-5.2) — cheapest, run first to conserve credits ──
    { action: 'updateSettings', args: [{ aiModel: 'gpt-5.2' }], wait: 500 },
    { action: 'saveSettings', args: [], timeout: 10000, wait: 500 },
    { waitFor: 'state.agent !== null && !state.llmRunning && state.settingsLoaded', timeout: 15000 },
    { action: 'sendMessageAsync', args: ['Reply with exactly: gpt ok'], timeout: 60000, wait: 500 },
    { assert: 'state.chatHistory.some(m => m.role === "assistant")', message: 'GPT should have an assistant message' },
    { assert: 'state.lastAiMessage.toLowerCase().includes("gpt")', message: 'GPT response should contain "gpt"' },

    // ── Round 2: Google (gemini-3.1-pro-preview) ──
    { action: 'updateSettings', args: [{ aiModel: 'gemini-3.1-pro-preview' }], wait: 500 },
    { action: 'saveSettings', args: [], timeout: 10000, wait: 500 },
    { waitFor: 'state.agent !== null && !state.llmRunning && state.settingsLoaded', timeout: 15000 },
    { action: 'sendMessageAsync', args: ['Reply with exactly: gemini ok'], timeout: 60000, wait: 500 },
    { assert: 'state.chatHistory.some(m => m.role === "assistant")', message: 'Gemini should have an assistant message' },
    { assert: 'state.lastAiMessage.toLowerCase().includes("gemini")', message: 'Gemini response should contain "gemini"' },

    // ── Round 3: Anthropic (claude-opus-4-5) — most expensive, run last ──
    { action: 'updateSettings', args: [{ aiModel: 'claude-opus-4-5' }], wait: 500 },
    { action: 'saveSettings', args: [], timeout: 10000, wait: 500 },
    { waitFor: 'state.agent !== null && !state.llmRunning && state.settingsLoaded', timeout: 15000 },
    { action: 'sendMessageAsync', args: ['Reply with exactly: opus ok'], timeout: 60000, wait: 500 },
    { assert: 'state.chatHistory.some(m => m.role === "assistant")', message: 'Opus should have an assistant message' },
    { assert: 'state.lastAiMessage.toLowerCase().includes("opus")', message: 'Opus response should contain "opus"' },
  ],
});
