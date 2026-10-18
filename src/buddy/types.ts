// What the app knows about a buddy group. By design this is very little: a name, display names and roles, and
// the days a member logged a workout. No account ids, weights, photos, meals or coach text ever appear here.
export interface BuddyMember {
  memberId: string; // a random id for this group only, not an account id
  displayName: string;
  role: 'owner' | 'member';
}

export interface BuddyGroup {
  id: string;
  name: string;
  members: BuddyMember[];
}

export interface MemberDays {
  memberId: string;
  displayName: string;
  days: string[]; // YYYY-MM-DD with at least one logged workout
}

export type BuddyFailure =
  | { kind: 'invite_unavailable' } // unknown, used, revoked, expired or blocked: the same answer on purpose
  | { kind: 'not_found' }
  | { kind: 'not_owner' }
  | { kind: 'group_full' }
  | { kind: 'limit_reached' }
  | { kind: 'already_member' }
  | { kind: 'disclosure_required' }
  | { kind: 'invalid' }
  | { kind: 'offline' }
  | { kind: 'error' };
