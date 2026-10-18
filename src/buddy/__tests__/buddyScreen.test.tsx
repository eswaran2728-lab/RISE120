import React from 'react';
import { Share } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import BuddyScreen from '../../../app/buddy';
import i18next, { t } from '../../i18n';
import * as api from '../api';
import type { BuddyGroup, MemberDays } from '../types';

jest.setTimeout(30000);

let mockUserId: string | null = 'A';
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return { useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]), useRouter: () => ({ back: jest.fn(), push: jest.fn() }) };
});
jest.mock('../../auth/useSession', () => ({ useSession: () => ({ session: mockUserId ? { user: { id: mockUserId } } : null }) }));
jest.mock('../../lib/useLocalDate', () => ({ useLocalDate: () => '2026-10-18' }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn(), functions: { invoke: jest.fn() } } }));
jest.mock('../api', () => ({ ...jest.requireActual('../api'), listGroups: jest.fn(), groupSummary: jest.fn(), createGroup: jest.fn(), createInvite: jest.fn(), acceptInvite: jest.fn(), leaveGroup: jest.fn(), removeMember: jest.fn(), blockMember: jest.fn() }));

const mocked = api as unknown as Record<string, jest.Mock>;

const GROUP = '3f2b8c1e-1111-4222-8333-444455556666';
const ME = '11111111-1111-4111-8111-111111111111';
const SAM = '22222222-2222-4222-8222-222222222222';
const group = (over: Partial<BuddyGroup> = {}): BuddyGroup => ({
  id: GROUP,
  name: 'Morning crew',
  me: { memberId: ME, role: 'owner' },
  members: [
    { memberId: ME, displayName: 'Alex', role: 'owner' },
    { memberId: SAM, displayName: 'Sam', role: 'member' },
  ],
  ...over,
});
const days = (): MemberDays[] => [
  { memberId: ME, displayName: 'Alex', days: ['2026-10-13', '2026-10-13', '2026-10-15'] },
  { memberId: SAM, displayName: 'Sam', days: ['2026-10-13', '2026-10-14', '2026-10-17'] },
];

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
const byId = (tree: ReactTestRenderer, id: string) => tree.root.findAll((n) => n.props.testID === id && typeof n.type !== 'string' && (typeof n.props.onPress === 'function' || typeof n.props.onChangeText === 'function' || typeof n.props.onValueChange === 'function')).pop();
const press = async (tree: ReactTestRenderer, id: string) => {
  await act(async () => {
    await byId(tree, id)!.props.onPress();
  });
};
const type = async (tree: ReactTestRenderer, id: string, text: string) => {
  await act(async () => {
    byId(tree, id)!.props.onChangeText(text);
  });
};
const toggle = async (tree: ReactTestRenderer, id: string, value: boolean) => {
  await act(async () => {
    byId(tree, id)!.props.onValueChange(value);
  });
};
async function mount() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<BuddyScreen />);
  });
  return tree;
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockUserId = 'A';
  await i18next.changeLanguage('en');
  mocked.listGroups.mockResolvedValue([group()]);
  mocked.groupSummary.mockResolvedValue({ kind: 'ok', members: days() });
  mocked.createGroup.mockResolvedValue({ kind: 'ok', groupId: GROUP });
  mocked.createInvite.mockResolvedValue({ kind: 'ok', token: 'A'.repeat(43), inviteId: 'inv1', expiresAt: '2026-10-21T10:00:00Z' });
  mocked.acceptInvite.mockResolvedValue({ kind: 'ok', groupId: GROUP });
  mocked.leaveGroup.mockResolvedValue({ kind: 'ok' });
  mocked.removeMember.mockResolvedValue({ kind: 'ok' });
  mocked.blockMember.mockResolvedValue({ kind: 'ok' });
  jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
});

