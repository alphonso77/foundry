import { useEffect, useState } from 'react';
import { BlueprintList } from './components/BlueprintList';
import { ConfigForm } from './components/ConfigForm';
import { DeployPanel } from './components/DeployPanel';
import { TokenStatus } from './components/TokenStatus';
import { generate, getManifest, listBlueprints, startDeploy, ValidationFailure } from './api';
import type { BlueprintManifest, BlueprintSummary, ValidationError } from './types';

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

type Banner = { kind: 'success' | 'error'; text: string };

export function App() {
  const [blueprints, setBlueprints] = useState<BlueprintSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manifest, setManifest] = useState<BlueprintManifest | null>(null);
  const [serverErrors, setServerErrors] = useState<ValidationError[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);

  useEffect(() => {
    listBlueprints()
      .then(setBlueprints)
      .catch((e: unknown) => setBanner({ kind: 'error', text: errMsg(e) }));
  }, []);

  async function handleSelect(id: string): Promise<void> {
    setSelectedId(id);
    setManifest(null);
    setServerErrors([]);
    setBanner(null);
    setDeploymentId(null);
    try {
      setManifest(await getManifest(id));
    } catch (e) {
      setBanner({ kind: 'error', text: errMsg(e) });
    }
  }

  async function handleGenerate(config: Record<string, unknown>): Promise<void> {
    if (!manifest) {
      return;
    }
    setSubmitting(true);
    setServerErrors([]);
    setBanner(null);
    try {
      const blob = await generate({ blueprintId: manifest.id, config });
      const name =
        typeof config.serviceName === 'string' && config.serviceName
          ? config.serviceName
          : manifest.id;
      downloadBlob(blob, `${name}.zip`);
      setBanner({ kind: 'success', text: `Generated ${name}.zip` });
    } catch (e) {
      if (e instanceof ValidationFailure) {
        setServerErrors(e.errors);
        setBanner({ kind: 'error', text: 'Please fix the highlighted fields.' });
      } else {
        setBanner({ kind: 'error', text: errMsg(e) });
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeploy(config: Record<string, unknown>, region: string): Promise<void> {
    if (!manifest) {
      return;
    }
    setDeploying(true);
    setServerErrors([]);
    setBanner(null);
    try {
      const id = await startDeploy({ blueprintId: manifest.id, config, region });
      setDeploymentId(id);
      setBanner({ kind: 'success', text: `Deploy started in ${region}.` });
    } catch (e) {
      if (e instanceof ValidationFailure) {
        setServerErrors(e.errors);
        setBanner({ kind: 'error', text: 'Please fix the highlighted fields.' });
      } else {
        setBanner({ kind: 'error', text: errMsg(e) });
      }
    } finally {
      setDeploying(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark">⬢</span>
          <span className="brand__name">Foundry</span>
        </div>
        <span className="topbar__tag">Service Portal</span>
        <TokenStatus />
      </header>

      <main className="layout">
        <aside className="panel panel--list">
          <h2 className="panel__title">Blueprints</h2>
          <BlueprintList blueprints={blueprints} selectedId={selectedId} onSelect={handleSelect} />
        </aside>

        <section className="panel panel--config">
          {banner ? <div className={`banner banner--${banner.kind}`}>{banner.text}</div> : null}

          {!manifest ? (
            <div className="empty">
              <h2>Pick a blueprint to get started</h2>
              <p className="muted">
                Select a blueprint on the left, configure it, and download a ready-to-build project.
              </p>
            </div>
          ) : (
            <>
              <div className="config-header">
                <h2 className="panel__title">{manifest.name}</h2>
                <span className="pill">v{manifest.version}</span>
                <span className="pill pill--ghost">{manifest.deployTarget}</span>
              </div>
              <p className="muted config-desc">{manifest.description}</p>
              <ConfigForm
                key={manifest.id}
                manifest={manifest}
                serverErrors={serverErrors}
                submitting={submitting}
                deploying={deploying}
                onSubmit={handleGenerate}
                onDeploy={handleDeploy}
              />
              {deploymentId ? (
                <DeployPanel
                  key={deploymentId}
                  deploymentId={deploymentId}
                  onClear={() => setDeploymentId(null)}
                />
              ) : null}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
