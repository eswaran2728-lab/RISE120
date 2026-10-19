import { runRecipeValidation } from '../../../scripts/recipes/validate';

const L = (t: string) => ({ en: t, ms: `${t} ms`, ta: `${t} ta` });
const draft = (over: Record<string, unknown> = {}) => ({
  id: 'fixture', version: 1, userId: null, status: 'draft', verified: false, region: 'MY', name: L('Fixture'), aliases: {}, servings: 2,
  ingredients: [{ ref: { source: 'fixture', sourceId: 'rice' }, name: 'rice', amount: 100, unit: 'g', tags: [] }],
  preparation: [L('Cook.')], prepMinutes: 5, cookMinutes: 5, cooking: ['stovetop'], dietLabels: [], freeFrom: [], nutrition: null, price: null, reviewer: null, ...over,
});
const file = (name: string, value: unknown) => ({ path: `content/recipes/${name}.json`, text: typeof value === 'string' ? value : JSON.stringify(value) });

describe('runRecipeValidation', () => {
  it('reports nothing published as an open launch gate, not a failure', () => {
    const result = runRecipeValidation([]);

    expect(result.exitCode).toBe(0);
    expect(result.lines.join('\n')).toMatch(/nothing is published/i);
  });

  it('accepts a valid draft and counts it as unpublished', () => {
    const result = runRecipeValidation([file('fixture', draft())]);

    expect(result.exitCode).toBe(0);
    expect(result.lines.join('\n')).toContain('recipes: 1 (published 0, in review 0, draft 1, private 0)');
    expect(result.lines.join('\n')).toContain('offered to members: 0');
  });

  it('names a file that is not valid JSON or not a recipe, without printing its text', () => {
    const result = runRecipeValidation([file('broken', '{ nope SECRET-TEXT'), file('odd', { id: 'x' })]);

    expect(result.exitCode).toBe(1);
    const text = result.lines.join('\n');
    expect(text).toContain('content/recipes/broken.json: not valid JSON');
    expect(text).toContain('content/recipes/odd.json: not the expected shape');
    expect(text).not.toContain('SECRET-TEXT');
  });

  it('fails on a rule problem such as an unsupported diet claim', () => {
    const result = runRecipeValidation([file('claim', draft({ dietLabels: ['vegetarian'], ingredients: [{ ref: { source: 'fixture', sourceId: 'chicken' }, name: 'chicken', amount: 100, unit: 'g', tags: ['meat'] }] }))]);

    expect(result.exitCode).toBe(1);
    expect(result.lines.join('\n')).toContain('diet_label_unsupported: fixture');
  });

  it('fails on a duplicate import of the same recipe version', () => {
    const result = runRecipeValidation([file('one', draft()), file('two', draft())]);

    expect(result.exitCode).toBe(1);
    expect(result.lines.join('\n')).toContain('duplicate_recipe: fixture');
  });

  it('refuses private recipes in the content folder: shared content is never owned by a member', () => {
    const result = runRecipeValidation([file('mine', draft({ userId: 'u1', status: 'private' }))]);

    expect(result.exitCode).toBe(1);
    expect(result.lines.join('\n')).toContain('content/recipes/mine.json: content recipes must be shared');
  });
});
