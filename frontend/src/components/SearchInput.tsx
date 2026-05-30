// Reusable debounced search input.
//
// Typing feels instant (local state updates on every keystroke), but the
// parent's onChange — which is what fires the API call — only runs after
// debounceMs of inactivity. So typing "rohit pandey" sends ONE request,
// not eleven.
//
// Usage:
//   const [q, setQ] = useState('');
//   <SearchInput value={q} onChange={setQ} placeholder="Search users…" />
//
// Wire that q into the API .list() call's dependency array.

import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** ms of typing-pause before onChange fires. Default 300ms. */
  debounceMs?: number;
  /** Tailwind classes appended to the wrapper. */
  className?: string;
  /** Tailwind classes appended to the input itself. */
  inputClassName?: string;
}

export default function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  debounceMs = 300,
  className,
  inputClassName,
}: Props) {
  // local state so typing feels instant; the API only sees the debounced value.
  const [local, setLocal] = useState(value);
  // Track whether the change originated from this component vs. the parent
  // wiping the field — if the parent resets `value` to '' we want the input
  // to clear too without re-firing onChange.
  const fromParent = useRef(false);

  useEffect(() => {
    fromParent.current = true;
    setLocal(value);
  }, [value]);

  useEffect(() => {
    if (fromParent.current) { fromParent.current = false; return; }
    const t = setTimeout(() => {
      if (local !== value) onChange(local);
    }, debounceMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, debounceMs]);

  return (
    <div className={'relative ' + (className || '')}>
      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        type="search"
        className={'pl-8 pr-8 ' + (inputClassName || '')}
        placeholder={placeholder}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
      />
      {local && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => { setLocal(''); onChange(''); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
