import { supabase } from '../../lib/supabase';
import { getPhotoUrl, localPhotoExists, removeLocalPhotos, saveLocalPhoto, uploadCheckinPhoto } from '../photos';

const mockFiles: Record<string, { exists: boolean; copy: jest.Mock; delete: jest.Mock; arrayBuffer: jest.Mock }> = {};
const mockDirs: Record<string, { exists: boolean; create: jest.Mock; delete: jest.Mock }> = {};

jest.mock('expo-file-system', () => {
  const join = (parts: unknown[]) => parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
  return {
    Paths: { document: { uri: 'file:///docs' } },
    File: jest.fn().mockImplementation((...parts: unknown[]) => {
      const uri = join(parts);
      mockFiles[uri] ??= { exists: true, copy: jest.fn().mockResolvedValue(undefined), delete: jest.fn(), arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)) };
      return Object.assign(mockFiles[uri], { uri });
    }),
    Directory: jest.fn().mockImplementation((...parts: unknown[]) => {
      const uri = join(parts);
      mockDirs[uri] ??= { exists: true, create: jest.fn(), delete: jest.fn() };
      return Object.assign(mockDirs[uri], { uri });
    }),
  };
});

jest.mock('../../lib/supabase', () => ({
  supabase: { storage: { from: jest.fn() } },
}));

const upload = jest.fn();
const createSignedUrl = jest.fn();

describe('check-in photos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(mockFiles)) delete mockFiles[key];
    for (const key of Object.keys(mockDirs)) delete mockDirs[key];
    upload.mockResolvedValue({ error: null });
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed.example/photo' }, error: null });
    (supabase.storage.from as jest.Mock).mockReturnValue({ upload, createSignedUrl });
  });

  it('copies a picked photo into the per-user documents folder', async () => {
    const saved = await saveLocalPhoto('u1', '2026-10-13', 'file:///cache/picked.jpg');

    expect(saved).toBe('file:///docs/checkin-photos/u1/2026-10-13.jpg');
    expect(mockFiles['file:///cache/picked.jpg'].copy).toHaveBeenCalledWith(
      expect.objectContaining({ uri: 'file:///docs/checkin-photos/u1/2026-10-13.jpg' }),
      { overwrite: true }
    );
    expect(mockDirs['file:///docs/checkin-photos/u1'].create).toHaveBeenCalledWith({ idempotent: true, intermediates: true });
  });

  it('removes every local photo for an account', () => {
    removeLocalPhotos('u1');

    expect(mockDirs['file:///docs/checkin-photos/u1'].delete).toHaveBeenCalled();
  });

  it('does nothing when the account has no local photos', () => {
    mockDirs['file:///docs/checkin-photos/u1'] = { exists: false, create: jest.fn(), delete: jest.fn() };

    removeLocalPhotos('u1');

    expect(mockDirs['file:///docs/checkin-photos/u1'].delete).not.toHaveBeenCalled();
  });

  it('uploads into the private bucket under the user folder and returns the object path', async () => {
    const path = await uploadCheckinPhoto('u1', '2026-10-13', 'file:///docs/checkin-photos/u1/2026-10-13.jpg');

    expect(path).toBe('u1/2026-10-13.jpg');
    expect(supabase.storage.from).toHaveBeenCalledWith('checkin-photos');
    expect(upload).toHaveBeenCalledWith('u1/2026-10-13.jpg', expect.any(ArrayBuffer), {
      contentType: 'image/jpeg',
      upsert: true,
    });
  });

  it('throws when the upload fails so the photo stays pending', async () => {
    upload.mockResolvedValue({ error: { message: 'Network request failed' } });

    await expect(uploadCheckinPhoto('u1', '2026-10-13', 'file:///x.jpg')).rejects.toThrow('Network request failed');
  });

  it('creates a short-lived signed URL for reading', async () => {
    expect(await getPhotoUrl('u1/2026-10-13.jpg')).toBe('https://signed.example/photo');
    expect(createSignedUrl).toHaveBeenCalledWith('u1/2026-10-13.jpg', 3600);
  });

  it('returns null when no signed URL can be made', async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: 'not found' } });

    expect(await getPhotoUrl('u1/missing.jpg')).toBeNull();
  });

  it('reports whether a local photo file still exists', () => {
    mockFiles['file:///docs/a.jpg'] = { exists: true, copy: jest.fn(), delete: jest.fn(), arrayBuffer: jest.fn() };
    mockFiles['file:///docs/b.jpg'] = { exists: false, copy: jest.fn(), delete: jest.fn(), arrayBuffer: jest.fn() };

    expect(localPhotoExists('file:///docs/a.jpg')).toBe(true);
    expect(localPhotoExists('file:///docs/b.jpg')).toBe(false);
  });
});
