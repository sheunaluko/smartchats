import { defineWorkflow } from 'simi';

export const agentWaitFlow = defineWorkflow({
  id: 'agent_wait_flow',
  app: 'smartchats',
  tags: ['e2e', 'agent', 'process', 'wait'],
  steps: [
    // Wait for store + agent initialization
    { waitFor: 'state.agent !== null && state.aiModel !== "" && state.settingsLoaded === true', timeout: 15000 },

    // Ask the agent to fork a background agent that waits 12 seconds then asks for instructions
    {
      action: 'sendMessageAsync',
      args: ['Use fork_process to spawn a background agent (mode: "agent") named "wait-agent" with the directive: "Wait 12 seconds using a setTimeout wrapped in a promise, then after waiting respond asking the user for further instructions." Use standard completion mode.'],
      timeout: 45000,
      wait: 1000,
    },

    // Wait for process to appear in store
    { waitFor: 'state.processes.length > 0', timeout: 15000 },

    // Assert process was spawned in agent mode
    { assert: 'state.processes[0].mode === "agent"', message: 'Process should be in agent mode' },

    // Wait for the child agent to finish (needs 12s wait + LLM loops)
    { waitFor: 'state.processes[0].status === "completed" || state.processes[0].status === "failed"', timeout: 45000 },

    // Assert process completed successfully
    { assert: 'state.processes[0].status === "completed"', message: 'Agent process should have completed successfully' },
    { assert: 'state.processes[0].exitCode === 0', message: 'Agent process should exit with code 0' },

    // Assert the child agent produced output
    { assert: 'state.processes[0].stdoutLines > 0', message: 'Agent process should have produced stdout output' },
  ],
});
