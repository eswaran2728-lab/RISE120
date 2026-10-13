import { Directory, File, Paths } from 'expo-file-system';
import { supabase } from '../lib/supabase';
import type { LocalDate } from '../sync/types';

const BUCKET = 'checkin-photos';
const SIGNED_URL_SECONDS = 3600;

const userDirectory = (userId: string) => new Directory(Paths.document, 'checkin-photos', userId);

// The picker's cache file can be cleared by the system, so keep our own copy until it uploads.
export async function saveLocalPhoto(userId: string, date: LocalDate, pickedUri: string): Promise<string> {
  const directory = userDirectory(userId);
  directory.create({ idempotent: true, intermediates: true });
  const destination = new File(directory, `${date}.jpg`);
  await new File(pickedUri).copy(destination, { overwrite: true });
  return destination.uri;
}

export function localPhotoExists(uri: string): boolean {
  return new File(uri).exists;
}

export function removeLocalPhoto(uri: string): void {
  const file = new File(uri);
  if (file.exists) file.delete();
}

// Called when the account is deleted: drop every unsynced photo for that user.
export function removeLocalPhotos(userId: string): void {
  const directory = userDirectory(userId);
  if (directory.exists) directory.delete();
}

// Photos are JPEG (the picker is asked to re-encode), stored at "<user id>/<date>.jpg" in a
// private bucket. Returns the object path to store in checkins.photo_path.
export async function uploadCheckinPhoto(userId: string, date: LocalDate, localUri: string): Promise<string> {
  const bytes = await new File(localUri).arrayBuffer();
  const path = `${userId}/${date}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error(error.message);
  return path;
}

// Reads use short-lived signed URLs; the bucket is never public.
export async function getPhotoUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !data) return null;
  return data.signedUrl;
}
