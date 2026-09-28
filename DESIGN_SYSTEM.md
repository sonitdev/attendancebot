# Design System

## Product character

Professional site-operations software: calm, dense enough for real work, high status clarity, no playful dashboard decoration.

## Worker Mini App

Mobile-first; one dominant action; large 48px+ tap targets; visible loading/progress; plain language. Required states: idle, requesting location, verifying, success, retryable error, permission denied, no network, low accuracy, outside site. Never show success before API confirmation.

## Admin portal

Information-first tables, filters and status badges. Use semantic status colors with icon/text redundancy. Exception pages prioritize unresolved records. Responsive layouts retain critical identifiers, status and primary action.

## Localization

All display text goes through translation keys. English first, Khmer-ready. Dates/times render in official site timezone, not browser timezone.
