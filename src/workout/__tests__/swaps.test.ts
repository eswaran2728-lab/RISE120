import type { CatalogueInput, Equipment, ExerciseVersion } from '../catalogue';
import { eligibleSwaps } from '../swaps';

const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
const reviewer = { name: 'A. Coach', role: 'Certified strength coach', reviewedOn: '2026-10-10' };
const media = { kind: 'video' as const, source: 'Rise120 Studio', licence: 'Owned by Rise120' };
const ex = (id: string, over: Partial<ExerciseVersion> = {}): ExerciseVersion => ({
  id, version: 1, pattern: 'squat', equipment: 'none', name: L(id), cues: [L('one'), L('two')], regressions: [], alternatives: [], media, reviewer, status: 'published', ...over,
});
const squat = ex('squat', { equipment: 'gym', alternatives: ['goblet', 'chair', 'barbell', 'draft', 'lunge-push', 'missing'] });
const catalogue = (): CatalogueInput => ({
  exercises: [
    squat,
    ex('goblet', { equipment: 'home' }),
    ex('chair', { equipment: 'none' }),
    ex('barbell', { equipment: 'gym' }),
    ex('draft', { status: 'draft', reviewer: null }),
    ex('lunge-push', { pattern: 'push' }),
  ],
  sessions: [],
});
const swapsFor = (location: 'home' | 'gym', equipment: Equipment, exclude: string[] = []) => eligibleSwaps(squat, { location, equipment }, catalogue(), exclude).map((e) => e.id);

describe('eligibleSwaps', () => {
  it('offers the reviewed alternatives that can be done with the equipment at hand, in the listed order', () => {
    expect(swapsFor('home', 'home')).toEqual(['goblet', 'chair']);
  });

  it('offers only bodyweight alternatives to someone with no equipment', () => {
    expect(swapsFor('home', 'none')).toEqual(['chair']);
  });

  it('offers every reviewed alternative at a gym', () => {
    expect(swapsFor('gym', 'none')).toEqual(['goblet', 'chair', 'barbell']);
  });

  it('never offers a draft, an unknown id, or an exercise of a different movement', () => {
    const all = swapsFor('gym', 'gym');

    expect(all).not.toContain('draft');
    expect(all).not.toContain('missing');
    expect(all).not.toContain('lunge-push');
  });

  it('leaves out exercises already in the session', () => {
    expect(swapsFor('gym', 'gym', ['chair'])).toEqual(['goblet', 'barbell']);
  });

  it('never offers the exercise itself', () => {
    const selfListed = { ...squat, alternatives: ['squat', 'chair'] };
    const c = catalogue();
    c.exercises[0] = selfListed;

    expect(eligibleSwaps(selfListed, { location: 'home', equipment: 'none' }, c, []).map((e) => e.id)).toEqual(['chair']);
  });

  it('gives an empty list, not an error, when there is no suitable swap', () => {
    expect(swapsFor('home', 'none', ['chair'])).toEqual([]);
    expect(eligibleSwaps(ex('lonely'), { location: 'gym', equipment: 'gym' }, { exercises: [ex('lonely')], sessions: [] }, [])).toEqual([]);
  });

  it('gives nothing when the exercise itself is not published', () => {
    const unpublished = ex('squat', { status: 'in_review', alternatives: ['chair'] });

    expect(eligibleSwaps(unpublished, { location: 'gym', equipment: 'gym' }, { exercises: [unpublished, ex('chair')], sessions: [] }, [])).toEqual([]);
  });
});
