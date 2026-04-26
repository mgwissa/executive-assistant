import { useEffect, useMemo, useRef, useState } from 'react';
import { isNotebookShared } from '../lib/notebookSharing';
import { extractPreview, formatRelative } from '../lib/format';
import { getNoteCanonicalMarkdown } from '../lib/noteContentBridge';
import { useAuthStore } from '../store/useAuthStore';
import { useNotebooksStore } from '../store/useNotebooksStore';
import { useNotesStore } from '../store/useNotesStore';
import { useSharingStore } from '../store/useSharingStore';
import type { Notebook, Section } from '../types';
import { ShareNotebookModal } from './ShareNotebookModal';
import {
  BookIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  NoteIcon,
  PlusIcon,
  TrashIcon,
} from './icons';
import { SearchBar } from './SearchBar';

export function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const { notes, activeId, query, setActive, createNote } = useNotesStore();
  const {
    notebooks,
    sections,
    memberCountByNotebook,
    activeNotebookId,
    setActiveNotebook,
    createNotebook,
    renameNotebook,
    deleteNotebook,
    createSection,
    renameSection,
    deleteSection,
    fetchAll: fetchNotebooks,
    refreshMemberCounts,
  } = useNotebooksStore();
  const fetchNotes = useNotesStore((s) => s.fetchAll);
  const fetchSharing = useSharingStore((s) => s.fetchSharing);

  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    setShareOpen(false);
  }, [activeNotebookId]);

  const activeNotebook = notebooks.find((n) => n.id === activeNotebookId) ?? null;

  const notebookSections = useMemo(
    () =>
      activeNotebookId
        ? sections.filter((s) => s.notebook_id === activeNotebookId)
        : [],
    [sections, activeNotebookId],
  );

  const notesInNotebook = useMemo(() => {
    const sectionIds = new Set(notebookSections.map((s) => s.id));
    return notes.filter((n) => n.section_id && sectionIds.has(n.section_id));
  }, [notes, notebookSections]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notesInNotebook;
    return notesInNotebook.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        getNoteCanonicalMarkdown(n).toLowerCase().includes(q),
    );
  }, [notesInNotebook, query]);

  const notesBySection = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const s of notebookSections) {
      map.set(s.id, []);
    }
    for (const n of filtered) {
      if (n.section_id) {
        const arr = map.get(n.section_id);
        if (arr) arr.push(n);
      }
    }
    return map;
  }, [filtered, notebookSections]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapsed = (sectionId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const handleNewNote = (sectionId: string) => {
    if (!user) return;
    void createNote(user.id, sectionId);
  };

  const firstSection = notebookSections[0];

  return (
    <aside className="flex h-full w-72 flex-col border-r border-border-strong bg-surface-sunken">
      {/* Notebook picker */}
      <div className="border-b border-border-strong px-3 py-3">
        <NotebookPicker
          notebooks={notebooks}
          memberCountByNotebook={memberCountByNotebook}
          currentUserId={user?.id}
          activeId={activeNotebookId}
          onSelect={setActiveNotebook}
          onCreate={(name) => user && createNotebook(user.id, name)}
          onRename={renameNotebook}
          onDelete={deleteNotebook}
          onShare={() => setShareOpen(true)}
        />
      </div>

      {activeNotebook && user ? (
        <ShareNotebookModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          notebookId={activeNotebook.id}
          notebookName={activeNotebook.name}
          isOwner={activeNotebook.user_id === user.id}
          currentUserId={user.id}
          onMembershipChanged={async () => {
            await fetchNotebooks(user.id);
            await refreshMemberCounts();
            await fetchNotes(user.id);
            await fetchSharing(activeNotebook.id);
          }}
        />
      ) : null}

      {/* Search + new section */}
      <div className="space-y-2 border-b border-border-strong px-3 py-3">
        <SearchBar />
        <div className="flex gap-2">
          <button
            className="btn-primary flex-1"
            disabled={!firstSection}
            onClick={() => firstSection && handleNewNote(firstSection.id)}
          >
            <PlusIcon className="h-4 w-4" />
            New note
          </button>
          <button
            className="btn-ghost shrink-0 px-2"
            title="New section"
            onClick={() => {
              if (!user || !activeNotebookId) return;
              const name = window.prompt('Section name:');
              if (name?.trim()) void createSection(activeNotebookId, user.id, name.trim());
            }}
          >
            <FolderIcon className="h-4 w-4" />
            <PlusIcon className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Section tree */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {!activeNotebook ? (
          <div className="px-3 py-10 text-center text-xs text-text-muted">
            No notebook selected.
          </div>
        ) : notebookSections.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-text-muted">
            No sections yet. Create one to start adding notes.
          </div>
        ) : (
          <div className="space-y-1">
            {notebookSections.map((section) => (
              <SectionGroup
                key={section.id}
                section={section}
                notes={notesBySection.get(section.id) ?? []}
                activeNoteId={activeId}
                isCollapsed={collapsed.has(section.id)}
                onToggleCollapsed={() => toggleCollapsed(section.id)}
                onSelectNote={setActive}
                onNewNote={() => handleNewNote(section.id)}
                onRenameSection={renameSection}
                onDeleteSection={deleteSection}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

/* ---------- Notebook picker ---------- */

function NotebookPicker({
  notebooks,
  memberCountByNotebook,
  currentUserId,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onShare,
}: {
  notebooks: Notebook[];
  memberCountByNotebook: Record<string, number>;
  currentUserId: string | undefined;
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onShare: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commitRename = (id: string) => {
    setEditing(null);
    if (draft.trim()) onRename(id, draft.trim());
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Notebooks
        </h2>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            className="btn-ghost h-6 px-1.5 text-[11px] font-medium"
            title="Share notebook"
            disabled={!activeId}
            onClick={onShare}
          >
            Share
          </button>
          <button
            type="button"
            className="btn-ghost h-6 w-6 p-0"
            title="New notebook"
            onClick={() => {
              const name = window.prompt('Notebook name:');
              if (name?.trim()) onCreate(name.trim());
            }}
          >
            <PlusIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <ul className="space-y-0.5">
        {notebooks.map((nb) => {
          const isActive = nb.id === activeId;
          const isEditing = editing === nb.id;
          const shared = isNotebookShared(nb, currentUserId, memberCountByNotebook);
          const canDelete = notebooks.length > 1 && nb.user_id === currentUserId;
          return (
            <li key={nb.id} className="group flex items-center gap-1">
              {isEditing ? (
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitRename(nb.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(nb.id);
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  className="input min-w-0 flex-1 py-1 text-sm"
                  maxLength={100}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect(nb.id)}
                  onDoubleClick={() => {
                    setDraft(nb.name);
                    setEditing(nb.id);
                  }}
                  className={[
                    'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                    isActive
                      ? 'bg-brand-50 font-medium text-brand-700 ring-1 ring-brand-200 dark:bg-surface-raised dark:text-brand-300 dark:ring-brand-500/30'
                      : 'text-text hover:bg-surface-raised',
                  ].join(' ')}
                  title="Double-click to rename"
                >
                  <BookIcon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">{nb.name}</span>
                  {shared ? (
                    <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-muted ring-1 ring-border">
                      Shared
                    </span>
                  ) : null}
                </button>
              )}
              {canDelete ? (
                <button
                  type="button"
                  className="btn-ghost hidden h-6 w-6 shrink-0 p-0 text-red-500 group-hover:flex"
                  title="Delete notebook"
                  onClick={() => {
                    if (window.confirm(`Delete "${nb.name}" and all its sections and notes?`))
                      void onDelete(nb.id);
                  }}
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------- Section group ---------- */

function SectionGroup({
  section,
  notes,
  activeNoteId,
  isCollapsed,
  onToggleCollapsed,
  onSelectNote,
  onNewNote,
  onRenameSection,
  onDeleteSection,
}: {
  section: Section;
  notes: { id: string; title: string; content: string; updated_at: string }[];
  activeNoteId: string | null;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  onSelectNote: (id: string) => void;
  onNewNote: () => void;
  onRenameSection: (id: string, name: string) => void;
  onDeleteSection: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== section.name) {
      onRenameSection(section.id, draft.trim());
    }
  };

  return (
    <div>
      <div className="group flex items-center gap-1 rounded-md px-1 py-1 hover:bg-surface-raised/50">
        <button
          onClick={onToggleCollapsed}
          className="shrink-0 p-0.5 text-text-subtle hover:text-text"
          aria-label={isCollapsed ? 'Expand section' : 'Collapse section'}
        >
          {isCollapsed ? (
            <ChevronRightIcon className="h-3.5 w-3.5" />
          ) : (
            <ChevronDownIcon className="h-3.5 w-3.5" />
          )}
        </button>
        <FolderIcon className="h-3.5 w-3.5 shrink-0 text-text-subtle" />
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setDraft(section.name);
                setEditing(false);
              }
            }}
            className="input min-w-0 flex-1 py-0.5 text-xs"
            maxLength={100}
          />
        ) : (
          <button
            className="min-w-0 flex-1 truncate text-left text-xs font-semibold uppercase tracking-wider text-text-muted"
            onDoubleClick={() => {
              setDraft(section.name);
              setEditing(true);
            }}
            title="Double-click to rename"
          >
            {section.name}
          </button>
        )}
        <span className="mr-1 text-[10px] text-text-subtle">{notes.length}</span>
        <button
          className="btn-ghost hidden h-5 w-5 shrink-0 p-0 group-hover:flex"
          title="Add note to this section"
          onClick={onNewNote}
        >
          <PlusIcon className="h-3 w-3" />
        </button>
        <button
          className="btn-ghost hidden h-5 w-5 shrink-0 p-0 text-red-500 group-hover:flex"
          title="Delete section"
          onClick={() => {
            if (
              window.confirm(
                `Delete "${section.name}"? Notes in this section will also be removed.`,
              )
            )
              void onDeleteSection(section.id);
          }}
        >
          <TrashIcon className="h-3 w-3" />
        </button>
      </div>

      {!isCollapsed && (
        <ul className="ml-5 space-y-0.5 border-l border-border/50 pl-2 pt-0.5">
          {notes.length === 0 ? (
            <li className="px-2 py-2 text-[11px] text-text-subtle">No notes</li>
          ) : (
            notes.map((note) => {
              const isActive = note.id === activeNoteId;
              const preview = extractPreview(getNoteCanonicalMarkdown(note));
              return (
                <li key={note.id}>
                  <button
                    onClick={() => onSelectNote(note.id)}
                    className={[
                      'w-full rounded-md px-2.5 py-1.5 text-left transition-colors',
                      isActive
                        ? 'border-l-2 border-brand-600 bg-brand-50 shadow-card ring-1 ring-border dark:border-brand-400 dark:bg-surface-raised dark:ring-border-strong'
                        : 'hover:bg-surface-raised',
                    ].join(' ')}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <NoteIcon className="h-3 w-3 shrink-0 text-text-subtle" />
                        <span className="truncate text-sm font-medium text-text">
                          {note.title || 'Untitled'}
                        </span>
                      </div>
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-text-subtle">
                        {formatRelative(note.updated_at)}
                      </span>
                    </div>
                    {preview && (
                      <p className="mt-0.5 line-clamp-2 pl-[18px] text-xs text-text-muted">
                        {preview}
                      </p>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
