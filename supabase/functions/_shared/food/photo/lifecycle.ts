// Where food photos live and how they are removed. Only the "food-photos" bucket is ever touched here; check-in photos
// are a different bucket and are never read or deleted by this code. Files are removed through the Storage API, because
// deleting storage.objects rows with SQL would leave the files orphaned.
// deno-lint-ignore no-explicit-any
type Db = any;

export const FOOD_PHOTO_BUCKET = 'food-photos';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

// The one object name a member's request may use: their folder, the request id, .jpg.
export const foodPhotoPath = (userId: string, requestId: string) => `${userId}/${requestId}.jpg`;

export function isFoodPhotoPath(userId: string, path: string): boolean {
  return new RegExp(`^${userId}/${UUID}\\.jpg$`, 'i').test(path);
}

// Removing something that is already gone is not an error, so cleanup can be repeated.
export async function deletePhotoImage(db: Db, path: string): Promise<void> {
  const { error } = await db.storage.from(FOOD_PHOTO_BUCKET).remove([path]);
  if (error) throw new Error('food_photo_delete_failed');
}

async function removeAll(db: Db, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await db.storage.from(FOOD_PHOTO_BUCKET).remove(paths.slice(i, i + 100));
    if (error) throw new Error('food_photo_delete_failed');
  }
}

// Removes the images of finished requests at once, and anything older than the retention period (abandoned uploads, and
// requests that never finished). Never throws for one bad batch without having recorded what it did delete.
export async function runPhotoCleanup(db: Db, options: { retentionHours?: number } = {}): Promise<{ deleted: number }> {
  const finished = await db.rpc('food_photo_finished_images');
  if (finished.error) throw new Error('food_photo_cleanup_failed');
  const expired = await db.rpc('food_photo_expired_images', { p_retention_hours: options.retentionHours ?? null });
  if (expired.error) throw new Error('food_photo_cleanup_failed');

  const paths = [...new Set<string>([...((finished.data ?? []) as string[]), ...((expired.data ?? []) as string[])])];
  if (paths.length === 0) return { deleted: 0 };
  await removeAll(db, paths);
  const marked = await db.rpc('food_photo_mark_images_deleted', { p_paths: paths });
  if (marked.error) throw new Error('food_photo_cleanup_failed');
  return { deleted: paths.length };
}
