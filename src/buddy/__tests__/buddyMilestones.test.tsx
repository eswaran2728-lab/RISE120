import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import BuddyScreen from '../../../app/buddy';
import i18next, { t } from '../../i18n';
import * as api from '../api';
import type { BuddyGroup, GroupShare, MemberDays } from '../types';

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
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  listGroups: jest.fn(), groupSummary: jest.fn(), createGroup: jest.fn(), createInvite: jest.fn(), acceptInvite: jest.fn(), leaveGroup: jest.fn(), removeMember: jest.fn(), blockMember: jest.fn(),
  getMilestones: jest.fn(), shareMilestone: jest.fn(), withdrawShare: jest.fn(), groupShares: jest.fn(), reportsOpen: jest.fn(), submitReport: jest.fn(),
}));

const mocked = api as unknown as Record<string, jest.Mock>;

const GROUP = '3f2b8c1e-1111-4222-8333-444455556666';
const ME = '11111111-1111-4111-8111-111111111111';
const SAM = '22222222-2222-4222-8222-222222222222';
const group = (): BuddyGroup => ({
  id: GROUP,
  name: 'Morning crew',
  me: { memberId: ME, role: 'owner' },
  members: [
    { memberId: ME, displayName: 'Alex', role: 'owner' },
    { memberId: SAM, displayName: 'Sam', role: 'member' },
  ],
});
const days = (): MemberDays[] => [
  { memberId: ME, displayName: 'Alex', days: ['2026-10-13'] },
  { memberId: SAM, displayName: 'Sam', days: ['2026-10-13', '2026-10-14'] },
];
const share = (over: Partial<GroupShare> = {}): GroupShare => ({ memberId: SAM, displayName: 'Sam', milestone: 7, sharedAt: '2026-10-17T00:00:00Z', mine: false, ...over });

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
const has = (tree: ReactTestRenderer, id: string) => tree.root.findAll((n) => n.props.testID === id).length > 0;
const byId = (tree: ReactTestRenderer, id: string) => tree.root.findAll((n) => n.props.testID === id && typeof n.type !== 'string' && (typeof n.props.onPress === 'function' || typeof n.props.onChangeText === 'function')).pop();
const press = async (tree: ReactTestRenderer, id: string) => {
  await act(async () => {
    await byId(tree, id)!.props.onPress();
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
  ['listGroups', 'groupSummary', 'createGroup', 'createInvite', 'acceptInvite', 'leaveGroup', 'removeMember', 'blockMember', 'getMilestones', 'shareMilestone', 'withdrawShare', 'groupShares', 'reportsOpen', 'submitReport'].forEach((name) => mocked[name].mockReset());
  mockUserId = 'A';
  await i18next.changeLanguage('en');
  mocked.listGroups.mockResolvedValue([group()]);
  mocked.groupSummary.mockResolvedValue({ kind: 'ok', members: days() });
  mocked.getMilestones.mockResolvedValue({ kind: 'ok', days: 9, milestones: [{ milestone: 7, sharedIn: [] }] });
  mocked.groupShares.mockResolvedValue({ kind: 'ok', shares: [] });
  mocked.shareMilestone.mockResolvedValue({ kind: 'ok' });
  mocked.withdrawShare.mockResolvedValue({ kind: 'ok' });
  mocked.reportsOpen.mockResolvedValue(false);
  mocked.submitReport.mockResolvedValue({ kind: 'ok', reportId: 'rep-1', receivedAt: '2026-10-18T10:00:00Z' });
  mocked.blockMember.mockResolvedValue({ kind: 'ok' });
});

describe('ranking by participation', () => {
  it('explains how ties are shown, so an equal rank and the order within it make sense', async () => {
    mocked.groupSummary.mockResolvedValue({ kind: 'ok', members: [{ memberId: ME, displayName: 'Alex', days: ['2026-10-13'] }, { memberId: SAM, displayName: 'sam', days: ['2026-10-14'] }] });
    const tree = await mount();

    await press(tree, 'buddy-ranking-toggle');

    expect(shows(tree, t('buddy.rank', { rank: 1, name: 'Alex', count: 1 }))).toBe(true);
    expect(shows(tree, t('buddy.rank', { rank: 1, name: 'sam', count: 1 }))).toBe(true);
    expect(shows(tree, t('buddy.rankingTies'))).toBe(true);
  });
});

describe('sharing a milestone', () => {
  it('shows an earned milestone as something to preview, and shares nothing until it is confirmed', async () => {
    const tree = await mount();

    expect(has(tree, `buddy-milestone-preview-${GROUP}-7`)).toBe(true);
    expect(mocked.shareMilestone).not.toHaveBeenCalled();
    await press(tree, `buddy-milestone-preview-${GROUP}-7`);

    expect(shows(tree, t('buddy.previewSays', { group: 'Morning crew', name: 'Alex', count: 7 }))).toBe(true);
    expect(shows(tree, t('buddy.previewOnly'))).toBe(true); // nothing else is shared: no weight, photos, meals, coach messages or logs
    expect(mocked.shareMilestone).not.toHaveBeenCalled();
  });

  it('shares only after the member confirms the preview, with a request id', async () => {
    const tree = await mount();
    await press(tree, `buddy-milestone-preview-${GROUP}-7`);

    await press(tree, `buddy-milestone-confirm-${GROUP}-7`);

    expect(mocked.shareMilestone).toHaveBeenCalledTimes(1);
    expect(mocked.shareMilestone).toHaveBeenCalledWith({ groupId: GROUP, milestone: 7, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(shows(tree, t('buddy.shared'))).toBe(true);
  });

  it('shares nothing when the member cancels the preview', async () => {
    const tree = await mount();
    await press(tree, `buddy-milestone-preview-${GROUP}-7`);

    await press(tree, `buddy-milestone-cancel-${GROUP}-7`);

    expect(mocked.shareMilestone).not.toHaveBeenCalled();
    expect(has(tree, `buddy-milestone-confirm-${GROUP}-7`)).toBe(false);
  });

  it('shares once however many times confirm is tapped', async () => {
    let release!: (value: unknown) => void;
    mocked.shareMilestone.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const tree = await mount();
    await press(tree, `buddy-milestone-preview-${GROUP}-7`);

    await act(async () => {
      void byId(tree, `buddy-milestone-confirm-${GROUP}-7`)!.props.onPress();
      void byId(tree, `buddy-milestone-confirm-${GROUP}-7`)!.props.onPress();
    });
    await act(async () => release({ kind: 'ok' }));

    expect(mocked.shareMilestone).toHaveBeenCalledTimes(1);
  });

  it('keeps the same request id when a share is retried after a lost answer', async () => {
    mocked.shareMilestone.mockResolvedValueOnce({ kind: 'offline' });
    mocked.shareMilestone.mockResolvedValueOnce({ kind: 'ok' });
    const tree = await mount();
    await press(tree, `buddy-milestone-preview-${GROUP}-7`);

    await press(tree, `buddy-milestone-confirm-${GROUP}-7`);
    expect(shows(tree, t('buddy.offline'))).toBe(true);
    await press(tree, `buddy-milestone-confirm-${GROUP}-7`);

    const [first, second] = mocked.shareMilestone.mock.calls.map((c) => c[0]);
    expect(second.requestId).toBe(first.requestId);
  });

  it('says plainly when the server will not share it (not earned), and when the share was already withdrawn', async () => {
    mocked.shareMilestone.mockResolvedValueOnce({ kind: 'milestone_not_earned' });
    mocked.shareMilestone.mockResolvedValueOnce({ kind: 'share_withdrawn' });
    const tree = await mount();
    await press(tree, `buddy-milestone-preview-${GROUP}-7`);

    await press(tree, `buddy-milestone-confirm-${GROUP}-7`);
    expect(shows(tree, t('buddy.milestoneNotEarned'))).toBe(true);
    await press(tree, `buddy-milestone-confirm-${GROUP}-7`);
    expect(shows(tree, t('buddy.shareWithdrawn'))).toBe(true);
  });

  it('shows the group\'s shared milestones as a name and a number, and lets the member withdraw their own', async () => {
    mocked.groupShares.mockResolvedValue({ kind: 'ok', shares: [share(), share({ memberId: ME, displayName: 'Alex', milestone: 7, mine: true })] });
    mocked.getMilestones.mockResolvedValue({ kind: 'ok', days: 9, milestones: [{ milestone: 7, sharedIn: [GROUP] }] });
    const tree = await mount();

    expect(shows(tree, t('buddy.milestoneLine', { name: 'Sam', count: 7 }))).toBe(true);
    expect(has(tree, `buddy-milestone-preview-${GROUP}-7`)).toBe(false); // already shared here
    expect(has(tree, `buddy-withdraw-${GROUP}-7`)).toBe(true);
    expect(has(tree, `buddy-withdraw-${GROUP}-7`) && tree.root.findAll((n) => n.props.testID === `buddy-withdraw-${SAM}`).length === 0).toBe(true);
  });

  it('withdraws at once and then shows the milestone as something that can be previewed again', async () => {
    mocked.groupShares.mockResolvedValueOnce({ kind: 'ok', shares: [share({ memberId: ME, displayName: 'Alex', mine: true })] });
    mocked.getMilestones.mockResolvedValueOnce({ kind: 'ok', days: 9, milestones: [{ milestone: 7, sharedIn: [GROUP] }] });
    const tree = await mount();

    await press(tree, `buddy-withdraw-${GROUP}-7`);

    expect(mocked.withdrawShare).toHaveBeenCalledWith(GROUP, 7);
    expect(has(tree, `buddy-withdraw-${GROUP}-7`)).toBe(false);
    expect(has(tree, `buddy-milestone-preview-${GROUP}-7`)).toBe(true);
  });

  it('keeps the group usable, with the milestone section explained, when milestones cannot be read', async () => {
    mocked.getMilestones.mockResolvedValue({ kind: 'offline' });
    const tree = await mount();

    expect(shows(tree, 'Morning crew')).toBe(true);
    expect(shows(tree, t('buddy.milestonesUnavailable'))).toBe(true);
  });

  it('says a member with no milestone yet has none, and never offers to share one', async () => {
    mocked.getMilestones.mockResolvedValue({ kind: 'ok', days: 2, milestones: [] });
    const tree = await mount();

    expect(shows(tree, t('buddy.noMilestones'))).toBe(true);
    expect(has(tree, `buddy-milestone-preview-${GROUP}-7`)).toBe(false);
  });

  it('shows nothing private: no weight, photo, meal, coach or log text anywhere on the milestone section', async () => {
    mocked.groupShares.mockResolvedValue({ kind: 'ok', shares: [share()] });
    const tree = await mount();
    await press(tree, `buddy-milestone-preview-${GROUP}-7`);

    const text = textsOf(tree).join(' ');
    expect(text).not.toMatch(/\bkg\b|calorie|photo of|coach said/i);
    expect(text).toContain(t('buddy.previewOnly'));
  });
});

describe('account switches and a late answer', () => {
  it('does not show one account\'s milestones, shares or reporting state to the next account', async () => {
    let releaseA!: (value: unknown) => void;
    mocked.getMilestones.mockReturnValueOnce(new Promise((resolve) => (releaseA = resolve)));
    mocked.getMilestones.mockResolvedValue({ kind: 'ok', days: 0, milestones: [] }); // account B has none
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<BuddyScreen />);
    });

    mockUserId = 'B';
    await act(async () => {
      tree.update(<BuddyScreen />);
    });
    await act(async () => releaseA({ kind: 'ok', days: 9, milestones: [{ milestone: 7, sharedIn: [] }] }));

    expect(has(tree, `buddy-milestone-preview-${GROUP}-7`)).toBe(false);
    expect(shows(tree, t('buddy.noMilestones'))).toBe(true);
  });

  it('ignores the answer to a share started by an account that has since signed out', async () => {
    let release!: (value: unknown) => void;
    mocked.shareMilestone.mockReturnValue(new Promise((resolve) => (release = resolve)));
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<BuddyScreen />);
    });
    await press(tree, `buddy-milestone-preview-${GROUP}-7`);
    await act(async () => {
      void byId(tree, `buddy-milestone-confirm-${GROUP}-7`)!.props.onPress();
    });

    mockUserId = 'B';
    await act(async () => {
      tree.update(<BuddyScreen />);
    });
    mocked.groupShares.mockClear();
    await act(async () => release({ kind: 'ok' }));

    expect(shows(tree, t('buddy.shared'))).toBe(false);
    expect(mocked.groupShares).not.toHaveBeenCalledWith(GROUP, 'A');
  });
});

