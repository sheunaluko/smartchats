import type { BillingAPI } from 'smartchats-backend';
import { BackendError } from 'smartchats-backend';
import type { LocalBackendOptions } from './backend.js';

/** Self-hosted mode has no billing — every method throws `not_supported`.
 *  Callers gate UI on `capabilities.billing === false`. */
export function createBillingAPI(_opts: LocalBackendOptions): BillingAPI {
    const err = (method: string): never => {
        throw new BackendError(
            'not_supported',
            `billing.${method} is not available in self-hosted mode (capabilities.billing === false)`
        );
    };
    return {
        async getBalance() { return err('getBalance'); },
        async purchaseCredits() { return err('purchaseCredits'); },
        async createSubscription() { return err('createSubscription'); },
        async manageSubscription() { return err('manageSubscription'); },
    };
}
