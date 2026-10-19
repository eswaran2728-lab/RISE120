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
  me: { memberId: string; role: 'owner' | 'member' };
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
  | { kind: 'milestone_not_earned' }
  | { kind: 'share_withdrawn' }
  | { kind: 'reporting_unavailable' }
  | { kind: 'invalid' }
  | { kind: 'offline' }
  | { kind: 'error' };

// A completion milestone: "N workout days". `sharedIn` lists the member's groups it is currently shared into.
export interface Milestone {
  milestone: number;
  sharedIn: string[];
}

// What a group sees of a share: a name and a number. Nothing else ever appears here.
export interface GroupShare {
  memberId: string;
  displayName: string;
  milestone: number;
  sharedAt: string;
  mine: boolean;
}

export type ReportReason = 'harassment' | 'spam' | 'unsafe' | 'other';
