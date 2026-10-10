import { randomBytes } from 'node:crypto';
import { findTranscript } from '../../agents/claude/transcript/transcriptFile.js';
import { listCommands } from '../../agents/claude/offers/commands.js';
import { listFiles } from '../../agents/claude/offers/files.js';
import { listModels } from '../../agents/claude/offers/models.js';
import { readMentionedImage } from '../../uploads/media.js';
import type { RouteModule } from './context.js';

const MESSAGE_ID = /^[A-Za-z0-9_-]{8,64}$/;
// A command, and what it is given, if anything (`/effort high`, `/model opus[1m]`).
const COMMAND = /^\/[a-z][\w:-]{0,40}( [\w.:[\]-]{1,40})?$/;
// Enough for a slider pushed from one end to the other, or a page of scrolling.
const KEYS_MAX = 200;

// What the chat of a session shows: the conversation, its images, what is on screen and the answers to it.
export const register: RouteModule = (app, ctx) => {
  const { deps, machineOr404 } = ctx;
  // The message as the journal now has it, for the page to apply like any row.
  const message = (session: string, qid: string) => deps.machine.message(session, qid);

  app.get<{ Params: { machine: string; id: string } }>('/api/m/:machine/sessions/:id/choices', async (req, reply) => {
    const m = machineOr404(req, reply);
    if (!m) return reply;
    if (!(await m.exists(req.params.id))) return reply.code(404).send({ error: 'no such session' });
    return m.onScreen(req.params.id);
  });

  app.get<{ Params: { machine: string; id: string } }>('/api/m/:machine/sessions/:id/screen', async (req, reply) => {
    const m = machineOr404(req, reply);
    if (!m) return reply;
    if (!(await m.exists(req.params.id))) return reply.code(404).send({ error: 'no such session' });
    return { text: await m.screenText(req.params.id) };
  });

  // What can follow a `/` in the session, as Claude Code lists it; a shell takes none.
  app.get<{ Params: { machine: string; id: string } }>('/api/m/:machine/sessions/:id/commands', async (req, reply) => {
    const m = machineOr404(req, reply);
    if (!m) return reply;
    const s = (await m.listSessions()).find((x) => x.id === req.params.id);
    if (!s) return reply.code(404).send({ error: 'no such session' });
    if (s.kind !== 'claude' || !deps.claudeDir) return { commands: [] };
    return { commands: await listCommands({ claudeDir: deps.claudeDir, cwd: s.cwd, claudeBin: deps.claudeBin }) };
  });

  // The models /model takes in the session, as Claude Code lists them for its folder; a shell takes none.
  app.get<{ Params: { machine: string; id: string } }>('/api/m/:machine/sessions/:id/models', async (req, reply) => {
    const m = machineOr404(req, reply);
    if (!m) return reply;
    const s = (await m.listSessions()).find((x) => x.id === req.params.id);
    if (!s) return reply.code(404).send({ error: 'no such session' });
    if (s.kind !== 'claude' || !deps.claudeBin || !s.cwd) return { models: [] };
    return { models: await listModels(deps.claudeBin, s.cwd) };
  });

  // The files of the session's folder an `@` can name.
  app.get<{ Params: { machine: string; id: string } }>('/api/m/:machine/sessions/:id/files', async (req, reply) => {
    const m = machineOr404(req, reply);
    if (!m) return reply;
    const s = (await m.listSessions()).find((x) => x.id === req.params.id);
    if (!s) return reply.code(404).send({ error: 'no such session' });
    return { files: s.cwd ? await listFiles(s.cwd) : [] };
  });

  // What the composer sends Claude: typed in now, or held, in order, while Claude cannot take it.
  app.post<{ Params: { machine: string; id: string }; Body: { text?: unknown; id?: unknown } }>('/api/m/:machine/sessions/:id/messages', async (req, reply) => {
    const m = machineOr404(req, reply);
    if (!m) return reply;
    const text = req.body?.text;
    if (typeof text !== 'string' || !text) return reply.code(400).send({ error: 'text required' });
    // The page names each message, so one sent again after its answer was lost is taken once.
    const given = req.body?.id;
    if (given !== undefined && (typeof given !== 'string' || !MESSAGE_ID.test(given))) return reply.code(400).send({ error: 'bad message id' });
    if (!(await m.exists(req.params.id))) return reply.code(404).send({ error: 'no such session' });
    const qid = given ?? randomBytes(8).toString('hex');
    return { queued: await m.sendMessage(req.params.id, text, qid), message: message(req.params.id, qid) };
  });

  // A slash command typed at Claude's prompt, as a key on the page would; nothing is typed while a dialog
  // has the keyboard, where its Enter would take whatever the dialog has selected.
  app.post<{ Params: { machine: string; id: string }; Body: { command?: unknown } }>('/api/m/:machine/sessions/:id/command', async (req, reply) => {
    const m = machineOr404(req, reply);
    if (!m) return reply;
    const command = req.body?.command;
    if (typeof command !== 'string' || !COMMAND.test(command)) return reply.code(400).send({ error: 'bad command' });
    if (!(await m.exists(req.params.id))) return reply.code(404).send({ error: 'no such session' });
    const { ran, screen } = await m.runCommand(req.params.id, command);
    return screen ? { ran, screen } : { ran };
  });

  // Keys pressed in a dialog on screen, sent as a request rather than on the session's line, which a slow
  // phone line can hold for seconds while it looks open; the answer brings the screen after them.
  app.post<{ Params: { machine: string; id: string }; Body: { keys?: unknown } }>('/api/m/:machine/sessions/:id/keys', async (req, reply) => {
    const m = machineOr404(req, reply);
    if (!m) return reply;
    const keys = req.body?.keys;
    if (typeof keys !== 'string' || !keys || keys.length > KEYS_MAX) return reply.code(400).send({ error: 'bad keys' });
    if (!(await m.exists(req.params.id))) return reply.code(404).send({ error: 'no such session' });
    return { screen: await m.press(req.params.id, keys) };
  });

  // Closes the dialog on screen, and only it: what the ✕ under a dialog does.
  app.post<{ Params: { machine: string; id: string } }>('/api/m/:machine/sessions/:id/close', async (req, reply) => {
    const m = machineOr404(req, reply);
    if (!m) return reply;
    if (!(await m.exists(req.params.id))) return reply.code(404).send({ error: 'no such session' });
    return { screen: await m.close(req.params.id) };
  });

  // Takes back a held message; its text comes back, to put in the composer again.
  app.delete<{ Params: { machine: string; id: string; qid: string } }>('/api/m/:machine/sessions/:id/messages/:qid', async (req, reply) => {
    const m = machineOr404(req, reply);
    if (!m) return reply;
    const text = m.unsend(req.params.id, req.params.qid);
    if (text === null) return reply.code(404).send({ error: 'already sent' });
    return { text, message: message(req.params.id, req.params.qid) };
  });

  // A waiting message goes now, out of its turn, or moves a place earlier or later.
  app.post<{ Params: { machine: string; id: string; qid: string }; Body: { move?: unknown } }>(
    '/api/m/:machine/sessions/:id/messages/:qid',
    async (req, reply) => {
      const m = machineOr404(req, reply);
      if (!m) return reply;
      const move = req.body?.move;
      if (move !== undefined && move !== -1 && move !== 1) return reply.code(400).send({ error: 'bad move' });
      const done = move === undefined ? await m.sendNow(req.params.id, req.params.qid) : m.moveQueued(req.params.id, req.params.qid, move);
      if (!done) return reply.code(404).send({ error: 'already sent' });
      return { message: message(req.params.id, req.params.qid) };
    },
  );

  // Answers the choice on screen: `index` and `label` take one option, with `text` typed into it when it
  // is a field for an answer of one's own; `ticked` and `labels` send a question that takes several with
  // those ticked. Options are named as well as numbered, so a tap on options that have since changed
  // presses nothing.
  app.post<{
    Params: { machine: string; id: string };
    Body: { index?: unknown; label?: unknown; text?: unknown; ticked?: unknown; labels?: unknown };
  }>(
    '/api/m/:machine/sessions/:id/choices',
    async (req, reply) => {
      const m = machineOr404(req, reply);
      if (!m) return reply;
      const { index, label, text, ticked, labels } = req.body ?? {};
      const several = ticked !== undefined || labels !== undefined;
      const isIndex = (i: unknown) => Number.isSafeInteger(i) && (i as number) >= 0;
      if (several) {
        if (!Array.isArray(ticked) || !ticked.every(isIndex) || !Array.isArray(labels) || !labels.every((l) => typeof l === 'string')) {
          return reply.code(400).send({ error: 'ticked and labels required' });
        }
      } else if (!isIndex(index) || typeof label !== 'string') {
        return reply.code(400).send({ error: 'index and label required' });
      } else if (text !== undefined && (typeof text !== 'string' || !text.trim())) {
        return reply.code(400).send({ error: 'bad text' });
      }
      if (!(await m.exists(req.params.id))) return reply.code(404).send({ error: 'no such session' });
      const pressed = several
        ? await m.tick(req.params.id, ticked as number[], labels as string[])
        : await m.choose(req.params.id, index as number, label as string, text as string | undefined);
      if (!pressed) return reply.code(409).send({ error: 'the options have changed' });
      return reply.code(204).send();
    },
  );

  // Answers what the session waits on the person for (OnScreen.asks); 409 when it is over, answered at the
  // Mac or passed by, so an answer goes to the ask it was given for or nowhere.
  app.post<{ Params: { machine: string; id: string; askId: string }; Body: { allow?: unknown; always?: unknown } }>(
    '/api/m/:machine/sessions/:id/asks/:askId',
    async (req, reply) => {
      const m = machineOr404(req, reply);
      if (!m) return reply;
      const { allow, always } = req.body ?? {};
      if (typeof allow !== 'boolean') return reply.code(400).send({ error: 'allow required' });
      if (always !== undefined && (always !== true || !allow)) return reply.code(400).send({ error: 'bad always' });
      if (!(await m.exists(req.params.id))) return reply.code(404).send({ error: 'no such session' });
      const answered = m.answer(req.params.id, req.params.askId, allow ? { allow, ...(always && { always }) } : { allow });
      if (!answered) return reply.code(409).send({ error: 'already answered' });
      return reply.code(204).send();
    },
  );

  // An image Claude named in the session, for the chat to show. Paths the transcript does not name are refused.
  app.get<{ Params: { machine: string; id: string }; Querystring: { path?: string } }>(
    '/api/m/:machine/sessions/:id/image',
    async (req, reply) => {
      const m = machineOr404(req, reply);
      if (!m) return reply;
      if (typeof req.query.path !== 'string') return reply.code(400).send({ error: 'no path' });
      const meta = m.sessionMeta(req.params.id);
      if (!meta || !(await m.exists(req.params.id))) return reply.code(404).send({ error: 'no such session' });
      const transcript = meta.claudeSessionId && deps.claudeProjectsRoot ? await findTranscript(deps.claudeProjectsRoot, meta.claudeSessionId) : null;
      if (!transcript) return reply.code(404).send({ error: 'no transcript' });
      const image = await readMentionedImage(transcript, req.query.path);
      if (image === 'refused') return reply.code(403).send({ error: 'not an image this session named' });
      if (image === 'gone') return reply.code(404).send({ error: 'image gone' });
      return reply
        .header('content-type', image.type)
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'private, max-age=300')
        .send(image.bytes);
    },
  );
};
