# Admin dashboard working agreement

This package is the authenticated AkibaMiles/MiniMiles administration console. Changes must preserve authorization, auditability, and existing operational behavior while improving the interface.

## Required skill gate

Before planning, implementing, or reviewing the UI/PWA overhaul, check that the following skills are available in the current session. Read every applicable `SKILL.md` before acting.

| Skill | Required use |
| --- | --- |
| `frontend-design` | Visual direction, typography, layout, and avoidance of generic dashboard styling |
| `ui-ux-pro-max` | Interaction, responsive, accessibility, chart, and design-system decisions |
| `tailwindcss-mobile-first` | Mobile baseline, breakpoints, safe areas, touch targets, and responsive components |
| `vercel-react-best-practices` | React/Next.js data, rendering, and bundle performance |
| `web-design-guidelines` | Final web-interface compliance review |
| `accessibility` | WCAG 2.2 AA review and remediation |
| `critique-affordance` | Rendered-screen action discoverability and state-clarity review |
| `browser:control-in-app-browser` | Real rendered UI inspection at the required viewports |
| `playwright` | Repeatable critical-journey and responsive browser tests |
| `web-quality-audit` | Measured Lighthouse-style performance, accessibility, and best-practice audit |
| `security-best-practices` | Authenticated PWA caching, session, header, and dependency safety review |

If a required skill is absent:

1. Use `find-skills` to identify a reputable source.
2. Prefer an official or established source with meaningful adoption.
3. Use `skill-installer` to install it.
4. Tell the user that a newly installed skill becomes available on the next turn.
5. Do not install an unproven PWA-specific skill merely to satisfy the label; use official Next.js and browser platform documentation when no trustworthy skill exists.

## Source of truth

- Product and UI requirements: `docs/admin-dashboard-pwa-ui-overhaul-spec.md`
- Existing funded-voucher requirements: files in `docs/akiba-funded-voucher-*.md`
- Route retirement rules: `src/middleware.ts`
- Roles and permissions: `src/types/index.ts`

When these conflict, authorization and middleware behavior win until the product specification and code are deliberately reconciled.

## Delivery workflow

1. Start from the mobile layout and progressively enhance at content-driven breakpoints.
2. Keep authorization checks on the server. Hiding navigation is not access control.
3. Never cache authenticated API responses or sensitive HTML in the service worker.
4. Use existing APIs before proposing backend changes.
5. Preserve deep links, browser back behavior, filters, and scroll position.
6. Verify loading, empty, error, offline, disabled, and permission-denied states.
7. Inspect the rendered result at 320, 375, 414, 768, 1024, 1280, and 1440 CSS pixels.
8. Verify keyboard-only use, visible focus, reduced motion, 200% zoom, and screen-reader names.
9. Run unit tests, browser journeys, production build, and web-quality checks before handoff.
10. Do not call a placeholder or blocked legacy surface complete.

