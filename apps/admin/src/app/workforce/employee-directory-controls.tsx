'use client';

import { Filter, Plus } from 'lucide-react';
import type { PositionListItem } from '@workforce/contracts';

export function EmployeeDirectoryControls({
  searchQuery, onSearchChange, positionFilter, onPositionChange, positions, searchLabel, addLabel, onAdd,
}: {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  positionFilter: string;
  onPositionChange: (value: string) => void;
  positions: PositionListItem[];
  searchLabel: string;
  addLabel: string;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm md:flex-row md:items-center">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        <input type="text" placeholder={searchLabel} value={searchQuery} onChange={(event) => onSearchChange(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs focus:ring-1 focus:ring-sky-500 sm:w-64" />
        <div className="flex items-center space-x-1.5 text-xs text-slate-600">
          <Filter className="h-3.5 w-3.5 text-slate-400" /><span>Position:</span>
          <select value={positionFilter} onChange={(event) => onPositionChange(event.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs">
            <option value="ALL">All Positions</option><option value="UNASSIGNED">Unassigned Only</option>
            {positions.map((position) => <option key={position.id} value={position.id}>{position.name} ({position.code})</option>)}
          </select>
        </div>
      </div>
      <button onClick={onAdd} className="inline-flex shrink-0 cursor-pointer items-center space-x-1.5 rounded-xl bg-[var(--portal-primary)] px-3.5 py-2 text-xs font-bold text-white shadow-2xs transition-all hover:brightness-90 active:scale-95">
        <Plus className="h-3.5 w-3.5 text-[#c4d701]" /><span>{addLabel}</span>
      </button>
    </div>
  );
}
