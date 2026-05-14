/**
 * `smartchats login` — interactively authenticate against the cloud.
 *
 * Forces a fresh credential acquisition: deletes any cached token so
 * `getIdToken` falls through to the browser-based flow. The MCP server,
 * other CLI subcommands, and any future smartchats tooling all read
 * the same credentials file (`~/.smartchats-mcp/credentials.json` by
 * default; `SMARTCHATS_CREDENTIALS_FILE` overrides).
 */

import consola from 'consola';
import { getIdToken, getUid, logout, resolveConfig } from 'smartchats-cloud-client';

export async function runLogin(): Promise<void> {
    const config = resolveConfig();
    // Clear any cached creds so getIdToken triggers the interactive flow.
    await logout(config).catch(() => undefined);

    consola.info(`Signing in to ${config.firebase.projectId} (${config.cloudFunctionsBase})`);
    consola.info('Browser will open for sign-in. URL also printed in case auto-open fails.');

    await getIdToken(config);  // browser flow → stored refresh token

    const uid = await getUid(config);
    consola.success(`Signed in as uid=${uid}`);
    consola.info(`Credentials cached at ${config.credentialsFile}`);
}

export const loginHelp = `smartchats login — sign in to the SmartChats cloud

Opens a browser for OAuth (Google or email/password), captures the credential,
and persists a refresh token so subsequent commands authenticate silently.

Usage:
  smartchats login

Override Firebase config via env vars (rare — only for staging/dev):
  SMARTCHATS_FIREBASE_API_KEY
  SMARTCHATS_FIREBASE_AUTH_DOMAIN
  SMARTCHATS_FIREBASE_PROJECT_ID
  SMARTCHATS_CLOUD_FUNCTIONS_BASE
`;
