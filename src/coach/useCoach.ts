import { useCallback, useEffect, useRef, useState } from 'react';
import { clearCache } from '../cache/userCache';
import { useSession } from '../auth/useSession';
import { LimitSnapshot, loadLimitsOrCached } from '../monetization/limits';
import { loadPlanBundle, refreshPlanBundle } from '../plan/planData';
import { notifyPlanChanged } from '../plan/planEvents';
import { newLogId } from '../food/log';
import { decideProposal, loadHistory, sendCoachMessage, SendResult } from './api';
import { readCoachCache, setCachedProposalStatus, writeCoachCache } from './cache';
import { mergeHistory, retrySecondsLeft, upsertExchange, withProposalStatus } from './state';
import { CoachExchange, COACH_MESSAGE_MAX_CHARS, ProposalStatus } from './types';

// What a send is doing, or how it ended. Anything the server did not clearly finish keeps its request id so that
// checking again can never create a second answer; a new model request is always an explicit tap.
export type AttemptPhase = 'sending' | 'limit' | 'rate_limited' | 'in_progress' | 'unavailable' | 'unknown' | 'offline' | 'invalid' | 'error';

export interface Attempt {
  requestId: string;
  message: string;
  phase: AttemptPhase;
  resetsAt: string | null;
  retryAt: string | null;
}

export type RefreshState = 'refreshing' | 'failed' | 'done';

// Everything the screen shows belongs to ONE account. A result that arrives for an account that is no longer
// the signed-in one is dropped, and a view for another account is never displayed.
interface CoachView {
  userId: string;
  history: CoachExchange[];
  historyState: 'loading' | 'ready' | 'offline' | 'error';
  limits: { snapshot: LimitSnapshot; stale: boolean } | null;
  plan: { startDate: string; names: Record<string, string> } | null;
  draft: string;
  attempt: Attempt | null;
  proposalDropped: boolean;
  deciding: Record<string, boolean>;
  decisionError: Record<string, boolean>;
  refresh: Record<string, RefreshState>;
}

const initialView = (userId: string): CoachView => ({
  userId,
  history: [],
  historyState: 'loading',
  limits: null,
  plan: null,
  draft: '',
  attempt: null,
  proposalDropped: false,
  deciding: {},
  decisionError: {},
  refresh: {},
});

const PHASE_BY_RESULT: Partial<Record<SendResult['kind'], AttemptPhase>> = {
  in_progress: 'in_progress',
  unavailable: 'unavailable',
  unknown_outcome: 'unknown',
  offline: 'offline',
  invalid: 'invalid',
  error: 'error',
};

