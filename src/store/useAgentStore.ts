import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { isUndoRefusal, planUndo, type UndoPlan } from '../lib/agentDesk';
import type {
  AgentAction,
  AgentBrief,
  AgentBriefInsert,
  AgentMemory,
  AgentRun,
  ProfileUpdate,
  TaskInsert,
  TaskUpdate,
} from '../types';
import { useProfileStore } from './useProfileStore';
import { useNotesStore } from './useNotesStore';
import { useTasksStore } from './useTasksStore';

const RUN_LIMIT = 40;
const ACTION_LIMIT = 250;
const BRIEF_LIMIT = 14;
const MEMORY_LIMIT = 200;

type AgentState = {
  runs: AgentRun[];
  actions: AgentAction[];
  briefs: AgentBrief[];
  memory: AgentMemory[];
  loading: boolean;
  error: string | null;
  /** Action id currently being undone, so the row can show a spinner. */
  undoingId: string | null;

  fetchAll: (userId: string) => Promise<void>;
  undoAction: (userId: string, actionId: string) => Promise<boolean>;
  markLogSeen: (userId: string) => Promise<void>;
  savePlaybook: (userId: string, playbook: string) => Promise<void>;
  clear: () => void;
};

/**
 * `before` / `after` hold raw database column names (see `lib/agentDesk.ts`),
 * so they map straight onto a Supabase update. The double assertion is the
 * honest way to say "this came from jsonb and we have verified the shape as
 * far as it can be verified" — the alternative would be `any`, which the
 * repo bans.
 */
function asTaskUpdate(patch: Record<string, unknown>): TaskUpdate {
  return patch as unknown as TaskUpdate;
}

function asTaskInsert(row: Record<string, unknown>): TaskInsert {
  return row as unknown as TaskInsert;
}

function asProfileUpdate(patch: Record<string, unknown>): ProfileUpdate {
  return patch as unknown as ProfileUpdate;
}

function asBriefInsert(row: Record<string, unknown>): AgentBriefInsert {
  return row as unknown as AgentBriefInsert;
}

async function executeUndo(userId: string, plan: UndoPlan): Promise<string | null> {
  switch (plan.op) {
    case 'delete_task': {
      const { error } = await supabase.from('tasks').delete().eq('id', plan.taskId);
      return error?.message ?? null;
    }
    case 'patch_task': {
      const { error } = await supabase
        .from('tasks')
        .update(asTaskUpdate(plan.patch))
        .eq('id', plan.taskId);
      return error?.message ?? null;
    }
    case 'restore_task': {
      const { error } = await supabase.from('tasks').insert(asTaskInsert(plan.row));
      return error?.message ?? null;
    }
    case 'patch_profile': {
      const { error } = await supabase
        .from('profiles')
        .update(asProfileUpdate(plan.patch))
        .eq('user_id', userId);
      return error?.message ?? null;
    }
    case 'delete_memory': {
      const { error } = await supabase
        .from('agent_memory')
        .delete()
        .eq('user_id', userId)
        .eq('key', plan.key);
      return error?.message ?? null;
    }
    case 'restore_memory': {
      const { error } = await supabase
        .from('agent_memory')
        .upsert({ ...plan.row, user_id: userId, key: plan.key } as never, {
          onConflict: 'user_id,key',
        });
      return error?.message ?? null;
    }
    case 'delete_note': {
      const { error } = await supabase.from('notes').delete().eq('id', plan.noteId);
      return error?.message ?? null;
    }
    case 'delete_brief': {
      const { error } = await supabase.from('agent_briefs').delete().eq('id', plan.briefId);
      return error?.message ?? null;
    }
    case 'restore_brief': {
      const { error } = await supabase
        .from('agent_briefs')
        .upsert(asBriefInsert(plan.row), { onConflict: 'user_id,kind,brief_date' });
      return error?.message ?? null;
    }
    default:
      return 'Unsupported undo operation';
  }
}

