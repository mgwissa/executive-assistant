import { formatInTimeZone } from 'date-fns-tz';
import { useEffect, useRef, useState } from 'react';
import { useWhoop } from '../hooks/useWhoop';
import { connectWhoop, whoopAction, whoopErrorMessage } from '../lib/whoop';
import { Card } from './ui/Card';

function sleepDuration(value:number | null):string {
  if (value === null) return 'Not scored';
  const minutes=Math.round(value/60_000); return `${Math.floor(minutes/60)}h ${minutes%60}m`;
}
function when(value:string | null,timezone:string):string {
  return value ? formatInTimeZone(new Date(value),timezone,'MMM d, h:mm a zzz') : 'Not yet synced';
}
export function WhoopPanel({userId,timezone,compact=false}:{userId:string;timezone:string;compact?:boolean}) {
  const {data,loading,error,reload}=useWhoop(userId);
  const [selected,setSelected]=useState<string[]>([]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState<string | null>(null);
  const [actionError,setActionError]=useState<string | null>(null);
  const callbackHandled=useRef(false);
  const alive=useRef(false);
  useEffect(() => { alive.current=true; return () => { alive.current=false; }; },[]);
  const connection=data?.summary.connectionStatus;
  useEffect(() => { if (data) setSelected(data.allowedConnectionIds); },[data]);
  useEffect(() => {
    if (compact || callbackHandled.current) return;
    const url=new URL(window.location.href), result=url.searchParams.get('whoop');
    if (!result) return;
    callbackHandled.current=true;
    const code=url.searchParams.get('code'),state=url.searchParams.get('state'),denied=url.searchParams.has('error');
    for (const name of ['whoop','code','state','error','error_description','scope']) url.searchParams.delete(name);
    window.history.replaceState(window.history.state,'',url);
    if (result !== 'callback' || denied || !code || !state) { setActionError('WHOOP authorization was not completed. You can safely try Connect again.'); return; }
    setBusy(true); setMessage('Finishing WHOOP authorization and reading your first private snapshot…');
    void whoopAction('complete',{code,state}).then(() => whoopAction('sync')).then(() => { if (alive.current) setMessage('WHOOP connected and refreshed.'); })
      .catch((cause:unknown) => { if (alive.current) { setMessage(null); setActionError(cause instanceof Error ? cause.message : 'Initial sync could not finish.'); } })
      .finally(() => { if (alive.current) { setBusy(false); void reload(); } });
  },[compact,reload]);
  const run=async (action:() => Promise<void>) => {
    setBusy(true); setActionError(null); setMessage(null);
    try { await action(); } catch (cause) { setActionError(cause instanceof Error ? cause.message : 'WHOOP request failed.'); }
    finally { setBusy(false); await reload(); }
  };
  const latest=data?.summary.latest, previous=data?.summary.lastCompletedCycle;
  return <Card className={compact ? 'mt-4' : ''}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-sm font-semibold text-text">WHOOP · private personal context</h2>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">Sleep, recovery and strain alongside your day—not a productivity score.</p></div>
      {compact ? <a className="btn-ghost text-xs" href="/profile">Manage WHOOP</a> : null}
    </div>
    {loading ? <p className="mt-3 text-xs text-text-muted" role="status">Checking private context…</p> : null}
    {error || actionError ? <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">{actionError ?? error}</p> : null}
    {message ? <p className="mt-3 text-sm text-text-muted" role="status">{message}</p> : null}
    {data ? <>
      <p className="mt-3 text-xs font-medium text-text-muted">{connection === 'connected' ? 'Connected' : connection === 'pending' ? 'Authorization unfinished' : connection === 'reconnect_required' ? 'Reconnect required' : 'Not connected'}
        {connection === 'connected' ? ` · ${data.summary.freshness === 'recent' ? 'Recently synced' : 'Readings need attention'} · ${when(data.summary.lastSyncedAt,timezone)}` : ''}</p>
      {data.summary.errorCode ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{whoopErrorMessage(data.summary.errorCode)}</p> : null}
      {connection === 'connected' && data.summary.freshness !== 'recent' ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Cached readings may be stale, absent or incomplete. A successful connection does not establish current readings.</p> : null}
      {connection === 'connected' ? <>
        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-surface-sunken p-3"><dt className="text-xs text-text-muted">Latest recovery</dt><dd className="mt-1 text-lg font-semibold text-text">{latest?.recovery_score == null ? 'Not scored' : `${latest.recovery_score}%`}</dd>
            <p className="mt-1 text-xs text-text-subtle">{latest?.recovery_calibrating ? 'WHOOP is calibrating' : latest?.recovery_state ?? 'No cycle returned'}</p></div>
          <div className="rounded-lg bg-surface-sunken p-3"><dt className="text-xs text-text-muted">Main sleep · same cycle</dt><dd className="mt-1 text-lg font-semibold text-text">{sleepDuration(latest?.sleep_total_ms ?? null)}</dd>
            <p className="mt-1 text-xs text-text-subtle">{latest?.sleep_performance_pct == null ? latest?.sleep_state ?? 'No sleep returned' : `${latest.sleep_performance_pct}% sleep performance`}</p></div>
          <div className="rounded-lg bg-surface-sunken p-3"><dt className="text-xs text-text-muted">Last completed cycle strain</dt><dd className="mt-1 text-lg font-semibold text-text">{previous?.strain == null ? 'Not scored' : `${previous.strain.toFixed(1)} / 21`}</dd>
            <p className="mt-1 text-xs text-text-subtle">{previous ? when(previous.cycle_end,timezone) : 'No completed cycle returned'}</p></div>
        </dl>
        {latest ? <p className="mt-3 text-xs text-text-subtle">Latest WHOOP cycle began {when(latest.cycle_start,timezone)}. Sleep ended {latest.sleep_end ? when(latest.sleep_end,timezone) : 'at an unavailable time'}. Physiological cycles need not match calendar days.</p> : null}
        {!compact && data.summary.recentCycles.length ? <details className="mt-4 text-xs text-text-muted"><summary className="cursor-pointer font-medium">Recent cycles</summary><div className="mt-2 overflow-x-auto"><table className="w-full text-left"><thead><tr><th className="p-2">Cycle began</th><th className="p-2">Recovery</th><th className="p-2">Main sleep</th><th className="p-2">Strain</th></tr></thead><tbody>{data.summary.recentCycles.map((row) => <tr key={row.cycle_id} className="border-t border-border"><td className="p-2">{when(row.cycle_start,timezone)}</td><td className="p-2">{row.recovery_score == null ? row.recovery_state : `${row.recovery_score}%`}</td><td className="p-2">{sleepDuration(row.sleep_total_ms)}</td><td className="p-2">{row.strain == null ? row.strain_state : `${row.strain.toFixed(1)}${row.cycle_end ? '' : ' (ongoing)'}`}</td></tr>)}</tbody></table></div></details> : null}
      </> : null}
      {!compact ? <>
        <fieldset className="mt-5 rounded-lg border border-border p-3" disabled={busy || loading}>
          <legend className="px-1 text-xs font-semibold text-text">Private morning-planning access</legend>
          <p className="mb-3 text-xs leading-relaxed text-text-muted">Only the agents you select can read your WHOOP summary. Existing workspace approval alone does not grant health access. No selection keeps WHOOP app-only.</p>
          {data.agents.length ? data.agents.map((agent) => <label key={agent.id} className="mt-2 flex items-start gap-2 text-sm text-text"><input type="checkbox" className="mt-1" checked={selected.includes(agent.id)} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids,agent.id] : ids.filter((id) => id !== agent.id))}/><span>{agent.name}<span className="block text-xs text-text-subtle">Client {agent.clientId.slice(0,8)}…{agent.lastUsedAt ? ` · Last request ${when(agent.lastUsedAt,timezone)}` : ''}</span></span></label>) : <p className="text-xs text-text-muted">Connect an agent below before granting personal-context access.</p>}
          {connection === 'connected' ? <button type="button" className="btn-secondary mt-3" onClick={() => void run(async () => { await whoopAction('grants',{connectionIds:selected}); setMessage('Private assistant access saved.'); })}>Save assistant access</button> : null}
        </fieldset>
        {!data.configured ? <div className="mt-4 text-xs leading-relaxed text-text-muted"><p>Server setup is needed: WHOOP developer app credentials and an encryption key. Secrets stay on the server; never paste them into notes or chat.</p><p className="mt-2">Register this exact callback address:</p><code className="mt-1 block break-all rounded bg-surface-sunken p-2 select-all">{data.redirectUri}</code></div> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn-primary" disabled={busy || loading || !data.configured} onClick={() => void run(() => connectWhoop(selected))}>{connection === 'connected' ? 'Reconnect WHOOP' : 'Connect WHOOP'}</button>
          {connection === 'connected' ? <button type="button" className="btn-secondary" disabled={busy || loading || !data.configured} onClick={() => void run(async () => { await whoopAction('sync'); setMessage('Private WHOOP snapshot refreshed.'); })}>Sync now</button> : null}
          <button type="button" className="btn-ghost" disabled={busy || loading} onClick={() => void reload()}>Refresh status</button>
          {connection && connection !== 'disconnected' ? <button type="button" className="btn-danger" disabled={busy || loading} onClick={() => {
            if (!window.confirm('Disconnect WHOOP, remove all assistant health access, and delete its cached readings and saved credentials?')) return;
            void run(async () => { const result=await whoopAction<{providerRevoked:boolean}>('disconnect'); setMessage(result.providerRevoked ? 'WHOOP disconnected. Cached readings and credentials deleted.' : 'Disconnected locally; cached readings and credentials deleted. WHOOP grant revocation could not be confirmed—remove the app in WHOOP settings too.'); });
          }}>Disconnect & delete cached readings</button> : null}
        </div>
      </> : connection !== 'connected' ? <p className="mt-3 text-xs text-text-muted">Connect WHOOP in Profile to add private personal context to your day.</p> : null}
      <p className="mt-4 text-xs leading-relaxed text-text-subtle">Private to your account. Excluded from shared notebooks and general memory. Your own check-in matters more than a wearable score; no tasks or meetings are changed automatically.</p>
    </> : null}
  </Card>;
}