describe('the groups', () => {
  it('shows each group with its members and the days they logged a workout in the last 7 days', async () => {
    const tree = await mount();

    expect(shows(tree, 'Morning crew')).toBe(true);
    expect(shows(tree, t('buddy.daysOf', { name: 'Alex', count: 2 }))).toBe(true);
    expect(shows(tree, t('buddy.daysOf', { name: 'Sam', count: 3 }))).toBe(true);
    expect(mocked.groupSummary).toHaveBeenCalledWith(GROUP, '2026-10-12', '2026-10-18');
  });

  it('says what a group can see, in plain words, before anything is shared', async () => {
    const tree = await mount();

    expect(shows(tree, t('buddy.disclosure'))).toBe(true);
  });

  it('shows a retry when the groups cannot be read', async () => {
    mocked.listGroups.mockResolvedValue(null);
    const tree = await mount();

    expect(shows(tree, t('buddy.loadError'))).toBe(true);
    mocked.listGroups.mockResolvedValue([group()]);
    await act(async () => {
      await tree.root.findAll((n) => typeof n.props.onPress === 'function' && n.findAll((m) => (m.type as unknown) === 'Text' && m.children.includes(t('errors.retry'))).length > 0).pop()!.props.onPress();
    });
    expect(shows(tree, 'Morning crew')).toBe(true);
  });

  it('shows a group whose days could not be read, with its members, instead of hiding it', async () => {
    mocked.groupSummary.mockResolvedValue({ kind: 'offline' });
    const tree = await mount();

    expect(shows(tree, 'Morning crew')).toBe(true);
    expect(shows(tree, t('buddy.daysUnavailable'))).toBe(true);
  });

  it('tells a member with no groups how to start or join one', async () => {
    mocked.listGroups.mockResolvedValue([]);
    const tree = await mount();

    expect(shows(tree, t('buddy.noGroups'))).toBe(true);
  });
});

describe('starting a group', () => {
  it('does nothing until the disclosure is accepted and both names are filled in', async () => {
    const tree = await mount();
    await type(tree, 'buddy-create-name', 'Crew');
    await type(tree, 'buddy-create-display', 'Alex');

    await press(tree, 'buddy-create-submit');

    expect(mocked.createGroup).not.toHaveBeenCalled();
    expect(shows(tree, t('buddy.needDisclosure'))).toBe(true);
  });

  it('creates the group with the accepted disclosure and shows it', async () => {
    const tree = await mount();
    await type(tree, 'buddy-create-name', 'Crew');
    await type(tree, 'buddy-create-display', 'Alex');
    await toggle(tree, 'buddy-create-disclosure', true);

    await press(tree, 'buddy-create-submit');

    expect(mocked.createGroup).toHaveBeenCalledWith({ name: 'Crew', displayName: 'Alex', disclosureAccepted: true });
    expect(mocked.listGroups).toHaveBeenCalledTimes(2);
  });

  it('sends one request however many times the button is pressed', async () => {
    let finish!: (v: unknown) => void;
    mocked.createGroup.mockReturnValue(new Promise((r) => (finish = r)));
    const tree = await mount();
    await type(tree, 'buddy-create-name', 'Crew');
    await type(tree, 'buddy-create-display', 'Alex');
    await toggle(tree, 'buddy-create-disclosure', true);

    await act(async () => {
      void byId(tree, 'buddy-create-submit')!.props.onPress();
      void byId(tree, 'buddy-create-submit')!.props.onPress();
    });
    await act(async () => finish({ kind: 'ok', groupId: GROUP }));

    expect(mocked.createGroup).toHaveBeenCalledTimes(1);
  });

  it('says so when the account is already in as many groups as allowed', async () => {
    mocked.createGroup.mockResolvedValue({ kind: 'limit_reached' });
    const tree = await mount();
    await type(tree, 'buddy-create-name', 'Crew');
    await type(tree, 'buddy-create-display', 'Alex');
    await toggle(tree, 'buddy-create-disclosure', true);

    await press(tree, 'buddy-create-submit');

    expect(shows(tree, t('buddy.limitReached'))).toBe(true);
  });
});

describe('joining with an invitation', () => {
  const fill = async (tree: ReactTestRenderer) => {
    await type(tree, 'buddy-join-token', ` ${'B'.repeat(43)} `);
    await type(tree, 'buddy-join-display', 'Sam');
    await toggle(tree, 'buddy-join-disclosure', true);
  };

  it('needs the accepted disclosure', async () => {
    const tree = await mount();
    await type(tree, 'buddy-join-token', 'B'.repeat(43));
    await type(tree, 'buddy-join-display', 'Sam');

    await press(tree, 'buddy-join-submit');

    expect(mocked.acceptInvite).not.toHaveBeenCalled();
  });

  it('sends the pasted token without its spaces, then refreshes the groups', async () => {
    const tree = await mount();
    await fill(tree);

    await press(tree, 'buddy-join-submit');

    expect(mocked.acceptInvite).toHaveBeenCalledWith({ token: 'B'.repeat(43), displayName: 'Sam', disclosureAccepted: true });
    expect(mocked.listGroups).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['invite_unavailable', 'buddy.inviteUnavailable'],
    ['group_full', 'buddy.groupFull'],
    ['already_member', 'buddy.alreadyMember'],
    ['limit_reached', 'buddy.limitReached'],
    ['offline', 'buddy.offline'],
    ['error', 'buddy.error'],
  ])('explains a %s answer in words and keeps what was typed', async (kind, key) => {
    mocked.acceptInvite.mockResolvedValue({ kind });
    const tree = await mount();
    await fill(tree);

    await press(tree, 'buddy-join-submit');

    expect(shows(tree, t(key))).toBe(true);
    expect(byId(tree, 'buddy-join-display')!.props.value).toBe('Sam');
  });
});

