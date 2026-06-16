import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { BlueprintResolver, GenerateRequest } from '@foundry/shared';
import {
  BlueprintNotFoundError,
  ConfigValidationError,
  type Generator,
  kebabCase,
} from '@foundry/generator';
import { authMiddleware } from './auth.js';

export interface AppDeps {
  resolver: BlueprintResolver;
  generator: Generator;
  authDisabled: boolean;
  corsOrigin: string;
}

/**
 * Build the Express app implementing the HTTP API contract. Construction is
 * decoupled from wiring/listening so tests can inject a resolver + generator
 * pointed at fixtures.
 */
export function createApp(deps: AppDeps): Express {
  const app = express();

  app.use(cors({ origin: deps.corsOrigin }));
  app.use(express.json({ limit: '1mb' }));

  const api = express.Router();
  // Auth shim guards the whole API surface (open when AUTH_DISABLED).
  api.use(authMiddleware(deps.authDisabled));

  api.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  api.get(
    '/blueprints',
    asyncHandler(async (_req, res) => {
      const list = await deps.resolver.list();
      res.json(list);
    }),
  );

  api.get(
    '/blueprints/:id',
    asyncHandler(async (req, res) => {
      try {
        const manifest = await deps.resolver.getManifest(req.params.id);
        res.json(manifest);
      } catch (err) {
        if (err instanceof BlueprintNotFoundError) {
          res.status(404).json({ error: err.message });
          return;
        }
        throw err;
      }
    }),
  );

  api.post(
    '/generate',
    asyncHandler(async (req, res) => {
      const body = req.body as Partial<GenerateRequest>;

      if (typeof body?.blueprintId !== 'string' || body.blueprintId.length === 0) {
        res.status(400).json({
          errors: [{ field: 'blueprintId', message: 'blueprintId is required.' }],
        });
        return;
      }
      const config =
        body.config && typeof body.config === 'object'
          ? body.config
          : ({} as Record<string, unknown>);

      try {
        const result = await deps.generator.generate(body.blueprintId, config, body.version);
        const zip = await result.toZip();

        const rawName =
          typeof config.serviceName === 'string' && config.serviceName.length > 0
            ? config.serviceName
            : result.manifest.id;
        const filename = `${kebabCase(rawName) || 'project'}.zip`;

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(zip);
      } catch (err) {
        if (err instanceof ConfigValidationError) {
          res.status(400).json({ errors: err.errors });
          return;
        }
        if (err instanceof BlueprintNotFoundError) {
          res.status(404).json({ error: err.message });
          return;
        }
        throw err;
      }
    }),
  );

  app.use('/api', api);

  // Centralized error handler — anything unexpected becomes a 500.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[foundry] unhandled error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  });

  return app;
}

/** Wrap an async route so rejected promises reach the error handler. */
function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}
