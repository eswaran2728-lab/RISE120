import { stableUuid } from '../stableId';
import { setLogId } from '../../workout/log';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

describe('stableUuid', () => {
  it('gives the same uuid for the same seed and a different one for another', () => {
    expect(stableUuid('a|b')).toBe(stableUuid('a|b'));
    expect(stableUuid('a|b')).not.toBe(stableUuid('a|c'));
  });

  it('looks like a version 4 uuid, so the server accepts it as an id', () => {
    expect(stableUuid('seed')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('is the id workout sets already use, so existing set ids do not change', () => {
    expect(setLogId('u1', '2026-10-13', 'ex-1', 1)).toBe(stableUuid('u1|2026-10-13|ex-1|1'));
  });
});
