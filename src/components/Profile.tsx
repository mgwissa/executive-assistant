import { useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useEventsStore } from '../store/useEventsStore';
import { useProfileStore } from '../store/useProfileStore';
import { syncOutlookCalendar } from '../lib/calendarSync';
import { eventsFetchIsoRange } from '../lib/eventQueries';
import {
  DEFAULT_ESCALATION_CONFIG,
  escalationConfigForSave,
  parseEscalationConfig,
  type PriorityEscalationConfig,
} from '../lib/priorityEscalation';
import type { Json } from '../types/database';
import type { ProfileUpdate } from '../types';
import { CalendarIcon, CheckSquareIcon, UserIcon } from './icons';
import { Card } from './ui/Card';
import { IconBadge } from './ui/IconBadge';

export function Profile() {
  const user = useAuthStore((s) => s.user);
  const { profile, loading, saving, error, updateProfile, fetchProfile } = useProfileStore();
  const fetchEventsRange = useEventsStore((s) => s.fetchRange);
  const deleteOutlookImports = useEventsStore((s) => s.deleteOutlookImports);
  const initialFirstName = profile?.first_name ?? '';

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto w-full max-w-2xl px-8 py-10">
        <header className="mb-8 flex items-center gap-4">
          <IconBadge size="lg" tone="brand" className="rounded-full">
            <UserIcon className="h-6 w-6" />
          </IconBadge>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-text">Your profile</h1>
            <p className="mt-1 text-sm text-text-muted">
              This is how the app addresses you.
            </p>
          </div>
        </header>

        <div className="space-y-6">
          <ProfileForm
            key={`${user?.id ?? 'anon'}:${initialFirstName}`}
            initialFirstName={initialFirstName}
            email={user?.email ?? ''}
            loading={loading}
            saving={saving}
            error={error}
            onSubmit={async (next) => {
              if (!user) return;
              await updateProfile(user.id, { first_name: next === '' ? null : next });
            }}
          />

          {user && profile && (
            <PriorityEscalationSection
              key={`esc-${JSON.stringify(profile.priority_escalation)}`}
              userId={user.id}
              rawConfig={profile.priority_escalation}
              loading={loading}
              saving={saving}
              updateProfile={updateProfile}
              fetchProfile={fetchProfile}
            />
          )}

          {user && (
            <CalendarSyncSection
              key={`${user.id}:${profile?.outlook_ics_url ?? ''}:${profile?.outlook_ics_last_synced_at ?? ''}`}
              userId={user.id}
              profileTimezone={profile?.timezone}
              outlookIcsUrl={profile?.outlook_ics_url}
              lastSyncedAt={profile?.outlook_ics_last_synced_at}
              loading={loading}
              updateProfile={updateProfile}
              fetchProfile={fetchProfile}
              fetchEventsRange={fetchEventsRange}
              deleteOutlookImports={deleteOutlookImports}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function PriorityEscalationSection({
  userId,
  rawConfig,
  loading,
  saving,
  updateProfile,
  fetchProfile,
}: {
  userId: string;
  rawConfig: unknown;
  loading: boolean;
  saving: boolean;
  updateProfile: (uid: string, patch: ProfileUpdate) => Promise<void>;
  fetchProfile: (uid: string) => Promise<void>;
}) {
  const parsed = parseEscalationConfig(rawConfig);
  const [enabled, setEnabled] = useState(parsed.enabled);
  const [p4ToP3Days, setP4ToP3Days] = useState(String(parsed.p4ToP3Days));
  const [p3ToP2Days, setP3ToP2Days] = useState(String(parsed.p3ToP2Days));
  const [p2ToP1Days, setP2ToP1Days] = useState(String(parsed.p2ToP1Days));
  const [message, setMessage] = useState<string | null>(null);

  const dirty =
    enabled !== parsed.enabled ||
    String(parsed.p4ToP3Days) !== p4ToP3Days.trim() ||
    String(parsed.p3ToP2Days) !== p3ToP2Days.trim() ||
    String(parsed.p2ToP1Days) !== p2ToP1Days.trim();

  const save = async () => {
    setMessage(null);
    const next: PriorityEscalationConfig = {
      enabled,
      p4ToP3Days: Number(p4ToP3Days) || DEFAULT_ESCALATION_CONFIG.p4ToP3Days,
      p3ToP2Days: Number(p3ToP2Days) || DEFAULT_ESCALATION_CONFIG.p3ToP2Days,
      p2ToP1Days: Number(p2ToP1Days) || DEFAULT_ESCALATION_CONFIG.p2ToP1Days,
    };
    await updateProfile(userId, {
      priority_escalation: escalationConfigForSave(next) as Json,
    });
    await fetchProfile(userId);
    setMessage('Saved.');
    setTimeout(() => setMessage(null), 2500);
  };

  return (
    <Card tone="sunken">
      <div className="mb-4 flex items-start gap-3">
        <IconBadge tone="amber" size="md">
          <CheckSquareIcon className="h-5 w-5" />
        </IconBadge>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-text">Todo priority escalation</h2>
          <p className="mt-1 text-sm text-text-muted">
            Open tasks can move one step up after they stay at the same level for the number of days
            you set (Later → Routine → Active → Important). Critical is never auto-promoted. The timer
            resets when you change priority manually or after each bump.
          </p>
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          disabled={loading}
          className="rounded border-border"
        />
        Enable automatic escalation
      </label>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field
          id="esc-p4-p3"
          label="Later → Routine (days)"
          hint="Stays at Later before bumping"
        >
          <input
            id="esc-p4-p3"
            type="number"
            min={1}
            max={365}
            value={p4ToP3Days}
            onChange={(e) => setP4ToP3Days(e.target.value)}
            disabled={loading || !enabled}
            className="input"
          />
        </Field>
        <Field
          id="esc-p3-p2"
          label="Routine → Active (days)"
          hint="Stays at Routine before bumping"
        >
          <input
            id="esc-p3-p2"
            type="number"
            min={1}
            max={365}
            value={p3ToP2Days}
            onChange={(e) => setP3ToP2Days(e.target.value)}
            disabled={loading || !enabled}
            className="input"
          />
        </Field>
        <Field
          id="esc-p2-p1"
          label="Active → Important (days)"
          hint="Stays at Active before bumping"
        >
          <input
            id="esc-p2-p1"
            type="number"
            min={1}
            max={365}
            value={p2ToP1Days}
            onChange={(e) => setP2ToP1Days(e.target.value)}
            disabled={loading || !enabled}
            className="input"
          />
        </Field>
      </div>

      {message && (
        <p className="mt-3 text-sm text-text-muted" role="status">
          {message}
        </p>
      )}

      <div className="mt-4 flex justify-end border-t border-border pt-4">
        <button
          type="button"
          className="btn-primary"
          disabled={loading || saving || !dirty}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save escalation settings'}
        </button>
      </div>
    </Card>
  );
}

function CalendarSyncSection({
  userId,
  profileTimezone,
  outlookIcsUrl,
  lastSyncedAt,
  loading,
  updateProfile,
  fetchProfile,
  fetchEventsRange,
  deleteOutlookImports,
}: {
  userId: string;
  profileTimezone: string | null | undefined;
  outlookIcsUrl: string | null | undefined;
  lastSyncedAt: string | null | undefined;
  loading: boolean;
  updateProfile: (uid: string, patch: ProfileUpdate) => Promise<void>;
  fetchProfile: (uid: string) => Promise<void>;
  fetchEventsRange: (uid: string, fromIso: string, toIso: string) => Promise<void>;
  deleteOutlookImports: (uid: string) => Promise<string | null>;
}) {
  const [icsUrl, setIcsUrl] = useState(outlookIcsUrl ?? '');
  const [savingUrl, setSavingUrl] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [removingImports, setRemovingImports] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const savedTrim = (outlookIcsUrl ?? '').trim();
  const dirty = savedTrim !== icsUrl.trim();

  const lastSyncedLabel =
    lastSyncedAt && !Number.isNaN(Date.parse(lastSyncedAt))
      ? new Date(lastSyncedAt).toLocaleString()
      : null;

  const saveUrlOnly = async () => {
    setSavingUrl(true);
    setSyncMessage(null);
    try {
      await updateProfile(userId, {
        outlook_ics_url: icsUrl.trim() === '' ? null : icsUrl.trim(),
      });
      await fetchProfile(userId);
    } catch (e) {
      setSyncMessage(e instanceof Error ? e.message : 'Failed to save URL');
    } finally {
      setSavingUrl(false);
    }
  };

  const onSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      if (dirty) {
        await updateProfile(userId, {
          outlook_ics_url: icsUrl.trim() === '' ? null : icsUrl.trim(),
        });
      }
      if (!icsUrl.trim() && !savedTrim) {
        setSyncMessage('Paste your Outlook published .ics URL first.');
        return;
      }
      const { imported } = await syncOutlookCalendar();
      setSyncMessage(`Synced successfully. Imported ${imported} occurrence(s).`);
      await fetchProfile(userId);
      const { fromIso, toIso } = eventsFetchIsoRange(profileTimezone);
      await fetchEventsRange(userId, fromIso, toIso);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sync failed';
      setSyncMessage(
        `${msg} If you have not deployed the Edge Function yet, run the steps in README (Outlook calendar sync).`,
      );
    } finally {
      setSyncing(false);
    }
  };

  const onRemoveImported = async () => {
    if (
      !window.confirm(
        'Remove every event that was imported from Outlook in this app? Events you created manually here are kept. The next sync will re-import anything still in your ICS feed.',
      )
    ) {
      return;
    }
    setRemovingImports(true);
    setSyncMessage(null);
    try {
      const err = await deleteOutlookImports(userId);
      if (err) setSyncMessage(err);
      else setSyncMessage('Removed all imported Outlook events from this app.');
    } finally {
      setRemovingImports(false);
    }
  };

  return (
    <Card tone="sunken">
      <div className="mb-4 flex items-start gap-3">
        <IconBadge tone="blue" size="md">
          <CalendarIcon className="h-5 w-5" />
        </IconBadge>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-text">Outlook calendar (published ICS)</h2>
          <p className="mt-1 text-sm text-text-muted">
            Use the <span className="font-medium text-text">ICS</span> link from Outlook (ends in{' '}
            <code className="rounded bg-surface-raised px-1 py-0.5 text-xs ring-1 ring-border">calendar.ics</code>
            ), not the HTML page. Sync runs on the server so the browser is not blocked by CORS.
          </p>
        </div>
      </div>

      <Field
        id="outlook-ics-url"
        label="ICS URL"
        hint="Paste the full https://…/calendar.ics URL. Save it here, then sync whenever you want fresh events."
      >
        <input
          id="outlook-ics-url"
          type="url"
          value={icsUrl}
          onChange={(e) => setIcsUrl(e.target.value)}
          placeholder="https://outlook.office365.com/owa/calendar/.../calendar.ics"
          autoComplete="off"
          disabled={loading}
          className="input font-mono text-xs"
        />
      </Field>

      {lastSyncedLabel && (
        <p className="mt-2 text-xs text-text-muted">Last synced: {lastSyncedLabel}</p>
      )}

      {syncMessage && (
        <p className="mt-3 text-sm text-text-muted" role="status">
          {syncMessage}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <button
          type="button"
          className="btn-secondary"
          disabled={loading || savingUrl || !dirty}
          onClick={() => void saveUrlOnly()}
        >
          {savingUrl ? 'Saving…' : 'Save URL'}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={loading || syncing || (!icsUrl.trim() && !savedTrim)}
          onClick={() => void onSync()}
        >
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
        <button
          type="button"
          className="btn-danger"
          disabled={loading || removingImports || syncing}
          onClick={() => void onRemoveImported()}
        >
          {removingImports ? 'Removing…' : 'Remove imported Outlook events'}
        </button>
      </div>
    </Card>
  );
}

function ProfileForm({
  initialFirstName,
  email,
  loading,
  saving,
  error,
  onSubmit,
}: {
  initialFirstName: string;
  email: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  onSubmit: (firstName: string) => Promise<void>;
}) {
  const [firstName, setFirstName] = useState(initialFirstName);
  const [status, setStatus] = useState<'idle' | 'saved'>('idle');

  const dirty = initialFirstName !== firstName.trim();

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const next = firstName.trim();
        await onSubmit(next);
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 2000);
      }}
    >
      <Card tone="sunken">
      <Field
        id="first-name"
        label="First name"
        hint="Used in your dashboard greeting. Leave blank to hide it."
      >
        <input
          id="first-name"
          type="text"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder="e.g. Wissam"
          maxLength={60}
          autoComplete="given-name"
          disabled={loading}
          className="input"
        />
      </Field>

      <Field id="email" label="Email">
        <input
          id="email"
          type="email"
          value={email}
          disabled
          className="input cursor-not-allowed opacity-70"
        />
      </Field>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between border-t border-border pt-4">
        <p
          className={[
            'text-xs',
            status === 'saved' ? 'text-emerald-600 dark:text-emerald-400' : 'text-text-muted',
          ].join(' ')}
          aria-live="polite"
        >
          {status === 'saved'
            ? 'Saved.'
            : dirty
              ? 'Unsaved changes.'
              : 'All changes saved.'}
        </p>
        <button
          type="submit"
          disabled={saving || !dirty || loading}
          className="btn-primary"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
      </Card>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-sm font-medium text-text"
      >
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-xs text-text-muted">{hint}</p>
      )}
    </div>
  );
}
