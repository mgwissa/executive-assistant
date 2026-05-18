/**
 * Verifies that an incoming request to a notification Edge Function came
 * from a trusted source (pg_cron or a DB trigger using `net.http_post`).
 *
 * Both Edge Functions are deployed with `verify_jwt = false` (Supabase's
 * gateway can't always validate JWTs signed with ECC keys, see config.toml).
 * Instead, we accept calls that carry a shared `x-cron-secret` header that
 * matches the `CRON_SECRET` env var. Vault stores the same value under the
 * `cron_secret` name so the trigger / pg_cron job can include it.
 */
export function isAuthorizedInternalCall(req: Request): boolean {
  const expected = Deno.env.get('CRON_SECRET');
  if (!expected) return false;
  const got = req.headers.get('x-cron-secret');
  return !!got && got === expected;
}
