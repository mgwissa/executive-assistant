import { useEffect } from 'react';
import { Auth } from './components/Auth';
import { Dashboard } from './components/Dashboard';
import { Editor } from './components/Editor';
import { NavRail } from './components/NavRail';
import { Profile } from './components/Profile';
import { Sidebar } from './components/Sidebar';
import { Tasks } from './components/Tasks';
import { useAuthStore } from './store/useAuthStore';
import { useNotesStore } from './store/useNotesStore';
import { useProfileStore } from './store/useProfileStore';
import { useTasksStore } from './store/useTasksStore';
import { useViewStore } from './store/useViewStore';

function NotesView() {
  return (
    <div className="flex h-full min-w-0 flex-1">
      <Sidebar />
      <main className="min-w-0 flex-1 bg-white dark:bg-slate-900">
        <Editor />
      </main>
    </div>
  );
}

function Shell() {
  const user = useAuthStore((s) => s.user);
  const fetchAll = useNotesStore((s) => s.fetchAll);
  const clearNotes = useNotesStore((s) => s.clear);
  const fetchProfile = useProfileStore((s) => s.fetchProfile);
  const clearProfile = useProfileStore((s) => s.clear);
  const fetchTasks = useTasksStore((s) => s.fetchAll);
  const clearTasks = useTasksStore((s) => s.clear);
  const view = useViewStore((s) => s.view);

  useEffect(() => {
    if (user) {
      fetchAll(user.id);
      fetchProfile(user.id);
      fetchTasks(user.id);
    } else {
      clearNotes();
      clearProfile();
      clearTasks();
    }
  }, [
    user,
    fetchAll,
    clearNotes,
    fetchProfile,
    clearProfile,
    fetchTasks,
    clearTasks,
  ]);

  return (
    <div className="flex h-full">
      <NavRail />
      <div className="flex min-w-0 flex-1">
        {view === 'dashboard' && <Dashboard />}
        {view === 'tasks' && <Tasks />}
        {view === 'notes' && <NotesView />}
        {view === 'profile' && <Profile />}
      </div>
    </div>
  );
}

export default function App() {
  const { session, loading, init } = useAuthStore();

  useEffect(() => {
    init();
  }, [init]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        Loading…
      </div>
    );
  }

  return session ? <Shell /> : <Auth />;
}
