import type { BuddyFailure } from './types';

// The text key for each way a buddy request can fail.
export const MESSAGE: Record<BuddyFailure['kind'], string> = {
  invite_unavailable: 'buddy.inviteUnavailable',
  group_full: 'buddy.groupFull',
  already_member: 'buddy.alreadyMember',
  limit_reached: 'buddy.limitReached',
  offline: 'buddy.offline',
  not_found: 'buddy.error',
  not_owner: 'buddy.error',
  disclosure_required: 'buddy.needDisclosure',
  milestone_not_earned: 'buddy.milestoneNotEarned',
  share_withdrawn: 'buddy.shareWithdrawn',
  reporting_unavailable: 'buddy.reportClosed',
  invalid: 'buddy.error',
  error: 'buddy.error',
};
