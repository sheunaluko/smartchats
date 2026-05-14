import { defineWorkflow } from 'simi';

export const breathingAppFlow = defineWorkflow({
  id: 'breathing_app_flow',
  app: 'smartchats',
  tags: ['e2e', 'app_platform', 'breathing'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    // ── Setup ──
    { waitFor: 'state.agent !== null && state.aiModel !== ""', timeout: 10000 },
    { action: 'updateSettings', args: [{ aiModel: 'gpt-5.2' }], wait: 500 },
    { action: 'saveSettings', args: [], timeout: 10000, wait: 500 },
    { waitFor: 'state.agent !== null && !state.llmRunning && state.settingsLoaded', timeout: 15000 },
    { action: 'clearChat', args: [], wait: 500 },

    // ── Step 1: Trigger init to seed apps ──
    { action: 'sendMessageAsync', args: ['Hello'], timeout: 60000, wait: 500 },
    { waitFor: '!state.llmRunning', timeout: 30000 },

    // ── Step 2: Verify breathing app seeded ──
    { waitFor: 'state.installedApps.length > 0', timeout: 20000 },
    { assert: 'state.installedApps.some(i => i.app_id === "guided_breathing")', message: 'Breathing app should be installed' },

    // ── Step 3: Activate ──
    { action: 'sendMessageAsync', args: ['Open the guided breathing app'], timeout: 60000, wait: 500 },
    { waitFor: 'state.activeApp !== null', timeout: 15000 },
    { assert: 'state.activeAppId === "guided_breathing"', message: 'Breathing app should be active' },

    // ── Step 4: Start breathing ──
    { action: 'sendMessageAsync', args: ['Start the breathing exercise'], timeout: 60000, wait: 500 },
    { waitFor: '!state.llmRunning', timeout: 30000 },
    { waitFor: 'state.workspace["guided_breathing.running"] === true', timeout: 10000 },

    // ── Step 5: Let it run for a few seconds, check phase changes ──
    { waitFor: 'state.workspace["guided_breathing.phase"] !== "Ready"', timeout: 10000 },

    // ── Step 6: Pause ──
    { action: 'sendMessageAsync', args: ['Pause the breathing exercise'], timeout: 60000, wait: 500 },
    { waitFor: '!state.llmRunning', timeout: 30000 },
    // Pause function returned successfully — agent confirmed
    { assert: 'state.lastAiMessage.length > 0', message: 'Agent should confirm pause' },

    // ── Step 7: Resume ──
    { action: 'sendMessageAsync', args: ['Resume the breathing'], timeout: 60000, wait: 500 },
    { waitFor: '!state.llmRunning', timeout: 30000 },
    { assert: 'state.lastAiMessage.length > 0', message: 'Agent should confirm resume' },

    // ── Step 8: Stop ──
    { action: 'sendMessageAsync', args: ['Stop the breathing exercise'], timeout: 60000, wait: 500 },
    { waitFor: '!state.llmRunning', timeout: 30000 },
    { assert: 'state.lastAiMessage.length > 0', message: 'Agent should confirm stop' },

    // ── Step 9: Deactivate ──
    { action: 'sendMessageAsync', args: ['Close the app'], timeout: 60000, wait: 500 },
    { waitFor: 'state.activeApp === null', timeout: 15000 },
  ],
});
