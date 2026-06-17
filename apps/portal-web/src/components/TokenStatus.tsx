import { useEffect, useRef, useState } from 'react';
import { beginLogin, fetchUserinfo, getAccessToken, isOAuthEnabled } from '../auth';

/**
 * Top-bar key icon reflecting access-token health at a glance, with a modal for
 * detail. Three states:
 *   - good   (green) — OAuth on, token decodes, not expired, and /oauth/userinfo 200s.
 *   - bad    (red)   — OAuth on but no/undecodable/expired token, or userinfo non-200.
 *   - bypass (grey)  — OAuth disabled (VITE_OAUTH_ENABLED off); no token by design.
 *
 * Passive: never blocks render. The auth server (/oauth/userinfo) is the source
 * of truth for "good". State is recomputed on mount and whenever the modal opens.
 * Identity is client-level — `sub === client_id`; this is not a per-user identity.
 */

interface Claims {
  sub?: string;
  client_id?: string;
  scope?: string[] | string;
  iss?: string;
  type?: string;
  iat?: number;
  exp?: number;
}

interface UserinfoBody {
  sub?: string;
  client_id?: string;
  scope?: string[];
}

type TokenState =
  | { kind: 'loading' }
  | { kind: 'bypass' }
  | { kind: 'good'; claims: Claims; userinfo: UserinfoBody }
  | { kind: 'bad'; reason: string; claims: Claims | null };

function decodeJwt(token: string): Claims | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    return JSON.parse(atob(b64 + pad)) as Claims;
  } catch {
    return null;
  }
}

async function computeState(): Promise<TokenState> {
  if (!isOAuthEnabled()) {
    return { kind: 'bypass' };
  }

  const token = getAccessToken();
  if (!token) {
    return { kind: 'bad', reason: 'No access token in this session.', claims: null };
  }

  const claims = decodeJwt(token);
  if (!claims) {
    return { kind: 'bad', reason: 'Token could not be decoded.', claims: null };
  }

  if (typeof claims.exp === 'number' && claims.exp * 1000 <= Date.now()) {
    return { kind: 'bad', reason: `Token expired at ${fmtTime(claims.exp)}.`, claims };
  }

  try {
    const res = await fetchUserinfo();
    if (!res.ok) {
      return {
        kind: 'bad',
        reason: `The auth server rejected this token (HTTP ${res.status}).`,
        claims,
      };
    }
    const userinfo = (await res.json()) as UserinfoBody;
    return { kind: 'good', claims, userinfo };
  } catch {
    return { kind: 'bad', reason: 'Could not reach the auth server to verify this token.', claims };
  }
}

function fmtTime(epochSeconds?: number): string {
  if (typeof epochSeconds !== 'number') {
    return '—';
  }
  return new Date(epochSeconds * 1000).toLocaleString();
}

function fmtUnit(ms: number): string {
  const mins = Math.round(ms / 60000);
  return mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins}m`;
}

function fmtExpHint(exp?: number): string {
  if (typeof exp !== 'number') {
    return '';
  }
  const delta = exp * 1000 - Date.now();
  return delta >= 0 ? `expires in ${fmtUnit(delta)}` : `expired ${fmtUnit(-delta)} ago`;
}

function fmtIatHint(iat?: number): string {
  if (typeof iat !== 'number') {
    return '';
  }
  return `${fmtUnit(Date.now() - iat * 1000)} ago`;
}

function fmtScope(scope?: string[] | string): string {
  if (Array.isArray(scope)) {
    return scope.length ? scope.join(' ') : 'none';
  }
  return typeof scope === 'string' && scope ? scope : 'none';
}

function KeyIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="modal__row">
      <span className="modal__key">{label}</span>
      <span className="modal__val">
        {value}
        {hint ? <span className="modal__hint"> · {hint}</span> : null}
      </span>
    </div>
  );
}

function ClaimsList({ claims }: { claims: Claims }) {
  return (
    <>
      <Row label="sub" value={claims.sub ?? '—'} />
      <Row label="client_id" value={claims.client_id ?? claims.sub ?? '—'} />
      <Row label="scope" value={fmtScope(claims.scope)} />
      <Row label="iss" value={claims.iss ?? '—'} />
      <Row label="type" value={claims.type ?? '—'} />
      <Row label="iat" value={fmtTime(claims.iat)} hint={fmtIatHint(claims.iat)} />
      <Row label="exp" value={fmtTime(claims.exp)} hint={fmtExpHint(claims.exp)} />
    </>
  );
}

export function TokenStatus() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<TokenState>({ kind: 'loading' });
  const keyRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    void computeState().then((s) => {
      if (active) {
        setState(s);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // Escape-to-close + focus the close button while the modal is open.
  useEffect(() => {
    if (!open) {
      return;
    }
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        keyRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function openModal(): void {
    setOpen(true);
    // Re-check on open: the token may have expired since mount.
    setState({ kind: 'loading' });
    void computeState().then(setState);
  }

  function closeModal(): void {
    setOpen(false);
    keyRef.current?.focus();
  }

  const tone =
    state.kind === 'good' ? 'good' : state.kind === 'bypass' || state.kind === 'loading' ? 'bypass' : 'bad';
  const label =
    state.kind === 'good'
      ? 'Access token valid'
      : state.kind === 'bypass'
        ? 'Auth bypassed'
        : state.kind === 'loading'
          ? 'Checking access token'
          : 'Access token problem';

  return (
    <>
      <button
        ref={keyRef}
        type="button"
        className={`token-key token-key--${tone}`}
        aria-label={label}
        title={label}
        onClick={openModal}
      >
        <KeyIcon />
      </button>

      {open ? (
        <div className="modal-overlay" onClick={closeModal}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={label}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__header">
              <h2 className="modal__title">{modalTitle(state)}</h2>
              <button ref={closeRef} type="button" className="modal__close" aria-label="Close" onClick={closeModal}>
                ✕
              </button>
            </div>
            {renderBody(state)}
          </div>
        </div>
      ) : null}
    </>
  );
}

function modalTitle(state: TokenState): string {
  switch (state.kind) {
    case 'good':
      return 'Access token — valid';
    case 'bad':
      return 'Access token — problem';
    case 'bypass':
      return 'Auth is bypassed';
    case 'loading':
      return 'Checking access token…';
  }
}

function renderBody(state: TokenState) {
  switch (state.kind) {
    case 'loading':
      return <p className="muted">Checking token status…</p>;

    case 'bypass':
      return (
        <p className="muted">
          OAuth is off (<code>VITE_OAUTH_ENABLED</code> is not <code>true</code>), so the portal runs
          without an identity provider and no access token is in play. There is nothing to verify. Enable
          it (alongside the API’s <code>AUTH_DISABLED=false</code>) to exercise the real token flow.
        </p>
      );

    case 'good':
      return (
        <>
          <div className="modal__rows">
            <ClaimsList claims={state.claims} />
          </div>
          <p className="modal__section-title">Confirmed by the auth server (/oauth/userinfo)</p>
          <pre className="modal__json">{JSON.stringify(state.userinfo, null, 2)}</pre>
        </>
      );

    case 'bad':
      return (
        <>
          <p className="banner banner--error">{state.reason}</p>
          {state.claims ? (
            <>
              <p className="modal__section-title">Decoded token (not accepted)</p>
              <div className="modal__rows">
                <ClaimsList claims={state.claims} />
              </div>
            </>
          ) : null}
          <div className="modal__actions">
            <button type="button" className="btn btn--primary" onClick={() => void beginLogin()}>
              Re-authenticate
            </button>
          </div>
        </>
      );
  }
}
