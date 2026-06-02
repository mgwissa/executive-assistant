import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  askMemory,
  fetchMemoryChunkCount,
  syncMemoryFull,
  type MemoryCitation,
} from '../lib/memoryApi';
import {
  clearMemoryChat,
  loadMemoryChat,
  saveMemoryChat,
  type MemoryChatTurn,
} from '../lib/memoryChatStorage';
import { viewPath } from '../lib/routes';
import { useNotesStore } from '../store/useNotesStore';
import { useProfileStore } from '../store/useProfileStore';
import { ArrowRightIcon, RefreshIcon, SearchIcon, SparklesIcon } from './icons';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';
import { EmptyState } from './ui/EmptyState';
import { IconBadge } from './ui/IconBadge';

type ChatTurn = MemoryChatTurn;

const STARTER_PROMPTS = [
  'Where did I leave off on the Lead Engine ping endpoint?',
  'What open questions do I have in my notes?',
  'What am I waiting on from other people?',
  'Summarize my highest-priority open tasks.',
];

function sourceLabel(type: MemoryCitation['sourceType']): string {
  if (type === 'note') return 'Note';
  if (type === 'task') return 'Task';
  return 'Debrief';
}

function renderSimpleMarkdown(text: string): ReactNode {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    if (/^\[\d+\]$/.test(part)) {
      return (
        <sup key={i} className="text-brand-600 dark:text-brand-400">
          {part.slice(1, -1)}
        </sup>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export function MemoryPage() {
  const navigate = useNavigate();
  const profile = useProfileStore((s) => s.profile);
  const fetchProfile = useProfileStore((s) => s.fetchProfile);
  const userId = profile?.user_id;
  const setActiveNote = useNotesStore((s) => s.setActive);

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [asking, setAsking] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [chunkCount, setChunkCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatHydrated, setChatHydrated] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const lastSynced = profile?.memory_last_synced_at;

  useEffect(() => {
    if (!userId) {
      setTurns([]);
      setChatHydrated(false);
      return;
    }
    setTurns(loadMemoryChat(userId));
    setChatHydrated(true);
  }, [userId]);

  useEffect(() => {
    if (!userId || !chatHydrated) return;
    saveMemoryChat(userId, turns);
  }, [userId, turns, chatHydrated]);

  const refreshMeta = useCallback(async () => {
    try {
      const count = await fetchMemoryChunkCount();
      setChunkCount(count);
    } catch {
      setChunkCount(null);
    }
  }, []);

  useEffect(() => {
    void refreshMeta();
  }, [refreshMeta, lastSynced]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, asking]);

  const openCitation = useCallback(
    (c: MemoryCitation) => {
      if (c.sourceType === 'note') {
        setActiveNote(c.sourceId);
        navigate(viewPath('notes'));
        return;
      }
      if (c.sourceType === 'task') {
        navigate(viewPath('tasks'));
        return;
      }
      navigate(viewPath('calendar'));
    },
    [navigate, setActiveNote],
  );

  const runAsk = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || asking) return;

      setError(null);
      setAsking(true);
      setTurns((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', content: q }]);
      setInput('');

      try {
        const result = await askMemory(q);
        setTurns((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            content: result.answer,
            citations: result.citations,
          },
        ]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Something went wrong';
        setError(msg);
        setTurns((prev) => [
          ...prev,
          { id: `err-${Date.now()}`, role: 'assistant', content: msg },
        ]);
      } finally {
        setAsking(false);
        inputRef.current?.focus();
      }
    },
    [asking],
  );

  const runFullIndex = useCallback(async () => {
    setIndexing(true);
    setError(null);
    try {
      const stats = await syncMemoryFull();
      if (userId) await fetchProfile(userId);
      setChunkCount(stats.chunks);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Indexing failed');
    } finally {
      setIndexing(false);
    }
  }, [fetchProfile, userId]);

  const indexLabel = useMemo(() => {
    if (indexing) return 'Indexing…';
    if (chunkCount === null) return 'Index workspace';
    if (chunkCount === 0) return 'Index workspace';
    return 'Re-index all';
  }, [chunkCount, indexing]);

  const clearChat = useCallback(() => {
    if (turns.length === 0) return;
    if (!window.confirm('Clear this conversation?')) return;
    setTurns([]);
    setError(null);
    if (userId) clearMemoryChat(userId);
  }, [turns.length, userId]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="border-b border-border bg-surface-raised px-4 py-4 sm:px-8">
        <div className="mx-auto flex max-w-3xl flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <IconBadge tone="brand" size="md">
              <SparklesIcon className="h-5 w-5" />
            </IconBadge>
            <div>
              <h1 className="text-xl font-semibold text-text">Memory</h1>
              <p className="mt-0.5 text-sm text-text-muted">
                Ask about your notes, tasks, and meeting debriefs — your external working memory.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {chunkCount != null ? (
              <Badge variant="subtle">{chunkCount} chunks indexed</Badge>
            ) : null}
            {lastSynced ? (
              <span className="text-xs text-text-subtle">
                Last sync {new Date(lastSynced).toLocaleString()}
              </span>
            ) : null}
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-1.5 text-sm"
              disabled={indexing || asking}
              onClick={() => void runFullIndex()}
            >
              <RefreshIcon className={`h-4 w-4 ${indexing ? 'animate-spin' : ''}`} />
              {indexLabel}
            </button>
            {turns.length > 0 ? (
              <button
                type="button"
                className="btn-secondary text-sm"
                disabled={asking}
                onClick={clearChat}
              >
                Clear chat
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="mx-auto max-w-3xl space-y-4">
          {turns.length === 0 ? (
            <EmptyState
              icon={<SearchIcon className="h-8 w-8" />}
              title="Ask anything about your work"
              message="Index your workspace first, then ask where you left off, what's open, or who you talked to about something."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {STARTER_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="rounded-full border border-border bg-surface-raised px-3 py-1.5 text-left text-xs text-text-muted hover:border-brand-300 hover:text-text"
                      onClick={() => void runAsk(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              }
            />
          ) : (
            turns.map((turn) => (
              <div
                key={turn.id}
                className={turn.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
              >
                <Card
                  tone={turn.role === 'user' ? 'sunken' : 'raised'}
                  padded="sm"
                  className={[
                    'max-w-[92%] text-sm',
                    turn.role === 'user' ? 'bg-brand-50 dark:bg-brand-950/30' : '',
                  ].join(' ')}
                >
                  {turn.role === 'user' ? (
                    <p className="whitespace-pre-wrap text-text">{turn.content}</p>
                  ) : (
                    <>
                      <p className="whitespace-pre-wrap leading-relaxed text-text">
                        {renderSimpleMarkdown(turn.content)}
                      </p>
                      {turn.citations && turn.citations.length > 0 ? (
                        <div className="mt-3 space-y-2 border-t border-border pt-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                            Sources
                          </p>
                          <ul className="space-y-1.5">
                            {turn.citations.map((c, i) => (
                              <li key={`${c.sourceType}-${c.sourceId}-${i}`}>
                                <button
                                  type="button"
                                  onClick={() => openCitation(c)}
                                  className="group flex w-full items-start gap-2 rounded-lg border border-border bg-surface px-2.5 py-2 text-left hover:border-brand-300"
                                >
                                  <Badge variant="subtle" className="shrink-0 text-[10px]">
                                    {sourceLabel(c.sourceType)}
                                  </Badge>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs font-medium text-text group-hover:text-brand-700 dark:group-hover:text-brand-300">
                                      {c.title}
                                    </span>
                                    <span className="mt-0.5 line-clamp-2 text-[11px] text-text-muted">
                                      {c.excerpt}
                                    </span>
                                  </span>
                                  <ArrowRightIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-subtle" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </>
                  )}
                </Card>
              </div>
            ))
          )}
          {asking ? (
            <p className="text-sm text-text-muted" role="status">
              Searching your workspace…
            </p>
          ) : null}
        </div>
      </div>

      <div className="border-t border-border bg-surface-raised px-4 py-4 sm:px-8">
        <form
          className="mx-auto max-w-3xl"
          onSubmit={(e) => {
            e.preventDefault();
            void runAsk(input);
          }}
        >
          {error ? (
            <p className="mb-2 text-xs text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void runAsk(input);
                }
              }}
              rows={2}
              placeholder="e.g. Me and Brian talked about the coverage endpoint — where are we at?"
              className="input min-h-[3rem] flex-1 resize-none py-2.5"
              disabled={asking}
            />
            <button type="submit" className="btn-primary shrink-0 self-end px-4" disabled={asking || !input.trim()}>
              Ask
            </button>
          </div>
          <p className="mt-2 text-[11px] text-text-subtle">
            Enter to send · Shift+Enter for newline · Answers cite your indexed notes and tasks
          </p>
        </form>
      </div>
    </div>
  );
}
