import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

/**
 * The authenticated principal attached to a request once a bearer token has
 * been verified. `sub` is the token subject (= the OAuth `client_id` under the
 * current client-level identity model); `scope` is the granted scopes.
 */
export interface Principal {
  sub: string;
  scope: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}

export interface AuthOptions {
  /** Symmetric HS256 secret shared with the IdP (config.oauthJwtSecret). */
  jwtSecret: string;
  /** Expected `iss` claim (config.oauthIssuer). */
  issuer: string;
}

/**
 * Auth middleware.
 *
 * When `AUTH_DISABLED` is true (the dev default), every route is open. When it
 * is armed (`AUTH_DISABLED=false`), this verifies a real bearer access token
 * issued by Foundry's dogfooded OAuth server (the OAuth blueprint's IdP):
 * HS256 signature + issuer + `type === 'access'`. Refresh tokens replayed as
 * bearers are rejected (same guard the IdP's `/token` refresh branch uses).
 *
 * On success the verified principal is attached as `req.principal`; on any
 * failure the request is rejected `401` with an RFC 6750 `WWW-Authenticate`
 * challenge.
 */
export function authMiddleware(authDisabled: boolean, opts: AuthOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (authDisabled) {
      next();
      return;
    }

    const header = req.headers.authorization;
    const match = /^Bearer (.+)$/i.exec(header ?? '');
    if (!match) {
      unauthorized(res, 'missing or malformed Authorization header');
      return;
    }

    try {
      const decoded = jwt.verify(match[1], opts.jwtSecret, { issuer: opts.issuer });
      if (typeof decoded === 'string' || decoded.type !== 'access') {
        unauthorized(res, 'token is not an access token');
        return;
      }
      req.principal = {
        sub: String(decoded.sub ?? ''),
        scope: Array.isArray(decoded.scope) ? (decoded.scope as string[]) : [],
      };
      next();
    } catch {
      // Signature/issuer/expiry failures all collapse to a generic 401 — never
      // leak which check failed.
      unauthorized(res, 'invalid or expired token');
    }
  };
}

function unauthorized(res: Response, detail: string): void {
  res
    .status(401)
    .set('WWW-Authenticate', `Bearer error="invalid_token", error_description="${detail}"`)
    .json({ error: 'invalid_token', error_description: detail });
}
