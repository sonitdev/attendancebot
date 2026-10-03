'use client';

import { Building, Clock, Plus } from 'lucide-react';
import type { ProjectListItem } from '@workforce/contracts';

export function ProjectSiteControls({ projects, selectedProjectId, onSelectProject, allProjectsLabel, projectsLabel, addSiteLabel, addScheduleLabel, createProjectLabel, onAddSite, onAddSchedule, onAddProject }: {
  projects: ProjectListItem[];
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  allProjectsLabel: string;
  projectsLabel: string;
  addSiteLabel: string;
  addScheduleLabel: string;
  createProjectLabel: string;
  onAddSite: () => void;
  onAddSchedule: () => void;
  onAddProject: () => void;
}) {
  return <div className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs md:flex-row md:items-center">
    <div className="flex flex-wrap items-center gap-2"><span className="mr-1 text-xs font-bold text-slate-500">{projectsLabel}</span>
      <button type="button" onClick={() => onSelectProject(null)} className={`cursor-pointer rounded-xl px-3 py-1.5 text-xs font-extrabold transition-all ${!selectedProjectId ? 'bg-[var(--portal-primary)] text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{allProjectsLabel} ({projects.length})</button>
      {projects.map((project) => <button key={project.id} type="button" onClick={() => onSelectProject(project.id)} className={`cursor-pointer rounded-xl px-3 py-1.5 text-xs font-extrabold transition-all ${selectedProjectId === project.id ? 'bg-[var(--portal-primary)] text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{project.name}</button>)}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={onAddSite} className="inline-flex cursor-pointer items-center space-x-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-xs transition-all hover:bg-emerald-700"><Plus size={14} /><span>{addSiteLabel}</span></button>
      <button type="button" onClick={onAddSchedule} className="inline-flex cursor-pointer items-center space-x-1.5 rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white shadow-xs transition-all hover:bg-amber-700"><Clock size={14} /><span>{addScheduleLabel}</span></button>
      <button type="button" onClick={onAddProject} className="inline-flex cursor-pointer items-center space-x-1.5 rounded-xl bg-slate-800 px-3 py-2 text-xs font-bold text-white shadow-xs transition-all hover:bg-slate-900"><Building size={14} /><span>{createProjectLabel}</span></button>
    </div>
  </div>;
}
