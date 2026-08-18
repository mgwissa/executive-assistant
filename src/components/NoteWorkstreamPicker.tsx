import { useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useWorkstreamsStore } from '../store/useWorkstreamsStore';
import { PlusIcon, TargetIcon, XIcon } from './icons';

export function NoteWorkstreamPicker({ noteId, noteOwnerId }: { noteId: string; noteOwnerId: string }) {
  const user = useAuthStore((state) => state.user);
  const workstreams = useWorkstreamsStore((state) => state.workstreams);
  const noteLinks = useWorkstreamsStore((state) => state.noteLinks);
  const createWorkstream = useWorkstreamsStore((state) => state.createWorkstream);
  const toggleNote = useWorkstreamsStore((state) => state.toggleNote);
  const [open, setOpen] = useState(false);
  const canOrganize = user?.id === noteOwnerId;

  const assignedIds = new Set(
    noteLinks.filter((link) => link.note_id === noteId).map((link) => link.workstream_id),
  );
  const assigned = workstreams.filter((workstream) => assignedIds.has(workstream.id));

  const addWorkstream = async () => {
    if (!user) return;
    const name = window.prompt('Workstream name:');
    if (!name?.trim()) return;
    const created = await createWorkstream(user.id, name);
    if (created) await toggleNote(user.id, noteId, created.id);
  };

  return (
    <div className="relative">
      <button
        type="button"
        className="btn-ghost h-9 gap-1.5 rounded-lg px-2.5 text-xs"
        onClick={() => setOpen((value) => !value)}
        disabled={!canOrganize}
        aria-expanded={open}
        title={canOrganize ? 'Organize in workstreams' : 'Shared notes stay organized by their owner'}
      >
        <TargetIcon className="h-4 w-4" />
        <span className="hidden sm:inline">
          {assigned.length === 0 ? 'Add to workstream' : assigned.map((item) => item.name).join(', ')}
        </span>
        {assigned.length > 0 ? (
          <span className="rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
            {assigned.length}
          </span>
        ) : null}
      </button>

      {open && canOrganize ? (
        <div className="absolute right-0 top-11 z-30 w-64 rounded-xl border border-border-strong bg-surface-raised p-2 shadow-xl">
          <div className="flex items-center justify-between px-2 py-1.5">
            <div>
              <p className="text-xs font-semibold text-text">Workstreams</p>
              <p className="text-[11px] text-text-muted">A note can support more than one.</p>
            </div>
            <button
              type="button"
              className="btn-ghost h-7 w-7 p-0"
              onClick={() => setOpen(false)}
              aria-label="Close workstream picker"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="max-h-56 overflow-y-auto py-1">
            {workstreams.length === 0 ? (
              <p className="px-2 py-3 text-xs text-text-muted">No workstreams yet.</p>
            ) : (
              workstreams.map((workstream) => {
                const checked = assignedIds.has(workstream.id);
                return (
                  <label
                    key={workstream.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-text hover:bg-surface-sunken"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        if (user) void toggleNote(user.id, noteId, workstream.id);
                      }}
                      className="h-4 w-4 rounded border-border-strong accent-brand-600"
                    />
                    <span className="min-w-0 flex-1 truncate">{workstream.name}</span>
                    {workstream.status !== 'active' ? (
                      <span className="text-[10px] uppercase tracking-wide text-text-subtle">
                        {workstream.status}
                      </span>
                    ) : null}
                  </label>
                );
              })
            )}
          </div>

          <button type="button" className="btn-ghost mt-1 w-full justify-start text-xs" onClick={addWorkstream}>
            <PlusIcon className="h-3.5 w-3.5" />
            New workstream
          </button>
        </div>
      ) : null}
    </div>
  );
}
