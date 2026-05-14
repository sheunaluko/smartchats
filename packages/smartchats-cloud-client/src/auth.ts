/**
 * Firebase OAuth authentication for the cloud client.
 *
 * First run: spawns a local HTTP server, opens a browser to a Firebase
 * sign-in page, and captures the resulting ID token via callback. Subsequent
 * runs reuse the stored refresh token to mint a fresh ID token without
 * user interaction.
 *
 * Always logs the auth URL to stdout in addition to attempting browser
 * launch — required for headless / SSH / WSL contexts where browser
 * auto-open isn't available.
 *
 * Credentials persist at `~/.smartchats-mcp/credentials.json` by default
 * (`SMARTCHATS_CREDENTIALS_FILE` overrides). File mode 0o600.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CloudClientConfig } from './config.js';

interface StoredCredentials {
    refreshToken: string;
    uid: string;
    email: string | null;
    displayName: string | null;
}

interface AuthState {
    idToken: string;
    uid: string;
    email: string | null;
    displayName: string | null;
    refreshToken: string;
}

interface RefreshResponse {
    id_token: string;
    refresh_token: string;
    expires_in: string;
    token_type: string;
    user_id: string;
}

/**
 * Auth state for a single client instance. Module-level cache means
 * repeated `getIdToken` calls within one process reuse a fresh token.
 */
const authCache = new WeakMap<CloudClientConfig, AuthState>();

/**
 * Get a valid Firebase ID token, authenticating if needed.
 *
 * Order of attempts:
 *   1. In-memory cache from a prior call this process.
 *   2. Stored refresh token → Firebase REST refresh.
 *   3. Browser-based interactive login.
 */
export async function getIdToken(config: CloudClientConfig): Promise<string> {
    const cached = authCache.get(config);
    if (cached) return cached.idToken;

    const stored = await loadCredentials(config);
    if (stored) {
        try {
            const refreshed = await refreshIdToken(stored.refreshToken, config);
            const state: AuthState = {
                idToken: refreshed.id_token,
                uid: stored.uid,
                email: stored.email,
                displayName: stored.displayName,
                refreshToken: refreshed.refresh_token,
            };
            authCache.set(config, state);
            // Refresh token may have rotated — persist the new one.
            await saveCredentials(config, {
                refreshToken: refreshed.refresh_token,
                uid: stored.uid,
                email: stored.email,
                displayName: stored.displayName,
            });
            return state.idToken;
        } catch {
            console.error('[auth] Stored credentials expired, re-authenticating...');
        }
    }

    const auth = await browserLogin(config);
    authCache.set(config, auth);
    await saveCredentials(config, {
        refreshToken: auth.refreshToken,
        uid: auth.uid,
        email: auth.email,
        displayName: auth.displayName,
    });
    return auth.idToken;
}

/** Get the authenticated user's UID, authenticating if needed. */
export async function getUid(config: CloudClientConfig): Promise<string> {
    if (!authCache.has(config)) {
        await getIdToken(config);
    }
    return authCache.get(config)!.uid;
}

/** Force re-authentication (e.g., after a 401). */
export async function reauthenticate(config: CloudClientConfig): Promise<string> {
    authCache.delete(config);
    return getIdToken(config);
}

/** Log out — clear stored credentials and current auth state. */
export async function logout(config: CloudClientConfig): Promise<void> {
    authCache.delete(config);
    try {
        await unlink(config.credentialsFile);
    } catch {
        // File may not exist — fine.
    }
}

// ---------------------------------------------------------------------------
// Token refresh via Firebase REST API
// ---------------------------------------------------------------------------

async function refreshIdToken(
    refreshToken: string,
    config: CloudClientConfig,
): Promise<RefreshResponse> {
    const url = `https://securetoken.googleapis.com/v1/token?key=${config.firebase.apiKey}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Token refresh failed (${res.status}): ${err}`);
    }
    return res.json() as Promise<RefreshResponse>;
}

// ---------------------------------------------------------------------------
// Credential persistence
// ---------------------------------------------------------------------------

async function loadCredentials(config: CloudClientConfig): Promise<StoredCredentials | null> {
    try {
        const data = await readFile(config.credentialsFile, 'utf-8');
        return JSON.parse(data) as StoredCredentials;
    } catch {
        return null;
    }
}

async function saveCredentials(
    config: CloudClientConfig,
    creds: StoredCredentials,
): Promise<void> {
    await mkdir(dirname(config.credentialsFile), { recursive: true });
    await writeFile(config.credentialsFile, JSON.stringify(creds, null, 2), {
        mode: 0o600,
    });
}

// ---------------------------------------------------------------------------
// Browser-based login flow
// ---------------------------------------------------------------------------

