import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { Server } from 'socket.io';
import { APP_NAME, RATE_LIMIT } from '../shared/constants.js';
import { isGitHubConfigured } from './github.js';
import { RateLimiter } from './rateLimit.js';
import { registerSocketHandlers } from './sockets.js';
import { RoomStore } from './state.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');
const publicDir = path.join(projectRoot, 'public');

const app = express();
const store = new RoomStore();
const httpLimiter = new RateLimiter(RATE_LIMIT.httpWindowMs, RATE_LIMIT.httpMaxRequests);

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.use((req: Request, res: Response, next: NextFunction) => {
  const key = req.ip ?? 'unknown';
  if (!httpLimiter.take(key)) {
    res.status(429).json({ error: 'Too many requests. Try again shortly.' });
    return;
  }
  next();
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    app: APP_NAME,
    uptimeSeconds: Math.round(process.uptime()),
    rooms: store.size,
    githubConfigured: isGitHubConfigured(),
    time: new Date().toISOString(),
  });
});

app.use(
  express.static(publicDir, {
    extensions: ['html'],
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  }),
);

// Room codes are handled entirely client-side, so any unknown path shows the app.
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[http] unhandled error:', error.message);
  res.status(500).json({ error: 'Something went wrong on the factory floor.' });
});

const server = http.createServer(app);
const io = new Server(server, {
  serveClient: true,
  pingTimeout: 25_000,
  pingInterval: 10_000,
  maxHttpBufferSize: 200_000,
  cors: { origin: false },
});

const stopSockets = registerSocketHandlers(io, { store });

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
server.listen(port, () => {
  console.log(`${APP_NAME} is running on port ${port}`);
  console.log(
    isGitHubConfigured()
      ? 'GitHub saving: configured.'
      : 'GitHub saving: not configured (the Download JSON fallback still works).',
  );
});

function shutdown(signal: string): void {
  console.log(`Received ${signal}, shutting the factory down.`);
  stopSockets();
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
