'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { km } from '@workforce/contracts';

export type Locale = 'km' | 'en';

export interface TranslationDictionary {
  nav: {
    operations: string;
    workers: string;
    sites: string;
    assignments: string;
    telegramReporting: string;
    attendance: string;
    sales: string;
    reports: string;
    security: string;
    settings: string;
    management: string;
  };
  workforce: {
    titleEmployees: string;
    subtitleEmployees: string;
    titleProjectsSites: string;
    subtitleProjectsSites: string;
    titleAssignments: string;
    subtitleAssignments: string;
    addSite: string;
    addSchedule: string;
    createProject: string;
    assignWorker: string;
    addEmployee: string;
    refreshView: string;
    allProjects: string;
    projectsLabel: string;
    sitesSectionTitle: string;
    sitesSectionSubtitle: string;
    schedulesSectionTitle: string;
    schedulesSectionSubtitle: string;
    assignmentsSectionTitle: string;
    assignmentsSectionSubtitle: string;
    noSites: string;
    noSchedules: string;
    noAssignments: string;
    editLocation: string;
    editSchedule: string;
    searchEmployees: string;
    geofenceRadius: string;
    graceMinutes: string;
    time: string;
    timezone: string;
    status: string;
    actions: string;
  };
  actions: {
    cancel: string;
    save: string;
    saving: string;
    saved: string;
    saveFailed: string;
    processing: string;
    retry: string;
    remove: string;
    removed: string;
    details: string;
    close: string;
    confirm: string;
  };
  lang: {
    khmer: string;
    english: string;
    switchLang: string;
  };
}

export const enTranslations: TranslationDictionary = {
  nav: {
    operations: 'Today Operations',
    workers: 'Employees',
    sites: 'Sites & Schedules',
    assignments: 'Shift Assignments',
    telegramReporting: 'Telegram Reporting',
    attendance: 'Attendance',
    sales: 'Sales Team',
    reports: 'Reports',
    security: 'Security',
    settings: 'Settings',
    management: 'Workforce Management',
  },
  workforce: {
    titleEmployees: 'Employee Directory',
    subtitleEmployees: 'Manage employee profiles, codes, job titles, and statuses.',
    titleProjectsSites: 'Projects, Sites & Schedules',
    subtitleProjectsSites: 'Manage projects, physical sites, GPS geofences, and shift schedules.',
    titleAssignments: 'Workforce Assignments',
    subtitleAssignments: 'Assign workers to designated physical sites, work shifts, and active dates.',
    addSite: 'Add Site',
    addSchedule: 'Add Schedule',
    createProject: 'New Project',
    assignWorker: 'Assign Worker',
    addEmployee: 'Register Employee',
    refreshView: 'Refresh View',
    allProjects: 'All Projects',
    projectsLabel: 'Projects:',
    sitesSectionTitle: 'Physical Sites & Geofence Boundaries',
    sitesSectionSubtitle: 'Configure Google Maps coordinates and allowed radius for worker check-ins.',
    schedulesSectionTitle: 'Work Schedules & Flexible Grace Periods',
    schedulesSectionSubtitle: 'Configure shift start/end hours and flexible grace periods (e.g. 10 or 30 minutes).',
    assignmentsSectionTitle: 'Worker Site & Schedule Assignments',
    assignmentsSectionSubtitle: 'Assign employees to designated physical sites, work shifts, and active dates.',
    noSites: 'No sites found in this project yet. Click "Add Site" to create one.',
    noSchedules: 'No schedules configured yet. Click "Add Schedule" to create one.',
    noAssignments: 'No worker assignments yet. Click "Assign Worker" to create one.',
    editLocation: 'Edit Location & Geofence',
    editSchedule: 'Edit Schedule',
    searchEmployees: 'Search employees by name, code, or title...',
    geofenceRadius: 'Geofence Radius',
    graceMinutes: 'Grace Period',
    time: 'Time',
    timezone: 'Timezone',
    status: 'Status',
    actions: 'Actions',
  },
  actions: {
    cancel: 'Cancel',
    save: 'Save',
    saving: 'Saving...',
    saved: 'Saved successfully.',
    saveFailed: 'Failed to save. Please review details and try again.',
    processing: 'Processing...',
    retry: 'Retry',
    remove: 'Remove',
    removed: 'Removed successfully.',
    details: 'View Details',
    close: 'Close',
    confirm: 'Confirm',
  },
  lang: {
    khmer: 'ខ្មែរ',
    english: 'English',
    switchLang: 'Switch Language',
  },
};

