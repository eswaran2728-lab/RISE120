import fs from 'fs';
import path from 'path';
import React from 'react';
import { Text } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import i18next, { t } from '../../i18n';
import { tokens } from '../../theme/tokens';
import { ActionButton } from '../ActionButton';
import { AsyncState } from '../AsyncState';
import { ScreenFrame } from '../ScreenFrame';
import { SectionCard } from '../SectionCard';
import { SyncNotice } from '../SyncNotice';

jest.setTimeout(30000);

const render = async (element: React.ReactElement) => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  return tree;
};
const flat = (style: unknown): Record<string, any> => Object.assign({}, ...[style].flat(5).filter(Boolean));
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
const button = (tree: ReactTestRenderer) => tree.root.findAll((n) => n.props.accessibilityRole === 'button' && typeof n.type !== 'string')[0];
const press = async (node: { props: Record<string, any> }) => {
  await act(async () => {
    await node.props.onPress();
  });
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(async () => {
  await i18next.changeLanguage('en');
});

describe('ActionButton', () => {
  it('is a labelled button with a 48-point target, and its label wraps instead of being cut off', async () => {
    const tree = await render(<ActionButton label="A very long label that has to wrap onto several lines on a small phone" onPress={jest.fn()} />);

    const node = button(tree);
    expect(node.props.accessibilityLabel).toBe('A very long label that has to wrap onto several lines on a small phone');
    expect(flat(node.props.style).minHeight).toBeGreaterThanOrEqual(tokens.minTap);
    expect(flat(node.props.style).height).toBeUndefined();
    const label = tree.root.findAll((n) => (n.type as unknown) === 'Text')[0];
    expect(label.props.numberOfLines).toBeUndefined();
    expect(label.props.allowFontScaling).not.toBe(false);
  });

  it('calls onPress once for a press', async () => {
    const onPress = jest.fn();
    const tree = await render(<ActionButton label="Go" onPress={onPress} />);

    await press(button(tree));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('ignores presses while busy, tells assistive technology it is busy, and shows progress', async () => {
    const onPress = jest.fn();
    const tree = await render(<ActionButton label="Save" busy onPress={onPress} />);

    const node = button(tree);
    expect(node.props.accessibilityState).toEqual(expect.objectContaining({ busy: true, disabled: true }));
    await press(node);
    expect(onPress).not.toHaveBeenCalled();
    expect(tree.root.findAll((n) => n.props.accessibilityRole === 'progressbar' || (n.type as unknown) === 'ActivityIndicator').length).toBeGreaterThan(0);
    expect(shows(tree, 'Save')).toBe(true); // the label stays: busy is not a different button
  });

  it('ignores presses while disabled', async () => {
    const onPress = jest.fn();
    const tree = await render(<ActionButton label="Save" disabled onPress={onPress} />);

    await press(button(tree));

    expect(onPress).not.toHaveBeenCalled();
    expect(button(tree).props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  });

  it('blocks a second tap while an async action is still running, then allows the next one', async () => {
    const gate = deferred();
    const onPress = jest.fn(() => gate.promise);
    const tree = await render(<ActionButton label="Save" onPress={onPress} />);

    await act(async () => {
      void button(tree).props.onPress();
      void button(tree).props.onPress();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(button(tree).props.accessibilityState).toEqual(expect.objectContaining({ busy: true }));

    await act(async () => gate.resolve());
    await press(button(tree));
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('is usable again after an async action fails, and does not swallow the error', async () => {
    const failure = new Error('network');
    const onPress = jest.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const onError = jest.fn();
    const tree = await render(<ActionButton label="Save" onPress={onPress} onError={onError} />);

    await press(button(tree));
    expect(onError).toHaveBeenCalledWith(failure);
    expect(button(tree).props.accessibilityState).toEqual(expect.objectContaining({ busy: false }));
    await press(button(tree));
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('draws primary on gold with dark text, secondary outlined, link as plain gold text, danger in the danger colour', async () => {
    const primary = flat(button(await render(<ActionButton label="x" variant="primary" onPress={jest.fn()} />)).props.style);
    const secondary = flat(button(await render(<ActionButton label="x" variant="secondary" onPress={jest.fn()} />)).props.style);
    const link = flat(button(await render(<ActionButton label="x" variant="link" onPress={jest.fn()} />)).props.style);
    const danger = flat(button(await render(<ActionButton label="x" variant="danger" onPress={jest.fn()} />)).props.style);

    expect(primary.backgroundColor).toBe(tokens.color.accent);
    expect(secondary.borderColor).toBe(tokens.color.borderStrong);
    expect(secondary.backgroundColor).not.toBe(tokens.color.accent);
    expect(link.backgroundColor).toBeUndefined();
    expect(danger.borderColor).toBe(tokens.color.danger);
    for (const style of [primary, secondary, link, danger]) expect(style.minHeight).toBeGreaterThanOrEqual(tokens.minTap);
  });

  it('cannot be made without a visible label: there is no icon-only form', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'ActionButton.tsx'), 'utf8');

    expect(source).toMatch(/label: string/);
    expect(source).not.toMatch(/icon\??:/);
  });
});

describe('AsyncState', () => {
  it('announces loading with words and a spinner', async () => {
    const tree = await render(<AsyncState state={{ kind: 'loading' }} />);

    expect(shows(tree, t('states.loading'))).toBe(true);
    expect(tree.root.findAll((n) => n.props.accessibilityLiveRegion === 'polite').length).toBeGreaterThan(0);
  });

  it('shows the empty message', async () => {
    const tree = await render(<AsyncState state={{ kind: 'empty', message: 'Nothing logged yet.' }} />);

    expect(shows(tree, 'Nothing logged yet.')).toBe(true);
  });

  it('shows an error with a Try again button that retries only that action', async () => {
    const onRetry = jest.fn();
    const tree = await render(<AsyncState state={{ kind: 'error', message: 'Could not load.', onRetry }} />);

    expect(shows(tree, 'Could not load.')).toBe(true);
    expect(tree.root.findAll((n) => n.props.accessibilityRole === 'alert').length).toBeGreaterThan(0);
    expect(shows(tree, t('errors.retry'))).toBe(true);
    await press(button(tree));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows offline with the last sync time and saved data, and an optional retry', async () => {
    const onRetry = jest.fn();
    const tree = await render(<AsyncState state={{ kind: 'offline', lastSync: '14 Oct, 09:30', onRetry }} />);

    expect(shows(tree, t('states.offline'))).toBe(true);
    expect(shows(tree, '14 Oct, 09:30')).toBe(true);
    await press(button(tree));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('offers no retry button when there is nothing to retry', async () => {
    const tree = await render(<AsyncState state={{ kind: 'error', message: 'Gone.' }} />);

    expect(tree.root.findAll((n) => n.props.accessibilityRole === 'button' && typeof n.type !== 'string')).toHaveLength(0);
  });

  it.each(['ms', 'ta'])('is translated in %s', async (language) => {
    await i18next.changeLanguage(language);

    const tree = await render(<AsyncState state={{ kind: 'offline', lastSync: null }} />);

    expect(shows(tree, t('states.offline'))).toBe(true);
    expect(shows(tree, 'states.')).toBe(false);
    expect(t('states.offline')).not.toBe('You are offline. Showing what is saved on this phone.');
  });
});

describe('SyncNotice', () => {
  it('says nothing when everything is saved and online', async () => {
    const tree = await render(<SyncNotice pending={0} offline={false} />);

    expect(textsOf(tree)).toEqual([]);
  });

  it('shows how many changes wait to sync, as words', async () => {
    const tree = await render(<SyncNotice pending={3} offline={false} />);

    expect(shows(tree, t('states.pendingSync', { count: 3 }))).toBe(true);
    expect(shows(tree, '3')).toBe(true);
  });

  it('shows offline and the last sync time together with the waiting changes', async () => {
    const tree = await render(<SyncNotice pending={2} offline lastSync="14 Oct, 09:30" />);

    expect(shows(tree, t('states.offlineShort'))).toBe(true);
    expect(shows(tree, '14 Oct, 09:30')).toBe(true);
    expect(shows(tree, t('states.pendingSync', { count: 2 }))).toBe(true);
  });

  it('is announced politely to screen readers', async () => {
    const tree = await render(<SyncNotice pending={1} offline={false} />);

    expect(tree.root.findAll((n) => n.props.accessibilityLiveRegion === 'polite').length).toBeGreaterThan(0);
  });
});

describe('SectionCard and ScreenFrame', () => {
  it('SectionCard shows its title as a header and its children on the card surface', async () => {
    const tree = await render(
      <SectionCard title="Targets">
        <Text>inside</Text>
      </SectionCard>
    );

    expect(shows(tree, 'Targets')).toBe(true);
    expect(shows(tree, 'inside')).toBe(true);
    expect(tree.root.findAll((n) => n.props.accessibilityRole === 'header' && typeof n.type === 'string').length).toBe(1);
    const card = tree.root.findAll((n) => flat(n.props.style).backgroundColor === tokens.color.surface)[0];
    expect(flat(card.props.style).borderRadius).toBe(tokens.radius.card);
    expect(flat(card.props.style).padding).toBe(tokens.space[4]);
  });

  it('SectionCard accent tone uses the gold surface with dark text', async () => {
    const tree = await render(
      <SectionCard title="Your session" tone="accent">
        <Text>inside</Text>
      </SectionCard>
    );

    expect(tree.root.findAll((n) => flat(n.props.style).backgroundColor === tokens.color.accent).length).toBeGreaterThan(0);
    const title = tree.root.findAll((n) => (n.type as unknown) === 'Text' && n.children.includes('Your session'))[0];
    expect(flat(title.props.style).color).toBe(tokens.color.onAccent);
  });

  it('ScreenFrame scrolls, keeps taps working with the keyboard open, and has no fixed height', async () => {
    const tree = await render(
      <ScreenFrame>
        <Text>content</Text>
      </ScreenFrame>
    );

    const scroll = tree.root.findAll((n) => n.props.keyboardShouldPersistTaps === 'handled')[0];
    expect(scroll).toBeDefined();
    expect(flat(scroll.props.contentContainerStyle).padding).toBe(tokens.space[4]);
    expect(flat(scroll.props.contentContainerStyle).height).toBeUndefined();
    expect(tree.root.findAll((n) => (n.type as unknown) === 'KeyboardAvoidingView' || n.props.behavior !== undefined).length).toBeGreaterThan(0);
    expect(tree.root.findAll((n) => flat(n.props.style).backgroundColor === tokens.color.bg).length).toBeGreaterThan(0);
    expect(shows(tree, 'content')).toBe(true);
  });

  it('ScreenFrame can leave scrolling to a list the screen owns', async () => {
    const tree = await render(
      <ScreenFrame scroll={false}>
        <Text>list here</Text>
      </ScreenFrame>
    );

    expect(tree.root.findAll((n) => n.props.keyboardShouldPersistTaps === 'handled')).toHaveLength(0);
    expect(shows(tree, 'list here')).toBe(true);
  });
});

describe('theme discipline', () => {
  it.each(['ActionButton', 'AsyncState', 'SectionCard', 'SyncNotice', 'ScreenFrame'])('%s has no colour literals', (file) => {
    const source = fs.readFileSync(path.join(__dirname, '..', `${file}.tsx`), 'utf8');

    expect(source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  });
});
