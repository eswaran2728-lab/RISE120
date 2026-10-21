import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import { supabase } from '../lib/supabase';
import { tokens } from '../theme/tokens';
import { ActionButton } from '../ui/ActionButton';
import { SectionCard } from '../ui/SectionCard';
import { Availability, healthConnectAdapter } from './adapter';
import { connectHealth, disconnectHealth } from './connection';
import { deviceOffsetAt } from './days';
import { loadHealth } from './store';
import { HealthDeps, syncHealth } from './sync';
import { HealthMetric, HealthState } from './types';

const PLAY_STORE = 'market://details?id=com.google.android.apps.healthdata';
const SHOWN_DAYS = 7;

interface Props {
  userId: string;
  deps?: HealthDeps;
  openUrl?: (url: string) => Promise<unknown>;
}

// Optional Android Health Connect link: steps and sleep, read-only. It is off until the member taps Connect, says where the
// numbers come from and when they were last read, keeps everything the member typed separate, and never changes a target.
export function HealthSection({ userId, deps, openUrl = (url) => Linking.openURL(url) }: Props) {
  const alive = useRef(true);
  const lock = useRef(false);
  const [state, setState] = useState<HealthState | null>(null);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const resolved: HealthDeps = deps ?? { adapter: healthConnectAdapter, now: () => new Date(), offsetAt: deviceOffsetAt, currentUserId: async () => (await supabase.auth.getSession()).data.session?.user?.id ?? null };

  const refresh = useCallback(async () => {
    const loaded = await loadHealth(userId);
    if (alive.current) setState(loaded);
  }, [userId]);

  const explain = (outcome: Awaited<ReturnType<typeof syncHealth>>) => {
    if (outcome.kind === 'failed') setMessage(t('health.syncFailed'));
    else if (outcome.kind === 'permission_lost') setMessage(t('health.permissionLost'));
    else if (outcome.kind === 'unsupported') setAvailability(outcome.availability);
    else if (outcome.kind === 'ok' && outcome.missing.length > 0) setMessage(t('health.partial', { missing: outcome.missing.map((m) => t(`health.${m}`)).join(', ') }));
    else setMessage(null);
  };

  // On opening: look at the device, and if the member is already connected, read.
  useEffect(() => {
    alive.current = true;
    void (async () => {
      const available = await resolved.adapter.availability().catch((): Availability => 'unsupported');
      if (!alive.current) return;
      setAvailability(available);
      const loaded = await loadHealth(userId);
      if (!alive.current) return;
      setState(loaded);
      if (loaded.status === 'connected') {
        const outcome = await syncHealth(userId, resolved);
        if (!alive.current) return;
        explain(outcome);
        await refresh();
      }
    })();
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // One action at a time; a second tap before the first finishes is ignored.
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await action();
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const connect = () =>
    run(async () => {
      setMessage(null);
      const outcome = await connectHealth(userId, resolved);
      if (!alive.current) return;
      if (outcome.kind === 'denied') setMessage(t('health.denied'));
      else if (outcome.kind === 'error') setMessage(t('health.error'));
      else if (outcome.kind === 'connected') {
        if (outcome.partial.length > 0) setMessage(t('health.partial', { missing: outcome.partial.map((m: HealthMetric) => t(`health.${m}`)).join(', ') }));
        else explain(outcome.sync);
      } else if (outcome.kind !== 'stale_account') setAvailability(outcome.kind);
      await refresh();
    });

  const sync = () =>
    run(async () => {
      explain(await syncHealth(userId, resolved));
      if (alive.current) await refresh();
    });

  const disconnect = () =>
    run(async () => {
      const outcome = await disconnectHealth(userId, resolved);
      if (!alive.current) return;
      setAsking(false);
      setMessage(t('health.disconnected') + ' ' + t(outcome.revoked ? 'health.restartNote' : 'health.revokeManually'));
      await refresh();
    });

  if (state === null || availability === null) {
    return (
      <SectionCard title={t('health.title')}>
        <ActivityIndicator color={tokens.color.accent} />
      </SectionCard>
    );
  }

  const connected = state.status === 'connected';
  const days = [...new Set([...Object.keys(state.steps), ...Object.keys(state.sleep)])].sort().reverse().slice(0, SHOWN_DAYS);
  const origins = [...new Set([...Object.values(state.steps), ...Object.values(state.sleep)].flatMap((d) => d.origins))].sort();
  const supported = availability === 'available';

  return (
    <SectionCard title={t('health.title')}>
      <Text style={styles.note}>{t('health.intro')}</Text>
      <Text style={styles.note}>{t('health.noTargets')}</Text>

      {availability === 'unsupported' ? <Text style={styles.warning}>{t('health.unsupported')}</Text> : null}
      {availability === 'unavailable' || availability === 'update_required' ? (
        <>
          <Text style={styles.warning}>{t(availability === 'unavailable' ? 'health.unavailable' : 'health.updateRequired')}</Text>
          <ActionButton testID="health-get" variant="secondary" label={t('health.getHealthConnect')} onPress={() => openUrl(PLAY_STORE)} />
        </>
      ) : null}

      {supported && !connected ? <ActionButton testID="health-connect" label={t('health.connect')} busy={busy} onPress={connect} /> : null}

      {connected ? (
        <>
          <Text style={styles.body}>{t('health.source')}</Text>
          {origins.length > 0 ? <Text style={styles.note}>{t('health.apps', { apps: origins.join(', ') })}</Text> : null}
          <Text style={styles.note}>{state.lastSyncAt ? t('health.lastSync', { time: new Date(state.lastSyncAt).toLocaleString() }) : t('health.neverSynced')}</Text>
          {days.length === 0 ? <Text style={styles.note}>{t('health.noDays')}</Text> : null}
          {days.map((day) => (
            <Text key={day} style={styles.body}>
              {[day, state.steps[day] ? t('health.stepsLine', { count: state.steps[day].value.toLocaleString() }) : null, state.sleep[day] ? t('health.sleepLine', { hours: Math.floor(state.sleep[day].value / 60), minutes: state.sleep[day].value % 60 }) : null].filter(Boolean).join('  ·  ')}
            </Text>
          ))}
          <Text style={styles.note}>{t('health.manualKept')}</Text>
          {supported ? <ActionButton testID="health-sync" variant="secondary" label={t('health.syncNow')} busy={busy} onPress={sync} /> : null}
        </>
      ) : null}

      {message ? <Text accessibilityLiveRegion="polite" style={styles.warning}>{message}</Text> : null}

      {(connected && (!state.permissions.steps || !state.permissions.sleep)) || (message === t('health.denied')) ? (
        <ActionButton testID="health-settings" variant="link" label={t('health.openSettings')} onPress={() => resolved.adapter.openSettings()} />
      ) : null}

      {connected ? (
        asking ? (
          <View style={styles.ask}>
            <Text style={styles.body}>{t('health.disconnectAsk')}</Text>
            <ActionButton testID="health-disconnect-confirm" variant="danger" label={t('health.disconnectConfirm')} busy={busy} onPress={disconnect} />
            <ActionButton testID="health-disconnect-cancel" variant="link" label={t('health.disconnectCancel')} onPress={() => setAsking(false)} />
          </View>
        ) : (
          <ActionButton testID="health-disconnect" variant="link" label={t('health.disconnect')} onPress={() => setAsking(true)} />
        )
      ) : null}
    </SectionCard>
  );
}


const styles = StyleSheet.create({
  body: { color: tokens.color.text, fontSize: 16, lineHeight: 24, marginVertical: tokens.space[1] },
  note: { color: tokens.color.textSecondary, fontSize: 14, lineHeight: 21, marginVertical: tokens.space[1] },
  warning: { color: tokens.color.warning, fontSize: 16, lineHeight: 24, marginVertical: tokens.space[2] },
  ask: { marginTop: tokens.space[2], padding: tokens.space[3], borderRadius: tokens.radius.control, backgroundColor: tokens.color.surfaceRaised },
});
