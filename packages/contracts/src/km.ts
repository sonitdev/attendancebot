/**
 * Khmer-first copy shared by the Admin portal, Telegram Mini App, and API.
 * Keep route names, enum values, and API error codes out of this file: those
 * are programmatic identifiers, not worker-facing copy.
 */
export const km = {
  app: {
    title: 'ប្រព័ន្ធវត្តមានការដ្ឋាន',
    loading: 'កំពុងផ្ទៀងផ្ទាត់សិទ្ធិ…',
  },
  nav: {
    operations: 'ប្រតិបត្តិការថ្ងៃនេះ',
    workers: 'បញ្ជីបុគ្គលិក',
    sites: 'ការដ្ឋាន និងវេនការ',
    assignments: 'ការចាត់តាំងវេនការ',
    management: 'ការគ្រប់គ្រងបុគ្គលិក',
  },
  attendance: {
    open: 'បើកវត្តមាន',
    checkIn: 'ចូលវត្តមាន',
    checkOut: 'ចេញវត្តមាន',
    submit: 'បញ្ជូនវត្តមាន',
    locationRequired: 'សូមអនុញ្ញាតឱ្យប្រើទីតាំង GPS របស់អ្នក។',
    noAssignment: 'ថ្ងៃនេះអ្នកមិនមានការចាត់តាំងការងារទេ។',
    completed: 'បានបញ្ចប់វេនការថ្ងៃនេះ',
  },
  status: {
    NOT_STARTED: 'មិនទាន់ចូលវត្តមាន',
    ON_TIME: 'ទាន់ពេល',
    LATE: 'យឺត',
    COMPLETED: 'បានបញ្ចប់',
    EARLY_CHECKOUT: 'ចេញមុនពេល',
    MISSING_CHECKOUT: 'ខកខានចេញវត្តមាន',
    OUTSIDE_GEOFENCE: 'នៅក្រៅតំបន់ការដ្ឋាន',
    LOW_ACCURACY: 'GPS មិនច្បាស់លាស់',
    PENDING_REVIEW: 'កំពុងរង់ចាំពិនិត្យ',
  },
} as const;
