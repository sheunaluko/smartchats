import { useCallback } from 'react';
import { useInsights } from '@/context/InsightsContext';

type AnyHandler = ((...args: any[]) => any) | undefined;

export function useTrackedClick<H extends AnyHandler>(
    handler: H,
    name: string,
    surface: string,
    contextFn?: () => Record<string, any>,
): H {
    const { client } = useInsights();
    return useCallback((...args: any[]) => {
        client?.addEvent?.('ui_click', {
            name,
            surface,
            ...(contextFn ? { context: contextFn() } : {}),
        }).catch?.(() => {});
        return handler?.(...args);
    }, [handler, name, surface, client, contextFn]) as H;
}
