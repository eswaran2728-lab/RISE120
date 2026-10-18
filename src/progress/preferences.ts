// Whether this member has hidden their weight and photos on Progress. Remembered on this phone for this account
// only; nothing here is shared with anyone. An unreadable value means "show", so a damaged setting can never hide
// something the member wanted to see, and hiding is always an explicit choice.
import { readCache, writeCache } from '../cache/userCache';

export async function loadHideBody(userId: string): Promise<boolean> {
  return (await readCache<unknown>(userId, 'prefs')) === true;
}

export const saveHideBody = (userId: string, hidden: boolean) => writeCache(userId, 'prefs', hidden);
