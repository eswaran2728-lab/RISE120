import { ScenarioRejected, parseScenarios, toContext } from '../scenarios';
import { RAW_FIXTURE_SCENARIOS } from '../fixtures';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const first = () => clone(RAW_FIXTURE_SCENARIOS[0]) as Record<string, any>;

function problemsOf(raw: unknown) {
  try {
    parseScenarios(raw);
  } catch (error) {
    if (error instanceof ScenarioRejected) return error.problems;
    throw error;
  }
  return [];
}

describe('scenario file', () => {
  it('accepts the fictional fixture set: ten scenarios, at least three in each of English, Malay and Tamil', () => {
    const scenarios = parseScenarios(RAW_FIXTURE_SCENARIOS);

    const perLanguage = (code: string) => scenarios.filter((s) => s.language === code).length;
    expect(scenarios).toHaveLength(10);
    for (const code of ['en', 'ms', 'ta']) expect(perLanguage(code)).toBeGreaterThanOrEqual(3);
  });

  it('turns a scenario into the same context shape the coach gets', () => {
    const context = toContext(parseScenarios(RAW_FIXTURE_SCENARIOS)[0]);

    expect(context.language).toBe('en');
    expect(context.planDays.length).toBeGreaterThan(0);
    expect(context.exercises.length).toBeGreaterThan(0);
  });

  it('rejects a scenario without consent, and one that is not marked deidentified', () => {
    const noConsent = first();
    delete noConsent.consent;
    const falseConsent = first();
    falseConsent.consent = false;
    const notDeidentified = first();
    notDeidentified.deidentified = false;

    expect(problemsOf([noConsent]).map((p) => p.code)).toContain('no_consent');
    expect(problemsOf([falseConsent]).map((p) => p.code)).toContain('no_consent');
    expect(problemsOf([notDeidentified]).map((p) => p.code)).toContain('not_deidentified');
  });

  it.each(['userId', 'user_id', 'email', 'fullName', 'phone', 'address', 'dob', 'planId'])('rejects an identifying field: %s', (key) => {
    const scenario = first();
    scenario.context.profile[key] = 'x';

    expect(problemsOf([scenario]).map((p) => p.code)).toContain('identifying_field');
  });

  it.each(['photo', 'image', 'photoUrl', 'selfie', 'avatar'])('rejects a photo field: %s', (key) => {
    const scenario = first();
    scenario[key] = 'x';

    expect(problemsOf([scenario]).map((p) => p.code)).toContain('photo');
  });

  it('rejects an unknown field anywhere instead of passing it to a provider', () => {
    const scenario = first();
    scenario.context.checkins[0].notes = 'free text';

    expect(problemsOf([scenario]).map((p) => p.code)).toContain('unknown_field');
  });

  it.each([
    ['an email address', 'write to jane.doe@example.com about this'],
    ['a phone number', 'call me on +60 12-345 6789'],
    ['a link', 'see https://example.com/me'],
    ['an embedded image', 'data:image/png;base64,AAAA'],
    ['an image file name', 'my progress IMG_2031.jpg'],
    ['a UUID account id', 'my id is 3f2b8c1e-1111-4222-8333-444455556666'],
  ])('rejects %s typed into the message', (_label, message) => {
    const scenario = first();
    scenario.message = message;

    expect(problemsOf([scenario]).map((p) => p.code)).toContain('contact_detail');
  });

  it('rejects a duplicate id, an unsupported language and an empty file', () => {
    const a = first();
    const b = first();
    const odd = first();
    odd.id = 'odd';
    odd.language = 'fr';

    expect(problemsOf([a, b]).map((p) => p.code)).toContain('duplicate_id');
    expect(problemsOf([odd]).map((p) => p.code)).toContain('bad_language');
    expect(problemsOf([]).map((p) => p.code)).toContain('empty');
    expect(problemsOf({ not: 'a list' }).map((p) => p.code)).toContain('bad_shape');
  });

  it('never repeats the rejected value in the error, so private data cannot reach logs', () => {
    const scenario = first();
    scenario.message = 'call me on +60 12-345 6789 or mail jane.doe@example.com';
    scenario.context.profile.email = 'jane.doe@example.com';

    let text = '';
    try {
      parseScenarios([scenario]);
    } catch (error) {
      text = `${(error as Error).message} ${JSON.stringify((error as ScenarioRejected).problems)}`;
    }

    expect(text).not.toBe('');
    expect(text).not.toContain('jane.doe');
    expect(text).not.toContain('345 6789');
  });

  it('rejects the whole file when one scenario is bad, rather than quietly skipping it', () => {
    const bad = first();
    bad.id = 'bad';
    bad.consent = false;

    expect(() => parseScenarios([...clone(RAW_FIXTURE_SCENARIOS), bad])).toThrow(ScenarioRejected);
  });
});
