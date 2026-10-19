import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { ExerciseDemo } from '../ExerciseDemo';
import { SwapSheet } from '../SwapSheet';
import { t } from '../../i18n';

const L = (en: string, ms: string, ta: string) => ({ en, ms, ta });
const exercise = (media: unknown) => ({
  name: L('Goblet squat', 'Skuat goblet', 'கோப்லெட் ஸ்குவாட்'),
  cues: [L('Chest up', 'Dada tegak', 'மார்பை உயர்த்து'), L('Knees out', 'Lutut keluar', 'முழங்கால் வெளியே')],
  media: media as never,
});
const video = { kind: 'video', source: 'Rise120 Studio', licence: 'Owned by Rise120', url: 'https://example.com/squat.mp4' };

const textsOf = (tree: ReactTestRenderer): string[] => {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') out.push(node);
    else if (node && typeof node === 'object') ((node as { children?: unknown[] | null }).children ?? []).forEach(walk);
  };
  walk(tree.toJSON());
  return out;
};
const shows = (tree: ReactTestRenderer, text: string) => textsOf(tree).some((s) => s.includes(text));
const byId = (tree: ReactTestRenderer, id: string) => tree.root.findAll((n) => n.props.testID === id && typeof n.type !== 'string' && typeof n.props.onPress === 'function').pop();
const render = async (element: React.ReactElement) => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  return tree;
};
const press = (tree: ReactTestRenderer, id: string) =>
  act(async () => {
    await byId(tree, id)!.props.onPress();
  });

describe('ExerciseDemo', () => {
  it('always shows the text cues, in the chosen language', async () => {
    const tree = await render(<ExerciseDemo exercise={exercise(null)} language="ms" openUrl={jest.fn()} />);

    expect(shows(tree, 'Dada tegak')).toBe(true);
    expect(shows(tree, 'Lutut keluar')).toBe(true);
    expect(shows(tree, 'Skuat goblet')).toBe(true);
    expect(shows(tree, 'Chest up')).toBe(false);
  });

  it('shows the cues in Tamil and falls back to English for an unknown language', async () => {
    expect(shows(await render(<ExerciseDemo exercise={exercise(null)} language="ta" openUrl={jest.fn()} />), 'மார்பை உயர்த்து')).toBe(true);
    expect(shows(await render(<ExerciseDemo exercise={exercise(null)} language={'fr' as never} openUrl={jest.fn()} />), 'Chest up')).toBe(true);
  });

  it('says there is no video, and keeps the cues, when the exercise has none', async () => {
    const tree = await render(<ExerciseDemo exercise={exercise(null)} language="en" openUrl={jest.fn()} />);

    expect(shows(tree, t('exercise.noVideo'))).toBe(true);
    expect(byId(tree, 'exercise-video-open')).toBeUndefined();
    expect(shows(tree, 'Chest up')).toBe(true);
  });

  it('also treats media without a link as no video', async () => {
    const tree = await render(<ExerciseDemo exercise={exercise({ ...video, url: undefined })} language="en" openUrl={jest.fn()} />);

    expect(byId(tree, 'exercise-video-open')).toBeUndefined();
    expect(shows(tree, t('exercise.noVideo'))).toBe(true);
  });

  it('never loads the video by itself: nothing is opened until the person asks', async () => {
    const openUrl = jest.fn().mockResolvedValue(undefined);
    const tree = await render(<ExerciseDemo exercise={exercise(video)} language="en" openUrl={openUrl} />);

    expect(openUrl).not.toHaveBeenCalled();
    expect(byId(tree, 'exercise-video-open')).toBeDefined();
    expect(shows(tree, 'Rise120 Studio')).toBe(true); // the credit is shown with it

    await press(tree, 'exercise-video-open');
    expect(openUrl).toHaveBeenCalledWith('https://example.com/squat.mp4');
  });

  it('keeps the cues and explains when the video cannot be opened (offline or blocked)', async () => {
    const openUrl = jest.fn().mockRejectedValue(new Error('Network request failed'));
    const tree = await render(<ExerciseDemo exercise={exercise(video)} language="en" openUrl={openUrl} />);

    await press(tree, 'exercise-video-open');

    expect(shows(tree, t('exercise.videoUnavailable'))).toBe(true);
    expect(shows(tree, 'Chest up')).toBe(true);
  });

  it('only opens links that are https', async () => {
    const openUrl = jest.fn();
    const tree = await render(<ExerciseDemo exercise={exercise({ ...video, url: 'javascript:alert(1)' })} language="en" openUrl={openUrl} />);

    expect(byId(tree, 'exercise-video-open')).toBeUndefined();
    expect(openUrl).not.toHaveBeenCalled();
  });
});

