import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { buildWhoopSummary, record, type WhoopConnection, type WhoopCycle } from './whoop.ts';

export async function whoopDiscovery(admin: SupabaseClient, userId: string, connectionId: string | null) {
  if (!connectionId) return { available: false };
  try {
    const { data, error } = await admin.rpc('read_whoop_personal_context', {
      p_user_id:userId,p_connection_id:connectionId,p_metadata_only:true,
    });
    // An optional provider must never break the work/calendar context or imply health.
    if (error) return { available:false, status:'unavailable' };
    return record(data).available === true ? { available:true,readTool:'get_personal_context',sensitive:true } : {available:false};
  } catch { return {available:false,status:'unavailable'}; }
}
export async function readWhoopContext(admin: SupabaseClient, userId: string, connectionId: string | null) {
  if (!connectionId) return null;
  const { data, error } = await admin.rpc('read_whoop_personal_context', {
    p_user_id:userId,p_connection_id:connectionId,p_metadata_only:false,
  });
  if (error) throw new Error('Private personal context could not be read; do not infer healthy or zero readings.');
  const value = record(data);
  if (value.available !== true) return null;
  return buildWhoopSummary(value.connection as WhoopConnection, (value.cycles ?? []) as WhoopCycle[]);
}
