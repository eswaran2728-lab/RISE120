import React from 'react';
import { useSession } from './useSession';

// Wraps a screen that keeps an account's data in its own state. The screen is created afresh for every account
// (and again if the first account signs back in), so nothing loaded for one account can still be showing, or
// still be saving, when another account is signed in. A late result from the old instance lands on an unmounted
// screen and is dropped.
export function withAccountKey<P extends object>(Screen: React.ComponentType<P>) {
  function AccountScoped(props: P) {
    const { session } = useSession();
    return <Screen key={session?.user?.id ?? 'signed-out'} {...props} />;
  }
  AccountScoped.displayName = `AccountScoped(${Screen.displayName ?? Screen.name ?? 'Screen'})`;
  AccountScoped.accountScoped = true as const;
  return AccountScoped;
}
