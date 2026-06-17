/**
 * Browser-side OAuth 2.0 Authorization-Code + PKCE client for the dogfooded
 * Foundry IdP (the OAuth blueprint's generated server).
 *
 * Flow:
 *   1. `ensureAuthenticated()` runs once on app load.
 *      - On the `/callback` path with `?code=`: exchange the code for an access
 *        token, store it, and clean the URL.
 *      - Otherwise, if no token is stored: build a PKCE challenge, stash the
 *        verifier + state in sessionStorage, and redirect to `/oauth/authorize`.
 *      - If a token is already stored: resolve and let the app render.
 *   2. `getAccessToken()` / `clearAccessToken()` back the api layer's bearer
 *      attachment and its 401 → re-auth behavior.
 *
 * Identity is client-level (subject = client_id) — there is no login/consent
 * step yet (see coordination.md). Tokens live in sessionStorage: fine for a
 * local prototype, but readable by any XSS on this origin — not for production.
 */

/**
 * Master switch. Off by default so the everyday dev loop (portal + API with
 * `AUTH_DISABLED=true`, no IdP running) is unchanged. The dogfood scenario sets
 * `VITE_OAUTH_ENABLED=true` (alongside `AUTH_DISABLED=false` on the API) to arm
 * the full auth-code + PKCE flow against the locally-running IdP.
 */
const OAUTH_ENABLED = import.meta.env.VITE_OAUTH_ENABLED === 'true';

const CLIENT_ID = import.meta.env.VITE_OAUTH_CLIENT_ID ?? 'foundry-portal';
const REDIRECT_URI = import.meta.env.VITE_OAUTH_REDIRECT_URI ?? 'http://localhost:5173/callback';

// Same-origin endpoints: the Vite dev proxy forwards `/oauth/*` to the IdP (see
// vite.config.ts). Keeping these relative means the browser never makes a
// cross-origin call to the IdP — no CORS dependency on the generated server.
// `/authorize` is a top-level navigation; `/token` is a fetch.
const AUTHORIZE_ENDPOINT = '/oauth/authorize';
const TOKEN_ENDPOINT = '/oauth/token';
const USERINFO_ENDPOINT = '/oauth/userinfo';

const TOKEN_KEY = 'foundry.access_token';
const VERIFIER_KEY = 'foundry.pkce_verifier';
const STATE_KEY = 'foundry.oauth_state';

export function getAccessToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function clearAccessToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

/** Whether the OAuth flow is armed (`VITE_OAUTH_ENABLED=true`). When false the
 *  portal runs auth-bypassed and no token is in play. */
export function isOAuthEnabled(): boolean {
  return OAUTH_ENABLED;
}

/**
 * Live auth-server check: `GET /oauth/userinfo` (same-origin, proxied to the IdP
 * by vite.config.ts) bearing the stored access token. Used by the token-status
 * indicator — the auth server's verdict is the source of truth for token health.
 * If no token is stored the request is sent without the header and the IdP 401s,
 * which the caller surfaces as the bad state.
 */
export async function fetchUserinfo(): Promise<Response> {
  const token = getAccessToken();
  return fetch(USERINFO_ENDPOINT, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

/**
 * Resolve only when the app has a usable access token. May trigger a full-page
 * redirect to the IdP (in which case the returned promise never resolves — the
 * page navigates away). Call once before rendering the app.
 */
export async function ensureAuthenticated(): Promise<void> {
  if (!OAUTH_ENABLED) {
    return;
  }

  const url = new URL(window.location.href);

  // Callback leg: any return to the redirect path is handled here — success
  // (?code=) OR failure (?error=). Falling through on an error redirect would
  // loop straight back into a fresh login.
  if (url.pathname === new URL(REDIRECT_URI).pathname) {
    await handleCallback(url);
    return;
  }

  if (getAccessToken()) {
    return;
  }

  await beginLogin();
  // beginLogin navigates away; block until the redirect happens.
  await new Promise<never>(() => {});
}

/** Build the PKCE challenge, persist the verifier/state, and redirect. */
export async function beginLogin(): Promise<void> {
  if (!OAUTH_ENABLED) {
    return;
  }

  const verifier = randomString(64);
  const state = randomString(24);
  const challenge = await s256Challenge(verifier);

  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });

  window.location.assign(`${AUTHORIZE_ENDPOINT}?${params.toString()}`);
}

async function handleCallback(url: URL): Promise<void> {
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);

  // Always strip the query string so a reload can't replay the (one-time) code.
  const cleanUrl = `${url.origin}/`;

  // IdP returned an error (RFC 6749 §4.1.2.1) instead of a code. Surface it to
  // the .auth-error screen rather than falling through to another login.
  if (error) {
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);
    window.history.replaceState({}, '', cleanUrl);
    const description = url.searchParams.get('error_description');
    throw new Error(`Authorization failed: ${error}${description ? ` (${description})` : ''}.`);
  }

  if (!code || !verifier || !returnedState || returnedState !== expectedState) {
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);
    window.history.replaceState({}, '', cleanUrl);
    throw new Error('OAuth callback failed: missing code or state mismatch.');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);

  if (!res.ok) {
    window.history.replaceState({}, '', cleanUrl);
    throw new Error(`Token exchange failed (HTTP ${res.status}).`);
  }

  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    window.history.replaceState({}, '', cleanUrl);
    throw new Error('Token exchange returned no access_token.');
  }

  sessionStorage.setItem(TOKEN_KEY, json.access_token);
  // Land back on the app root with a clean URL.
  window.history.replaceState({}, '', cleanUrl);
}

// ── PKCE primitives (Web Crypto) ─────────────────────────────────────────────

function randomString(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return base64Url(arr);
}

async function s256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) {
    str += String.fromCharCode(b);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
