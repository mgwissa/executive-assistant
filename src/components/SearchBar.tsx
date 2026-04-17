import { useNotesStore } from '../store/useNotesStore';
import { SearchIcon } from './icons';

export function SearchBar() {
  const { query, setQuery } = useNotesStore();
  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search notes…"
        className="input pl-8"
      />
    </div>
  );
}
