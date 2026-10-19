import { callFunction, createAdmin, createTestUser, TestUser } from './helpers';

jest.setTimeout(300000);

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const DISCLOSURE = { disclosureVersion: 1, disclosureAccepted: true };
const uuid = () => crypto.randomUUID();

// Roadmap E2: private completion milestones shared into a group only after an explicit confirmation, a participation
// count that gives at most one point per local day, and reports that are stored for authorised review only. Run these
// live suites in band (they change shared configuration and restore it).
describe('buddy milestones, reports and moderation (live)', () => {
  const admin = createAdmin();
  const users: TestUser[] = [];
  let A: TestUser, B: TestUser, C: TestUser, MOD: TestUser;
  let exercise: string;

  beforeAll(async () => {
    for (const label of ['bm-a', 'bm-b', 'bm-c', 'bm-mod']) users.push(await createTestUser(admin, label));
    [A, B, C, MOD] = users;
    exercise = (await admin.from('exercises').select('id').limit(1).single()).data!.id;
  });
  afterAll(async () => {
    await clean();
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
  });
  const ids = () => users.map((u) => u.id);
  async function clean() {
    await admin.from('buddy_reports').delete().in('reporter_id', ids());
    await admin.from('buddy_moderators').delete().in('user_id', ids());
    await admin.from('buddy_blocks').delete().in('blocker_id', ids());
    await admin.from('buddy_groups').delete().in('owner_id', ids());
    await admin.from('buddy_members').delete().in('user_id', ids());
    await admin.from('workout_logs').delete().in('user_id', ids());
  }
  beforeEach(clean);

  const buddy = (user: TestUser, body: Record<string, unknown>) => callFunction('buddy', user.jwt, body);
  const moderation = (user: TestUser, body: Record<string, unknown>) => callFunction('buddy-moderation', user.jwt, body);
  const createGroup = async (user: TestUser, displayName = 'Alex') => {
    const result = await buddy(user, { action: 'create_group', name: 'Crew', displayName, ...DISCLOSURE });
    expect(result.status).toBe(200);
    return result.json.groupId as string;
  };
  const join = async (owner: TestUser, groupId: string, joiner: TestUser, displayName: string) => {
    const invite = await buddy(owner, { action: 'create_invite', groupId });
    const result = await buddy(joiner, { action: 'accept_invite', token: invite.json.token, displayName, ...DISCLOSURE });
    expect(result.status).toBe(200);
  };
  const memberId = async (groupId: string, user: TestUser) => (await admin.from('buddy_members').select('member_id').eq('group_id', groupId).eq('user_id', user.id).single()).data!.member_id as string;
  const logDays = async (user: TestUser, offsets: number[], setsPerDay = 1) => {
    const rows = offsets.flatMap((o) => Array.from({ length: setsPerDay }, (_, i) => ({ user_id: user.id, log_date: day(o), exercise_id: exercise, set_number: i + 1, reps: 8, weight_kg: 20 })));
    expect((await admin.from('workout_logs').insert(rows)).error).toBeNull();
  };
  const setConfig = async (key: string, value: unknown, run: () => Promise<void>) => {
    const original = (await admin.from('app_config').select('value').eq('key', key).single()).data?.value;
    try {
      expect((await admin.from('app_config').update({ value }).eq('key', key)).error).toBeNull();
      await run();
    } finally {
      await admin.from('app_config').update({ value: original }).eq('key', key);
    }
  };
  const share = (user: TestUser, groupId: string, milestone: number, requestId = uuid()) => buddy(user, { action: 'share_milestone', groupId, milestone, requestId });
  const sharesSeenBy = async (user: TestUser, groupId: string) => (await buddy(user, { action: 'shares', groupId })).json.shares as { memberId: string; displayName: string; milestone: number; mine: boolean }[];

  describe('participation: at most one point for each local day', () => {
    it('counts a day once however many sets, entries or activities it has', async () => {
      await setConfig('buddy_milestone_days', [2, 3], async () => {
        await logDays(A, [-1, -2], 6); // two days, six sets each
        const result = await buddy(A, { action: 'milestones' });

        expect(result.status).toBe(200);
        expect(result.json.days).toBe(2);
        expect(result.json.milestones.map((m: { milestone: number }) => m.milestone)).toEqual([2]);
      });
    });

    it('does not change when the same logs are synced again', async () => {
      await setConfig('buddy_milestone_days', [2, 3], async () => {
        await logDays(A, [-1, -2]);
        const first = await buddy(A, { action: 'milestones' });
        await admin.from('workout_logs').upsert({ user_id: A.id, log_date: day(-1), exercise_id: exercise, set_number: 1, reps: 8, weight_kg: 20, id: (await admin.from('workout_logs').select('id').eq('user_id', A.id).eq('log_date', day(-1)).single()).data!.id }, { onConflict: 'id' });
        const second = await buddy(A, { action: 'milestones' });

        expect(second.json.days).toBe(first.json.days);
      });
    });

    it('never counts another member\'s days', async () => {
      await setConfig('buddy_milestone_days', [1], async () => {
        await logDays(B, [-1, -2, -3]);

        const result = await buddy(A, { action: 'milestones' });

        expect(result.json.days).toBe(0);
        expect(result.json.milestones).toEqual([]);
      });
    });
  });

  describe('sharing a milestone', () => {
    it('refuses a milestone the member has not earned, and one that is not a milestone', async () => {
      await setConfig('buddy_milestone_days', [2, 3], async () => {
        const groupId = await createGroup(A);
        await logDays(A, [-1]);

        expect((await share(A, groupId, 2)).status).toBe(409);
        expect((await share(A, groupId, 2)).json.error).toBe('MILESTONE_NOT_EARNED');
        expect((await share(A, groupId, 5)).status).toBe(409); // not a configured milestone
        expect(await sharesSeenBy(A, groupId)).toEqual([]);
      });
    });

    it('shows a shared milestone to the other members as a name and a number, and nothing else', async () => {
      await setConfig('buddy_milestone_days', [2], async () => {
        const groupId = await createGroup(A, 'Alex');
        await join(A, groupId, B, 'Sam');
        await logDays(A, [-1, -2], 4);

        expect((await share(A, groupId, 2)).status).toBe(200);

        const seen = await buddy(B, { action: 'shares', groupId });
        expect(seen.status).toBe(200);
        expect(seen.json.shares).toEqual([{ memberId: await memberId(groupId, A), displayName: 'Alex', milestone: 2, sharedAt: expect.any(String), mine: false }]);
        const raw = JSON.stringify(seen.json);
        for (const forbidden of ['weight', 'reps', 'photo', 'meal', 'calorie', 'coach', 'user_id', A.id, A.email]) expect(raw).not.toContain(forbidden);
        expect((await sharesSeenBy(A, groupId))[0].mine).toBe(true);
      });
    });

    it('is invisible to other groups, to non-members and to a group the member has left', async () => {
      await setConfig('buddy_milestone_days', [2], async () => {
        const g1 = await createGroup(A);
        const g2 = await createGroup(B, 'Sam');
        await join(A, g1, C, 'Lee');
        await logDays(A, [-1, -2]);
        await share(A, g1, 2);

        expect((await buddy(B, { action: 'shares', groupId: g1 })).status).toBe(404); // a stranger
        expect(await sharesSeenBy(B, g2)).toEqual([]); // another group
        expect((await sharesSeenBy(C, g1)).length).toBe(1);

        await buddy(A, { action: 'leave', groupId: g1 });
        expect((await admin.from('buddy_shares').select('id').eq('user_id', A.id)).data).toEqual([]); // removed with the membership
      });
    });

    it('cannot be shared into a group the member is not in', async () => {
      await setConfig('buddy_milestone_days', [2], async () => {
        const other = await createGroup(B, 'Sam');
        await logDays(A, [-1, -2]);

        expect((await share(A, other, 2)).status).toBe(404);
        expect((await admin.from('buddy_shares').select('id').eq('group_id', other)).data).toEqual([]);
      });
    });

    it('is one share when the request is replayed or repeated', async () => {
      await setConfig('buddy_milestone_days', [2], async () => {
        const groupId = await createGroup(A);
        await logDays(A, [-1, -2]);
        const requestId = uuid();

        const first = await share(A, groupId, 2, requestId);
        const replay = await share(A, groupId, 2, requestId);
        const again = await share(A, groupId, 2, uuid());

        expect([first.status, replay.status, again.status]).toEqual([200, 200, 200]);
        expect((await admin.from('buddy_shares').select('id').eq('user_id', A.id)).data).toHaveLength(1);
      });
    });

    it('withdrawing takes effect at once, and a delayed replay of the old share cannot bring it back', async () => {
      await setConfig('buddy_milestone_days', [2], async () => {
        const groupId = await createGroup(A);
        await join(A, groupId, B, 'Sam');
        await logDays(A, [-1, -2]);
        const requestId = uuid();
        await share(A, groupId, 2, requestId);
        expect(await sharesSeenBy(B, groupId)).toHaveLength(1);

        expect((await buddy(A, { action: 'withdraw_share', groupId, milestone: 2 })).status).toBe(200);
        expect(await sharesSeenBy(B, groupId)).toEqual([]);

        const replay = await share(A, groupId, 2, requestId);
        expect(replay.status).toBe(409);
        expect(replay.json.error).toBe('SHARE_WITHDRAWN');
        expect(await sharesSeenBy(B, groupId)).toEqual([]);

        expect((await share(A, groupId, 2, uuid())).status).toBe(200); // a new, deliberate share is allowed
        expect(await sharesSeenBy(B, groupId)).toHaveLength(1);
      });
    });

    it('withdrawing a share that does not exist is a not-found, and cannot touch someone else\'s', async () => {
      await setConfig('buddy_milestone_days', [2], async () => {
        const groupId = await createGroup(A);
        await join(A, groupId, B, 'Sam');
        await logDays(A, [-1, -2]);
        await share(A, groupId, 2);

        expect((await buddy(B, { action: 'withdraw_share', groupId, milestone: 2 })).status).toBe(404);
        expect(await sharesSeenBy(B, groupId)).toHaveLength(1);
      });
    });

    it('stops showing a share at once when blocking ends the sharer or the viewer access', async () => {
      await setConfig('buddy_milestone_days', [2], async () => {
        const groupId = await createGroup(A);
        await join(A, groupId, B, 'Sam');
        await join(A, groupId, C, 'Lee');
        await logDays(B, [-1, -2]);
        await share(B, groupId, 2);
        expect(await sharesSeenBy(C, groupId)).toHaveLength(1);

        // A member who blocks someone leaves the group (E1), so they can no longer read anything in it.
        await buddy(C, { action: 'block_member', groupId, memberId: await memberId(groupId, B) });
        expect((await buddy(C, { action: 'shares', groupId })).status).toBe(404);
        expect(await sharesSeenBy(A, groupId)).toHaveLength(1);

        // The owner blocking the sharer removes them, and their share with them.
        await buddy(A, { action: 'block_member', groupId, memberId: await memberId(groupId, B) });
        expect(await sharesSeenBy(A, groupId)).toEqual([]);
        expect((await buddy(B, { action: 'shares', groupId })).status).toBe(404);
        expect((await admin.from('buddy_shares').select('id').eq('user_id', B.id)).data).toEqual([]);
      });
    });

    it('stops showing a share once it has expired', async () => {
      await setConfig('buddy_milestone_days', [2], async () => {
        const groupId = await createGroup(A);
        await join(A, groupId, B, 'Sam');
        await logDays(B, [-1, -2]);
        await share(B, groupId, 2);
        expect(await sharesSeenBy(A, groupId)).toHaveLength(1);

        await admin.from('buddy_shares').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('user_id', B.id);

        expect(await sharesSeenBy(A, groupId)).toEqual([]);
        expect(await sharesSeenBy(B, groupId)).toEqual([]);
      });
    });

    it('removes shares with the member when the owner removes them', async () => {
      await setConfig('buddy_milestone_days', [2], async () => {
        const groupId = await createGroup(A);
        await join(A, groupId, B, 'Sam');
        await logDays(B, [-1, -2]);
        await share(B, groupId, 2);

        await buddy(A, { action: 'remove_member', groupId, memberId: await memberId(groupId, B) });

        expect((await admin.from('buddy_shares').select('id').eq('user_id', B.id)).data).toEqual([]);
        expect((await sharesSeenBy(A, groupId))).toEqual([]);
        expect((await buddy(B, { action: 'shares', groupId })).status).toBe(404);
      });
    });

    it('is deleted with the account', async () => {
      await setConfig('buddy_milestone_days', [2], async () => {
        const temp = await createTestUser(admin, 'bm-temp');
        const groupId = await createGroup(A);
        await join(A, groupId, temp, 'Tmp');
        await admin.from('workout_logs').insert([0, 1].map((o) => ({ user_id: temp.id, log_date: day(-1 - o), exercise_id: exercise, set_number: 1, reps: 8, weight_kg: 20 })));
        await share(temp, groupId, 2);

        expect((await callFunction('delete-account', temp.jwt, {})).status).toBe(200);

        expect((await admin.from('buddy_shares').select('id').eq('user_id', temp.id)).data).toEqual([]);
      });
    });

    it('can only be read, never written, directly by a member', async () => {
      const read = await A.client.from('buddy_shares').select('id');
      const write = await A.client.from('buddy_shares').insert({ group_id: uuid(), user_id: A.id, milestone: 1, expires_at: new Date().toISOString() });

      expect(read.data ?? []).toEqual([]);
      expect(read.error ?? write.error).toBeTruthy();
      expect(write.error).toBeTruthy();
    });
  });

  describe('reports', () => {
    const report = (user: TestUser, groupId: string, member: string, extra: Record<string, unknown> = {}) =>
      buddy(user, { action: 'report', groupId, memberId: member, reason: 'harassment', requestId: uuid(), ...extra });
    const openReporting = (run: () => Promise<void>) => setConfig('buddy_reports_enabled', true, run);

    it('is gated off until the owner turns it on and a moderator exists: reports are refused, not silently stored', async () => {
      const groupId = await createGroup(A);
      await join(A, groupId, B, 'Sam');

      expect((await buddy(A, { action: 'reports_status' })).json).toEqual({ open: false });
      await openReporting(async () => {
        expect((await buddy(A, { action: 'reports_status' })).json).toEqual({ open: false }); // enabled but nobody to handle it
      });
      const refused = await report(A, groupId, await memberId(groupId, B));
      expect(refused.status).toBe(503);
      expect(refused.json.error).toBe('REPORTING_UNAVAILABLE');
      expect((await admin.from('buddy_reports').select('id').eq('reporter_id', A.id)).data).toEqual([]);
    });

    it('is open only when it is switched on and a moderator is named', async () => {
      await admin.from('buddy_moderators').insert({ user_id: MOD.id });
      await openReporting(async () => {
        expect((await buddy(A, { action: 'reports_status' })).json).toEqual({ open: true });
      });
    });

    it('stores and acknowledges a report for the group the reporter is in, once per request', async () => {
      await admin.from('buddy_moderators').insert({ user_id: MOD.id });
      await openReporting(async () => {
        const groupId = await createGroup(A);
        await join(A, groupId, B, 'Sam');
        const target = await memberId(groupId, B);
        const requestId = uuid();

        const first = await report(A, groupId, target, { requestId, note: 'Please look at this' });
        const replay = await report(A, groupId, target, { requestId, note: 'Please look at this' });

        expect(first.status).toBe(200);
        expect(first.json).toEqual({ reportId: expect.any(String), receivedAt: expect.any(String) });
        expect(replay.json.reportId).toBe(first.json.reportId);
        const rows = (await admin.from('buddy_reports').select('*').eq('reporter_id', A.id)).data!;
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ reported_user_id: B.id, group_id: groupId, status: 'open', reason: 'harassment', note: 'Please look at this', reported_display_name: 'Sam' });
      });
    });

    it('does not make a second open report for the same person in the same group', async () => {
      await admin.from('buddy_moderators').insert({ user_id: MOD.id });
      await openReporting(async () => {
        const groupId = await createGroup(A);
        await join(A, groupId, B, 'Sam');
        const target = await memberId(groupId, B);

        const first = await report(A, groupId, target);
        const second = await report(A, groupId, target);

        expect(second.json.reportId).toBe(first.json.reportId);
        expect((await admin.from('buddy_reports').select('id').eq('reporter_id', A.id)).data).toHaveLength(1);
      });
    });

    it('refuses a report about yourself, about someone outside the group, or from outside the group', async () => {
      await admin.from('buddy_moderators').insert({ user_id: MOD.id });
      await openReporting(async () => {
        const g1 = await createGroup(A);
        const g2 = await createGroup(B, 'Sam');
        await join(A, g1, C, 'Lee');

        expect((await report(A, g1, await memberId(g1, A))).status).toBe(409); // yourself
        expect((await report(A, g1, await memberId(g2, B))).status).toBe(404); // a member of another group
        expect((await report(B, g1, await memberId(g1, C))).status).toBe(404); // not in the group
        expect((await admin.from('buddy_reports').select('id').in('reporter_id', ids())).data).toEqual([]);
      });
    });

    it('limits how many reports one member can file a day', async () => {
      await admin.from('buddy_moderators').insert({ user_id: MOD.id });
      await openReporting(async () => {
        await setConfig('buddy_reports_per_day', 1, async () => {
          const groupId = await createGroup(A);
          await join(A, groupId, B, 'Sam');
          await join(A, groupId, C, 'Lee');

          expect((await report(A, groupId, await memberId(groupId, B))).status).toBe(200);
          expect((await report(A, groupId, await memberId(groupId, C))).status).toBe(409);
        });
      });
    });

    it('can still be filed after the reported member has been blocked, and cannot be read by members', async () => {
      await admin.from('buddy_moderators').insert({ user_id: MOD.id });
      await openReporting(async () => {
        const groupId = await createGroup(A);
        await join(A, groupId, B, 'Sam');
        const target = await memberId(groupId, B);
        expect((await report(A, groupId, target)).status).toBe(200);
        await buddy(A, { action: 'block_member', groupId, memberId: target });

        expect((await A.client.from('buddy_reports').select('id')).data ?? []).toEqual([]);
        expect((await A.client.from('buddy_reports').insert({ reporter_id: A.id, reported_user_id: B.id, reason: 'spam', request_id: uuid() })).error).toBeTruthy();
      });
    });

    it('is deleted with the reporter\'s account', async () => {
      await admin.from('buddy_moderators').insert({ user_id: MOD.id });
      await openReporting(async () => {
        const temp = await createTestUser(admin, 'bm-rep');
        const groupId = await createGroup(A);
        await join(A, groupId, temp, 'Tmp');
        await report(temp, groupId, await memberId(groupId, A));

        await callFunction('delete-account', temp.jwt, {});

        expect((await admin.from('buddy_reports').select('id').eq('reporter_id', temp.id)).data).toEqual([]);
      });
    });
  });

  describe('moderation', () => {
    const fileReport = async () => {
      await admin.from('buddy_moderators').insert({ user_id: MOD.id });
      const groupId = await createGroup(A);
      await join(A, groupId, B, 'Sam');
      let reportId = '';
      await setConfig('buddy_reports_enabled', true, async () => {
        reportId = (await buddy(A, { action: 'report', groupId, memberId: await memberId(groupId, B), reason: 'unsafe', requestId: uuid() })).json.reportId;
      });
      return { groupId, reportId };
    };

    it('gives an ordinary member nothing: the same answer as an unknown endpoint, for every action', async () => {
      const { reportId } = await fileReport();

      for (const body of [{ action: 'queue' }, { action: 'start_review', reportId }, { action: 'resolve', reportId, resolution: 'no_action' }]) {
        const result = await moderation(A, body);
        expect(result.status).toBe(404);
        expect(result.json).toEqual({ error: 'not_found' });
      }
      expect((await callFunction('buddy-moderation', undefined, { action: 'queue' })).status).toBe(401);
    });

    it('lists open reports to a named moderator, without account ids or anything but the report', async () => {
      const { reportId } = await fileReport();

      const queue = await moderation(MOD, { action: 'queue' });

      expect(queue.status).toBe(200);
      expect(queue.json.reports).toEqual([expect.objectContaining({ reportId, status: 'open', reason: 'unsafe', reportedDisplayName: 'Sam', reporterDisplayName: 'Alex', groupName: 'Crew' })]);
      const raw = JSON.stringify(queue.json);
      for (const forbidden of [A.id, B.id, 'weight', 'photo', 'meal', 'coach']) expect(raw).not.toContain(forbidden);
    });

    it('moves a report to review and closes it with a resolution', async () => {
      const { reportId } = await fileReport();

      expect((await moderation(MOD, { action: 'start_review', reportId })).status).toBe(200);
      expect((await admin.from('buddy_reports').select('status').eq('id', reportId).single()).data!.status).toBe('in_review');
      expect((await moderation(MOD, { action: 'resolve', reportId, resolution: 'no_action', note: 'Looked fine' })).status).toBe(200);

      const row = (await admin.from('buddy_reports').select('status, resolution, resolution_note, reviewed_by').eq('id', reportId).single()).data!;
      expect(row).toMatchObject({ status: 'closed', resolution: 'no_action', resolution_note: 'Looked fine', reviewed_by: MOD.id });
      expect((await moderation(MOD, { action: 'queue' })).json.reports).toEqual([]);
      expect((await moderation(MOD, { action: 'resolve', reportId, resolution: 'no_action' })).status).toBe(409); // already closed
    });

    it('removes the reported member from the group when that is the resolution, with their shares', async () => {
      const { reportId, groupId } = await fileReport();

      expect((await moderation(MOD, { action: 'resolve', reportId, resolution: 'removed_from_group' })).status).toBe(200);

      expect((await admin.from('buddy_members').select('user_id').eq('group_id', groupId).eq('user_id', B.id)).data).toEqual([]);
      expect((await buddy(B, { action: 'shares', groupId })).status).toBe(404);
    });

    it('stops working as soon as the moderator is removed', async () => {
      await fileReport();
      expect((await moderation(MOD, { action: 'queue' })).status).toBe(200);

      await admin.from('buddy_moderators').delete().eq('user_id', MOD.id);

      expect((await moderation(MOD, { action: 'queue' })).status).toBe(404);
    });
  });
});
