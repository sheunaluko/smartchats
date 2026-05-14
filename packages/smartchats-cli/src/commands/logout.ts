/**
 * `smartchats logout` — clear cached cloud credentials.
 *
 * Deletes the credentials file and clears the in-process auth cache.
 * Subsequent cloud-targeted commands will trigger a fresh interactive
 * login on next call.
 */

import consola from 'consola';
import { logout, resolveConfig } from 'smartchats-cloud-client';

export async function runLogout(): Promise<void> {
    const config = resolveConfig();
    await logout(config);
    consola.success(`Logged out. Removed ${config.credentialsFile}.`);
}

export const logoutHelp = `smartchats logout — clear cached cloud credentials

Removes the stored refresh token. Next 'smartchats login' (or any cloud-targeted
command) prompts for fresh authentication.

Usage:
  smartchats logout
`;
