import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { t } from '../i18n';
import { tokens } from '../theme/tokens';
import { ActionButton } from '../ui/ActionButton';
import { SectionCard } from '../ui/SectionCard';
import { cancelReminders, enableReminders, syncReminders, type NotificationApi } from './adapter';
import { DEFAULT_REMINDERS, loadReminders, saveReminders } from './preferences';
import type { ReminderPreferences } from './schedule';

// A few ready times instead of a clock picker: quick to choose, easy to read, and always valid.
const TIMES = ['06:30', '12:00', '18:00', '20:30'];
const QUIET = { quietStart: '21:00', quietEnd: '07:00' };

interface Props {
  userId: string;
  api: NotificationApi;
  now?: () => Date;
  timeZone?: string;
}

const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// Daily workout reminder. Off until the person turns it on; permission is asked for at that moment only.
export function ReminderSettings({ userId, api, now = () => new Date(), timeZone = deviceZone() }: Props) {
  const [prefs, setPrefs] = useState<ReminderPreferences>(DEFAULT_REMINDERS);
  const [denied, setDenied] = useState(false);
  const alive = useRef(true);
  const text = { title: t('reminders.title'), body: t('reminders.body') };

  useEffect(() => {
    alive.current = true;
    void loadReminders(userId).then((saved) => alive.current && setPrefs(saved));
    return () => {
      alive.current = false;
    };
  }, [userId]);

  const apply = useCallback(
    async (next: ReminderPreferences) => {
      if (!(await saveReminders(userId, next))) return;
      if (alive.current) setPrefs(next);
      // Whether today's session is done is not known here; the next sync (app open, workout logged) corrects it.
      await syncReminders(api, next, false, now(), timeZone, text);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, api, timeZone, text.title, text.body]
  );

  const setEnabled = async (enabled: boolean) => {
    setDenied(false);
    if (!enabled) {
      await saveReminders(userId, { ...prefs, enabled: false });
      if (alive.current) setPrefs({ ...prefs, enabled: false });
      await cancelReminders(api);
      return;
    }
    const next = { ...prefs, enabled: true };
    const result = await enableReminders(api, next, false, now(), timeZone, text);
    if (!alive.current) return;
    if (result === 'scheduled') {
      await saveReminders(userId, next);
      setPrefs(next);
    } else {
      setDenied(true);
    }
  };

  return (
    <SectionCard title={t('reminders.title')}>
      <Text style={styles.note}>{t('reminders.intro')}</Text>
      <View style={styles.row}>
        <Switch testID="reminder-enabled" accessibilityLabel={t('reminders.enable')} value={prefs.enabled} onValueChange={setEnabled} />
        <Text style={styles.rowText}>{t('reminders.enable')}</Text>
      </View>
      {denied ? <Text accessibilityLiveRegion="polite" style={styles.warning}>{t('reminders.denied')}</Text> : null}

      {prefs.enabled ? (
        <>
          <Text style={styles.note}>{t('reminders.time')}</Text>
          {TIMES.map((time) => (
            <ActionButton
              key={time}
              testID={`reminder-time-${time.replace(':', '')}`}
              variant={prefs.time === time ? 'primary' : 'secondary'}
              label={time}
              onPress={() => apply({ ...prefs, time })}
            />
          ))}
          <View style={styles.row}>
            <Switch
              testID="reminder-quiet"
              accessibilityLabel={t('reminders.quiet')}
              value={prefs.quietStart !== null}
              onValueChange={(on) => apply({ ...prefs, quietStart: on ? QUIET.quietStart : null, quietEnd: on ? QUIET.quietEnd : null })}
            />
            <Text style={styles.rowText}>{t('reminders.quiet')}</Text>
          </View>
        </>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  note: { color: tokens.color.textSecondary, fontSize: 14, lineHeight: 21, marginVertical: tokens.space[2] },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: tokens.minTap, marginVertical: tokens.space[1] },
  rowText: { flex: 1, marginLeft: tokens.space[2], color: tokens.color.text, fontSize: 16, lineHeight: 24 },
  warning: { color: tokens.color.warning, fontSize: 16, lineHeight: 24, marginVertical: tokens.space[2] },
});
