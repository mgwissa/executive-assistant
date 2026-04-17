import { useMemo } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useNotesStore } from '../store/useNotesStore';
import { extractPreview, formatRelative } from '../lib/format';
import { PlusIcon } from './icons';
import { SearchBar } from './SearchBar';

export function Sidebar() {
  const { notes, activeId, query, setActive, createNote } = useNotesStore();
  const user = useAuthStore((s) => s.user);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q),
    );
  }, [notes, query]);

  return (
    <aside className="flex h-full w-72 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
      <div className="border-b border-slate-200 px-3 py-3 dark:border-slate-800">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Notes
        </h2>
        <div className="space-y-2">
          <SearchBar />
          <button
            className="btn-primary w-full"
            onClick={() => user && createNote(user.id)}
          >
            <PlusIcon className="h-4 w-4" />
            New note
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {filtered.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-slate-500 dark:text-slate-400">
            {query ? 'No matches.' : 'No notes yet. Create your first note.'}
          </div>
        ) : (
          <ul className="space-y-1">
            {filtered.map((note) => {
              const isActive = note.id === activeId;
              const preview = extractPreview(note.content);
              return (
                <li key={note.id}>
                  <button
                    onClick={() => setActive(note.id)}
                    className={[
                      'w-full rounded-md px-3 py-2 text-left transition-colors',
                      isActive
                        ? 'bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700'
                        : 'hover:bg-white/60 dark:hover:bg-slate-900',
                    ].join(' ')}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {note.title || 'Untitled'}
                      </span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        {formatRelative(note.updated_at)}
                      </span>
                    </div>
                    {preview && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                        {preview}
                      </p>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
