import { randomUUID } from 'node:crypto';
import express, {
  type NextFunction,
  type Request,
  type Response,
  type Router,
} from 'express';
import type { DeployRequest } from '@foundry/shared';
import { BlueprintNotFoundError, ConfigValidationError, type Generator } from '@foundry/generator';
import type { DeployExecutor } from './executor.js';
import { DeploymentStore, isTerminal } from './store.js';

const DEFAULT_REGION = 'us-east-1';

export interface DeployRouterDeps {
  generator: Generator;
  store: DeploymentStore;
  executor: DeployExecutor;
}

/**
 * Router for `/api/deployments` (mounted behind the existing authMiddleware).
 * POST validates config exactly like `/api/generate` (same 400/404 shapes) then
 * returns 202 and runs the deploy in the background; the rest are status/log
 * reads and an async teardown.
 */
export function createDeployRouter(deps: DeployRouterDeps): Router {
  const router = express.Router();

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = req.body as Partial<DeployRequest>;

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
      const region =
        typeof body.region === 'string' && body.region.length > 0 ? body.region : DEFAULT_REGION;

      // Validate by running the generator's full path — same contract as
      // /api/generate. The resolved result is handed straight to the executor
      // so we don't generate twice.
      let result;
      try {
        result = await deps.generator.generate(body.blueprintId, config, body.version);
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

      const now = new Date().toISOString();
      const id = randomUUID();
      deps.store.create({
        id,
        blueprintId: body.blueprintId,
        region,
        phase: 'pending',
        createdAt: now,
        updatedAt: now,
      });
      deps.executor.startDeploy(id, result, region);

      res.status(202).json({ id });
    }),
  );

  router.get('/', (_req, res) => {
    res.json(deps.store.list());
  });

  router.get('/:id', (req, res) => {
    const status = deps.store.get(req.params.id);
    if (!status) {
      res.status(404).json({ error: `Deployment not found: ${req.params.id}` });
      return;
    }
    res.json(status);
  });

  router.get('/:id/logs', (req, res) => {
    const status = deps.store.get(req.params.id);
    if (!status) {
      res.status(404).json({ error: `Deployment not found: ${req.params.id}` });
      return;
    }
    const cursor = Number.parseInt(String(req.query.cursor ?? '0'), 10);
    const read = deps.store.readLogs(req.params.id, cursor)!;
    res.json({
      id: req.params.id,
      lines: read.lines,
      nextCursor: read.nextCursor,
      done: isTerminal(status.phase),
    });
  });

  router.delete('/:id', (req, res) => {
    const status = deps.store.get(req.params.id);
    if (!status) {
      res.status(404).json({ error: `Deployment not found: ${req.params.id}` });
      return;
    }
    deps.executor.startTeardown(req.params.id);
    res.status(202).end();
  });

  return router;
}

/** Wrap an async route so rejected promises reach the error handler. */
function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}
