import path from 'node:path';
import JSZip from 'jszip';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { FolderResolver, Generator } from '@foundry/generator';
import { createApp } from '../src/app.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'blueprints');
const JWT_SECRET = 'test-secret';
const ISSUER = 'https://auth.test';

function app(overrides: { authDisabled?: boolean } = {}) {
  const resolver = new FolderResolver(FIXTURES);
  return createApp({
    resolver,
    generator: new Generator(resolver),
    authDisabled: overrides.authDisabled ?? true,
    corsOrigin: 'http://localhost:5173',
    oauthJwtSecret: JWT_SECRET,
    oauthIssuer: ISSUER,
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
