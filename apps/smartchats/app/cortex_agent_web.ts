'use client' ;

import {
    Cortex,
    SystemContextManager,
    StreamingRunnerV3,
    createStreamingCodeGenModule,
    createCodeGenModule,
    createDynamicFunctionsModule,
    createKnowledgeGraphModule,
    createCodeOutputModule,
    get_function_dictionary,
} from 'cortex'
import { getExecutor } from "./src/sandbox"
import { IframeSandboxExecutor } from "./src/IframeSandbox"

import { sounds } from 'smartchats-common';
import { createBackendLlmCaller, nonStreamingBackendLlmCall } from '@/lib/llm_caller';
import { getTiviSettings } from '@lab-components/tivi/lib/settings';
import { useSmartChatsStore } from './store/useSmartChatsStore';

// Module imports
import { createIntroModule, createValuesModule, createPlatformModule, createResponseGuidanceModule } from "./modules/system"
import { createResponsivenessModule } from "./modules/responsiveness"
import { createConversationalModule } from "./modules/conversational"
import { createPersonalizationModule } from "./modules/personalization"
import { createAuthModule } from "./modules/auth"
import { createCoreModule } from "./modules/core"
import { createInitializationModule } from "./modules/initialization"
import { createDataModule } from "./modules/data"
import { createDynamicFunctionMgmtModule } from "./modules/dynamic_function_mgmt"
import { createProcessModule } from "./modules/process"
import { createKnowledgeGraphFunctionsModule } from "./modules/knowledge_graph"
import { createWebSearchModule } from "./modules/web_search"
import { createScriptureModule } from "./modules/scripture"
import { createDisplayModule } from "./modules/display"
import { createVisualizationModule } from "./modules/visualization"
import { createCliAgentModule } from "./modules/cli_agent"
import { createLoggingModule } from "./modules/logging"
import { createProceduralInstructionsModule } from "./modules/procedural_instructions"
import { createMetricsModule } from "./modules/metrics"
import { createTimingModule } from "./modules/timing"
import { createTodosModule } from "./modules/todos"
import { createAppearanceModule } from "./modules/appearance"
import { createVoiceMemosModule } from "./modules/voice_memos"
import { createScopingModule } from "./modules/scoping"
import { createSessionsModule } from "./modules/sessions"
import { createAppLauncherModule } from "./modules/app_launcher"
import { createOnboardingModule } from "./modules/onboarding"
import { createIssuesModule } from "./modules/issues"

import * as graph_utils from "./graph_utils"
import { test_graph_utils, clear_graph_utils_test } from "./test_graph_utils"
import { embed_vector } from '@/lib/backend';

// Attach graph_utils to window for debugging
if (typeof window !== 'undefined') {
    (window as any).graph_utils = {
        ...graph_utils,
        test_graph_utils,
        clear_graph_utils_test,
        search_knowledge_deep: graph_utils.search_knowledge_deep,
        get_entity_relations: graph_utils.get_entity_relations,
    };
}

declare var window : any ;

/**
 * Defines the SmartChats cortex agent
 */

/**
 * Creates a Cortex agent with standard functions
 */
export function get_agent(modelName: string = "gpt-5-mini", insightsClient?: any, authInfo?: { isAuthenticated: boolean }, useStreaming: boolean = true) {
    let model = modelName;
    let name  = "coer" ;

    // Build SCM with modules
    const scm = new SystemContextManager()

    // System context modules
    scm.add_module(createIntroModule())
    scm.add_module(createValuesModule())
    scm.add_module(createPlatformModule())
    scm.add_module(createScopingModule())
    scm.add_module(createPersonalizationModule())
    scm.add_module(createAuthModule(authInfo))
    scm.add_module(createResponsivenessModule())
    scm.add_module(createConversationalModule())
    scm.add_module(createResponseGuidanceModule())

    // Code gen / output modules (from ts_common factories)
    scm.add_module(useStreaming ? createStreamingCodeGenModule() : createCodeGenModule())
    scm.add_module(createDynamicFunctionsModule())
    scm.add_module(createKnowledgeGraphModule())
    scm.add_module(createCodeOutputModule())   // will be swapped by streaming runner

    // Function modules
    scm.add_module(createCoreModule())
    scm.add_module(createInitializationModule())
    scm.add_module(createDataModule())
    scm.add_module(createLoggingModule())
    scm.add_module(createProceduralInstructionsModule())
    scm.add_module(createDynamicFunctionMgmtModule())
    scm.add_module(createProcessModule())
    scm.add_module(createKnowledgeGraphFunctionsModule())
    scm.add_module(createWebSearchModule())
    scm.add_module(createScriptureModule())
    scm.add_module(createDisplayModule())
    scm.add_module(createVisualizationModule())
    scm.add_module(createMetricsModule())
    scm.add_module(createTodosModule())
    scm.add_module(createVoiceMemosModule())
    scm.add_module(createCliAgentModule())
    scm.add_module(createTimingModule())
    scm.add_module(createAppearanceModule())
    scm.add_module(createSessionsModule())
    scm.add_module(createOnboardingModule())
    scm.add_module(createIssuesModule())

    // App platform — uses late-bound rebuild ref since Cortex doesn't exist yet
    const appLauncherRebuildRef = { current: () => {} }
    scm.add_module(createAppLauncherModule(scm, () => appLauncherRebuildRef.current()))

    // Get web sandbox and utilities
    const sandbox = getExecutor();
    const utilities = {
        get_embedding: embed_vector,
        sounds: {
            error: sounds.error,
            activated: sounds.input_ready,
            ok: sounds.proceed,
            success: sounds.success
        }
    };

    // Pass a non-streaming llmCallFn to Cortex. Parent turns use the streaming
    // runner (configured below via setRunner); this hook is exercised by
    // (a) child agent processes spawned via ProcessManager, which run
    // SynchronousRunnerV2 and require ctx.llmCallFn, and (b) structured-
    // completion paths inside cortex.ts that call this.llmCallFn directly.
    let ops = { model, name, scm, insights: insightsClient, sandbox, utilities, llmCallFn: nonStreamingBackendLlmCall }
    let coer = new Cortex( ops ) ;

    // Bind app launcher rebuild callback now that Cortex exists
    appLauncherRebuildRef.current = () => {
        const built = scm.build()
        coer.functions = built.functions
        coer.function_dictionary = get_function_dictionary(built.functions)
    }

    // Initialize ProcessManager with iframe sandbox factory
    coer.initProcessManager(() => new IframeSandboxExecutor())

    // Streaming runner — the caller uses a module-level ttsQueue ref that app3
    // registers once tivi mounts, so voice mode flips on automatically.
    if (useStreaming) {
        const llmCallFn = createBackendLlmCaller({
            getVoice: () => getTiviSettings().openaiVoice,
            shouldPlayAudio: () => useSmartChatsStore.getState().started,
        });
        const runner = new StreamingRunnerV3({ streamingLlmCallFn: llmCallFn });
        coer.setRunner(runner);
    }

    return coer ;
}
