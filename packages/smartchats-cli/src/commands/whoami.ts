/**
 * `smartchats whoami` — print the currently-authenticated cloud user.
 *
 * Reads the stored credentials (or triggers an interactive login if
 * none exist), then prints the resolved Firebase UID and identifying
 * info — useful for confirming which account subsequent commands act
 * as.
 */

import consola from 'consola';
import * as fs from 'node:fs/promises';
import { getUid, resolveConfig } from 'smartchats-cloud-client';

export async function runWhoami(): Promise<void> {
    const config = resolveConfig();
    const uid = await getUid(config);

    // Surface email/displayName from the credentials file too — getUid only
    // returns uid. Read directly (file format documented in cloud-client).
    let email: string | null = null;
    let displayName: string | null = null;
    try {
        const raw = await fs.readFile(config.credentialsFile, 'utf-8');
        const parsed = JSON.parse(raw) as { email?: string; displayName?: string };
        email = parsed.email ?? null;
        displayName = parsed.displayName ?? null;
    } catch {
        // creds file unreadable — uid alone is fine
    }

    consola.info(`uid:         ${uid}`);
    if (email) consola.info(`email:       ${email}`);
    if (displayName) consola.info(`displayName: ${displayName}`);
    consola.info(`project:     ${config.firebase.projectId}`);
    consola.info(`creds file:  ${config.credentialsFile}`);
}

export const whoamiHelp = `smartchats whoami — show the currently-authenticated cloud user

Triggers an interactive login if no cached credentials exist.

Usage:
  smartchats whoami
`;
