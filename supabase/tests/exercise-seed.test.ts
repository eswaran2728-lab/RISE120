import { createAdmin, createTestUser, TestUser } from './helpers';

jest.setTimeout(60000);

const EXPECTED: Record<string, string[]> = {
  gym: ['Goblet squat', 'Dumbbell Romanian deadlift', 'Chest press machine', 'Seated cable row', 'Plank'],
  home: ['Chair squat', 'Unloaded hip hinge', 'Countertop incline push-up', 'Prone W raise', 'Dead bug'],
  none: ['Bodyweight squat', 'Glute bridge', 'Wall push-up', 'Prone W raise', 'Dead bug'],
};
const PATTERNS = ['squat', 'hinge', 'push', 'pull', 'core'];

describe('exercise library seed (live)', () => {
  const admin = createAdmin();
  let user: TestUser;

  beforeAll(async () => {
    user = await createTestUser(admin, 'seed');
  });

  afterAll(async () => {
    if (user) await admin.auth.admin.deleteUser(user.id);
  });

  it.each(Object.keys(EXPECTED))('has the five movement patterns for %s, with instructions', async (equipment) => {
    const { data, error } = await admin.from('exercises').select('name, muscle_group, instructions').eq('equipment', equipment);

    expect(error).toBeNull();
    const rows = data ?? [];
    expect(rows).toHaveLength(5);
    for (const [index, name] of EXPECTED[equipment].entries()) {
      const row = rows.find((r) => r.muscle_group === PATTERNS[index]);
      expect(row?.name).toBe(name);
      expect((row?.instructions ?? '').length).toBeGreaterThan(20);
    }
  });

  it('lets a signed-in user read exercises but not change them', async () => {
    const read = await user.client.from('exercises').select('id').eq('equipment', 'gym');
    expect(read.error).toBeNull();
    expect((read.data ?? []).length).toBe(5);

    const insert = await user.client
      .from('exercises')
      .insert({ name: 'x', muscle_group: 'core', equipment: 'gym', instructions: 'x' });
    expect(insert.error).not.toBeNull();

    const update = await user.client.from('exercises').update({ name: 'hacked' }).eq('equipment', 'gym').select();
    expect(update.data ?? []).toEqual([]);
  });
});
