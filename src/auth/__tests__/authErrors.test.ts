import { authErrorKey } from '../authErrors';

describe('authErrorKey', () => {
  it.each([
    ['Invalid login credentials', 'auth.errors.invalidCredentials'],
    ['User already registered', 'auth.errors.userExists'],
    ['Password should be at least 6 characters.', 'auth.errors.weakPassword'],
    ['Email not confirmed', 'auth.errors.emailNotConfirmed'],
    ['Network request failed', 'errors.offline'],
    ['Something unexpected', 'errors.generic'],
  ])('maps %j to %s', (message, key) => {
    expect(authErrorKey(new Error(message))).toBe(key);
  });

  it('falls back to the generic key for non-Error values', () => {
    expect(authErrorKey('boom')).toBe('errors.generic');
  });
});
