import { supabase } from './supabase';
import { FunctionsHttpError } from '@supabase/supabase-js';

type SyncResponse = { ok?: boolean; imported?: number; error?: string };

export async function syncOutlookCalendar(): Promise<{ imported: number }> {
  const { data, error } = await supabase.functions.invoke<SyncResponse>('sync-outlook-calendar', {
    body: {},
  });

  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body: unknown = await error.context.json().catch(() => null);
      if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
        throw new Error(body.error);
      }
    }
    throw new Error(error.message);
  }
  if (data && typeof data === 'object' && data.error) {
    throw new Error(String(data.error));
  }

  if (!data?.ok || typeof data.imported !== 'number') throw new Error('Calendar refresh was not confirmed. Saved events may be out of date.');
  const imported = data.imported;
  return { imported };
}
