import { describe, expect, it } from 'vitest';
import { Conflict, DomainError, errorReply, InvalidRequest, NotFound, UnsupportedMedia } from '../../../src/system/errors';

describe('errorReply', () => {
  it.each([
    [new InvalidRequest('bad id'), 400, 'bad id'],
    [new NotFound('no such session'), 404, 'no such session'],
    [new Conflict('the options have changed'), 409, 'the options have changed'],
    [new UnsupportedMedia('not an image'), 415, 'not an image'],
  ])('answers %o with its own status and words', (e, status, error) => {
    expect(errorReply(e)).toEqual({ status, body: { error } });
    expect(e).toBeInstanceOf(DomainError);
  });

  it('names by its code one the phone says in its own language', () => {
    expect(errorReply(new Conflict('a dialog is open', 'dialog-open'))).toEqual({ status: 409, body: { error: 'a dialog is open', code: 'dialog-open' } });
  });

  it.each([[new Error('ENOENT /Users/x/secret')], [new TypeError('x is undefined')], ['a string'], [undefined]])(
    'answers anything else with a 500 that says nothing about it: %o',
    (e) => {
      expect(errorReply(e)).toEqual({ status: 500, body: { error: 'server error' } });
    },
  );
});
