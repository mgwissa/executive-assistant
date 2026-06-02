import { supabase } from './supabase';

export type MemorySourceType = 'note' | 'task' | 'debrief';

export type MemoryCitation = {
  sourceType: MemorySourceType;
  sourceId: string;
  title: string;
  excerpt: string;
  similarity: number;
  metadata: Record<string, unknown>;
};

export type MemoryAskResult = {
  answer: string;
  citations: MemoryCitation[];
};

export type MemorySyncStats = {
  notes: number;
  tasks: number;
  debriefs: number;
  chunks: number;
};

function parseError(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
    return data.error;
  }
  return fallback;
}

export async function askMemory(question: string): Promise<MemoryAskResult> {
  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean;
    answer?: string;
    citations?: MemoryCitation[];
    error?: string;
  }>('memory-ask', { body: { question } });

  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(parseError(data, 'Ask failed'));

  return {
    answer: data.answer ?? '',
    citations: data.citations ?? [],
  };
}

export async function syncMemoryFull(): Promise<MemorySyncStats> {
  const { data, error } = await supabase.functions.invoke<
    MemorySyncStats & { ok?: boolean; error?: string }
  >('memory-sync', { body: { mode: 'full' } });

  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(parseError(data, 'Index failed'));

  return {
    notes: data.notes ?? 0,
    tasks: data.tasks ?? 0,
    debriefs: data.debriefs ?? 0,
    chunks: data.chunks ?? 0,
  };
}

export async function syncMemorySource(
  sourceType: MemorySourceType,
  sourceId: string,
): Promise<void> {
  if (sourceId.startsWith('tmp-')) return;

  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>(
    'memory-sync',
    { body: { sourceType, sourceId } },
  );

  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(parseError(data, 'Index failed'));
}

export async function deleteMemorySource(
  sourceType: MemorySourceType,
  sourceId: string,
): Promise<void> {
  if (sourceId.startsWith('tmp-')) return;

  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>(
    'memory-sync',
    { body: { mode: 'delete', sourceType, sourceId } },
  );

  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(parseError(data, 'Delete failed'));
}

export async function fetchMemoryChunkCount(): Promise<number> {
  const { count, error } = await supabase
    .from('memory_chunks')
    .select('*', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}
