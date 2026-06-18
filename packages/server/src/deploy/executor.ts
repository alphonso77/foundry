import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { DeploymentPhase } from '@foundry/shared';
import { kebabCase, type GenerateResult, type Generator } from '@foundry/generator';
import type { DeploymentStore } from './store.js';

/** Wall-clock per simulated phase in dry-run mode — long enough for the UI to poll. */
const DRY_RUN_STEP_MS = 500;

export interface ExecutorDeps {
  generator: Generator;
  store: DeploymentStore;
  /** Per-deployment workdirs are created under here: `<root>/<id>`. */
  workdirRoot: string;
  /** When true, never spawn a subprocess; simulate the phases (see Contracts §3). */
  dryRun: boolean;
}

/** Durable per-deployment record, written to `<workdir>/meta.json`. */
interface DeployMeta {
  id: string;
  blueprintId: string;
  region: string;
  serviceName: string;
  imageTag: string;
}

/**
 * Drives the deploy/teardown pipeline (Contracts §3). Deploys run in the
 * background: the route returns 202 immediately and this advances the phase +
 * streams subprocess output into the store as it goes. AWS credentials flow
 * through the standard chain — we run subprocesses with the host env plus an
 * explicit `AWS_REGION`.
 */
export class DeployExecutor {
  constructor(private readonly deps: ExecutorDeps) {}

  /** Workdir is derived purely from the id so teardown can find it after a restart. */
  private workdir(id: string): string {
    return path.join(this.deps.workdirRoot, id);
  }

  /** Fire-and-forget; the caller has already returned 202. */
  startDeploy(id: string, result: GenerateResult, region: string): void {
    void this.deploy(id, result, region).catch((err: unknown) => this.fail(id, err));
  }

  /** Fire-and-forget teardown. */
  startTeardown(id: string): void {
    void this.teardown(id).catch((err: unknown) => this.fail(id, err));
  }

  private async deploy(id: string, result: GenerateResult, region: string): Promise<void> {
    const status = this.deps.store.get(id);
    if (!status) {
      return;
    }
    const serviceName = kebabCase(asString(result.config.serviceName)) || status.blueprintId;
    const imageTag = id;
    const workdir = this.workdir(id);
    const infraDir = path.join(workdir, 'infra');

    // 1. generating — materialize the in-memory files + a durable meta.json.
    this.deps.store.update(id, { phase: 'generating' });
    await this.materialize(id, result, { id, blueprintId: status.blueprintId, region, serviceName, imageTag });

    if (this.deps.dryRun) {
      await this.simulateRemaining(id);
      return;
    }

    const vars = [
      '-var',
      `aws_region=${region}`,
      '-var',
      `service_name=${serviceName}`,
      '-var',
      `image_tag=${imageTag}`,
    ];

    // 2. tf-init
    this.deps.store.update(id, { phase: 'tf-init' });
    await this.run(id, infraDir, 'terraform', ['init', '-input=false'], { region });

    // 3. provisioning — ECR must exist before the push, so apply it on its own first.
    this.deps.store.update(id, { phase: 'provisioning' });
    await this.run(
      id,
      infraDir,
      'terraform',
      ['apply', '-auto-approve', '-input=false', '-target=aws_ecr_repository.this', ...vars],
      { region },
    );
    const ecrUrl = await this.run(id, infraDir, 'terraform', ['output', '-raw', 'ecr_repository_url'], {
      region,
    });

    // 4. building
    this.deps.store.update(id, { phase: 'building' });
    await this.run(id, workdir, 'docker', ['build', '-t', `${ecrUrl}:${imageTag}`, '.'], { region });

    // 5. pushing — ECR login then push. The login password must not hit the log.
    this.deps.store.update(id, { phase: 'pushing' });
    const registry = ecrUrl.split('/')[0];
    const password = await this.run(id, workdir, 'aws', ['ecr', 'get-login-password', '--region', region], {
      region,
      quiet: true,
    });
    await this.run(id, workdir, 'docker', ['login', '--username', 'AWS', '--password-stdin', registry], {
      region,
      stdin: password,
    });
    await this.run(id, workdir, 'docker', ['push', `${ecrUrl}:${imageTag}`], { region });

    // 6. deploying — full apply, then read the ALB DNS for the public URL.
    this.deps.store.update(id, { phase: 'deploying' });
    await this.run(id, infraDir, 'terraform', ['apply', '-auto-approve', '-input=false', ...vars], {
      region,
    });
    const albDns = await this.run(id, infraDir, 'terraform', ['output', '-raw', 'alb_dns_name'], {
      region,
    });

    this.deps.store.update(id, { phase: 'succeeded', url: `http://${albDns}` });
    this.log(id, `Deployment succeeded: http://${albDns}`);
  }

