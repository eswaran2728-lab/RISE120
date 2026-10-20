import { removeFoodPhotos, removeLocalFoodPhoto, saveFoodPhotoLocal } from '../files';

const mockFiles: Record<string, { exists: boolean; copy: jest.Mock; delete: jest.Mock }> = {};
const mockDirs: Record<string, { exists: boolean; create: jest.Mock; delete: jest.Mock }> = {};

jest.mock('expo-file-system', () => {
  const join = (parts: unknown[]) => parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
  return {
    Paths: { document: { uri: 'file:///docs' } },
    File: jest.fn().mockImplementation((...parts: unknown[]) => {
      const uri = join(parts);
      mockFiles[uri] ??= { exists: true, copy: jest.fn().mockResolvedValue(undefined), delete: jest.fn() };
      return Object.assign(mockFiles[uri], { uri });
    }),
    Directory: jest.fn().mockImplementation((...parts: unknown[]) => {
      const uri = join(parts);
      mockDirs[uri] ??= { exists: true, create: jest.fn(), delete: jest.fn() };
      return Object.assign(mockDirs[uri], { uri });
    }),
  };
});

const mockSaveAsync = jest.fn();
const mockResize = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: jest.fn().mockImplementation(() => {
      const context = { resize: (size: unknown) => (mockResize(size), context), renderAsync: async () => ({ saveAsync: mockSaveAsync }) };
      return context;
    }),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockFiles).forEach((k) => delete mockFiles[k]);
  Object.keys(mockDirs).forEach((k) => delete mockDirs[k]);
  mockSaveAsync.mockResolvedValue({ uri: 'file:///cache/processed.jpg' });
});

describe('local food photos', () => {
  it('re-encodes as a JPEG, downsized to a bounded long edge, into a per-account folder that is not the check-in folder', async () => {
    const uri = await saveFoodPhotoLocal('A', 'file:///cache/picked.jpg', 4000, 3000);

    expect(mockResize).toHaveBeenCalledWith({ width: 1280 });
    expect(mockSaveAsync).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.7 });
    expect(uri.startsWith('file:///docs/food-photos/A/')).toBe(true);
    expect(uri).not.toContain('checkin-photos');
    expect(uri.endsWith('.jpg')).toBe(true);
  });

  it('resizes by the height when the photo is taller than it is wide', async () => {
    await saveFoodPhotoLocal('A', 'file:///cache/picked.jpg', 3000, 4000);

    expect(mockResize).toHaveBeenCalledWith({ height: 1280 });
  });

  it('does not resize a photo that is already small', async () => {
    await saveFoodPhotoLocal('A', 'file:///cache/picked.jpg', 800, 600);

    expect(mockResize).not.toHaveBeenCalled();
  });

  it('removes the temporary file the re-encoder wrote, once the copy is kept', async () => {
    await saveFoodPhotoLocal('A', 'file:///cache/picked.jpg', 800, 600);

    expect(mockFiles['file:///cache/processed.jpg'].delete).toHaveBeenCalled();
  });

  it('removes one local photo', () => {
    removeLocalFoodPhoto('file:///docs/food-photos/A/x.jpg');

    expect(mockFiles['file:///docs/food-photos/A/x.jpg'].delete).toHaveBeenCalled();
  });

  it('removes every food photo of one account only (sign-out and account deletion)', () => {
    removeFoodPhotos('A');

    expect(mockDirs['file:///docs/food-photos/A'].delete).toHaveBeenCalled();
    expect(mockDirs['file:///docs/food-photos/B']).toBeUndefined();
  });

  it('does not fail when there is nothing to remove', () => {
    const { Directory } = jest.requireMock('expo-file-system');
    Directory.mockImplementationOnce(() => ({ exists: false, delete: jest.fn() }));

    expect(() => removeFoodPhotos('A')).not.toThrow();
  });
});
