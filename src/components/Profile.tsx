import { useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useProfileStore } from '../store/useProfileStore';
import { UserIcon } from './icons';
import { Card } from './ui/Card';
import { IconBadge } from './ui/IconBadge';

export function Profile() {
  const user = useAuthStore((s) => s.user);
  const { profile, loading, saving, error, updateProfile } = useProfileStore();
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
        </div>
      </div>
    </div>
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
