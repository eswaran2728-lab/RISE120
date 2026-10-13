// In-memory AsyncStorage shared across module re-imports, so tests can simulate an app restart.
export const mockStore = new Map<string, string>();

export const asyncStorageMock = {
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
};
