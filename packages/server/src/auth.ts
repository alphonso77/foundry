import type { NextFunction, Request, Response } from 'express';

/**
 * Auth middleware shim.
 *
 * When `AUTH_DISABLED` is true (the dev default), every route is open. This is
 * the seam where real OAuth slots in later: when auth is enabled we would
 * verify a bearer token here (issued by Foundry's own dogfooded OAuth server,
 * per the spec) and reject unauthenticated requests with 401.
 *
 * For this effort there is no real IdP, so the enabled branch is a clearly
 * marked stub that fails closed.
 */
export function authMiddleware(authDisabled: boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (authDisabled) {
      next();
      return;
    }

    // ── Real-auth seam ─────────────────────────────────────────────────────
    // TODO(auth): verify `req.headers.authorization` against the OAuth server
    // and attach the principal to the request. Until that exists, fail closed.
    void req;
    res.status(401).json({ error: 'Authentication required (no IdP configured).' });
  };
}
