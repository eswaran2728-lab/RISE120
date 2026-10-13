// Maps raw auth errors (Supabase, network) to translation keys so users never see raw English.
const RULES: [RegExp, string][] = [
  [/invalid login credentials/i, 'auth.errors.invalidCredentials'],
  [/already registered|already exists/i, 'auth.errors.userExists'],
  [/password should be|weak password/i, 'auth.errors.weakPassword'],
  [/email not confirmed/i, 'auth.errors.emailNotConfirmed'],
  [/network|fetch|offline/i, 'errors.offline'],
];

export function authErrorKey(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return RULES.find(([pattern]) => pattern.test(message))?.[1] ?? 'errors.generic';
}
