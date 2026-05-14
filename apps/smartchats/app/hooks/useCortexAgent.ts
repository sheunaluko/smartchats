'use client';

import { useState, useEffect, useMemo } from 'react';
import * as cortex_agent from "../cortex_agent_web";

/**
 * @param useStreaming - Developer flag: when true, uses the streaming runner for lower latency.
 *                       Not exposed to users. Flip here or at the call site to enable.
 */
export function useCortexAgent(model: string, insightsClient?: any, authInfo?: { isAuthenticated: boolean }, useStreaming: boolean = false) {
  const [agent, setAgent] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function initAgent() {
      try {
        setIsLoading(true);
        setError(null);
        const newAgent = await cortex_agent.get_agent(model, insightsClient, authInfo, useStreaming);

        if (!cancelled) {
          setAgent(newAgent);
          setIsLoading(false);
          insightsClient?.addEvent?.('agent_init_success', {
            model,
            useStreaming,
            isAuthenticated: authInfo?.isAuthenticated,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error('Failed to initialize agent'));
          setIsLoading(false);
          insightsClient?.addEvent?.('agent_init_error', {
            model,
            useStreaming,
            error: (err instanceof Error ? err.message : String(err)),
          });
        }
      }
    }

    initAgent();

    return () => {
      cancelled = true;
      // Future: Add agent cleanup if needed
      // if (agent) {
      //   agent.off('event', handle_event);
      // }
    };
  }, [model, insightsClient, authInfo?.isAuthenticated, useStreaming]);

  return useMemo(() => ({ agent, isLoading, error }), [agent, isLoading, error]);
}
