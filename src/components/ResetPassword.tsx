import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import { isSupabaseConfigured } from '../lib/supabase';
import { ThemeToggle } from './ThemeToggle';
import { Card } from './ui/Card';

export function ResetPassword() {
  const navigate = useNavigate();
  const updatePassword = useAuthStore((s) => s.updatePassword);
  const signOut = useAuthStore((s) => s.signOut);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      await updatePassword(password);
      setDone(true);
      window.history.replaceState({}, '', '/reset-password');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-surface-sunken p-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <Card tone="raised" padded="lg" className="w-full max-w-sm">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-text">Set a new password</h1>
          <p className="mt-1 text-sm text-text-muted">
            Choose a new password for your Notes workspace.
          </p>
        </div>

        {!isSupabaseConfigured && (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            Supabase is not configured. Password reset links require Supabase env vars.
          </div>
        )}

        {done ? (
          <div className="space-y-4">
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              Your password has been updated.
            </p>
            <button
              type="button"
              className="btn-primary w-full"
              onClick={() => navigate('/dashboard', { replace: true })}
            >
              Continue
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">
                New password
              </label>
              <input
                type="password"
                required
                minLength={6}
                autoFocus
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="••••••••"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">
                Confirm password
              </label>
              <input
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="input"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !isSupabaseConfigured}
              className="btn-primary w-full"
            >
              {busy ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}

        <div className="mt-6 text-center text-sm">
          <button
            type="button"
            onClick={() => {
              void signOut();
              navigate('/', { replace: true });
            }}
            className="font-medium text-brand-700 hover:text-brand-600"
          >
            Back to sign in
          </button>
        </div>
      </Card>
    </div>
  );
}
