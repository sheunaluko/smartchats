import { basicChatFlow } from './workflows/basic_chat_flow';
import { fullConversationFlow } from './workflows/full_conversation_flow';
import { settingsPersistenceFlow } from './workflows/settings_persistence_flow';
import { sessionSaveLoadFlow } from './workflows/session_save_load_flow';
import { codeExecutionFlow } from './workflows/code_execution_flow';
import { multiTurnContextFlow } from './workflows/multi_turn_context_flow';
import { workspaceUpdateFlow } from './workflows/workspace_update_flow';
import { htmlDisplayFlow } from './workflows/html_display_flow';
import { stressConversationFlow } from './workflows/stress_conversation_flow';
import { authGuardFlow } from './workflows/auth_guard_flow';
import { storageModeSwitchFlow } from './workflows/storage_mode_switch_flow';
import { modelSwitchFlow } from './workflows/model_switch_flow';
import { knowledgeGraphFlow } from './workflows/knowledge_graph_flow';
import { kgSettingsFlow } from './workflows/kg_settings_flow';
import { clearAndResumeFlow } from './workflows/clear_and_resume_flow';
import { sessionManagementFlow } from './workflows/session_management_flow';
import { rapidMessageFlow } from './workflows/rapid_message_flow';
import { executionHistoryNavFlow } from './workflows/execution_history_nav_flow';
import { agentDelegationFlow } from './workflows/agent_delegation_flow';
import { agentWaitFlow } from './workflows/agent_wait_flow';
import { agentInputFlow } from './workflows/agent_input_flow';
import { booleanMetricsFlow } from './workflows/boolean_metrics_flow';
import { timeShiftMetricFlow } from './workflows/time_shift_metric_flow';
import { appLifecycleFlow } from './workflows/app_lifecycle_flow';
import { breathingAppFlow } from './workflows/breathing_app_flow';
import { canarySweepFlow } from './workflows/canary_sweep_flow';
import { logExplorerFlow } from './workflows/log_explorer_flow';
import { metricsExplorerFlow } from './workflows/metrics_explorer_flow';
import { autoMetricsExplorerFlow } from './workflows/auto_metrics_explorer_flow';
import { seedTestDataFlow } from './workflows/seed_test_data_flow';
import { autoTodoFlow } from './workflows/auto_todo_flow';
import { autoKgExplorerFlow } from './workflows/auto_kg_explorer_flow';
import { shellModeCycleFlow } from './workflows/shell_mode_cycle_flow';
import { completeOnboardingFlow } from './workflows/complete_onboarding';

export const cortexWorkflows = {
  complete_onboarding: completeOnboardingFlow,
  basic_chat_flow: basicChatFlow,
  full_conversation_flow: fullConversationFlow,
  settings_persistence_flow: settingsPersistenceFlow,
  session_save_load_flow: sessionSaveLoadFlow,
  code_execution_flow: codeExecutionFlow,
  multi_turn_context_flow: multiTurnContextFlow,
  workspace_update_flow: workspaceUpdateFlow,
  html_display_flow: htmlDisplayFlow,
  stress_conversation_flow: stressConversationFlow,
  auth_guard_flow: authGuardFlow,
  storage_mode_switch_flow: storageModeSwitchFlow,
  model_switch_flow: modelSwitchFlow,
  knowledge_graph_flow: knowledgeGraphFlow,
  kg_settings_flow: kgSettingsFlow,
  clear_and_resume_flow: clearAndResumeFlow,
  session_management_flow: sessionManagementFlow,
  rapid_message_flow: rapidMessageFlow,
  execution_history_nav_flow: executionHistoryNavFlow,
  agent_delegation_flow: agentDelegationFlow,
  agent_wait_flow: agentWaitFlow,
  agent_input_flow: agentInputFlow,
  boolean_metrics_flow: booleanMetricsFlow,
  time_shift_metric_flow: timeShiftMetricFlow,
  app_lifecycle_flow: appLifecycleFlow,
  breathing_app_flow: breathingAppFlow,
  canary_sweep_flow: canarySweepFlow,
  log_explorer_flow: logExplorerFlow,
  metrics_explorer_flow: metricsExplorerFlow,
  auto_metrics_explorer_flow: autoMetricsExplorerFlow,
  seed_test_data_flow: seedTestDataFlow,
  auto_todo_flow: autoTodoFlow,
  auto_kg_explorer_flow: autoKgExplorerFlow,
  shell_mode_cycle_flow: shellModeCycleFlow,
};
