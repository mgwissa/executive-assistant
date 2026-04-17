import { supabase } from './supabase';

type SyncResponse = { ok?: boolean; imported?: number; error?: string };

export async function syncOutlookCalendar(): Promise<{ imported: number }> {
  const { data, error } = await supabase.functions.invoke<SyncResponse>('sync-outlook-calendar', {
    body: {},
  });

  if (error) {
    throw new Error(error.message);
  }
  if (data && typeof data === 'object' && data.error) {
    throw new Error(String(data.error));
  }

  const imported = typeof data?.imported === 'number' ? data.imported : 0;
  return { imported };
}
