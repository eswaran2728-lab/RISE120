import React, { useState } from 'react';
import { Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { withAccountKey } from '../withAccountKey';

let mockUserId: string | null = 'A';
jest.mock('../useSession', () => ({ useSession: () => ({ session: mockUserId ? { user: { id: mockUserId } } : null }) }));

let mounts = 0;
let latestSetter: (v: string) => void = () => undefined;
function Inner() {
  const [shown, setShown] = useState(`state of ${mockUserId}`);
  React.useEffect(() => {
    mounts += 1;
  }, []);
  React.useEffect(() => {
    latestSetter = setShown;
  }, [setShown]);
  return <Text>{shown}</Text>;
}
const Screen = withAccountKey(Inner);

const textOf = (tree: ReturnType<typeof create>) => JSON.stringify(tree.toJSON());

beforeEach(() => {
  mockUserId = 'A';
  mounts = 0;
});

describe('withAccountKey', () => {
  it('keeps the screen and its state while the same account stays signed in', async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<Screen />);
    });
    await act(async () => latestSetter('typed by A'));

    await act(async () => tree.update(<Screen />));

    expect(textOf(tree)).toContain('typed by A');
    expect(mounts).toBe(1);
  });

  it('starts a fresh screen when another account signs in, so nothing from the first account can remain', async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<Screen />);
    });
    await act(async () => latestSetter('private data of A'));

    mockUserId = 'B';
    await act(async () => tree.update(<Screen />));

    expect(textOf(tree)).not.toContain('private data of A');
    expect(textOf(tree)).toContain('state of B');
    expect(mounts).toBe(2);
  });

  it('starts fresh again when A signs back in (A to B to A)', async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<Screen />);
    });
    await act(async () => latestSetter('first A session'));
    mockUserId = 'B';
    await act(async () => tree.update(<Screen />));
    mockUserId = 'A';
    await act(async () => tree.update(<Screen />));

    expect(textOf(tree)).not.toContain('first A session');
    expect(mounts).toBe(3);
  });

  it('marks the wrapped screen so a test can check every private tab uses it', () => {
    expect((Screen as unknown as { accountScoped?: boolean }).accountScoped).toBe(true);
  });
});
