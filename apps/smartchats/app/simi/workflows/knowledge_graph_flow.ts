import { defineWorkflow } from 'simi';

export const knowledgeGraphFlow = defineWorkflow({
  id: 'knowledge_graph_flow',
  app: 'smartchats',
  tags: ['e2e', 'kg'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    // Reset to GPT for speed/consistency (model_switch_flow may leave Opus active)
    { waitFor: 'state.agent !== null && state.aiModel !== ""', timeout: 10000 },
    { action: 'updateSettings', args: [{ aiModel: 'gpt-5.2' }], wait: 500 },
    { action: 'saveSettings', args: [], timeout: 10000, wait: 500 },
    { waitFor: 'state.agent !== null && !state.llmRunning && state.settingsLoaded', timeout: 15000 },
    { action: 'clearChat', args: [], wait: 500 },

    // Ask the AI to store knowledge triples
    { action: 'sendMessageAsync', args: ['Use store_declarative_knowledge to store facts about the solar system. Include triples like ["sun", "is_a", "star"], ["earth", "orbits", "sun"], ["mars", "orbits", "sun"], ["venus", "orbits", "sun"]. Store at least 4 triples.'], timeout: 60000, wait: 1000 },

    // Wait for KG data to be populated
    { waitFor: 'state.kgGraphData.nodes.length > 0', timeout: 30000 },

    // Assert graph has nodes and edges
    { assert: 'state.kgGraphData.nodes.length >= 2', message: 'Knowledge graph should have at least 2 nodes' },
    { assert: 'state.kgGraphData.edges.length >= 1', message: 'Knowledge graph should have at least 1 edge' },

    // Clear graph
    { action: 'clearKgGraph', args: [], wait: 300 },

    // Assert cleared
    { assert: 'state.kgGraphData.nodes.length === 0', message: 'KG nodes should be empty after clear' },
    { assert: 'state.kgGraphData.edges.length === 0', message: 'KG edges should be empty after clear' },
  ],
});
