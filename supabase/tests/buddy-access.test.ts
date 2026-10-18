import { callFunction, createAdmin, createTestUser, TestUser } from './helpers';

jest.setTimeout(300000);

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const DISCLOSURE = { disclosureVersion: 1, disclosureAccepted: true };

// Roadmap E1: private, invitation-only groups. A member sees other members' display names and the days they
// logged a workout, and nothing else; invitations are random, hashed, expiring and single use; leaving, removal
// and blocking take effect at once.
describe('buddy groups (live)', () => {
  const admin = createAdmin();
  const users: TestUser[] = [];
  let A: TestUser, B: TestUser, C: TestUser, D: TestUser;

  beforeAll(async () => {
    for (const label of ['buddy-a', 'buddy-b', 'buddy-c', 'buddy-d']) users.push(await createTestUser(admin, label));
    [A, B, C, D] = users;
  });
  afterAll(async () => {
    await clean();
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
  });
  const ids = () => users.map((u) => u.id);
  async function clean() {
    await admin.from('buddy_blocks').delete().in('blocker_id', ids());
    await admin.from('buddy_groups').delete().in('owner_id', ids());
    await admin.from('buddy_members').delete().in('user_id', ids());
    await admin.from('workout_logs').delete().in('user_id', ids());
    await admin.from('checkins').delete().in('user_id', ids());
  }
  beforeEach(clean);

  const buddy = (user: TestUser, body: Record<string, unknown>) => callFunction('buddy', user.jwt, body);
  const createGroup = async (user: TestUser, name = 'Morning crew', displayName = 'Alex') => {
    const result = await buddy(user, { action: 'create_group', name, displayName, ...DISCLOSURE });
    expect(result.status).toBe(200);
    return result.json.groupId as string;
  };
  const invite = async (owner: TestUser, groupId: string) => {
    const result = await buddy(owner, { action: 'create_invite', groupId });
    expect(result.status).toBe(200);
    return { token: result.json.token as string, inviteId: result.json.inviteId as string };
  };
  const accept = (user: TestUser, token: string, displayName = 'Sam', extra: Record<string, unknown> = {}) =>
    buddy(user, { action: 'accept_invite', token, displayName, ...DISCLOSURE, ...extra });
  const join = async (owner: TestUser, groupId: string, joiner: TestUser, displayName = 'Sam') => {
    const { token } = await invite(owner, groupId);
    const result = await accept(joiner, token, displayName);
    expect(result.status).toBe(200);
    return result.json;
  };
  const memberRows = async (groupId: string) => (await admin.from('buddy_members').select('user_id, role, display_name, joined_at').eq('group_id', groupId).order('joined_at')).data ?? [];
  const setConfig = async (key: string, value: unknown, run: () => Promise<void>) => {
    const original = (await admin.from('app_config').select('value').eq('key', key).single()).data?.value;
    try {
      await admin.from('app_config').update({ value }).eq('key', key);
      await run();
    } finally {
      await admin.from('app_config').update({ value: original }).eq('key', key);
    }
  };

  describe('groups', () => {
    it('answers 401 without a JWT and 400 for a bad body', async () => {
      expect((await callFunction('buddy', undefined, {})).status).toBe(401);
      expect((await buddy(A, { action: 'create_group', name: 'x', displayName: 'y' })).status).toBe(400);
      expect((await buddy(A, { action: 'unknown' })).status).toBe(400);
    });

    it('creates a group with the creator as its owner, only after the disclosure is accepted', async () => {
      const refused = await buddy(A, { action: 'create_group', name: 'Crew', displayName: 'Alex', disclosureVersion: 1, disclosureAccepted: false });
      expect(refused.status).toBe(400);
      expect(await memberRows(crypto.randomUUID())).toEqual([]);

      const groupId = await createGroup(A);

      expect(await memberRows(groupId)).toMatchObject([{ user_id: A.id, role: 'owner', display_name: 'Alex' }]);
    });

    it('shows a group to its members only; a guessed group id shows nothing', async () => {
      const groupId = await createGroup(A);

      expect((await A.client.from('buddy_groups').select('id, name').eq('id', groupId)).data).toHaveLength(1);
      expect((await B.client.from('buddy_groups').select('id').eq('id', groupId)).data ?? []).toEqual([]);
      expect((await B.client.from('buddy_members').select('group_id').eq('group_id', groupId)).data ?? []).toEqual([]);
    });

    it('limits how many groups one account can be in, from app_config', async () => {
      await setConfig('buddy_max_groups_per_user', 1, async () => {
        await createGroup(A, 'One');
        const second = await buddy(A, { action: 'create_group', name: 'Two', displayName: 'Alex', ...DISCLOSURE });

        expect(second.status).toBe(409);
        expect(second.json).toMatchObject({ error: 'LIMIT_REACHED' });
      });
    });
  });

  describe('invitations', () => {
    it('stores only a hash of the token, never the token', async () => {
      const groupId = await createGroup(A);

      const { token, inviteId } = await invite(A, groupId);

      const row = (await admin.from('buddy_invites').select('*').eq('id', inviteId).single()).data!;
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain(token);
    });

    it('lets only the owner invite; a member who is not the owner, or an outsider, cannot', async () => {
      const groupId = await createGroup(A);
      await join(A, groupId, B);

      expect((await buddy(B, { action: 'create_invite', groupId })).status).toBe(403);
      const outsider = await buddy(C, { action: 'create_invite', groupId });
      expect(outsider.status).toBe(404);
      expect(outsider.json).toMatchObject({ error: 'GROUP_NOT_FOUND' });
    });

    it('limits the invitations open at once, from app_config', async () => {
      const groupId = await createGroup(A);
      await setConfig('buddy_max_active_invites', 2, async () => {
        await invite(A, groupId);
        await invite(A, groupId);
        const third = await buddy(A, { action: 'create_invite', groupId });

        expect(third.status).toBe(409);
        expect(third.json).toMatchObject({ error: 'LIMIT_REACHED' });
      });
    });

    it('lets someone join with a valid invitation after accepting the disclosure, and they see the group', async () => {
      const groupId = await createGroup(A);

      await join(A, groupId, B, 'Sam');

      expect(await memberRows(groupId)).toMatchObject([{ role: 'owner' }, { user_id: B.id, role: 'member', display_name: 'Sam' }]);
      expect((await B.client.from('buddy_groups').select('id').eq('id', groupId)).data).toHaveLength(1);
      const seen = (await B.client.from('buddy_members').select('display_name, role').eq('group_id', groupId)).data ?? [];
      expect(seen.map((m) => m.display_name).sort()).toEqual(['Alex', 'Sam']);
    });

    it('does not use up the invitation when the disclosure was not accepted', async () => {
      const groupId = await createGroup(A);
      const { token } = await invite(A, groupId);

      const refused = await accept(B, token, 'Sam', { disclosureAccepted: false });
      const accepted = await accept(B, token);

      expect(refused.status).toBe(400);
      expect(accepted.status).toBe(200);
    });

    it.each([
      ['an unknown token', async () => 'A'.repeat(43)],
      ['a token that was already used', async (ctx: { owner: TestUser; groupId: string }) => {
        const { token } = await invite(ctx.owner, ctx.groupId);
        await accept(C, token, 'Chris');
        return token;
      }],
      ['a revoked token', async (ctx: { owner: TestUser; groupId: string }) => {
        const { token, inviteId } = await invite(ctx.owner, ctx.groupId);
        expect((await buddy(ctx.owner, { action: 'revoke_invite', inviteId })).status).toBe(200);
        return token;
      }],
      ['an expired token', async (ctx: { owner: TestUser; groupId: string }) => {
        const { token, inviteId } = await invite(ctx.owner, ctx.groupId);
        await admin.from('buddy_invites').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', inviteId);
        return token;
      }],
    ])('answers %s with the same neutral error, and adds nobody', async (_label, getToken) => {
      const groupId = await createGroup(A);
      const token = await getToken({ owner: A, groupId });
      const before = (await memberRows(groupId)).length;

      const result = await accept(B, token);

      expect(result.status).toBe(404);
      expect(result.json).toEqual({ error: 'INVITE_UNAVAILABLE' });
      expect((await memberRows(groupId)).length).toBe(before);
    });

    it('lets exactly one of two competing accepts win', async () => {
      const groupId = await createGroup(A);
      const { token } = await invite(A, groupId);

      const results = await Promise.all([accept(B, token, 'Sam'), accept(C, token, 'Chris')]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
      expect(await memberRows(groupId)).toHaveLength(2);
    });

    it('refuses a full group without using up the invitation', async () => {
      const groupId = await createGroup(A);
      await setConfig('buddy_max_group_size', 2, async () => {
        await join(A, groupId, B);
        const { token } = await invite(A, groupId);

        const full = await accept(C, token, 'Chris');

        expect(full.status).toBe(409);
        expect(full.json).toMatchObject({ error: 'GROUP_FULL' });
        expect((await admin.from('buddy_invites').select('accepted_by').eq('token_hash', (await admin.from('buddy_invites').select('token_hash').eq('group_id', groupId).is('accepted_by', null).single()).data!.token_hash).single()).data?.accepted_by).toBeNull();
      });
    });

    it('does not add someone who is already a member', async () => {
      const groupId = await createGroup(A);
      await join(A, groupId, B);
      const { token } = await invite(A, groupId);

      const again = await accept(B, token, 'Sam again');

      expect(again.status).toBe(409);
      expect(again.json).toMatchObject({ error: 'ALREADY_MEMBER' });
      expect((await memberRows(groupId)).length).toBe(2);
    });
  });

  describe('leaving, removal and blocking take effect at once', () => {
    it('lets a member leave and stops all access immediately', async () => {
      const groupId = await createGroup(A);
      await join(A, groupId, B);

      expect((await buddy(B, { action: 'leave', groupId })).status).toBe(200);

      expect((await B.client.from('buddy_groups').select('id').eq('id', groupId)).data ?? []).toEqual([]);
      expect((await buddy(B, { action: 'summary', groupId, from: day(-6), to: day(0) })).status).toBe(404);
      expect((await memberRows(groupId)).map((m) => m.user_id)).toEqual([A.id]);
    });

    it('passes ownership to the longest-standing member when the owner leaves, and deletes a group when the last member leaves', async () => {
      const groupId = await createGroup(A);
      await join(A, groupId, B);

      await buddy(A, { action: 'leave', groupId });
      expect(await memberRows(groupId)).toMatchObject([{ user_id: B.id, role: 'owner' }]);

      await buddy(B, { action: 'leave', groupId });
      expect((await admin.from('buddy_groups').select('id').eq('id', groupId)).data ?? []).toEqual([]);
    });

    it('lets the owner remove a member, who loses access immediately; nobody else can', async () => {
      const groupId = await createGroup(A);
      await join(A, groupId, B);
      await join(A, groupId, C, 'Chris');
      const bMember = (await B.client.from('buddy_members').select('member_id, display_name').eq('group_id', groupId)).data!.find((m) => m.display_name === 'Sam')!.member_id;
      const cMember = (await B.client.from('buddy_members').select('member_id, display_name').eq('group_id', groupId)).data!.find((m) => m.display_name === 'Chris')!.member_id;

      expect((await buddy(B, { action: 'remove_member', groupId, memberId: cMember })).status).toBe(403);
      expect((await buddy(A, { action: 'remove_member', groupId, memberId: cMember })).status).toBe(200);

      expect((await C.client.from('buddy_groups').select('id').eq('id', groupId)).data ?? []).toEqual([]);
      expect((await buddy(C, { action: 'summary', groupId, from: day(-6), to: day(0) })).status).toBe(404);
      expect((await memberRows(groupId)).map((m) => m.user_id).sort()).toEqual([A.id, B.id].sort());
      void bMember;
    });

    it('blocking removes the pair from sharing a group and keeps them from sharing one again', async () => {
      const groupId = await createGroup(A);
      await join(A, groupId, B);
      await join(A, groupId, C, 'Chris');
      const cMember = (await B.client.from('buddy_members').select('member_id, display_name').eq('group_id', groupId)).data!.find((m) => m.display_name === 'Chris')!.member_id;

      const blocked = await buddy(B, { action: 'block_member', groupId, memberId: cMember });

      expect(blocked.status).toBe(200);
      expect((await B.client.from('buddy_groups').select('id').eq('id', groupId)).data ?? []).toEqual([]); // B left
      expect((await memberRows(groupId)).map((m) => m.user_id).sort()).toEqual([A.id, C.id].sort());
      // B cannot be invited back into a group C is in, and C cannot join one B is in.
      const { token } = await invite(A, groupId);
      const back = await accept(B, token, 'Sam');
      expect(back.status).toBe(404);
      expect(back.json).toEqual({ error: 'INVITE_UNAVAILABLE' });
    });

    it('does not let someone block or remove a member id from a group they are not in', async () => {
      const groupId = await createGroup(A);
      await join(A, groupId, B);
      const bMember = (await A.client.from('buddy_members').select('member_id, display_name').eq('group_id', groupId)).data!.find((m) => m.display_name === 'Sam')!.member_id;

      expect((await buddy(C, { action: 'block_member', groupId, memberId: bMember })).status).toBe(404);
      expect((await buddy(C, { action: 'remove_member', groupId, memberId: bMember })).status).toBe(404);
      expect(await memberRows(groupId)).toHaveLength(2);
    });
  });

  describe('what a group can see', () => {
    it('shows each member\'s display name and the days they logged a workout, and nothing else', async () => {
      const groupId = await createGroup(A, 'Crew', 'Alex');
      await join(A, groupId, B, 'Sam');
      const exercise = (await admin.from('exercises').select('id').limit(1).single()).data!.id;
      await admin.from('workout_logs').insert([
        { user_id: A.id, log_date: day(-1), exercise_id: exercise, set_number: 1, reps: 8, weight_kg: 20 },
        { user_id: A.id, log_date: day(-1), exercise_id: exercise, set_number: 2, reps: 8, weight_kg: 20 },
        { user_id: B.id, log_date: day(-3), exercise_id: exercise, set_number: 1, reps: 10, weight_kg: 30 },
        { user_id: B.id, log_date: day(-40), exercise_id: exercise, set_number: 1, reps: 10, weight_kg: 30 },
      ]);

      const result = await buddy(B, { action: 'summary', groupId, from: day(-6), to: day(0) });

      expect(result.status).toBe(200);
      const members = result.json.members as { memberId: string; displayName: string; days: string[] }[];
      expect(members.map((m) => [m.displayName, m.days]).sort()).toEqual([['Alex', [day(-1)]], ['Sam', [day(-3)]]]);
      for (const member of members) expect(Object.keys(member).sort()).toEqual(['days', 'displayName', 'memberId']);
    });

    it('carries no weight, photo, food or coach data and no account ids', async () => {
      const groupId = await createGroup(A);
      await join(A, groupId, B);
      await admin.from('checkins').insert([{ user_id: A.id, checkin_date: day(-1), weight_kg: 81.23, mood: 2, sleep_hours: 4.5, photo_path: `${A.id}/private.jpg` }]);

      const result = await buddy(B, { action: 'summary', groupId, from: day(-6), to: day(0) });

      const text = JSON.stringify(result.json);
      for (const secret of ['81.23', 'private.jpg', 'sleep', 'mood', A.id, B.id]) expect(text).not.toContain(secret);
    });

    it('refuses a non-member and a former member', async () => {
      const groupId = await createGroup(A);
      await join(A, groupId, B);
      await buddy(B, { action: 'leave', groupId });

      expect((await buddy(C, { action: 'summary', groupId, from: day(-6), to: day(0) })).status).toBe(404);
      expect((await buddy(B, { action: 'summary', groupId, from: day(-6), to: day(0) })).status).toBe(404);
    });

    it('refuses a range longer than 31 days', async () => {
      const groupId = await createGroup(A);

      expect((await buddy(A, { action: 'summary', groupId, from: day(-40), to: day(0) })).status).toBe(400);
    });
  });

  describe('the Data API', () => {
    it('lets no one write any buddy table or read invitations, blocks or other members\' account ids', async () => {
      const groupId = await createGroup(A);
      await join(A, groupId, B);

      const writes = await Promise.all([
        A.client.from('buddy_groups').insert({ owner_id: A.id, name: 'x' }),
        A.client.from('buddy_members').insert({ group_id: groupId, user_id: C.id, display_name: 'x', role: 'member', disclosure_version: 1 }),
        A.client.from('buddy_invites').insert({ group_id: groupId, created_by: A.id, token_hash: 'a'.repeat(64), expires_at: new Date().toISOString() }),
        A.client.from('buddy_blocks').insert({ blocker_id: A.id, blocked_id: B.id }),
      ]);
      for (const write of writes) expect(write.error).not.toBeNull();
      expect((await A.client.from('buddy_groups').update({ name: 'renamed' }).eq('id', groupId).select('id')).data ?? []).toEqual([]);
      expect((await A.client.from('buddy_members').delete().eq('group_id', groupId).select('group_id')).data ?? []).toEqual([]);
      expect((await A.client.from('buddy_invites').select('id')).error).not.toBeNull();
      expect((await A.client.from('buddy_blocks').select('blocker_id')).error).not.toBeNull();
      expect((await A.client.from('buddy_members').select('user_id').eq('group_id', groupId)).error).not.toBeNull();
      expect(await memberRows(groupId)).toHaveLength(2);
    });

    it('cannot call the database functions directly', async () => {
      const attempt = await A.client.rpc('buddy_create_group', { p_user_id: A.id, p_name: 'x', p_display_name: 'y', p_disclosure_version: 1 });

      expect(attempt.error).not.toBeNull();
    });
  });

  describe('deletion', () => {
    it('removes a deleted member from the groups they were in and the groups they owned', async () => {
      const mine = await createGroup(D, 'Mine', 'Dana');
      const theirs = await createGroup(A, 'Theirs', 'Alex');
      await join(A, theirs, D, 'Dana');
      await join(D, mine, B, 'Sam');

      await admin.auth.admin.deleteUser(D.id);

      expect((await admin.from('buddy_groups').select('id').eq('id', mine)).data ?? []).toEqual([]);
      expect((await memberRows(theirs)).map((m) => m.user_id)).toEqual([A.id]);
      users.splice(users.indexOf(D), 1);
      D = await createTestUser(admin, 'buddy-d');
      users.push(D);
    });
  });
});
