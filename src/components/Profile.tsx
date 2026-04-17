import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useProfileStore } from '../store/useProfileStore';
import { UserIcon } from './icons';

export function Profile() {
  const user = useAuthStore((s) => s.user);
  const { profile, loading, saving, error, updateProfile } = useProfileStore();

  const [firstName, setFirstName] = useState('');
  const [status, setStatus] = useState<'idle' | 'saved'>('idle');

  useEffect(() => {
    setFirstName(profile?.first_name ?? '');
  }, [profile?.first_name]);

  const dirty = (profile?.first_name ?? '') !== firstName.trim();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const next = firstName.trim();
    await updateProfile(user.id, { first_name: next === '' ? null : next });
    setStatus('saved');
    setTimeout(() => setStatus('idle'), 2000);
  };

  return (
    <div className="h-full overflow-y-auto bg-white dark:bg-slate-900">
      <div className="mx-auto w-full max-w-2xl px-8 py-10">
        <header className="mb-8 flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-600/10 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
            <UserIcon className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              Your profile
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              This is how the app addresses you.
            </p>
          </div>
        </header>

        <form
          onSubmit={onSubmit}
          className="space-y-6 rounded-xl border border-slate-200 bg-slate-50 p-6 dark:border-slate-800 dark:bg-slate-950/40"
        >
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
              value={user?.email ?? ''}
              disabled
              className="input cursor-not-allowed opacity-70"
            />
          </Field>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between border-t border-slate-200 pt-4 dark:border-slate-800">
            <p
              className={[
                'text-xs',
                status === 'saved'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-500 dark:text-slate-400',
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
        </form>
      </div>
    </div>
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
        className="block text-sm font-medium text-slate-700 dark:text-slate-200"
      >
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      )}
    </div>
  );
}
