// What can go wrong in a way the caller should hear about, with the HTTP status it is answered with.
// Anything else is the server's own fault: answered 500 with no detail, and logged in full.
// code: for the ones the phone shows, which it says in the phone's own language.
export class DomainError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export class InvalidRequest extends DomainError {
  constructor(message: string, code?: string) {
    super(400, message, code);
  }
}

export class NotFound extends DomainError {
  constructor(message: string, code?: string) {
    super(404, message, code);
  }
}

export class Conflict extends DomainError {
  constructor(message: string, code?: string) {
    super(409, message, code);
  }
}

export class UnsupportedMedia extends DomainError {
  constructor(message: string, code?: string) {
    super(415, message, code);
  }
}

export function errorReply(e: unknown): { status: number; body: { error: string; code?: string } } {
  if (!(e instanceof DomainError)) return { status: 500, body: { error: 'server error' } };
  return { status: e.status, body: e.code ? { error: e.message, code: e.code } : { error: e.message } };
}
