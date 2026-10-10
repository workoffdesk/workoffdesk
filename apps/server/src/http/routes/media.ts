import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppDeps } from '../app.js';
import { InvalidRequest } from '../../system/errors.js';
import { createReadStream } from 'node:fs';
import { appendPart, byteRange, finishPart, PART_MAX, partSize, videoCover, videoFile, type Playable } from '../../uploads/fileUpload.js';
import { readUpload, saveImage } from '../../uploads/media.js';
import type { RouteModule } from './context.js';

// Images and files sent from the phone, for Claude to read.
export const register: RouteModule = (app, ctx) => {
  if (ctx.deps.media) registerMediaRoutes(app, ctx.deps.media);
};

const UPLOAD_LIMIT = 30 * 1024 * 1024;

// Images arrive as the raw file, and what they are is judged from the bytes alone: the Content-Type is
// dropped unread, as phones send it missing, empty (React Native) or generic.
function registerMediaRoutes(app: FastifyInstance, media: NonNullable<AppDeps['media']>) {
  // An empty body is not parsed at all.
  const raw = (body: unknown) => (Buffer.isBuffer(body) ? body : Buffer.alloc(0));
  void app.register(async (upload) => {
    upload.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    upload.post(
      '/api/uploads',
      {
        bodyLimit: UPLOAD_LIMIT,
        onRequest: async (req) => {
          delete req.headers['content-type'];
        },
      },
      async (req, reply) => reply.code(201).send({ path: await saveImage(media.uploadsDir, raw(req.body)) }),
    );
    // A part of a file, appended where the Mac's copy ends; `upload-offset` says where the phone thinks that is.
    upload.put<{ Params: { id: string } }>(
      '/api/uploads/parts/:id',
      {
        bodyLimit: PART_MAX,
        onRequest: async (req) => {
          delete req.headers['content-type'];
        },
      },
      async (req) => {
        const at = Number(req.headers['upload-offset']);
        if (!Number.isSafeInteger(at) || at < 0) throw new InvalidRequest('upload-offset is not a byte count');
        return { size: await appendPart(media.uploadsDir, req.params.id, at, raw(req.body)) };
      },
    );
  });

  // How much of a file the Mac has, to go on from.
  app.get<{ Params: { id: string } }>('/api/uploads/parts/:id', async (req) => ({ size: await partSize(media.uploadsDir, req.params.id) }));

  // The file is whole: where it is kept, and stills of it when it is a video.
  app.post<{ Params: { id: string }; Body: { name?: unknown; size?: unknown } }>('/api/uploads/parts/:id/done', async (req, reply) => {
    const { name, size } = req.body ?? {};
    if (typeof name !== 'string' || typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) throw new InvalidRequest('name and size are needed');
    return reply.code(201).send(await finishPart(media.uploadsDir, req.params.id, name, size));
  });

  // A video's first still, shown for it.
  app.get<{ Params: { folder: string } }>('/api/uploads/:folder/cover', async (req, reply) => {
    const cover = await videoCover(media.uploadsDir, req.params.folder);
    if (!cover) return reply.code(404).send({ error: 'no cover' });
    return reply.header('content-type', 'image/jpeg').header('cache-control', 'private, max-age=31536000, immutable').send(cover);
  });

  // A video sent from the phone, played on the phone in the ranges its player asks for.
  app.get<{ Params: { folder: string } }>('/api/uploads/:folder/video', async (req, reply) => {
    const video = await videoFile(media.uploadsDir, req.params.folder);
    return video ? sendVideo(video, req.headers.range, reply) : reply.code(404).send({ error: 'no such file' });
  });

  // Names are unique, so the phone keeps what it has seen.
  app.get<{ Params: { name: string } }>('/api/uploads/:name', async (req, reply) => {
    const image = await readUpload(media.uploadsDir, req.params.name);
    if (!image) return reply.code(404).send({ error: 'no such image' });
    return reply
      .header('content-type', image.type)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(image.bytes);
  });
}

function sendVideo(video: Playable, rangeHeader: string | undefined, reply: FastifyReply) {
  const range = byteRange(rangeHeader, video.size);
  if (range === 'unsatisfiable') return reply.code(416).header('content-range', `bytes */${video.size}`).send();
  const { start, end } = range ?? { start: 0, end: video.size - 1 };
  if (range) reply.code(206).header('content-range', `bytes ${start}-${end}/${video.size}`);
  return reply
    .header('content-type', video.type)
    .header('accept-ranges', 'bytes')
    .header('content-length', String(end - start + 1))
    .header('cache-control', 'private, no-store')
    .send(video.size ? createReadStream(video.file, { start, end }) : '');
}