export const useAgentStore = create<AgentState>((set, get) => ({
  runs: [],
  actions: [],
  briefs: [],
  memory: [],
  loading: false,
  error: null,
  undoingId: null,

  fetchAll: async (userId) => {
    set({ loading: true, error: null });

    const [runsRes, actionsRes, briefsRes, memoryRes] = await Promise.all([
      supabase
        .from('agent_runs')
        .select('*')
        .eq('user_id', userId)
        .order('started_at', { ascending: false })
        .limit(RUN_LIMIT),
      supabase
        .from('agent_actions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(ACTION_LIMIT),
      supabase
        .from('agent_briefs')
        .select('*')
        .eq('user_id', userId)
        .order('brief_date', { ascending: false })
        .limit(BRIEF_LIMIT),
      supabase
        .from('agent_memory')
        .select('*')
        .eq('user_id', userId)
        .order('pinned', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(MEMORY_LIMIT),
    ]);

    const firstError =
      runsRes.error ?? actionsRes.error ?? briefsRes.error ?? memoryRes.error ?? null;

    set({
      runs: runsRes.data ?? [],
      actions: actionsRes.data ?? [],
      briefs: briefsRes.data ?? [],
      memory: memoryRes.data ?? [],
      loading: false,
      error: firstError?.message ?? null,
    });
  },

  undoAction: async (userId, actionId) => {
    const action = get().actions.find((a) => a.id === actionId);
    if (!action) return false;

    const plan = planUndo(action);
    if (isUndoRefusal(plan)) {
      set({ error: plan.reason });
      return false;
    }

    set({ undoingId: actionId, error: null });
    const failure = await executeUndo(userId, plan);

    if (failure) {
      // Record the failure on the row so the log explains itself later.
      await supabase
        .from('agent_actions')
        .update({ undo_error: failure })
        .eq('id', actionId);
      set({
        undoingId: null,
        error: failure,
        actions: get().actions.map((a) =>
          a.id === actionId ? { ...a, undo_error: failure } : a,
        ),
      });
      return false;
    }

    const undoneAt = new Date().toISOString();
    const { error: markErr } = await supabase
      .from('agent_actions')
      .update({ status: 'undone', undone_at: undoneAt, undo_error: null })
      .eq('id', actionId);

    if (markErr) {
      // The data change already reversed; surface it but don't pretend it failed.
      set({ undoingId: null, error: `Undone, but the log could not be updated: ${markErr.message}` });
    } else {
      set({
        undoingId: null,
        actions: get().actions.map((a) =>
          a.id === actionId
            ? { ...a, status: 'undone', undone_at: undoneAt, undo_error: null }
            : a,
        ),
      });
    }

    // Pull the affected stores back in sync with the database.
    await useTasksStore.getState().fetchAll(userId);
    if (plan.op === 'patch_profile') {
      await useProfileStore.getState().fetchProfile(userId);
    }
    if (plan.op === 'delete_note') {
      await useNotesStore.getState().fetchAll(userId);
    }
    if (plan.op === 'delete_brief' || plan.op === 'restore_brief') {
      await get().fetchAll(userId);
    }
    return !markErr;
  },

  markLogSeen: async (userId) => {
    const seenAt = new Date().toISOString();
    const { error } = await supabase
      .from('profiles')
      .update({ agent_log_seen_at: seenAt })
      .eq('user_id', userId);
    if (error) {
      set({ error: error.message });
      return;
    }
    await useProfileStore.getState().fetchProfile(userId);
  },

  savePlaybook: async (userId, playbook) => {
    const value = playbook.trim() === '' ? null : playbook;
    const { error } = await supabase
      .from('profiles')
      .update({ agent_playbook: value })
      .eq('user_id', userId);
    if (error) {
      set({ error: error.message });
      return;
    }
    await useProfileStore.getState().fetchProfile(userId);
  },

  clear: () =>
    set({
      runs: [],
      actions: [],
      briefs: [],
      memory: [],
      loading: false,
      error: null,
      undoingId: null,
    }),
}));