describe('reporting', () => {
  it('does not claim reporting works when it is not open: it explains, offers block and leave, and sends nothing', async () => {
    mocked.reportsOpen.mockResolvedValue(false);
    const tree = await mount();

    await press(tree, `buddy-report-${SAM}`);

    expect(shows(tree, t('buddy.reportClosed'))).toBe(true);
    expect(has(tree, `buddy-report-send-${SAM}`)).toBe(false);
    expect(mocked.submitReport).not.toHaveBeenCalled();
    expect(has(tree, `buddy-block-${SAM}`)).toBe(true);
    expect(has(tree, `buddy-leave-${GROUP}`)).toBe(true);
  });

  it('lets a member choose a reason, add an optional note, and send, then shows the acknowledgement', async () => {
    mocked.reportsOpen.mockResolvedValue(true);
    const tree = await mount();
    await press(tree, `buddy-report-${SAM}`);

    await press(tree, `buddy-report-reason-${SAM}-harassment`);
    await act(async () => {
      byId(tree, `buddy-report-note-${SAM}`)!.props.onChangeText('  Please look  ');
    });
    await press(tree, `buddy-report-send-${SAM}`);

    expect(mocked.submitReport).toHaveBeenCalledWith({ groupId: GROUP, memberId: SAM, reason: 'harassment', note: 'Please look', requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(shows(tree, t('buddy.reportReceived', { reference: 'rep-1' }))).toBe(true);
  });

  it('needs a reason before anything is sent', async () => {
    mocked.reportsOpen.mockResolvedValue(true);
    const tree = await mount();
    await press(tree, `buddy-report-${SAM}`);

    await press(tree, `buddy-report-send-${SAM}`);

    expect(mocked.submitReport).not.toHaveBeenCalled();
    expect(shows(tree, t('buddy.reportNeedReason'))).toBe(true);
  });

  it('sends once however many times send is tapped, and keeps the request id for a retry', async () => {
    mocked.reportsOpen.mockResolvedValue(true);
    mocked.submitReport.mockResolvedValueOnce({ kind: 'offline' });
    mocked.submitReport.mockResolvedValueOnce({ kind: 'ok', reportId: 'rep-1', receivedAt: '2026-10-18T10:00:00Z' });
    const tree = await mount();
    await press(tree, `buddy-report-${SAM}`);
    await press(tree, `buddy-report-reason-${SAM}-spam`);

    await press(tree, `buddy-report-send-${SAM}`);
    expect(shows(tree, t('buddy.offline'))).toBe(true);
    await press(tree, `buddy-report-send-${SAM}`);

    const [first, second] = mocked.submitReport.mock.calls.map((c) => c[0]);
    expect(second.requestId).toBe(first.requestId);
  });

  it('says reporting is not open when the server turns it down', async () => {
    mocked.reportsOpen.mockResolvedValue(true);
    mocked.submitReport.mockResolvedValue({ kind: 'reporting_unavailable' });
    const tree = await mount();
    await press(tree, `buddy-report-${SAM}`);
    await press(tree, `buddy-report-reason-${SAM}-spam`);

    await press(tree, `buddy-report-send-${SAM}`);

    expect(shows(tree, t('buddy.reportClosed'))).toBe(true);
  });

  it('never offers to report oneself, and has no moderation queue or screen for members', async () => {
    mocked.reportsOpen.mockResolvedValue(true);
    const tree = await mount();

    expect(has(tree, `buddy-report-${ME}`)).toBe(false);
    expect(textsOf(tree).join(' ')).not.toMatch(/moderation queue|all reports/i);
  });
});

describe('translations', () => {
  it.each(['ms', 'ta'])('has the new text in %s, not the English fallback', async (language) => {
    const keys = ['buddy.milestonesTitle', 'buddy.previewOnly', 'buddy.previewSays', 'buddy.shareConfirm', 'buddy.withdraw', 'buddy.reportClosed', 'buddy.reportReceived', 'buddy.rankingTies', 'buddy.reportReason.harassment'];
    await i18next.changeLanguage('en');
    const english = keys.map((k) => t(k, { group: 'G', name: 'N', count: 1, reference: 'R' }));
    await i18next.changeLanguage(language);

    keys.forEach((k, i) => {
      const text = t(k, { group: 'G', name: 'N', count: 1, reference: 'R' });
      expect(text).not.toBe(k);
      expect(text).not.toBe(english[i]);
    });
    await i18next.changeLanguage('en');
  });
});
