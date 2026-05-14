import { defineWorkflow } from 'simi';

export const agentInputFlow = defineWorkflow({
  id: 'agent_input_flow',
  app: 'smartchats',
  tags: ['e2e', 'agent', 'process', 'request_input'],
  steps: [
    // Wait for store + agent initialization
    { waitFor: 'state.agent !== null && state.aiModel !== "" && state.settingsLoaded === true', timeout: 15000 },

    // Use sendMessageSync — fire-and-forget so simi doesn't block on the LLM round-trip
    // (which gets cancelled/re-triggered by triggerParentRerun during the request_input flow)
    {
      action: 'sendMessageSync',
      args: ['Use fork_process to spawn a background agent (mode: "agent") named "input-requester" with the directive: "First wait 10 seconds using a setTimeout wrapped in a promise. Then call the request_input function to ask the parent agent for a city name. Once you receive the city name, respond with a fun fact about that city." Use immediate completion mode. IMPORTANT: When the child process requests input from you, respond immediately using send_process_input with the city name "Paris" — do NOT ask the user, just send it directly.'],
      wait: 2000,
    },

    // Wait for process to appear in store
    { waitFor: 'state.processes.length > 0', timeout: 30000 },

    // Assert process was spawned in agent mode
    { assert: 'state.processes[0].mode === "agent"', message: 'Process should be in agent mode' },

    // Wait for process to complete or fail
    // This covers: child LLM calling request_input -> parent re-invocation via triggerParentRerun -> parent calling send_process_input -> child unblocking -> child responding
    { waitFor: 'state.processes[0].status === "completed" || state.processes[0].status === "failed"', timeout: 120000 },

    // Assert process completed successfully
    { assert: 'state.processes[0].status === "completed"', message: 'Agent process should have completed successfully' },
    { assert: 'state.processes[0].exitCode === 0', message: 'Agent process should exit with code 0' },

    // Assert the child agent produced output (the fun fact)
    { assert: 'state.processes[0].stdoutLines > 0', message: 'Agent process should have produced stdout output' },
  ],
});