  private async teardown(id: string): Promise<void> {
    const status = this.deps.store.get(id);
    if (!status) {
      return;
    }
    this.deps.store.update(id, { phase: 'destroying' });
    const workdir = this.workdir(id);
    const infraDir = path.join(workdir, 'infra');

    if (this.deps.dryRun) {
      this.log(id, '$ terraform destroy (dry run)');
      await sleep(DRY_RUN_STEP_MS);
      this.deps.store.update(id, { phase: 'destroyed' });
      this.log(id, 'Teardown complete (dry run).');
      return;
    }

    // Reconstruct the vars from the durable meta.json so teardown works even
    // after a restart wiped the in-memory status.
    const meta = await this.readMeta(workdir);
    await this.run(
      id,
      infraDir,
      'terraform',
      [
        'destroy',
        '-auto-approve',
        '-input=false',
        '-var',
        `aws_region=${meta.region}`,
        '-var',
        `service_name=${meta.serviceName}`,
        '-var',
        `image_tag=${meta.imageTag}`,
      ],
      { region: meta.region },
    );
    this.deps.store.update(id, { phase: 'destroyed' });
    this.log(id, 'Teardown complete.');
  }

  /** Write the generated files (`.hbs` already stripped) + meta.json to the workdir. */
  private async materialize(id: string, result: GenerateResult, meta: DeployMeta): Promise<void> {
    const workdir = this.workdir(id);
    await fs.mkdir(workdir, { recursive: true });
    for (const file of result.files) {
      const dest = path.join(workdir, file.path);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, file.contents);
    }
    // Durable record — see DeploymentStore's note. Teardown reads this back.
    await fs.writeFile(path.join(workdir, 'meta.json'), JSON.stringify(meta, null, 2));
    this.log(id, `Materialized ${result.files.length} files to ${workdir}`);
  }

  private async readMeta(workdir: string): Promise<DeployMeta> {
    const raw = await fs.readFile(path.join(workdir, 'meta.json'), 'utf8');
    return JSON.parse(raw) as DeployMeta;
  }

  /** Advance through the remaining phases with synthetic log lines (dry-run). */
  private async simulateRemaining(id: string): Promise<void> {
    const steps: Array<[DeploymentPhase, string]> = [
      ['tf-init', '$ terraform init'],
      ['provisioning', '$ terraform apply -target=aws_ecr_repository.this'],
      ['building', '$ docker build'],
      ['pushing', '$ docker push'],
      ['deploying', '$ terraform apply'],
    ];
    for (const [phase, line] of steps) {
      this.deps.store.update(id, { phase });
      this.log(id, `${line} (dry run)`);
      await sleep(DRY_RUN_STEP_MS);
    }
    this.deps.store.update(id, { phase: 'succeeded', url: 'http://dry-run.local' });
    this.log(id, 'Deployment succeeded (dry run): http://dry-run.local');
  }

  /**
   * Spawn a command, streaming stdout+stderr into the log buffer line-by-line,
   * and resolve with the trimmed stdout (needed for `terraform output -raw`).
   * Rejects on a non-zero exit or spawn error.
   */
  private run(
    id: string,
    cwd: string,
    cmd: string,
    args: string[],
    opts: { region: string; stdin?: string; quiet?: boolean },
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      this.log(id, `$ ${cmd} ${args.join(' ')}`);
      const child = spawn(cmd, args, {
        cwd,
        env: { ...process.env, AWS_REGION: opts.region },
      });

      let stdout = '';
      child.stdout.on('data', (buf: Buffer) => {
        const text = buf.toString();
        stdout += text;
        if (!opts.quiet) {
          this.logChunk(id, text);
        }
      });
      child.stderr.on('data', (buf: Buffer) => this.logChunk(id, buf.toString()));

      if (opts.stdin !== undefined) {
        child.stdin.write(opts.stdin);
        child.stdin.end();
      }

      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`\`${cmd}\` exited with code ${code ?? 'null'}`));
        }
      });
    });
  }

  private fail(id: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.log(id, `ERROR: ${message}`);
    this.deps.store.update(id, { phase: 'failed', error: message });
  }

  private log(id: string, line: string): void {
    this.deps.store.appendLog(id, line);
  }

  /** Split a raw subprocess chunk into non-empty lines and append each. */
  private logChunk(id: string, text: string): void {
    for (const line of text.split('\n')) {
      if (line.length > 0) {
        this.deps.store.appendLog(id, line);
      }
    }
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