async function browserLogin(config: CloudClientConfig): Promise<AuthState> {
    return new Promise<AuthState>((resolve, reject) => {
        const server = createServer((req: IncomingMessage, res: ServerResponse) => {
            const url = new URL(req.url!, `http://localhost`);

            if (url.pathname === '/') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(getAuthPageHtml(config));
                return;
            }

            if (url.pathname === '/callback' && req.method === 'POST') {
                let body = '';
                req.on('data', (chunk) => (body += chunk));
                req.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: true }));

                        const authState: AuthState = {
                            idToken: data.idToken,
                            uid: data.uid,
                            email: data.email || null,
                            displayName: data.displayName || null,
                            refreshToken: data.refreshToken,
                        };

                        server.close();
                        resolve(authState);
                    } catch {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Invalid payload' }));
                    }
                });
                return;
            }

            res.writeHead(404);
            res.end('Not found');
        });

        // Bind to "localhost" — Firebase Auth's authorized-domains list
        // whitelists `localhost` but treats `127.0.0.1` as a separate,
        // unauthorized host (signInWithPopup rejects it).
        server.listen(0, 'localhost', async () => {
            const addr = server.address();
            if (!addr || typeof addr === 'string') {
                reject(new Error('Failed to start local auth server'));
                return;
            }

            const authUrl = `http://localhost:${addr.port}`;

            // Print to stdout AND stderr so headless / piped contexts always
            // see the URL. MCP servers communicate over stdio (JSON-RPC on
            // stdout), so during MCP usage stderr is what the host displays;
            // for direct CLI usage stdout is more discoverable. Both ensures
            // visibility in any context.
            const banner = [
                '',
                '────────────────────────────────────────────────',
                'SmartChats sign-in required.',
                'Open this URL in a browser to authenticate:',
                `  ${authUrl}`,
                '────────────────────────────────────────────────',
                '',
            ].join('\n');
            process.stderr.write(banner);

            try {
                const { default: open } = await import('open');
                await open(authUrl);
            } catch {
                process.stderr.write('[auth] Could not auto-open browser. Visit the URL above.\n');
            }
        });

        // Timeout after 5 minutes
        setTimeout(() => {
            server.close();
            reject(new Error('Authentication timed out after 5 minutes'));
        }, 5 * 60 * 1000);
    });
}

function getAuthPageHtml(config: CloudClientConfig): string {
    const fbConfig = JSON.stringify(config.firebase);
    return `<!DOCTYPE html>
<html>
<head>
  <title>SmartChats — Sign In</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: #e0e0e0; }
    .container { text-align: center; max-width: 400px; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #888; margin-bottom: 2rem; }
    button { padding: 12px 24px; font-size: 1rem; border: none; border-radius: 8px; cursor: pointer; width: 100%; margin-bottom: 12px; font-weight: 500; }
    .google-btn { background: #4285f4; color: white; }
    .google-btn:hover { background: #357abd; }
    .email-section { margin-top: 1.5rem; border-top: 1px solid #333; padding-top: 1.5rem; }
    input { width: 100%; padding: 10px; margin-bottom: 10px; border: 1px solid #333; border-radius: 6px; background: #1a1a1a; color: #e0e0e0; font-size: 0.95rem; box-sizing: border-box; }
    .email-btn { background: #333; color: white; }
    .email-btn:hover { background: #444; }
    .status { margin-top: 1rem; padding: 10px; border-radius: 6px; display: none; }
    .status.success { display: block; background: #1a3a1a; color: #4ade80; }
    .status.error { display: block; background: #3a1a1a; color: #f87171; }
    .status.loading { display: block; background: #1a2a3a; color: #60a5fa; }
  </style>
</head>
<body>
  <div class="container">
    <h1>SmartChats</h1>
    <p>Sign in with your SmartChats account.</p>

    <button class="google-btn" onclick="signInWithGoogle()">Sign in with Google</button>

    <div class="email-section">
      <input type="email" id="email" placeholder="Email" />
      <input type="password" id="password" placeholder="Password" />
      <button class="email-btn" onclick="signInWithEmail()">Sign in with Email</button>
    </div>

    <div id="status" class="status"></div>
  </div>

  <script type="module">
    import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-app.js';
    import { getAuth, signInWithPopup, signInWithEmailAndPassword, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-auth.js';

    const app = initializeApp(${fbConfig});
    const auth = getAuth(app);

    function showStatus(msg, type) {
      const el = document.getElementById('status');
      el.textContent = msg;
      el.className = 'status ' + type;
    }

    async function sendToken(user) {
      const idToken = await user.getIdToken();
      showStatus('Sending credentials...', 'loading');
      const res = await fetch('/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken,
          refreshToken: user.refreshToken,
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
        }),
      });
      if (res.ok) {
        showStatus('Authenticated! You can close this tab.', 'success');
      } else {
        showStatus('Failed to send credentials.', 'error');
      }
    }

    window.signInWithGoogle = async function() {
      try {
        showStatus('Opening Google sign-in...', 'loading');
        const provider = new GoogleAuthProvider();
        const result = await signInWithPopup(auth, provider);
        await sendToken(result.user);
      } catch (err) {
        showStatus('Google sign-in failed: ' + err.message, 'error');
      }
    };

    window.signInWithEmail = async function() {
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      if (!email || !password) {
        showStatus('Please enter email and password.', 'error');
        return;
      }
      try {
        showStatus('Signing in...', 'loading');
        const result = await signInWithEmailAndPassword(auth, email, password);
        await sendToken(result.user);
      } catch (err) {
        showStatus('Email sign-in failed: ' + err.message, 'error');
      }
    };
  </script>
</body>
</html>`;
}
