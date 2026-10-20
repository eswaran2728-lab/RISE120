// The Supabase side of the food-photo request ledger (service role only; the user id must come from a verified token).
// reserve decides admission; complete stores the one bounded result; fail records a KNOWN failure. An unresolved
// reservation answers in_progress and is never started a second time.
// deno-lint-ignore no-explicit-any
type Db = any;

// What a stored result may hold: references to existing records and display text, never nutrition from the picture.
export type PhotoResult = Record<string, unknown>;

export type PhotoAdmission =
  | { status: 'reserved'; resetsAt: string }
  | { status: 'in_progress'; resetsAt: string }
  | { status: 'completed'; result: PhotoResult; resetsAt: string }
  | { status: 'limited'; resetsAt: string }
  | { status: 'unavailable'; reason: 'disabled' | 'premium_required' | 'config' };

export async function reservePhotoRequest(db: Db, userId: string, requestId: string, imagePath: string): Promise<PhotoAdmission> {
  const { data, error } = await db.rpc('food_photo_reserve', { p_user_id: userId, p_request_id: requestId, p_image_path: imagePath });
  if (error || !data) throw new Error('food_photo_reserve_failed');
  return {
    status: data.status,
    ...(data.reason ? { reason: data.reason } : {}),
    ...(data.result ? { result: data.result } : {}),
    ...(data.resets_at ? { resetsAt: new Date(data.resets_at).toISOString() } : {}),
  } as PhotoAdmission;
}

export async function completePhotoRequest(db: Db, userId: string, requestId: string, result: PhotoResult): Promise<{ status: string; result?: PhotoResult }> {
  const { data, error } = await db.rpc('food_photo_complete', { p_user_id: userId, p_request_id: requestId, p_result: result });
  if (error || !data) throw new Error('food_photo_complete_failed');
  return { status: data.status, ...(data.result ? { result: data.result } : {}) };
}

export async function failPhotoRequest(db: Db, userId: string, requestId: string): Promise<{ status: string }> {
  const { data, error } = await db.rpc('food_photo_fail', { p_user_id: userId, p_request_id: requestId });
  if (error || !data) throw new Error('food_photo_fail_failed');
  return { status: data.status };
}
