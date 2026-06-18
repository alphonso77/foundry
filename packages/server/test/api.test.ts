import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { FolderResolver, Generator } from '@foundry/generator';
import { createApp } from '../src/app.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'blueprints');
const JWT_SECRET = 'test-secret';
const ISSUER = 'https://auth.test';
const WORKDIR_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-deploy-test-'));

afterAll(() => {
  fs.rmSync(WORKDIR_ROOT, { recursive: true, force: true });
});

function app(overrides: { authDisabled?: boolean; deployDryRun?: boolean } = {}) {
  const resolver = new FolderResolver(FIXTURES);
  return createApp({
    resolver,
    generator: new Generator(resolver),
    authDisabled: overrides.authDisabled ?? true,
    corsOrigin: 'http://localhost:5173',
    oauthJwtSecret: JWT_SECRET,
    oauthIssuer: ISSUER,
    deployDryRun: overrides.deployDryRun ?? true,
    deployWorkdirRoot: WORKDIR_ROOT,
  });
}

/** Mint a token the way the IdP's `issueTokens` does (subject + issuer + type). */
function token(type: 'access' | 'refresh', opts: { secret?: string; issuer?: string } = {}) {
  return jwt.sign({ scope: ['read'], type }, opts.secret ?? JWT_SECRET, {
    subject: 'demo-client',
    issuer: opts.issuer ?? ISSUER,
    expiresIn: 900,
  });
}

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const res = await request(app()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('GET /api/blueprints', () => {
  it('lists summaries', async () => {
    const res = await request(app()).get('/api/blueprints');
    expect(res.status).toBe(200);
    expect(res.body).toContainEqual({
      id: 'demo',
      name: 'Demo Blueprint',
      description: expect.any(String),
    });
  });
});

describe('GET /api/blueprints/:id', () => {
  it('returns a manifest', async () => {
    const res = await request(app()).get('/api/blueprints/demo');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('demo');
    expect(res.body.inputs.fields).toHaveLength(4);
  });

  it('404s for unknown ids', async () => {
    const res = await request(app()).get('/api/blueprints/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });
});

describe('POST /api/generate', () => {
  it('returns a zip attachment for valid config', async () => {
    const res = await request(app())
      .post('/api/generate')
      .send({ blueprintId: 'demo', config: { serviceName: 'my-svc' } })
      .buffer(true)
      .parse((response, cb) => {
        const chunks: Buffer[] = [];
        response.on('data', (c: Buffer) => chunks.push(c));
        response.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.headers['content-disposition']).toContain('my-svc.zip');

    const zip = await JSZip.loadAsync(res.body as Buffer);
    expect(Object.keys(zip.files).sort()).toEqual(['README.md', 'package.json']);
    const pkg = JSON.parse(await zip.file('package.json')!.async('string'));
    expect(pkg.name).toBe('my-svc');
  });

  it('200s when a required field with a default is omitted', async () => {
    // `datastore` is required + has a default; omitting it must succeed because
    // defaults resolve before validation.
    const res = await request(app())
      .post('/api/generate')
      .send({ blueprintId: 'demo', config: { serviceName: 'my-svc' } });
    expect(res.status).toBe(200);
  });

  it('400s with field errors for invalid config', async () => {
    const res = await request(app())
      .post('/api/generate')
      .send({ blueprintId: 'demo', config: { serviceName: 'Bad Name!' } });

    expect(res.status).toBe(400);
    expect(res.body.errors).toBeInstanceOf(Array);
    expect(res.body.errors[0].field).toBe('serviceName');
  });

  it('400s when blueprintId is missing', async () => {
    const res = await request(app()).post('/api/generate').send({ config: {} });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('blueprintId');
  });

  it('404s for an unknown blueprint', async () => {
    const res = await request(app())
      .post('/api/generate')
      .send({ blueprintId: 'nope', config: {} });
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });
});

describe('auth (real bearer verification when enabled)', () => {
  it('401s with no Authorization header', async () => {
    const res = await request(app({ authDisabled: false })).get('/api/blueprints');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
    expect(res.headers['www-authenticate']).toContain('Bearer');
  });

  it('401s on a garbage token', async () => {
    const res = await request(app({ authDisabled: false }))
      .get('/api/blueprints')
      .set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
  });

  it('401s on a token signed with the wrong secret', async () => {
    const res = await request(app({ authDisabled: false }))
      .get('/api/blueprints')
      .set('Authorization', `Bearer ${token('access', { secret: 'other-secret' })}`);
    expect(res.status).toBe(401);
  });

  it('401s on a wrong-issuer token', async () => {
    const res = await request(app({ authDisabled: false }))
      .get('/api/blueprints')
      .set('Authorization', `Bearer ${token('access', { issuer: 'https://evil.test' })}`);
    expect(res.status).toBe(401);
  });

  it('401s when a refresh token is replayed as a bearer', async () => {
    const res = await request(app({ authDisabled: false }))
      .get('/api/blueprints')
      .set('Authorization', `Bearer ${token('refresh')}`);
    expect(res.status).toBe(401);
  });

  it('200s with a valid access token', async () => {
    const res = await request(app({ authDisabled: false }))
      .get('/api/blueprints')
      .set('Authorization', `Bearer ${token('access')}`);
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Array);
  });

  it('opens all routes when auth is disabled (dev default)', async () => {
    const res = await request(app({ authDisabled: true })).get('/api/blueprints');
    expect(res.status).toBe(200);
  });
});

describe('deployments (DEPLOY_DRY_RUN)', () => {
  /** Poll GET /api/deployments/:id until it reaches one of `phases` (or times out). */
  async function pollUntil(server: ReturnType<typeof app>, id: string, phases: string[]) {
    for (let i = 0; i < 60; i++) {
      const res = await request(server).get(`/api/deployments/${id}`);
      if (phases.includes(res.body.phase)) {
        return res.body;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`deployment ${id} never reached ${phases.join('/')}`);
  }

  it('walks a valid deploy from pending to succeeded with a url', async () => {
    const server = app();
    const create = await request(server)
      .post('/api/deployments')
      .send({ blueprintId: 'demo', config: { serviceName: 'my-svc' } });
    expect(create.status).toBe(202);
    expect(create.body.id).toBeTruthy();

    const done = await pollUntil(server, create.body.id, ['succeeded', 'failed']);
    expect(done.phase).toBe('succeeded');
    expect(done.url).toBe('http://dry-run.local');
    expect(done.region).toBe('us-east-1');
  });

  it('streams logs by cursor', async () => {
    const server = app();
    const create = await request(server)
      .post('/api/deployments')
      .send({ blueprintId: 'demo', config: { serviceName: 'my-svc' } });
    await pollUntil(server, create.body.id, ['succeeded', 'failed']);

    const first = await request(server).get(`/api/deployments/${create.body.id}/logs?cursor=0`);
    expect(first.status).toBe(200);
    expect(first.body.lines.length).toBeGreaterThan(0);
    expect(first.body.done).toBe(true);

    // Reading from nextCursor yields no already-seen lines.
    const next = await request(server).get(
      `/api/deployments/${create.body.id}/logs?cursor=${first.body.nextCursor}`,
    );
    expect(next.body.lines).toEqual([]);
    expect(next.body.nextCursor).toBe(first.body.nextCursor);
  });

  it('400s with field errors for invalid config (mirrors /api/generate)', async () => {
    const res = await request(app())
      .post('/api/deployments')
      .send({ blueprintId: 'demo', config: { serviceName: 'Bad Name!' } });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('serviceName');
  });

  it('404s for an unknown blueprint', async () => {
    const res = await request(app())
      .post('/api/deployments')
      .send({ blueprintId: 'nope', config: {} });
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });

  it('404s when fetching an unknown deployment', async () => {
    const res = await request(app()).get('/api/deployments/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('tears down a deployment to destroyed', async () => {
    const server = app();
    const create = await request(server)
      .post('/api/deployments')
      .send({ blueprintId: 'demo', config: { serviceName: 'my-svc' } });
    await pollUntil(server, create.body.id, ['succeeded', 'failed']);

    const del = await request(server).delete(`/api/deployments/${create.body.id}`);
    expect(del.status).toBe(202);

    const done = await pollUntil(server, create.body.id, ['destroyed', 'failed']);
    expect(done.phase).toBe('destroyed');
  });

  it('lists deployments', async () => {
    const server = app();
    await request(server)
      .post('/api/deployments')
      .send({ blueprintId: 'demo', config: { serviceName: 'my-svc' } });
    const res = await request(server).get('/api/deployments');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('401s on deploy routes when auth is armed and no token is sent', async () => {
    const res = await request(app({ authDisabled: false }))
      .post('/api/deployments')
      .send({ blueprintId: 'demo', config: { serviceName: 'my-svc' } });
    expect(res.status).toBe(401);
  });
});
