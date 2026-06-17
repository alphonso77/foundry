import type {
  BlueprintManifest,
  BlueprintSummary,
  GenerateRequest,
  ValidationError,
} from './types';
import { beginLogin, clearAccessToken, getAccessToken } from './auth';

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

/**
 * `fetch` wrapper that attaches the IdP access token as a bearer credential and,
 * on a `401`, clears the stale token and restarts the OAuth flow. The redirect
 * navigates away, so the returned response is effectively never consumed in the
 * 401 case — but we still return it to keep the type honest.
 */
async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getAccessToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) {
    clearAccessToken();
    // Re-initiate auth-code + PKCE; this navigates the page away.
    void beginLogin();
  }
  return res;
}

export async function listBlueprints(): Promise<BlueprintSummary[]> {
  const res = await authFetch(`${API_BASE}/blueprints`);
  if (!res.ok) {
    throw new Error(`Failed to load blueprints (HTTP ${res.status})`);
  }
  return (await res.json()) as BlueprintSummary[];
}

export async function getManifest(id: string): Promise<BlueprintManifest> {
  const res = await authFetch(`${API_BASE}/blueprints/${encodeURIComponent(id)}`);
  if (!res.ok) {
    throw new Error(`Failed to load blueprint "${id}" (HTTP ${res.status})`);
  }
  return (await res.json()) as BlueprintManifest;
}

/** Thrown when the server rejects a config with 400 + field-level errors. */
export class ValidationFailure extends Error {
  readonly errors: ValidationError[];
  constructor(errors: ValidationError[]) {
    super('The server rejected this configuration.');
    this.name = 'ValidationFailure';
    this.errors = errors;
  }
}

/** POST /api/generate. Resolves to a zip Blob on success. */
export async function generate(req: GenerateRequest): Promise<Blob> {
  const res = await authFetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (res.status === 400) {
    const body = (await res.json().catch(() => ({ errors: [] }))) as {
      errors?: ValidationError[];
    };
    throw new ValidationFailure(body.errors ?? []);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Generation failed (HTTP ${res.status})`);
  }
  return res.blob();
}
