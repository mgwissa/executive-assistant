/** Dev-only UI verification. Sample data, no account and no production writes. */
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { WorkPage } from '../components/WorkPage';
import { useAuthStore } from '../store/useAuthStore';
import { useProfileStore } from '../store/useProfileStore';
import { useTasksStore } from '../store/useTasksStore';
import { useNotesStore } from '../store/useNotesStore';
import { useEventsStore } from '../store/useEventsStore';
import type { Task } from '../types';
import '../index.css';

if (!import.meta.env.DEV) throw new Error('Trash preview is development-only.');
const now = new Date().toISOString();
const sample: Task = { id: 'tmp-active', user_id: 'preview', title: 'Review the lease-path discovery brief',
  description: 'Sample task: compare shopper intent, useful results and data requirements.',
  done: false, deleted_at: null, restored_at: null, priority: 'normal', priority_set_at: now,
  due_date: null, review_date: null, due_time: null, reminder_sent_at: null, linked_event_id: null,
  waiting_on: null, chase_snoozed_until: null, last_chased_at: null, estimated_minutes: null,
  tags: [], reschedule_count: 0, created_at: now, updated_at: now };
const deleted = { ...sample, id: 'tmp-trash', title: 'Prepare the old experiment-admin story',
  description: 'Preserved context\n\nThis sample task was dropped, not completed.\nIts original requirements and reference links remain available for review.', deleted_at: now };
useAuthStore.setState({ user: null, session: null });
useProfileStore.setState({ profile: null });
useNotesStore.setState({ notes: [], loading: false, error: null });
useEventsStore.setState({ events: [], loading: false, error: null });
useTasksStore.setState({ tasks: [sample], trashedTasks: [deleted], loading: false, error: null,
  fetchAll: async () => {}, createTask: async () => null,
  toggleDone: async (id, done) => useTasksStore.setState({ tasks: useTasksStore.getState().tasks.map(t => t.id === id ? {...t,done} : t) }),
  deleteTask: async (id) => {
    const state = useTasksStore.getState();
    const task = state.tasks.find(t => t.id === id);
    if (!task || !window.confirm('Sample only: move this task to Trash?')) return false;
    useTasksStore.setState({ tasks: state.tasks.filter(t => t.id !== id), trashedTasks: [{...task,deleted_at:now},...state.trashedTasks] });
    return true;
  },
  restoreTask: async (id) => {
    const state = useTasksStore.getState();
    const task = state.trashedTasks.find(t => t.id === id);
    if (!task) return false;
    useTasksStore.setState({ tasks: [...state.tasks,{...task,deleted_at:null,restored_at:now}], trashedTasks: state.trashedTasks.filter(t => t.id !== id) });
    return true;
  },
});
createRoot(document.getElementById('root')!).render(<MemoryRouter>
  <p className="bg-surface-sunken px-4 py-2 text-center text-xs text-text-muted">Development preview · sample data only · no production account or writes</p>
  <WorkPage />
</MemoryRouter>);