export function useCoach() {
  const { session } = useSession();
  const userId = session?.user?.id ?? null;
  const [state, setState] = useState<CoachView | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const view = userId && state?.userId === userId ? state : userId ? initialView(userId) : null;

  const activeUser = useRef(userId);
  const viewRef = useRef<CoachView | null>(view);
  const sending = useRef(new Set<string>()); // accounts with a send in flight
  const deciding = useRef(new Set<string>());

  useEffect(() => {
    activeUser.current = userId;
  }, [userId]);
  useEffect(() => {
    viewRef.current = view;
  });

  // Applies a change only if that account is still the one on screen.
  const patch = useCallback((forUser: string, change: (current: CoachView) => CoachView) => {
    if (activeUser.current !== forUser) return;
    setState((prev) => {
      const next = change(prev?.userId === forUser ? prev : initialView(forUser));
      viewRef.current = next;
      return next;
    });
  }, []);

  const refreshLimits = useCallback(
    async (forUser: string) => {
      const limits = await loadLimitsOrCached(forUser);
      patch(forUser, (v) => ({ ...v, limits }));
    },
    [patch]
  );

  const loadHistoryFor = useCallback(
    async (forUser: string) => {
      try {
        const server = await loadHistory(forUser);
        patch(forUser, (v) => {
          const history = mergeHistory(server, v.history);
          void writeCoachCache(forUser, history);
          return { ...v, history, historyState: 'ready' };
        });
      } catch {
        // Offline: show what this account saved on the phone, and say so.
        const cached = await readCoachCache(forUser);
        patch(forUser, (v) => (cached ? { ...v, history: mergeHistory(cached, v.history), historyState: 'offline' } : { ...v, historyState: 'error' }));
      }
    },
    [patch]
  );

  const loadPlanNames = useCallback(
    async (forUser: string) => {
      const bundle = await loadPlanBundle(forUser).catch(() => null);
      if (!bundle) return;
      patch(forUser, (v) => ({ ...v, plan: { startDate: bundle.plan.startDate, names: Object.fromEntries(bundle.exercises.map((e) => [e.id, e.name])) } }));
    },
    [patch]
  );

  // Called when the tab is shown, and again for a manual retry.
  const loadAll = useCallback(
    async (forUser: string) => {
      await Promise.all([loadHistoryFor(forUser), refreshLimits(forUser), loadPlanNames(forUser)]);
    },
    [loadHistoryFor, refreshLimits, loadPlanNames]
  );

  const retryHistory = useCallback(() => {
    if (!userId) return;
    patch(userId, (v) => ({ ...v, historyState: 'loading' }));
    void loadHistoryFor(userId);
  }, [userId, patch, loadHistoryFor]);

  const setDraft = useCallback(
    (draft: string) => {
      if (userId) patch(userId, (v) => ({ ...v, draft: draft.slice(0, COACH_MESSAGE_MAX_CHARS) }));
    },
    [userId, patch]
  );

  const run = useCallback(
    async (forUser: string, requestId: string, message: string) => {
      if (sending.current.has(forUser)) return;
      sending.current.add(forUser);
      patch(forUser, (v) => ({ ...v, attempt: { requestId, message, phase: 'sending', resetsAt: null, retryAt: null }, proposalDropped: false }));
      let result: SendResult;
      try {
        result = await sendCoachMessage(requestId, message);
      } finally {
        sending.current.delete(forUser);
      }
      setNow(Date.now());

      if (result.kind === 'answered') {
        patch(forUser, (v) => {
          const history = upsertExchange(v.history, result.exchange);
          void writeCoachCache(forUser, history);
          return { ...v, history, draft: '', attempt: null, proposalDropped: result.proposalDropped };
        });
        void refreshLimits(forUser);
        return;
      }
      const phase: AttemptPhase = result.kind === 'limit' ? 'limit' : result.kind === 'rate_limited' ? 'rate_limited' : PHASE_BY_RESULT[result.kind] ?? 'error';
      patch(forUser, (v) => ({
        ...v,
        attempt: {
          requestId,
          message,
          phase,
          resetsAt: result.kind === 'limit' ? result.resetsAt : null,
          retryAt: result.kind === 'rate_limited' ? result.retryAt : null,
        },
      }));
      if (result.kind === 'limit') void refreshLimits(forUser);
    },
    [patch, refreshLimits]
  );

  // The Send button. The same unsent message keeps its request id, so a retry can never make a second answer;
  // a different message gets a new one.
  const send = useCallback(async () => {
    const v = viewRef.current;
    if (!v || !userId || sending.current.has(userId)) return;
    const message = v.draft.trim();
    if (!message || message.length > COACH_MESSAGE_MAX_CHARS) return;
    const attempt = v.attempt;
    if (attempt?.phase === 'rate_limited' && retrySecondsLeft(attempt.retryAt, Date.now()) > 0) return;
    const reuse = attempt && attempt.message === message && attempt.phase !== 'sending';
    await run(userId, reuse ? attempt.requestId : newLogId(), message);
  }, [userId, run]);

  // Ask the server again about the SAME request: it returns the stored answer, or says it is still working.
  const checkAgain = useCallback(async () => {
    const attempt = viewRef.current?.attempt;
    if (userId && attempt) await run(userId, attempt.requestId, attempt.message);
  }, [userId, run]);

  // An explicit new question after an unknown outcome: a new request id.
  const askAgain = useCallback(async () => {
    const attempt = viewRef.current?.attempt;
    if (userId && attempt) await run(userId, newLogId(), attempt.message);
  }, [userId, run]);

  // Drops the plan copy that is now out of date, then reads the new one. A failure is shown, never hidden.
  const refreshPlan = useCallback(
    async (forUser: string, proposalId: string) => {
      patch(forUser, (v) => ({ ...v, refresh: { ...v.refresh, [proposalId]: 'refreshing' } }));
      try {
        const bundle = await refreshPlanBundle(forUser);
        patch(forUser, (v) => ({
          ...v,
          refresh: { ...v.refresh, [proposalId]: 'done' },
          plan: bundle ? { startDate: bundle.plan.startDate, names: Object.fromEntries(bundle.exercises.map((e) => [e.id, e.name])) } : v.plan,
        }));
      } catch {
        patch(forUser, (v) => ({ ...v, refresh: { ...v.refresh, [proposalId]: 'failed' } }));
      }
    },
    [patch]
  );

  const decide = useCallback(
    async (proposalId: string, decision: 'accept' | 'decline') => {
      if (!userId || deciding.current.has(proposalId)) return;
      const forUser = userId;
      deciding.current.add(proposalId);
      patch(forUser, (v) => ({ ...v, deciding: { ...v.deciding, [proposalId]: true }, decisionError: { ...v.decisionError, [proposalId]: false } }));
      let result;
      try {
        result = await decideProposal(proposalId, decision);
      } finally {
        deciding.current.delete(proposalId);
      }

      const stillHere = activeUser.current === forUser;
      const record = (status: ProposalStatus) => {
        if (stillHere) {
          patch(forUser, (v) => {
            const history = withProposalStatus(v.history, proposalId, status);
            void writeCoachCache(forUser, history);
            return { ...v, history, deciding: { ...v.deciding, [proposalId]: false } };
          });
        } else {
          void setCachedProposalStatus(forUser, proposalId, status);
        }
      };

      if (result.kind === 'accepted') {
        record('accepted');
        // The plan changed on the server, so this account's saved copy is out of date whoever is signed in now.
        notifyPlanChanged(forUser);
        await clearCache(forUser, 'plan').catch(() => undefined);
        if (stillHere) await refreshPlan(forUser, proposalId);
      } else if (result.kind === 'declined') {
        record('declined');
      } else if (result.kind === 'stale') {
        record('stale');
      } else if (result.kind === 'conflict' || result.kind === 'not_found') {
        patch(forUser, (v) => ({ ...v, deciding: { ...v.deciding, [proposalId]: false } }));
        await loadHistoryFor(forUser); // show what the server actually has
      } else {
        patch(forUser, (v) => ({ ...v, deciding: { ...v.deciding, [proposalId]: false }, decisionError: { ...v.decisionError, [proposalId]: true } }));
      }
    },
    [userId, patch, refreshPlan, loadHistoryFor]
  );

  const retryRefresh = useCallback(
    async (proposalId: string) => {
      if (userId) await refreshPlan(userId, proposalId);
    },
    [userId, refreshPlan]
  );

  // The retry countdown only displays the server's time; it never sends anything.
  const rateLimited = view?.attempt?.phase === 'rate_limited';
  useEffect(() => {
    if (!rateLimited) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [rateLimited]);

  const secondsLeft = view?.attempt?.phase === 'rate_limited' ? retrySecondsLeft(view.attempt.retryAt, now) : 0;

  return { userId, view, secondsLeft, setDraft, send, checkAgain, askAgain, decide, retryRefresh, retryHistory, loadAll, refreshLimits };
}
