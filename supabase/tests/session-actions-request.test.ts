import { parseSessionActionRequest } from '../functions/_shared/workout/actions';

const SESSION = '3f2b8c1e-1111-4222-8333-444455556666';
const REQUEST = '4a2b8c1e-1111-4222-8333-444455556667';
const swap = { action: 'swap', requestId: REQUEST, sessionId: SESSION, expectedRevision: 2, fromExerciseId: 'goblet-squat', replacementId: 'box-squat' };

describe('parseSessionActionRequest', () => {
  it('accepts a swap and keeps exactly the fields it needs', () => {
    expect(parseSessionActionRequest({ ...swap, userId: 'someone-else', extra: 1 })).toEqual({
      ok: true,
      action: 'swap',
      requestId: REQUEST,
      sessionId: SESSION,
      expectedRevision: 2,
      fromExerciseId: 'goblet-squat',
      replacementId: 'box-squat',
    });
  });

  it('accepts completion with just the session', () => {
    expect(parseSessionActionRequest({ action: 'complete', sessionId: SESSION.toUpperCase() })).toEqual({ ok: true, action: 'complete', sessionId: SESSION });
  });

  it.each([
    ['not an object', 'swap'],
    ['an array', []],
    ['unknown action', { ...swap, action: 'delete' }],
    ['bad session id', { ...swap, sessionId: 'x' }],
    ['bad request id', { ...swap, requestId: 'x' }],
    ['negative revision', { ...swap, expectedRevision: -1 }],
    ['fractional revision', { ...swap, expectedRevision: 1.5 }],
    ['string revision', { ...swap, expectedRevision: '1' }],
    ['missing from', { ...swap, fromExerciseId: undefined }],
    ['bad from id', { ...swap, fromExerciseId: 'Bad Id' }],
    ['bad replacement id', { ...swap, replacementId: '../x' }],
    ['same exercise', { ...swap, replacementId: 'goblet-squat' }],
  ])('rejects %s', (_name, body) => {
    expect(parseSessionActionRequest(body)).toEqual({ ok: false });
  });
});
