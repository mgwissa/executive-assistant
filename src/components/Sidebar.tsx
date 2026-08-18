import { useEffect, useMemo, useRef, useState } from 'react';
import { isNotebookShared } from '../lib/notebookSharing';
import { extractPreview, formatRelative } from '../lib/format';
import { meetingNoteNeedsTriage } from '../lib/meetingNoteTriage';
import { useAuthStore } from '../store/useAuthStore';
import { useNotebooksStore } from '../store/useNotebooksStore';
import { useNotesStore } from '../store/useNotesStore';
import { useEventsStore } from '../store/useEventsStore';
import { useSharingStore } from '../store/useSharingStore';
import { useShellLayoutStore } from '../store/useShellLayoutStore';
import { useWorkstreamsStore } from '../store/useWorkstreamsStore';
import type { Note, Notebook, Section, Workstream } from '../types';
import { ShareNotebookModal } from './ShareNotebookModal';
import {
  BookIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FolderIcon,
  InboxIcon,
  NoteIcon,
  PlusIcon,
  TargetIcon,
  TrashIcon,
} from './icons';
import { SearchBar } from './SearchBar';

/** Subtle alternating washes — same family as the app brand, not a rainbow.
 * Dark mode uses faint accent tints over the dark surface so every section
 * reads as "dark with a hint of color" rather than a bright patch. */
const SECTION_TONES = [
  {
    shell:
      'border-indigo-200/55 bg-gradient-to-br from-indigo-50/75 via-surface-raised to-white shadow-sm ring-indigo-950/[0.04] dark:border-indigo-500/15 dark:from-indigo-500/[0.06] dark:via-surface-raised/30 dark:to-surface-raised/10 dark:ring-indigo-400/10',
    header: 'bg-indigo-50/50 dark:bg-indigo-500/[0.05]',
    rail: 'border-l-indigo-200/70 dark:border-l-indigo-500/30',
    folder: 'text-indigo-600 dark:text-indigo-400',
  },
  {
    shell:
      'border-slate-200/70 bg-gradient-to-br from-slate-50/90 via-surface-raised to-white shadow-sm ring-slate-900/[0.03] dark:border-zinc-600/25 dark:from-white/[0.025] dark:via-surface-raised/30 dark:to-surface-raised/10 dark:ring-white/[0.03]',
    header: 'bg-slate-100/55 dark:bg-white/[0.03]',
    rail: 'border-l-slate-300/80 dark:border-l-zinc-500/45',
    folder: 'text-slate-600 dark:text-zinc-400',
  },
  {
    shell:
      'border-brand-200/60 bg-gradient-to-br from-brand-50/85 via-surface-raised to-white shadow-sm ring-brand-900/[0.04] dark:border-brand-500/18 dark:from-brand-500/[0.06] dark:via-surface-raised/30 dark:to-surface-raised/10 dark:ring-brand-400/10',
    header: 'bg-brand-50/60 dark:bg-brand-500/[0.05]',
    rail: 'border-l-brand-300/75 dark:border-l-brand-500/35',
    folder: 'text-brand-700 dark:text-brand-400',
  },
] as const;

