import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { supabase } from '../lib/supabase';
import type { LocalDate } from '../sync/types';

const BUCKET = 'checkin-photos';
const SIGNED_URL_SECONDS = 3600;
// The bucket accepts up to 5 MB; phone cameras easily exceed that, so photos are downsized and re-encoded.
const MAX_PHOTO_WIDTH = 1600;
const PHOTO_QUALITY = 0.7;

const userDirectory = (userId: string) => new Directory(Paths.document, 'checkin-photos', userId);

// The picker's cache file can be cleared by the system, so keep our own copy until it uploads.
// The photo is downsized (if wide) and re-encoded as JPEG, and each pick gets its own file so
// choosing another photo never replaces one that is still waiting to upload.
export async function saveLocalPhoto(userId: string, date: LocalDate, pickedUri: string, pickedWidth?: number): Promise<string> {
  let context = ImageManipulator.manipulate(pickedUri);
  if (pickedWidth && pickedWidth > MAX_PHOTO_WIDTH) context = context.resize({ width: MAX_PHOTO_WIDTH });
  const rendered = await context.renderAsync();
  const processed = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_QUALITY });

  const directory = userDirectory(userId);
  directory.create({ idempotent: true, intermediates: true });
  const destination = new File(directory, `${date}-${Date.now()}.jpg`);
  await new File(processed.uri).copy(destination, { overwrite: true });
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
