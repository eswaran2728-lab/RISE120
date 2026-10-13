import { supabase } from '../../lib/supabase';
import { supabaseTransport } from '../supabaseTransport';
import { localPhotoExists, uploadCheckinPhoto } from '../../checkin/photos';
import type { CheckinOperation, WorkoutSetOperation } from '../types';

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
});
