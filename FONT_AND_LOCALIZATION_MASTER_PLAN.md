# Font & English/Khmer Localization Master Plan

Status: Proposed implementation plan
Scope: Telegram Mini App and Admin portal
Primary locales: English (`en`) and Khmer (`km`)
Primary font: Kantumruy Pro

## 1. Executive direction

The reference direction is calm, premium operational software: deep forest green as the authority color, warm white surfaces, quiet lime accents, restrained shadows, and strong information hierarchy. Khmer must feel designed—not inserted into an English layout as an afterthought.

The current Mini App has the right functional foundation but its visual language is inconsistent: system-font rendering changes Khmer metrics, cards compete for attention, error states expose internal codes, and long Khmer strings are not given enough line-height or width. The Admin reference is closer to the target, but its language control, navigation labels, table density, and mixed-language field labels need one shared token and translation system.

## 2. Non-negotiable outcomes

- Every user-visible string uses a translation key; no new hard-coded English or Khmer copy.
- English and Khmer have complete key parity before either locale is released.
- Kantumruy Pro is the default UI font for Khmer and English UI text where it improves consistency; Roboto Flex remains available for dense Latin-only data and numeric readouts if needed.
- Font loading is local, versioned, self-hosted, and has a deliberate fallback stack.
- Language changes update the entire current surface without a page reload where practical.
- Dates, times, numbers, status labels, validation errors, and empty states are localized consistently while authoritative timestamps remain UTC/server-derived.
- Compact mobile layouts, wide admin tables, modals, buttons, and empty/error states are verified in both languages.

## 3. Typography system

### Font assets

Use the project-owned assets from `font_system/Kantumruy_Pro` and `font_system/Roboto_Flex`:

- `KantumruyPro-VariableFont_wght.ttf`
- `KantumruyPro-Italic-VariableFont_wght.ttf`

Copy them into each app’s owned public/static font directory or a shared package asset location. Do not load fonts from Google Fonts at runtime.

### Font roles

| Role | Family | Weight | Use |
|---|---|---:|---|
| UI/display | Kantumruy Pro | 600–800 | Headings, navigation, buttons, status labels |
| UI/body | Kantumruy Pro | 400–600 | Descriptions, forms, alerts, table labels |
| Data/numeric optional | Roboto Flex | 500–700 | Times, counts, IDs when tabular alignment matters |
| Fallback | system sans | normal | Only while the local font is loading or if unavailable |

### Tokens

Create shared tokens for:

- `font.family.ui`, `font.family.data`
- `font.size.display`, `title`, `body`, `label`, `caption`
- `font.lineHeight.khmerBody`, `khmerCompact`, `latinBody`
- `font.letterSpacing.heading`, `body`, `numeric`

Khmer body copy needs more vertical room than the current Mini App: default line-height should be approximately 1.65–1.8 for multi-line Khmer messages, with tighter values reserved for short labels.

## 4. Localization architecture

### Shared translation contract

Move all UI copy into a shared contracts translation structure with identical key paths:

```text
common.*
navigation.*
auth.*
attendance.*
registration.*
projects.*
employees.*
assignments.*
reports.*
errors.*
validation.*
accessibility.*
```

Each locale must satisfy the same TypeScript shape. CI should fail when a key exists in one locale but not the other.

### Locale selection

Priority order:

1. Explicit user preference stored locally and, for Admin users, persisted to the user profile when that capability is approved.
2. Telegram language or browser language when no preference exists.
3. English fallback.

The selected locale must be available to the API error-to-message mapper and not only to React components.

### Message policy

- Internal codes such as `NO_OPEN_ATTENDANCE`, `FORBIDDEN`, and `REGISTRATION_PENDING` remain diagnostic identifiers.
- UI receives a localized, human-readable message mapped from the code.
- Unknown errors use a safe localized fallback and are logged with a correlation ID, never exposed raw.
- Telegram bot messages, Mini App messages, and Admin messages use the same semantic key where the audience and tone match.

## 5. Language selector UX

Use a compact segmented control in the Admin shell and a lightweight preference control in the Mini App settings/help surface:

- Khmer: `ខ្មែរ`
- English: `EN`

The selector must have a visible active state, a 44px minimum touch target, accessible name, and no flag-only meaning. Flags may be decorative, but language names remain visible.

When switching language:

