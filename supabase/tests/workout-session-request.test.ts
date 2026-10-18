import { parseStartSessionRequest } from '../functions/_shared/workout/session';

const ID = '3f2b8c1e-1111-4222-8333-444455556666';
const PLAN = '9a2b8c1e-1111-4222-8333-444455556666';
const good = { requestId: ID, planId: PLAN, dayNumber: 18, templateId: 'home-basics', templateVersion: 1 };

describe('parseStartSessionRequest', () => {
  it('accepts the five fields', () => {
    expect(parseStartSessionRequest(good)).toEqual({ ok: true, ...good });
  });

  it.each([
    ['no request id', { ...good, requestId: undefined }],
    ['a request id that is not a UUID', { ...good, requestId: 'abc' }],
    ['a plan id that is not a UUID', { ...good, planId: '1' }],
    ['day 0', { ...good, dayNumber: 0 }],
    ['day 121', { ...good, dayNumber: 121 }],
    ['a fractional day', { ...good, dayNumber: 3.5 }],
    ['a day sent as text', { ...good, dayNumber: '18' }],
    ['a template id with capitals or spaces', { ...good, templateId: 'Home Basics' }],
    ['an empty template id', { ...good, templateId: '' }],
    ['a template version of 0', { ...good, templateVersion: 0 }],
    ['a template version as text', { ...good, templateVersion: '1' }],
    ['no body', null],
    ['a list', []],
  ])('rejects %s', (_label, body) => {
    expect(parseStartSessionRequest(body)).toEqual({ ok: false });
  });

  it('reads nothing else: a user id or a snapshot in the body is ignored', () => {
    const result = parseStartSessionRequest({ ...good, userId: 'other', snapshot: { exercises: [] }, exercises: ['x'] });

    expect(result).toEqual({ ok: true, ...good });
  });
});