describe('SwapSheet', () => {
  const options = [
    { id: 'chair', name: L('Chair squat', 'Skuat kerusi', 'நாற்காலி ஸ்குவாட்'), equipment: 'none' },
    { id: 'box', name: L('Box squat', 'Skuat kotak', 'பெட்டி ஸ்குவாட்'), equipment: 'home' },
  ];
  const props = (over: Record<string, unknown> = {}) => ({
    currentName: L('Goblet squat', 'Skuat goblet', 'கோப்லெட் ஸ்குவாட்'),
    options,
    doneSets: 2,
    remainingSets: 1,
    language: 'en' as const,
    onConfirm: jest.fn().mockResolvedValue(undefined),
    ...over,
  });

  it('lists the reviewed swaps and says nothing will change until one is chosen', async () => {
    const p = props();
    const tree = await render(<SwapSheet {...p} />);

    expect(byId(tree, 'swap-option-chair')).toBeDefined();
    expect(byId(tree, 'swap-option-box')).toBeDefined();
    expect(byId(tree, 'swap-confirm')).toBeUndefined();
    expect(p.onConfirm).not.toHaveBeenCalled();
  });

  it('reviews the change first: completed sets stay, only the remaining sets move', async () => {
    const tree = await render(<SwapSheet {...props()} />);

    await press(tree, 'swap-option-chair');

    expect(shows(tree, t('exercise.swapReview', { done: 2, remaining: 1, name: 'Chair squat' }))).toBe(true);
    expect(byId(tree, 'swap-confirm')).toBeDefined();
  });

  it('confirms the chosen replacement once, even if the button is tapped twice', async () => {
    let release!: () => void;
    const onConfirm = jest.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const tree = await render(<SwapSheet {...props({ onConfirm })} />);
    await press(tree, 'swap-option-box');

    await act(async () => {
      void byId(tree, 'swap-confirm')!.props.onPress();
      void byId(tree, 'swap-confirm')!.props.onPress();
    });
    await act(async () => release());

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('box');
  });

  it('lets the person back out of the review without swapping', async () => {
    const p = props();
    const tree = await render(<SwapSheet {...p} />);
    await press(tree, 'swap-option-chair');

    await press(tree, 'swap-cancel');

    expect(byId(tree, 'swap-confirm')).toBeUndefined();
    expect(p.onConfirm).not.toHaveBeenCalled();
  });

  it('says there is no suitable swap and offers nothing to press when the list is empty', async () => {
    const tree = await render(<SwapSheet {...props({ options: [] })} />);

    expect(shows(tree, t('exercise.noSwap'))).toBe(true);
    expect(tree.root.findAll((n) => typeof n.props.testID === 'string' && n.props.testID.startsWith('swap-option-'))).toEqual([]);
  });

  it('says nothing is left to swap when every set is done', async () => {
    const tree = await render(<SwapSheet {...props({ remainingSets: 0 })} />);

    expect(shows(tree, t('exercise.nothingLeft'))).toBe(true);
    expect(byId(tree, 'swap-option-chair')).toBeUndefined();
  });

  it('shows a message from the screen, for example a stale session', async () => {
    const tree = await render(<SwapSheet {...props({ message: 'The workout changed. Check it and try again.' })} />);

    expect(shows(tree, 'The workout changed. Check it and try again.')).toBe(true);
  });

  it('shows names in the chosen language', async () => {
    const tree = await render(<SwapSheet {...props({ language: 'ms' })} />);

    expect(shows(tree, 'Skuat kerusi')).toBe(true);
    expect(shows(tree, 'Chair squat')).toBe(false);
  });
});
