import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyReply } from 'fastify';
import type { RouteModule } from './context.js';

// The phone app itself: its files, and index.html for any page it routes to. Registered last, so it
// answers only what no other route does.
export const register: RouteModule = async (app, ctx) => {
  const webDir = ctx.deps.webDir;
  const hasWeb = !!webDir && existsSync(join(webDir, 'index.html'));
  await app.register(async (scope) => {
    scope.addHook('onRoute', (route) => {
      route.config = { ...(route.config as object), public: true };
    });
    // The build names what it puts in assets/ after its content, so a name never stands for another file.
    const built = join(webDir ?? '', 'assets') + sep;
    const setHeaders = (reply: FastifyReply, path: string) => {
      if (path.startsWith(built)) reply.header('cache-control', 'public, max-age=31536000, immutable');
    };
    if (hasWeb) await scope.register(fastifyStatic, { root: webDir!, index: false, wildcard: false, setHeaders });
    scope.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || !hasWeb || req.method !== 'GET') {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.type('text/html; charset=utf-8').header('cache-control', 'no-cache').sendFile('index.html', { cacheControl: false });
    });
  });
};
