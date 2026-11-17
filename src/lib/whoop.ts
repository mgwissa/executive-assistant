import { supabase } from './supabase';
import type { WhoopSummary } from '../../supabase/functions/_shared/whoop';

export type WhoopAgent = { id:string; name:string; clientId:string; lastUsedAt:string | null };
export type WhoopStatus = { configured:boolean; redirectUri:string; summary:WhoopSummary; agents:WhoopAgent[]; allowedConnectionIds:string[] };
const messages: Record<string,string> = {
  not_configured:'WHOOP needs server-side setup before you can connect.',
  invalid_state:'This WHOOP authorization has expired, was already used, or belongs to another account. Connect again from your signed-in Profile.',
  authorization_required:'WHOOP authorization has expired or was revoked. Reconnect to continue.',
  missing_scopes:'WHOOP did not grant the required read permissions. Reconnect and approve sleep, recovery and cycles.',
  rate_limited:'WHOOP asked us to wait. The next permitted sync will retry; cached readings are not current verification.',
  provider_unavailable:'WHOOP could not be reached. Previous readings were kept, not replaced with zeros.',
  incomplete_pagination:'The WHOOP read was incomplete. Previous readings were kept; a later sync will retry.',
  invalid_provider_data:'WHOOP returned unreadable data. Previous readings were kept.',
  deferred:'A sync is already running or is waiting for its next permitted attempt. Refresh shortly.',
  connection_changed:'The connection changed during this request. Refresh before trying again.',
  storage_unavailable:'Private WHOOP storage is unavailable. The migration/service may not be deployed yet.',
  unauthorized:'Sign in to Executive Assistant again to manage WHOOP.',
};
export function whoopErrorMessage(code: string | null | undefined): string | null {
  return code ? messages[code] ?? 'WHOOP could not refresh. Previous readings may be out of date.' : null;
}
export async function whoopAction<T>(action:string, extra:Record<string,unknown> = {}): Promise<T> {
  const {data,error} = await supabase.functions.invoke<T & {error?:string}>('whoop',{body:{action,...extra}});
  if (error) {
    let code: string | null = null;
    if ('context' in error && error.context instanceof Response) {
      try { const body:unknown = await error.context.clone().json(); if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') code=body.error; } catch { /* no readable error */ }
    }
    throw new Error(whoopErrorMessage(code) ?? 'The WHOOP connection service is unavailable. No current readings could be verified.');
  }
  if (!data || data.error) throw new Error(whoopErrorMessage(data?.error) ?? 'WHOOP returned no readable response.');
  return data;
}
export async function connectWhoop(connectionIds:string[]): Promise<void> {
  const {authorizationUrl} = await whoopAction<{authorizationUrl:string}>('connect',{connectionIds});
  const url = new URL(authorizationUrl);
  if (url.origin !== 'https://api.prod.whoop.com' || url.pathname !== '/oauth/oauth2/auth') throw new Error('WHOOP returned an unexpected authorization address.');
  window.location.assign(url.toString());
}