- preserve the current route, tab, filters, and form state;
- update document language and text direction metadata;
- retain server timezone formatting;
- avoid flashing untranslated keys;
- announce the change for screen readers.

## 6. Product surfaces to migrate

### Phase A — foundation

- Shared locale type and key-parity test.
- Kantumruy Pro loading and typography tokens.
- Error-code mapping layer.
- Locale persistence and selector primitive.
- Story/test fixtures for long Khmer labels.

### Phase B — Telegram Mini App

- Loading, authentication, registration-pending, no-assignment, no-attendance, success, GPS permission, outside-geofence, low-accuracy, offline, and camera states.
- Worker profile header, assignment card, attendance status card, action buttons, project picker, sales/visit flow, and report forms.
- Replace internal error codes in every catch path with localized semantic messages.
- Verify 48px action targets and one-hand reach on narrow Android screens.

### Phase C — Admin shell and workforce

- Sidebar, organization header, language selector, breadcrumbs, tabs, page headers, filters, tables, pagination, modals, and toast/alert primitives.
- Workforce, employees, projects/sites, assignments, settings, registration requests, and Telegram reporting.
- Preserve dense data readability while allowing Khmer labels to wrap without clipping.

### Phase D — attendance and reporting

- Attendance dashboard, exceptions, corrections, exports, operational reports, sales reports, and security/audit screens.
- Localized date/time/number formatting with site timezone.
- Status labels and badges with icon + text, never color alone.

### Phase E — Telegram copy and operational messages

- `/start`, registration, owner pairing, project connection, attendance prompts, approval notifications, reminders, failures, and daily reports.
- Keep approval controls private-owner-only and keep group messages informational only.

## 7. Component and code standards

- Build one `LocaleProvider`/locale hook per frontend surface, backed by the shared translation contract.
- Build reusable `LocalizedError`, `LanguageToggle`, `StatusBadge`, `EmptyState`, `LoadingState`, and `PageHeader` components.
- Do not duplicate the same label or error string in page files.
- Prefer semantic variants (`success`, `warning`, `danger`, `neutral`) over ad-hoc color classes.
- Keep business rules and API contracts unchanged during presentation/localization work.
- Do not translate employee names, project names, site names, IDs, or server-provided organization data unless explicitly required.

## 8. QA and acceptance gates

### Automated

- Translation key parity and no missing-key tests.
- Typecheck for contracts, API, Admin, and Mini App.
- Unit tests for error-code mapping in both locales.
- Snapshot or component tests for long Khmer labels and mixed English/Khmer strings.
- `git diff --check` and production builds.

### Visual/manual

- Android Telegram Web App at 360px, 390px, and 412px widths.
- Admin at 1280px desktop and 768px tablet widths.
- Verify font loading without layout collapse.
- Verify Khmer diacritics, wrapping, truncation, button height, table alignment, modal scrolling, and error readability.
- Verify language switching on every major route and after refresh.

### Release gate

Do not release a locale until:

1. key parity passes;
2. no raw internal error codes appear in UI screenshots;
3. both locale builds pass;
4. all critical attendance actions work in both locales;
5. visual review confirms no clipping or inaccessible controls.

## 9. Rollout strategy

1. Ship typography and translation infrastructure behind no behavior change.
2. Migrate Mini App states and error messages first because workers need the clearest feedback.
3. Migrate Admin shell and one vertical slice (Workforce) before the remaining pages.
4. Review English and Khmer screenshots at each phase.
5. Expand to reports, Telegram copy, and secondary surfaces.
6. Remove legacy hard-coded strings only after key-parity and runtime coverage are confirmed.

## 10. First implementation sprint

- Add the shared locale contract and English/Khmer dictionaries.
- Add a key-parity test.
- Move `km` into the shared locale model without breaking current imports.
- Add English equivalents for current Mini App and Telegram keys.
- Centralize API error-code presentation.
- Apply Kantumruy Pro to Admin and Mini App roots.
- Add the language toggle to the Mini App and Admin shell.
- Migrate the Mini App authentication, registration, attendance, and error states.
- Run typecheck, tests, builds, and two-language visual review.

## Definition of done

The system is complete when a worker or administrator can switch between English and Khmer, use every critical attendance flow without raw codes or clipped text, see consistent Kantumruy Pro typography across surfaces, and pass the automated and visual gates above without changing authoritative attendance, security, or tenant-scope behavior.
