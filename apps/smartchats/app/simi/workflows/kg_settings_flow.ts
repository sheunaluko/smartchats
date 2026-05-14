import { defineWorkflow } from 'simi';

export const kgSettingsFlow = defineWorkflow({
  id: 'kg_settings_flow',
  app: 'smartchats',
  tags: ['smoke', 'kg', 'settings'],
  steps: [
    // Wait for initialization
    { waitFor: 'state.aiModel !== ""', timeout: 10000 },

    // Toggle kgAutoDisplay off
    { action: 'updateKgSettings', args: [{ kgAutoDisplay: false }], wait: 300 },
    { assert: 'state.kgAutoDisplay === false', message: 'kgAutoDisplay should be false' },

    // Change kgMode to accumulate
    { action: 'updateKgSettings', args: [{ kgMode: "accumulate" }], wait: 300 },
    { assert: 'state.kgMode === "accumulate"', message: 'kgMode should be accumulate' },

    // Set graph data directly
    { action: 'setKgGraphData', args: [{ nodes: [{ id: "a", label: "Node A" }], edges: [] }], wait: 300 },
    { assert: 'state.kgGraphData.nodes.length === 1', message: 'Should have 1 node after set' },

    // Merge more data
    { action: 'mergeKgGraphData', args: [{ nodes: [{ id: "b", label: "Node B" }], edges: [{ source: "a", target: "b", label: "connects" }] }], wait: 300 },
    { assert: 'state.kgGraphData.nodes.length === 2', message: 'Should have 2 nodes after merge' },
    { assert: 'state.kgGraphData.edges.length === 1', message: 'Should have 1 edge after merge' },

    // Reset to defaults
    { action: 'updateKgSettings', args: [{ kgAutoDisplay: true, kgMode: "accumulate" }], wait: 300 },
    { action: 'clearKgGraph', args: [], wait: 300 },
    { assert: 'state.kgAutoDisplay === true', message: 'kgAutoDisplay should be restored' },
    { assert: 'state.kgGraphData.nodes.length === 0', message: 'Graph should be cleared' },
  ],
});
