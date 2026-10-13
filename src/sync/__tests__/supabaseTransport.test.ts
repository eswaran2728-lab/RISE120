import { supabase } from '../../lib/supabase';
import { supabaseTransport } from '../supabaseTransport';
import { localPhotoExists, uploadCheckinPhoto } from '../../checkin/photos';
import { clearPhotoUri } from '../queue';
import { applyFoodLogToDayCache } from '../../food/dayCache';
import type { CheckinOperation, FoodLogOperation, WorkoutSetOperation } from '../types';

jest.mock('../../food/dayCache', () => ({ applyFoodLogToDayCache: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../queue', () => ({ clearPhotoUri: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../checkin/photos', () => ({
  uploadCheckinPhoto: jest.fn(),
  localPhotoExists: jest.fn().mockReturnValue(true),
  removeLocalPhoto: jest.fn(),
  removeLocalPhotos: jest.fn(),
}));

jest.mock('../../lib/supabase', () => ({
  supabase: { from: jest.fn(), auth: { getSession: jest.fn() } },
}));

const upsert = jest.fn();

const set: WorkoutSetOperation = {
  kind: 'workout_set',
  id: 'set-1',
  date: '2026-10-13',
  exerciseId: 'ex-1',
  setNumber: 2,
  reps: 8,
  weightKg: 22.5,
  updatedAt: 1,
};
const checkin: CheckinOperation = {
  kind: 'checkin',
  date: '2026-10-13',
  weightKg: 70.5,
  mood: 4,
  sleepHours: 7.5,
  photoUri: null,
  updatedAt: 1,
};

describe('supabaseTransport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    upsert.mockResolvedValue({ error: null });
    (supabase.from as jest.Mock).mockReturnValue({ upsert });
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: { user: { id: 'A' } } } });
  });

  it('upserts a workout set on its stable id', async () => {
    await supabaseTransport.upsertWorkoutSet('A', set);

    expect(supabase.from).toHaveBeenCalledWith('workout_logs');
    expect(upsert).toHaveBeenCalledWith(
      { id: 'set-1', user_id: 'A', log_date: '2026-10-13', exercise_id: 'ex-1', set_number: 2, reps: 8, weight_kg: 22.5 },
      { onConflict: 'id' }
    );
  });

  it('upserts a check-in on (user, date) so the latest edit wins', async () => {
    await supabaseTransport.upsertCheckin('A', checkin);

    expect(supabase.from).toHaveBeenCalledWith('checkins');
    expect(upsert).toHaveBeenCalledWith(
      { user_id: 'A', checkin_date: '2026-10-13', weight_kg: 70.5, mood: 4, sleep_hours: 7.5 },
      { onConflict: 'user_id,checkin_date' }
    );
  });

  it('refuses to send when a different account is signed in', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: { user: { id: 'B' } } } });

    await expect(supabaseTransport.upsertWorkoutSet('A', set)).rejects.toThrow();

    expect(upsert).not.toHaveBeenCalled();
  });

  it('refuses to send when nobody is signed in', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: null } });

    await expect(supabaseTransport.upsertCheckin('A', checkin)).rejects.toThrow();
  });

  it('throws the database error so the operation stays queued', async () => {
    upsert.mockResolvedValue({ error: { message: 'Network request failed' } });

    await expect(supabaseTransport.upsertWorkoutSet('A', set)).rejects.toThrow('Network request failed');
  });

  describe('check-in photos', () => {
    const withPhoto: CheckinOperation = { ...checkin, photoUri: 'file:///docs/photo.jpg' };

    it('uploads the photo first, then saves its object path with the check-in', async () => {
      (uploadCheckinPhoto as jest.Mock).mockResolvedValue('A/2026-10-13.jpg');

      await supabaseTransport.upsertCheckin('A', withPhoto);

      expect(uploadCheckinPhoto).toHaveBeenCalledWith('A', '2026-10-13', 'file:///docs/photo.jpg');
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({ photo_path: 'A/2026-10-13.jpg', weight_kg: 70.5 }),
        { onConflict: 'user_id,checkin_date' }
      );
    });

    it('clears the uploaded photo reference from any newer queued edit', async () => {
      (uploadCheckinPhoto as jest.Mock).mockResolvedValue('A/2026-10-13.jpg');

      await supabaseTransport.upsertCheckin('A', withPhoto);

      expect(clearPhotoUri).toHaveBeenCalledWith('A', '2026-10-13', 'file:///docs/photo.jpg');
    });

    it('keeps the check-in pending when the photo upload fails', async () => {
      (uploadCheckinPhoto as jest.Mock).mockRejectedValue(new Error('Network request failed'));

      await expect(supabaseTransport.upsertCheckin('A', withPhoto)).rejects.toThrow('Network request failed');

      expect(upsert).not.toHaveBeenCalled();
    });

    it('does not touch photo_path when the check-in has no new photo', async () => {
      await supabaseTransport.upsertCheckin('A', checkin);

      expect(uploadCheckinPhoto).not.toHaveBeenCalled();
      expect(upsert.mock.calls[0][0]).not.toHaveProperty('photo_path');
    });

    it('skips the upload when the local photo is already gone (uploaded by an earlier flush)', async () => {
      (localPhotoExists as jest.Mock).mockReturnValueOnce(false);

      await supabaseTransport.upsertCheckin('A', withPhoto);

      expect(uploadCheckinPhoto).not.toHaveBeenCalled();
      expect(upsert.mock.calls[0][0]).not.toHaveProperty('photo_path');
    });
  });

  describe('food logs', () => {
    const log: FoodLogOperation = {
      kind: 'food_log', id: 'log-1', date: '2026-10-13', foodId: 'food-1', quantity: 1.5, mealType: 'dinner',
      deleted: false, food: null, updatedAt: 1,
    };
    const deleteEq = jest.fn();
    const deleteChain: { eq: jest.Mock } = { eq: jest.fn() };

    beforeEach(() => {
      deleteEq.mockReset();
      deleteChain.eq.mockReset();
      deleteChain.eq.mockImplementation((column: string, value: unknown) => {
        deleteEq(column, value);
        return deleteEq.mock.calls.length >= 2 ? Promise.resolve({ error: null }) : deleteChain;
      });
      (supabase.from as jest.Mock).mockReturnValue({ upsert, delete: () => deleteChain });
    });

    it('upserts the log on its stable id', async () => {
      await supabaseTransport.upsertFoodLog('A', log);

      expect(supabase.from).toHaveBeenCalledWith('food_logs');
      expect(upsert).toHaveBeenCalledWith(
        { id: 'log-1', user_id: 'A', log_date: '2026-10-13', food_id: 'food-1', quantity: 1.5, meal_type: 'dinner' },
        { onConflict: 'id' }
      );
    });

    it('deletes by log id and owner only', async () => {
      await supabaseTransport.deleteFoodLog('A', { ...log, deleted: true });

      expect(deleteEq.mock.calls).toEqual([['id', 'log-1'], ['user_id', 'A']]);
    });

    it('refuses to send when a different account is signed in', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: { user: { id: 'B' } } } });

      await expect(supabaseTransport.upsertFoodLog('A', log)).rejects.toThrow();
      await expect(supabaseTransport.deleteFoodLog('A', log)).rejects.toThrow();

      expect(upsert).not.toHaveBeenCalled();
      expect(deleteEq).not.toHaveBeenCalled();
    });

    it('throws the database error so the operation stays queued', async () => {
      upsert.mockResolvedValue({ error: { message: 'Network request failed' } });

      await expect(supabaseTransport.upsertFoodLog('A', log)).rejects.toThrow('Network request failed');
    });

    it('throws a delete error so the tombstone stays queued', async () => {
      deleteChain.eq.mockImplementation((column: string, value: unknown) => {
        deleteEq(column, value);
        return deleteEq.mock.calls.length >= 2 ? Promise.resolve({ error: { message: 'Network request failed' } }) : deleteChain;
      });

      await expect(supabaseTransport.deleteFoodLog('A', log)).rejects.toThrow('Network request failed');
    });
  });

  describe('food log day cache', () => {
    const log: FoodLogOperation = {
      kind: 'food_log', id: 'log-1', date: '2026-10-13', foodId: 'food-1', quantity: 1, mealType: 'lunch', deleted: false, food: null, updatedAt: 1,
    };
    const deleteChain: { eq: jest.Mock } = { eq: jest.fn() };

    beforeEach(() => {
      deleteChain.eq.mockReset();
      let calls = 0;
      deleteChain.eq.mockImplementation(() => (++calls >= 2 ? Promise.resolve({ error: null }) : deleteChain));
      (supabase.from as jest.Mock).mockReturnValue({ upsert, delete: () => deleteChain });
    });

    it('records a confirmed upsert in the offline day cache', async () => {
      await supabaseTransport.upsertFoodLog('A', log);

      expect(applyFoodLogToDayCache).toHaveBeenCalledWith('A', log);
    });

    it('records a confirmed delete in the offline day cache', async () => {
      await supabaseTransport.deleteFoodLog('A', { ...log, deleted: true });

      expect(applyFoodLogToDayCache).toHaveBeenCalledWith('A', expect.objectContaining({ deleted: true }));
    });

    it('does not touch the cache when the server write fails', async () => {
      upsert.mockResolvedValue({ error: { message: 'Network request failed' } });

      await expect(supabaseTransport.upsertFoodLog('A', log)).rejects.toThrow();

      expect(applyFoodLogToDayCache).not.toHaveBeenCalled();
    });
  });
});
