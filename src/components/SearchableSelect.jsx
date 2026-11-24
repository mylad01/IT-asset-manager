import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Search } from 'lucide-react';

export default function SearchableSelect({ options, value, onChange, placeholder = "Search and select..." }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const wrapperRef = useRef(null);

  const safeOptions = Array.isArray(options) ? options : [];
  const selectedOption = safeOptions.find(opt => opt.id === value);

  const filteredOptions = safeOptions.filter(opt =>
    opt.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <div
        className="glass-input cursor-pointer flex justify-between items-center"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className={selectedOption ? "tt" : "tt-muted"}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown size={16} className={`tt-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 glass-modal animate-glass-in">
          <div className="p-2 border-b border-white/10 flex items-center gap-2">
            <Search size={14} className="tt-muted" />
            <input
              type="text"
              className="w-full bg-transparent text-sm tt focus:outline-none placeholder:tt-muted"
              placeholder="Type to search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              autoFocus
            />
          </div>

          <ul className="max-h-48 overflow-y-auto">
            {filteredOptions.length === 0 ? (
              <li className="p-3 text-sm tt-muted italic text-center">No matches found.</li>
            ) : (
              filteredOptions.map((option) => (
                <li
                  key={option.id}
                  className="p-2.5 text-sm cursor-pointer hover:bg-white/10 tt-sec hover:tt transition-colors border-b border-white/5 last:border-0"
                  onClick={() => { onChange(option.id); setIsOpen(false); setSearchTerm(''); }}
                >
                  {option.label}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
