import path from 'node:path';
import JSZip from 'jszip';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { FolderResolver, Generator } from '@foundry/generator';
import { createApp } from '../src/app.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'blueprints');

function app() {
  const resolver = new FolderResolver(FIXTURES);
  return createApp({
    resolver,
    generator: new Generator(resolver),
    authDisabled: true,
    corsOrigin: 'http://localhost:5173',
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

describe('auth shim', () => {
  it('blocks requests when auth is enabled (no IdP configured)', async () => {
    const resolver = new FolderResolver(FIXTURES);
    const guarded = createApp({
      resolver,
      generator: new Generator(resolver),
      authDisabled: false,
      corsOrigin: 'http://localhost:5173',
    });
    const res = await request(guarded).get('/api/blueprints');
    expect(res.status).toBe(401);
  });
});
