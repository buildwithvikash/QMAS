import { randomUUID } from 'node:crypto';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { getEnv } from './config/env.js';
import { logger as defaultLogger } from './config/logger.js';
import { authenticate, requirePasswordCurrent } from './middlewares/auth.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import auditRoutes from './modules/audit/audit.routes.js';
import authRoutes from './modules/auth/auth.routes.js';
import formatsRoutes from './modules/formats/formats.routes.js';
import healthRoutes from './modules/health/health.routes.js';
import imirRoutes, { filesRouter } from './modules/imir/imir.routes.js';
import integrationRoutes from './modules/integration/integration.routes.js';
import mastersRoutes from './modules/masters/masters.routes.js';
import numberingRoutes from './modules/numbering/numbering.routes.js';
import rolesRoutes from './modules/roles/roles.routes.js';
import samplingRoutes from './modules/sampling/sampling.routes.js';
import { devicesRouter, syncRouter } from './modules/sync/sync.routes.js';
import usersRoutes from './modules/users/users.routes.js';

export function createApp({ logger = defaultLogger } = {}) {
  const env = getEnv();
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY); // behind ALB/CloudFront in AWS
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(helmet());
  if (env.corsOrigins.length) app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const api = Router();
  api.use(healthRoutes);
  api.use('/auth', authRoutes);

  // Everything below requires a signed-in user whose temporary password has been changed.
  api.use(authenticate, requirePasswordCurrent);
  api.use('/users', usersRoutes);
  api.use(rolesRoutes);
  api.use('/masters/sampling-plans', samplingRoutes);
  api.use('/masters/number-series', numberingRoutes);
  api.use('/masters', mastersRoutes);
  api.use('/formats', formatsRoutes);
  api.use('/imirs', imirRoutes);
  api.use('/files', filesRouter);
  api.use('/devices', devicesRouter);
  api.use('/sync', syncRouter);
  api.use('/integration', integrationRoutes);
  api.use('/audit', auditRoutes);

  app.use('/api/v1', api);
  app.use('/api', notFoundHandler);

  // Single-container option (as in WRL Tool Report): serve the built web app from the API.
  if (env.SERVE_WEB_DIST) {
    const dist = path.resolve(env.SERVE_WEB_DIST);
    // Hashed assets can be cached; the service worker, manifest and index.html must always be fresh
    // so tablets pick up a new release.
    const noCache = /(sw\.js|registerSW\.js|manifest\.webmanifest|index\.html)$/;
    app.use(express.static(dist, { index: false, maxAge: '1h', setHeaders: (res, file) => noCache.test(file) && res.setHeader('Cache-Control', 'no-cache') }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
