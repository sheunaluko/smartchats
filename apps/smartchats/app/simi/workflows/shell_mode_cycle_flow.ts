import { defineWorkflow } from 'simi';

export const shellModeCycleFlow = defineWorkflow({
  id: 'shell_mode_cycle_flow',
  app: 'smartchats',
  tags: ['smoke', 'shell', 'visual'],
  steps: [
    { action: 'setShellMode', args: ['full'], wait: 3000 },
    { assert: 'state.shellMode === "full"', message: 'Should be full' },

    { action: 'setShellMode', args: ['half'], wait: 3000 },
    { assert: 'state.shellMode === "half"', message: 'Should be half' },

    { action: 'setShellMode', args: ['icon'], wait: 3000 },
    { assert: 'state.shellMode === "icon"', message: 'Should be icon' },

    { action: 'setShellMode', args: ['guided'], wait: 3000 },
    { assert: 'state.shellMode === "guided"', message: 'Should be guided' },

    { action: 'setShellMode', args: ['full'], wait: 500 },
    { assert: 'state.shellMode === "full"', message: 'Should be back to full' },
  ],
});
