import { defineWorkflow } from 'simi';

export const agentDelegationFlow = defineWorkflow({
  id: 'agent_delegation_flow',
  app: 'smartchats',
  tags: ['e2e', 'delegation', 'agent', 'process'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    // Reset to GPT for speed/consistency (model_switch_flow may leave Opus active)
    { waitFor: 'state.agent !== null && state.aiModel !== "" && state.settingsLoaded === true', timeout: 15000 },
    { action: 'updateSettings', args: [{ aiModel: 'gpt-5.2' }], wait: 500 },
    { action: 'saveSettings', args: [], timeout: 10000, wait: 500 },
    { waitFor: 'state.agent !== null && !state.llmRunning && state.settingsLoaded', timeout: 15000 },
    { action: 'clearChat', args: [], wait: 500 },

    // Ask the agent to fork a background agent process
    {
      action: 'sendMessageAsync',
      args: ['Use fork_process to spawn a background agent (mode: "agent") named "day-finder" with the directive: "Figure out what day of the week January 1st 2030 falls on. Run the code to calculate it, then respond with the answer." Use standard completion mode.'],
      timeout: 60000,
      wait: 1000,
    },

    // Wait for process to appear in store
    { waitFor: 'state.processes.length > 0', timeout: 15000 },

    // Assert process was spawned in agent mode
    { assert: 'state.processes[0].mode === "agent"', message: 'Process should be in agent mode' },
    { assert: 'state.processes[0].status === "running" || state.processes[0].status === "completed" || state.processes[0].status === "failed" || state.processes[0].status === "killed"', message: 'Process should have a valid status' },

    // Wait for the child agent to finish (agent mode takes a few LLM loops)
    { waitFor: 'state.processes[0].status === "completed" || state.processes[0].status === "failed"', timeout: 120000 },

    // Assert process completed successfully
    { assert: 'state.processes[0].status === "completed"', message: 'Agent process should have completed successfully' },
    { assert: 'state.processes[0].exitCode === 0', message: 'Agent process should exit with code 0' },

    // Assert the child agent produced output
    { assert: 'state.processes[0].stdoutLines > 0', message: 'Agent process should have produced stdout output' },
  ],
});
