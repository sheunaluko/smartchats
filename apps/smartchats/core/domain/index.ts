/**
 * Core domain re-exports.
 *
 * This module defines the extraction boundary for smartchats-core.
 * Everything exported here is portable (no DOM, no MUI, no browser APIs).
 *
 * The actual files still live in app/ — this module provides the clean
 * import surface. When we eventually extract to a separate package,
 * these become the real exports and the app/ copies are removed.
 */

// Domain types
export type {
  ExecutionSnapshot,
  FunctionCallEvent,
  VariableAssignment,
  SandboxLog,
} from '../../app/types/execution';

// Cortex modules (all portable — pure function/prompt definitions)
export { createCoreModule } from '../../app/modules/core';
export { createAuthModule } from '../../app/modules/auth';
export { createConversationalModule } from '../../app/modules/conversational';
export { createPersonalizationModule } from '../../app/modules/personalization';
export { createResponsivenessModule } from '../../app/modules/responsiveness';
export { createIntroModule, createPlatformModule, createResponseGuidanceModule } from '../../app/modules/system';
export { createDataModule } from '../../app/modules/data';
export { createDisplayModule } from '../../app/modules/display';
export { createKnowledgeGraphFunctionsModule } from '../../app/modules/knowledge_graph';
export { createDynamicFunctionMgmtModule } from '../../app/modules/dynamic_function_mgmt';
export { createProcessModule } from '../../app/modules/process';
export { createWebSearchModule } from '../../app/modules/web_search';
export { createCliAgentModule } from '../../app/modules/cli_agent';

// Graph utilities (portable domain logic)
export { search_knowledge_deep } from '../../app/graph_utils';
