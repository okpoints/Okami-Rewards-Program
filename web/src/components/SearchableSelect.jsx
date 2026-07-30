import { useEffect, useRef, useState } from 'react';

export default function SearchableSelect({ options, value, onChange, placeholder }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const sorted = [...options].sort((a, b) => a.label.localeCompare(b.label));
  const filtered = query
    ? sorted.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : sorted;

  return (
    <div className="searchable-select" ref={wrapRef}>
      <input
        type="text"
        placeholder={placeholder || 'Search...'}
        value={open ? query : (selected?.label || '')}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={(e) => setQuery(e.target.value)}
      />
      {open && (
        <div className="searchable-select-panel">
          {filtered.length === 0 && <div className="searchable-select-empty">No matches.</div>}
          {filtered.map((o) => (
            <div
              key={o.value}
              className="searchable-select-option"
              onClick={() => { onChange(o.value); setOpen(false); setQuery(''); }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
