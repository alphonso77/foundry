import { useEffect, useRef, useState } from 'react';
import { getDeployment, getDeploymentLogs, teardownDeployment } from '../api';
import type { DeploymentPhase, DeploymentStatus } from '../types';

const POLL_MS = 2000;

const TERMINAL: ReadonlySet<DeploymentPhase> = new Set(['succeeded', 'failed', 'destroyed']);

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Live view of a single deployment: polls status (~2s) + streams the log buffer
 * by cursor until a terminal phase, surfaces the ALB url on success / the error
 * on failure, and offers a Teardown button once the deployment is up.
 */
export function DeployPanel({ deploymentId, onClear }: { deploymentId: string; onClear: () => void }) {
  const [status, setStatus] = useState<DeploymentStatus | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [tearingDown, setTearingDown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped to resume polling after a teardown (which starts from a terminal phase).
  const [pollKey, setPollKey] = useState(0);
  const cursorRef = useRef(0);
  const logRef = useRef<HTMLPreElement>(null);

  // Reset accumulated state whenever we switch to a different deployment.
  useEffect(() => {
    setStatus(null);
    setLines([]);
    setTearingDown(false);
    setError(null);
    cursorRef.current = 0;
  }, [deploymentId]);

  // Poll status + logs until terminal. Re-armed by pollKey after a teardown.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function tick(): Promise<void> {
      try {
        const [next, logs] = await Promise.all([
          getDeployment(deploymentId),
          getDeploymentLogs(deploymentId, cursorRef.current),
        ]);
        if (cancelled) {
          return;
        }
        setStatus(next);
        if (logs.lines.length > 0) {
          cursorRef.current = logs.nextCursor;
          setLines((prev) => [...prev, ...logs.lines]);
        }
        if (!TERMINAL.has(next.phase)) {
          timer = setTimeout(() => void tick(), POLL_MS);
        }
      } catch (e) {
        if (!cancelled) {
          setError(errMsg(e));
        }
      }
    }

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [deploymentId, pollKey]);

  // Keep the log view pinned to the latest line.
  useEffect(() => {
    const el = logRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines]);

  async function handleTeardown(): Promise<void> {
    setTearingDown(true);
    setError(null);
    try {
      await teardownDeployment(deploymentId);
      setPollKey((k) => k + 1); // resume polling through destroying → destroyed
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setTearingDown(false);
    }
  }

  const phase = status?.phase ?? 'pending';
  const isTerminal = TERMINAL.has(phase);
  const canTeardown = phase === 'succeeded' || phase === 'failed';

  return (
    <section className="deploy-panel">
      <div className="deploy-panel__head">
        <h3 className="deploy-panel__title">Deployment</h3>
        <span className={`deploy-phase deploy-phase--${phase}`}>{phase}</span>
        {status ? <span className="deploy-panel__region">{status.region}</span> : null}
        {isTerminal ? (
          <button className="btn btn--ghost btn--sm" type="button" onClick={onClear}>
            Dismiss
          </button>
        ) : null}
      </div>

      {status?.url ? (
        <p className="deploy-panel__url">
          <a href={status.url} target="_blank" rel="noreferrer">
            {status.url}
          </a>
        </p>
      ) : null}

      {phase === 'failed' && status?.error ? (
        <div className="banner banner--error">{status.error}</div>
      ) : null}
      {error ? <div className="banner banner--error">{error}</div> : null}

      <pre className="deploy-log" ref={logRef}>
        {lines.length > 0 ? lines.join('\n') : 'Waiting for logs…'}
      </pre>

      {canTeardown ? (
        <button
          className="btn btn--danger"
          type="button"
          onClick={() => void handleTeardown()}
          disabled={tearingDown}
        >
          {tearingDown ? 'Tearing down…' : 'Teardown'}
        </button>
      ) : null}
    </section>
  );
}