describe('inviting', () => {
  it('lets only the owner create an invitation', async () => {
    mocked.listGroups.mockResolvedValue([group({ me: { memberId: SAM, role: 'member' } })]);
    const tree = await mount();

    expect(byId(tree, `buddy-invite-${GROUP}`)).toBeUndefined();
  });

  it('shows the invitation once with when it expires, and offers to share it', async () => {
    const tree = await mount();

    await press(tree, `buddy-invite-${GROUP}`);

    expect(mocked.createInvite).toHaveBeenCalledWith(GROUP);
    expect(shows(tree, 'A'.repeat(43))).toBe(true);
    expect(shows(tree, t('buddy.inviteOnce'))).toBe(true);
    await press(tree, `buddy-share-${GROUP}`);
    expect(Share.share).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((Share.share as jest.Mock).mock.calls[0][0])).toContain('A'.repeat(43));
  });
});

describe('leaving and blocking', () => {
  it('asks to confirm before leaving, then leaves', async () => {
    const tree = await mount();

    await press(tree, `buddy-leave-${GROUP}`);
    expect(mocked.leaveGroup).not.toHaveBeenCalled();
    await press(tree, `buddy-leave-confirm-${GROUP}`);

    expect(mocked.leaveGroup).toHaveBeenCalledWith(GROUP);
    expect(mocked.listGroups).toHaveBeenCalledTimes(2);
  });

  it('asks to confirm before blocking another member, and never offers to block yourself', async () => {
    const tree = await mount();

    expect(byId(tree, `buddy-block-${ME}`)).toBeUndefined();
    await press(tree, `buddy-block-${SAM}`);
    expect(mocked.blockMember).not.toHaveBeenCalled();
    await press(tree, `buddy-block-confirm-${SAM}`);

    expect(mocked.blockMember).toHaveBeenCalledWith(GROUP, SAM);
  });

  it('lets the owner remove a member, after confirming', async () => {
    const tree = await mount();

    await press(tree, `buddy-remove-${SAM}`);
    expect(mocked.removeMember).not.toHaveBeenCalled();
    await press(tree, `buddy-remove-confirm-${SAM}`);

    expect(mocked.removeMember).toHaveBeenCalledWith(GROUP, SAM);
  });

  it('does not offer a non-owner the remove button', async () => {
    mocked.listGroups.mockResolvedValue([group({ me: { memberId: SAM, role: 'member' } })]);
    const tree = await mount();

    expect(byId(tree, `buddy-remove-${ME}`)).toBeUndefined();
  });
});

describe('the optional ranking', () => {
  it('is off until asked for, and then ranks by days with a workout, with ties sharing a place', async () => {
    mocked.groupSummary.mockResolvedValue({
      kind: 'ok',
      members: [
        { memberId: ME, displayName: 'Alex', days: ['2026-10-13', '2026-10-14', '2026-10-15'] },
        { memberId: SAM, displayName: 'Sam', days: ['2026-10-13', '2026-10-14', '2026-10-15'] },
      ],
    });
    const tree = await mount();
    expect(shows(tree, t('buddy.rank', { rank: 1, name: 'Alex', count: 3 }))).toBe(false);

    await press(tree, 'buddy-ranking-toggle');

    expect(shows(tree, t('buddy.rank', { rank: 1, name: 'Alex', count: 3 }))).toBe(true);
    expect(shows(tree, t('buddy.rank', { rank: 1, name: 'Sam', count: 3 }))).toBe(true);
  });
});

describe('privacy and languages', () => {
  it('never shows an account id, only display names', async () => {
    const tree = await mount();

    expect(textsOf(tree).join(' ')).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it.each(['ms', 'ta'])('shows the screen in %s without a missing translation', async (language) => {
    await i18next.changeLanguage(language);
    const tree = await mount();

    expect(shows(tree, t('buddy.disclosure'))).toBe(true);
    expect(shows(tree, 'buddy.')).toBe(false);
  });
});