export function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const notes = useNotesStore((s) => s.notes);
  const events = useEventsStore((s) => s.events);
  const activeId = useNotesStore((s) => s.activeId);
  const query = useNotesStore((s) => s.query);
  const setActive = useNotesStore((s) => s.setActive);
  const createNote = useNotesStore((s) => s.createNote);
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
  const workstreams = useWorkstreamsStore((s) => s.workstreams);
  const noteLinks = useWorkstreamsStore((s) => s.noteLinks);
  const activeWorkstreamId = useWorkstreamsStore((s) => s.activeWorkstreamId);
  const setActiveWorkstream = useWorkstreamsStore((s) => s.setActiveWorkstream);
  const createWorkstream = useWorkstreamsStore((s) => s.createWorkstream);

  const [shareOpen, setShareOpen] = useState(false);
  const [navigationMode, setNavigationMode] = useState<
    'meetingInbox' | 'scratch' | 'workstreams' | 'library'
  >('workstreams');

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

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notesInNotebook;
    return notesInNotebook.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        (n.content ?? '').toLowerCase().includes(q),
    );
  }, [notesInNotebook, query]);

  const filtered = useMemo(
    () => filteredNotes.filter((note) => !note.scratch_at),
    [filteredNotes],
  );
  const scratchNotes = useMemo(
    () => filteredNotes.filter((note) => Boolean(note.scratch_at)),
    [filteredNotes],
  );
  const scratchCount = useMemo(
    () => notesInNotebook.filter((note) => Boolean(note.scratch_at)).length,
    [notesInNotebook],
  );

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

  const workstreamNotes = useMemo(() => {
    const linkedIds = new Set(
      noteLinks
        .filter((link) =>
          activeWorkstreamId
            ? link.workstream_id === activeWorkstreamId
            : true,
        )
        .map((link) => link.note_id),
    );
    if (activeWorkstreamId) return filtered.filter((note) => linkedIds.has(note.id));
    return filtered.filter((note) => !linkedIds.has(note.id));
  }, [activeWorkstreamId, filtered, noteLinks]);

  const pendingMeetingNotes = useMemo(
    () => notesInNotebook.filter((note) => meetingNoteNeedsTriage(note, events)),
    [events, notesInNotebook],
  );
  const visiblePendingMeetingNotes = useMemo(() => {
    const visibleIds = new Set(filtered.map((note) => note.id));
    return pendingMeetingNotes.filter((note) => visibleIds.has(note.id));
  }, [filtered, pendingMeetingNotes]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapsed = (sectionId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const handleNewNote = async (
    sectionId: string,
    workstreamId?: string | null,
    scratch = false,
  ) => {
    if (!user) return;
    const note = await createNote(user.id, sectionId, { scratch });
    if (note && workstreamId) {
      await useWorkstreamsStore.getState().toggleNote(user.id, note.id, workstreamId);
    }
  };

  const firstSection = notebookSections[0];

  const toggleNotesSidebar = useShellLayoutStore((s) => s.toggleNotesSidebar);

  return (
    <aside className="relative flex h-full w-full shrink-0 flex-col border-r border-border-strong bg-gradient-to-b from-surface-sunken via-surface-sunken to-brand-50/[0.12] md:w-72 dark:to-brand-950/[0.12]">
      {/* Desktop-only collapse toggle. On mobile there's no other pane to
          reveal — the editor takes the full width when a note is selected. */}
      <div className="relative z-[1] hidden shrink-0 items-center justify-end border-b border-border-strong bg-surface-sunken/40 px-2 py-1 md:flex dark:bg-black/10">
        <button
          type="button"
          className="btn-ghost h-8 w-8 p-0"
          title="Hide note list (more space for editor)"
          aria-expanded={true}
          onClick={toggleNotesSidebar}
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
      </div>
      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-brand-200/0 via-brand-300/25 to-brand-200/0 dark:via-brand-500/20"
        aria-hidden
      />
      {/* Notebook picker */}
      <div className="relative border-b border-border-strong bg-gradient-to-br from-surface-raised/90 via-brand-50/25 to-brand-100/15 px-3 py-3 dark:from-surface-raised/40 dark:via-brand-950/15 dark:to-surface-raised/20">
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
      <div className="relative space-y-2 border-b border-border-strong bg-gradient-to-b from-brand-50/20 to-transparent px-3 py-3 dark:from-brand-950/12">
        <div className="grid grid-cols-2 rounded-lg bg-surface-sunken p-1 ring-1 ring-border" aria-label="Notes navigation mode">
          <button
            type="button"
            onClick={() => setNavigationMode('meetingInbox')}
            className={[
              'flex items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-xs font-medium transition-colors',
              navigationMode === 'meetingInbox'
                ? 'bg-surface-raised text-text shadow-sm'
                : 'text-text-muted hover:text-text',
            ].join(' ')}
          >
            Meetings
            {pendingMeetingNotes.length > 0 ? (
              <span className="rounded-full bg-brand-100 px-1.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
                {pendingMeetingNotes.length}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setNavigationMode('scratch')}
            className={[
              'flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
              navigationMode === 'scratch'
                ? 'bg-surface-raised text-text shadow-sm'
                : 'text-text-muted hover:text-text',
            ].join(' ')}
          >
            Scratch
            {scratchCount > 0 ? (
              <span className="rounded-full bg-brand-100 px-1.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
                {scratchCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setNavigationMode('workstreams')}
            className={[
              'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
              navigationMode === 'workstreams'
                ? 'bg-surface-raised text-text shadow-sm'
                : 'text-text-muted hover:text-text',
            ].join(' ')}
          >
            Workstreams
          </button>
          <button
            type="button"
            onClick={() => setNavigationMode('library')}
            className={[
              'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
              navigationMode === 'library'
                ? 'bg-surface-raised text-text shadow-sm'
                : 'text-text-muted hover:text-text',
            ].join(' ')}
          >
            Library
          </button>
        </div>
        <SearchBar />
        {navigationMode !== 'meetingInbox' ? <div className="flex gap-2">
          <button
            className="btn-primary flex-1"
            disabled={!firstSection}
            onClick={() =>
              firstSection &&
              void handleNewNote(
                firstSection.id,
                navigationMode === 'workstreams' ? activeWorkstreamId : null,
                navigationMode === 'scratch',
              )
            }
          >
            <PlusIcon className="h-4 w-4" />
            {navigationMode === 'scratch' ? 'New scratch' : 'New note'}
          </button>
          {navigationMode === 'library' ? (
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
          ) : navigationMode === 'workstreams' ? (
            <button
              className="btn-ghost shrink-0 px-2"
              title="New workstream"
              onClick={() => {
                if (!user) return;
                const name = window.prompt('Workstream name:');
                if (name?.trim()) void createWorkstream(user.id, name.trim());
              }}
            >
              <TargetIcon className="h-4 w-4" />
              <PlusIcon className="h-3 w-3" />
            </button>
          ) : null}
        </div> : (
          <p className="px-1 text-[11px] leading-relaxed text-text-muted">
            Meeting notes appear here after the meeting ends and stay until reviewed.
          </p>
        )}
      </div>

      {/* Section tree */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-transparent to-brand-50/[0.08] px-2 py-3 dark:to-brand-950/[0.06]">
        {!activeNotebook ? (
          <div className="px-3 py-10 text-center text-xs text-text-muted">
            No notebook selected.
          </div>
        ) : navigationMode === 'meetingInbox' ? (
          <MeetingInboxNavigation
            notes={visiblePendingMeetingNotes}
            sections={notebookSections}
            activeNoteId={activeId}
            onSelectNote={setActive}
          />
        ) : navigationMode === 'scratch' ? (
          <ScratchInboxNavigation
            notes={scratchNotes}
            sections={notebookSections}
            activeNoteId={activeId}
            onSelectNote={setActive}
          />
        ) : navigationMode === 'workstreams' ? (
          <WorkstreamNavigation
            workstreams={workstreams}
            activeWorkstreamId={activeWorkstreamId}
            noteLinks={noteLinks}
            notes={workstreamNotes}
            allNotes={filtered}
            sections={notebookSections}
            activeNoteId={activeId}
            onSelectWorkstream={setActiveWorkstream}
            onSelectNote={setActive}
            onCreateWorkstream={() => {
              if (!user) return;
              const name = window.prompt('Workstream name:');
              if (name?.trim()) void createWorkstream(user.id, name.trim());
            }}
          />
        ) : notebookSections.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-text-muted">
            No sections yet. Create one to start adding notes.
          </div>
        ) : (
          <div className="space-y-2.5">
            {notebookSections.map((section, sectionIndex) => {
              const tone = SECTION_TONES[sectionIndex % SECTION_TONES.length];
              return (
                <div
                  key={section.id}
                  className={[
                    'rounded-xl border p-1 ring-1',
                    tone.shell,
                  ].join(' ')}
                >
                  <SectionGroup
                    tone={tone}
                    section={section}
                    notes={notesBySection.get(section.id) ?? []}
                    activeNoteId={activeId}
                    isCollapsed={collapsed.has(section.id)}
                    onToggleCollapsed={() => toggleCollapsed(section.id)}
                    onSelectNote={setActive}
                    onNewNote={() => void handleNewNote(section.id)}
                    onRenameSection={renameSection}
                    onDeleteSection={deleteSection}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

function ScratchInboxNavigation({
  notes,
  sections,
  activeNoteId,
  onSelectNote,
}: {
  notes: Note[];
  sections: Section[];
  activeNoteId: string | null;
  onSelectNote: (id: string) => void;
}) {
  return (
    <div>
      <div className="px-2 pb-3">
        <p className="text-xs font-semibold text-text">Scratch inbox</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">
          Capture first. Promote useful context after tasks and decisions have been extracted.
        </p>
      </div>
      {notes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong bg-surface-raised/50 px-4 py-6 text-center">
          <p className="text-sm font-medium text-text">Scratch inbox clear</p>
          <p className="mt-1 text-xs text-text-muted">Quick captures waiting for cleanup will appear here.</p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {notes.map((note) => {
            const active = note.id === activeNoteId;
            const section = sections.find((item) => item.id === note.section_id);
            return (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => onSelectNote(note.id)}
                  className={[
                    'w-full rounded-lg px-3 py-2.5 text-left transition-colors',
                    active
                      ? 'bg-brand-50 text-brand-800 ring-1 ring-brand-200 dark:bg-brand-950/35 dark:text-brand-200 dark:ring-brand-500/25'
                      : 'bg-surface-raised/55 text-text ring-1 ring-border hover:bg-surface-raised',
                  ].join(' ')}
                >
                  <div className="flex items-start gap-2">
                    <NoteIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{note.title || 'Untitled scratch'}</p>
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-text-muted">
                        {extractPreview(note.content) || 'Open to add or sort this capture.'}
                      </p>
                      <p className="mt-1 truncate text-[10px] text-text-subtle">
                        {section?.name ?? 'Library'} · {formatRelative(note.scratch_at ?? note.updated_at)}
                      </p>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MeetingInboxNavigation({
  notes,
  sections,
  activeNoteId,
  onSelectNote,
}: {
  notes: Note[];
  sections: Section[];
  activeNoteId: string | null;
  onSelectNote: (id: string) => void;
}) {
  return (
    <div>
      <div className="px-2 pb-3">
        <p className="text-xs font-semibold text-text">Meeting inbox</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">
          Review decisions, create any real follow-ups, and preserve durable context before clearing the note.
        </p>
      </div>
      {notes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong bg-surface-raised/50 px-4 py-6 text-center">
          <p className="text-sm font-medium text-text">Meeting inbox clear</p>
          <p className="mt-1 text-xs text-text-muted">No completed meeting notes need review.</p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {notes.map((note) => {
            const active = note.id === activeNoteId;
            const section = sections.find((item) => item.id === note.section_id);
            return (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => onSelectNote(note.id)}
                  className={[
                    'w-full rounded-lg px-3 py-2.5 text-left transition-colors',
                    active
                      ? 'bg-brand-50 text-brand-800 ring-1 ring-brand-200 dark:bg-brand-950/35 dark:text-brand-200 dark:ring-brand-500/25'
                      : 'bg-surface-raised/55 text-text ring-1 ring-border hover:bg-surface-raised',
                  ].join(' ')}
                >
                  <div className="flex items-start gap-2">
                    <InboxIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{note.title || 'Untitled meeting'}</p>
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-text-muted">
                        {extractPreview(note.content) || 'Open to review this meeting note.'}
                      </p>
                      <p className="mt-1 truncate text-[10px] text-text-subtle">
                        {section?.name ?? 'Library'} · {formatRelative(note.linked_occurrence_start_at ?? note.updated_at)}
                      </p>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function WorkstreamNavigation({
  workstreams,
  activeWorkstreamId,
  noteLinks,
  notes,
  allNotes,
  sections,
  activeNoteId,
  onSelectWorkstream,
  onSelectNote,
  onCreateWorkstream,
}: {
  workstreams: Workstream[];
  activeWorkstreamId: string | null;
  noteLinks: { note_id: string; workstream_id: string }[];
  notes: Note[];
  allNotes: Note[];
  sections: Section[];
  activeNoteId: string | null;
  onSelectWorkstream: (id: string | null) => void;
  onSelectNote: (id: string) => void;
  onCreateWorkstream: () => void;
}) {
  const activeWorkstreams = workstreams.filter((workstream) => workstream.status === 'active');
  const visibleNoteIds = new Set(allNotes.map((note) => note.id));
  const linkedNoteIds = new Set(noteLinks.map((link) => link.note_id));
  const unassignedCount = allNotes.filter((note) => !linkedNoteIds.has(note.id)).length;
  const selected = workstreams.find((workstream) => workstream.id === activeWorkstreamId) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between px-2 pb-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-subtle">Active workstreams</p>
          <button type="button" className="btn-ghost h-6 px-1.5 text-[11px]" onClick={onCreateWorkstream}>
            <PlusIcon className="h-3 w-3" />
            New
          </button>
        </div>
        {activeWorkstreams.length === 0 ? (
          <button
            type="button"
            className="w-full rounded-xl border border-dashed border-border-strong bg-surface-raised/50 px-4 py-5 text-left"
            onClick={onCreateWorkstream}
          >
            <p className="text-sm font-medium text-text">Create your first workstream</p>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              Start with an active product or investigation. Existing notes stay where they are.
            </p>
          </button>
        ) : (
          <div className="space-y-1">
            {activeWorkstreams.map((workstream) => {
              const count = noteLinks.filter(
                (link) =>
                  link.workstream_id === workstream.id && visibleNoteIds.has(link.note_id),
              ).length;
              const active = workstream.id === activeWorkstreamId;
              return (
                <button
                  key={workstream.id}
                  type="button"
                  onClick={() => onSelectWorkstream(workstream.id)}
                  className={[
                    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    active
                      ? 'bg-brand-50 font-medium text-brand-700 ring-1 ring-brand-200 dark:bg-brand-950/35 dark:text-brand-300 dark:ring-brand-500/25'
                      : 'text-text hover:bg-surface-raised',
                  ].join(' ')}
                >
                  <TargetIcon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{workstream.name}</span>
                  <span className="text-[10px] text-text-subtle">{count}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => onSelectWorkstream(null)}
              className={[
                'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                activeWorkstreamId === null
                  ? 'bg-surface-raised font-medium text-text ring-1 ring-border-strong'
                  : 'text-text-muted hover:bg-surface-raised hover:text-text',
              ].join(' ')}
            >
              <InboxIcon className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">Unassigned</span>
              <span className="text-[10px] text-text-subtle">{unassignedCount}</span>
            </button>
          </div>
        )}
      </div>

      <div className="border-t border-border pt-3">
        <div className="px-2 pb-2">
          <p className="text-xs font-semibold text-text">{selected?.name ?? 'Unassigned notes'}</p>
          <p className="mt-0.5 text-[11px] text-text-muted">
            {selected ? 'Context collected across the existing library.' : 'Use this as the migration inbox.'}
          </p>
        </div>
        {notes.length === 0 ? (
          <p className="rounded-lg bg-surface-raised/60 px-3 py-4 text-xs text-text-muted ring-1 ring-border">
            {selected ? 'No notes have been added yet.' : 'Every visible note is assigned.'}
          </p>
        ) : (
          <ul className="space-y-1">
            {notes.map((note) => {
              const active = note.id === activeNoteId;
              const section = sections.find((item) => item.id === note.section_id);
              return (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => onSelectNote(note.id)}
                    className={[
                      'w-full rounded-lg px-3 py-2 text-left transition-colors',
                      active
                        ? 'bg-brand-50 text-brand-800 ring-1 ring-brand-200 dark:bg-brand-950/35 dark:text-brand-200 dark:ring-brand-500/25'
                        : 'text-text hover:bg-surface-raised',
                    ].join(' ')}
                  >
                    <p className="truncate text-sm font-medium">{note.title || 'Untitled'}</p>
                    <p className="mt-0.5 truncate text-[11px] text-text-muted">
                      {section?.name ?? 'Library'} · {formatRelative(note.updated_at)}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
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
  tone,
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
  tone: (typeof SECTION_TONES)[number];
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
      <div
        className={[
          'group flex items-center gap-1 rounded-lg px-1.5 py-1.5 transition-colors',
          tone.header,
          'hover:brightness-[0.99] dark:hover:brightness-110',
        ].join(' ')}
      >
        <button
          onClick={onToggleCollapsed}
          className="shrink-0 rounded p-0.5 text-text-subtle hover:bg-black/[0.04] hover:text-text dark:hover:bg-white/[0.06]"
          aria-label={isCollapsed ? 'Expand section' : 'Collapse section'}
        >
          {isCollapsed ? (
            <ChevronRightIcon className="h-3.5 w-3.5" />
          ) : (
            <ChevronDownIcon className="h-3.5 w-3.5" />
          )}
        </button>
        <FolderIcon className={['h-3.5 w-3.5 shrink-0 opacity-90', tone.folder].join(' ')} />
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
            className="min-w-0 flex-1 truncate text-left text-xs font-semibold uppercase tracking-wider text-text"
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
        <ul className={['ml-5 space-y-0.5 border-l-2 pl-2.5 pt-0.5', tone.rail].join(' ')}>
          {notes.length === 0 ? (
            <li className="px-2 py-2 text-[11px] text-text-muted">No notes</li>
          ) : (
            notes.map((note) => {
              const isActive = note.id === activeNoteId;
              const preview = extractPreview(note.content ?? '');
              return (
                <li key={note.id}>
                  <button
                    onClick={() => onSelectNote(note.id)}
                    className={[
                      'w-full rounded-md px-2.5 py-1.5 text-left transition-colors',
                      isActive
                        ? 'border-l-2 border-brand-600 bg-brand-50 shadow-card ring-1 ring-brand-200/60 dark:border-brand-400 dark:bg-brand-950/35 dark:ring-brand-500/25'
                        : 'hover:bg-black/[0.03] hover:ring-1 hover:ring-black/[0.04] dark:hover:bg-white/[0.04] dark:hover:ring-white/[0.06]',
                    ].join(' ')}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <NoteIcon
                          className={[
                            'h-3 w-3 shrink-0',
                            isActive
                              ? 'text-brand-600 dark:text-brand-400'
                              : 'text-text-subtle opacity-80',
                          ].join(' ')}
                        />
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