export const kmTranslations: TranslationDictionary = {
  nav: {
    operations: km.nav.operations,
    workers: km.nav.workers,
    sites: km.nav.sites,
    assignments: km.nav.assignments,
    telegramReporting: km.nav.telegramReporting,
    attendance: km.nav.attendance,
    sales: km.nav.sales,
    reports: km.nav.reports,
    security: km.nav.security,
    settings: km.nav.settings,
    management: km.nav.management,
  },
  workforce: {
    titleEmployees: 'បញ្ជីបុគ្គលិកទាំងអស់',
    subtitleEmployees: 'គ្រប់គ្រងបញ្ជីព័ត៌មានបុគ្គលិក កូដបុគ្គលិក និងស្ថានភាពការងារ',
    titleProjectsSites: 'គម្រោង ការដ្ឋាន និងវេនការងារ',
    subtitleProjectsSites: 'គ្រប់គ្រងគម្រោង ការដ្ឋាន កូអរដោនេ GPS និងកាលវិភាគវេនការងារ',
    titleAssignments: 'ការចាត់តាំងការងារបុគ្គលិក',
    subtitleAssignments: 'ចាត់តាំងបុគ្គលិកទៅកាន់ការដ្ឋាន វេនការងារ និងកាលបរិច្ឆេទកំណត់',
    addSite: 'បន្ថែមការដ្ឋាន',
    addSchedule: 'បន្ថែមវេនការ',
    createProject: 'បង្កើតគម្រោង',
    assignWorker: 'ចាត់តាំងបុគ្គលិកថ្មី',
    addEmployee: 'ចុះឈ្មោះបុគ្គលិកថ្មី',
    refreshView: 'ផ្ទុកឡើងវិញ',
    allProjects: 'គម្រោងទាំងអស់',
    projectsLabel: 'គម្រោង:',
    sitesSectionTitle: 'ការដ្ឋាន និងទីតាំងកំណត់ GPS',
    sitesSectionSubtitle: 'កំណត់កូអរដោនេលើផែនទី និងចម្ងាយទីតាំងកំណត់ ឱ្យបុគ្គលិក Check In ចូលការដ្ឋាន។',
    schedulesSectionTitle: 'វេនការ និងការអនុគ្រោះម៉ោង',
    schedulesSectionSubtitle: 'កំណត់ម៉ោងចូលធ្វើការ និងចំនួននាទីអនុគ្រោះ (Grace Period) ដូចជា ១០នាទី ឬ ៣០នាទី។',
    assignmentsSectionTitle: 'ការចាត់តាំងការងារបុគ្គលិក',
    assignmentsSectionSubtitle: 'កំណត់ថាបុគ្គលិកណាត្រូវបំពេញការងារនៅការដ្ឋាន និងវេនការមួយណា។',
    noSites: 'មិនទាន់មានការដ្ឋាននៅក្នុងគម្រោងនេះនៅឡើយទេ។ សូមចុច «បន្ថែមការដ្ឋាន» ដើម្បីបង្កើត។',
    noSchedules: 'មិនទាន់មានវេនការនៅឡើយទេ។ សូមចុច «បន្ថែមវេនការ» ដើម្បីកំណត់ម៉ោងធ្វើការ។',
    noAssignments: 'មិនទាន់មានការចាត់តាំងការងារនៅឡើយទេ។ សូមចុច «ចាត់តាំងបុគ្គលិកថ្មី» ដើម្បីចាត់តាំង។',
    editLocation: 'កែសម្រួលទីតាំង & ផែនទី',
    editSchedule: 'កែសម្រួលវេនការ',
    searchEmployees: 'ស្វែងរកបុគ្គលិកតាមឈ្មោះ កូដ ឬតួនាទី...',
    geofenceRadius: 'ទីតាំងកំណត់',
    graceMinutes: 'នាទីអនុគ្រោះ',
    time: 'ពេលវេលា',
    timezone: 'តំបន់ម៉ោង',
    status: 'ស្ថានភាព',
    actions: 'សកម្មភាព',
  },
  actions: {
    cancel: km.actions.cancel,
    save: 'រក្សាទុក',
    saving: km.actions.saving,
    saved: km.actions.saved,
    saveFailed: km.actions.saveFailed,
    processing: km.actions.processing,
    retry: km.actions.retry,
    remove: km.actions.remove,
    removed: km.actions.removed,
    details: km.admin.details,
    close: 'បិទ',
    confirm: 'បញ្ជាក់',
  },
  lang: {
    khmer: 'ខ្មែរ',
    english: 'English',
    switchLang: 'ប្តូរភាសា',
  },
};

interface LocaleContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  t: TranslationDictionary;
  isKm: boolean;
}

const LocaleContext = createContext<LocaleContextType>({
  locale: 'km',
  setLocale: () => {},
  toggleLocale: () => {},
  t: kmTranslations,
  isKm: true,
});

const STORAGE_KEY = 'workforce_portal_locale';

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('km');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
      if (saved === 'en' || saved === 'km') {
        setLocaleState(saved);
        document.documentElement.lang = saved;
        document.documentElement.dataset.locale = saved;
      } else {
        document.documentElement.lang = 'km';
        document.documentElement.dataset.locale = 'km';
      }
    } catch {
      // Ignore localStorage exceptions in private browsing
    }
  }, []);

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem(STORAGE_KEY, newLocale);
      document.documentElement.lang = newLocale;
      document.documentElement.dataset.locale = newLocale;
      window.dispatchEvent(new CustomEvent('workforce_locale_changed', { detail: newLocale }));
    } catch {
      // Ignore
    }
  };

  const toggleLocale = () => {
    setLocale(locale === 'km' ? 'en' : 'km');
  };

  const activeDict = (!mounted || locale === 'km') ? kmTranslations : enTranslations;

  return (
    <LocaleContext.Provider
      value={{
        locale: mounted ? locale : 'km',
        setLocale,
        toggleLocale,
        t: activeDict,
        isKm: !mounted || locale === 'km',
      }}
    >
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
