import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// Food photos have their own folder, per account, apart from the check-in photos and never read from them. A photo lives
// here only until the server has answered (or the screen is left); it is also removed on sign-out and account deletion.
const MAX_EDGE = 1280;
const PHOTO_QUALITY = 0.7;

const userDirectory = (userId: string) => new Directory(Paths.document, 'food-photos', userId);

// Downsizes (the longer edge to at most MAX_EDGE) and re-encodes as a JPEG. Re-encoding is expected to drop the picker's
// metadata, but that has not been checked on a phone; the server refuses any upload that carries metadata or anything
// beyond a plain JPEG structure, so a photo that kept some is refused rather than sent on.
export async function saveFoodPhotoLocal(userId: string, pickedUri: string, width?: number, height?: number): Promise<string> {
  let context = ImageManipulator.manipulate(pickedUri);
  if (width && height) {
    if (width >= height && width > MAX_EDGE) context = context.resize({ width: MAX_EDGE });
    else if (height > width && height > MAX_EDGE) context = context.resize({ height: MAX_EDGE });
  }
  const rendered = await context.renderAsync();
  const processed = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_QUALITY });

  const directory = userDirectory(userId);
  directory.create({ idempotent: true, intermediates: true });
  const destination = new File(directory, `${Date.now()}.jpg`);
  const temporary = new File(processed.uri);
  await temporary.copy(destination);
  try {
    temporary.delete();
  } catch {
    // The cache file is the system's to clear.
  }
  return destination.uri;
}

export function removeLocalFoodPhoto(uri: string): void {
  const file = new File(uri);
  if (file.exists) file.delete();
}

// Called on sign-out and account deletion: drop every unsent food photo for that account.
export function removeFoodPhotos(userId: string): void {
  const directory = userDirectory(userId);
  if (directory.exists) directory.delete();
}
