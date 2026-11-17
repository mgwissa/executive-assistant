import { useCallback, useEffect, useRef, useState } from 'react';
import { whoopAction, type WhoopStatus } from '../lib/whoop';

// Component-local only: no localStorage, shared-note cache, analytics or RAG copy.
export function useWhoop(userId:string) {
  const [data,setData] = useState<WhoopStatus | null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState<string | null>(null);
  const active = useRef(false), sequence = useRef(0);
  const invalidate = useCallback(() => { sequence.current++; },[]);
  const reload = useCallback(async () => {
    const request = ++sequence.current;
    if (active.current) { setLoading(true); setError(null); }
    try {
      const result = await whoopAction<WhoopStatus>('status');
      if (active.current && request === sequence.current) setData(result);
    } catch (cause) {
      if (active.current && request === sequence.current) setError(cause instanceof Error ? cause.message : 'Private context could not be read.');
    } finally { if (active.current && request === sequence.current) setLoading(false); }
  },[]);
  useEffect(() => {
    active.current=true;
    void reload();
    const refresh = () => { if (document.visibilityState === 'visible') void reload(); };
    window.addEventListener('focus',refresh);
    return () => { active.current=false; invalidate(); window.removeEventListener('focus',refresh); };
  },[userId,reload,invalidate]);
  return {data,loading,error,reload};
}
