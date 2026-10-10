# AkibaMiles Admin UI and PWA Overhaul Specification

Status: Draft for product review  
Scope: `packages/admin-dashboard`  
Target: Mobile-first authenticated web application and installable PWA  
Implementation stack: Next.js 14 App Router, React 18, Tailwind CSS 3, Radix UI, TanStack Query, Vitest

## 1. Purpose

Rebuild the admin console into a fast, accessible, mobile-first operational tool without changing the meaning of existing workflows.

The result must:

- make daily operational work usable from a 320–430px phone;
- keep dense analytical and bulk workflows efficient on desktop;
- expose urgent work before passive reporting;
- consolidate fragmented queues without removing their specialist detail pages;
- remove retired commerce operations from navigation;
- be installable as a PWA without storing sensitive admin data offline;
- respect the existing role and permission model;
- provide repeatable browser, accessibility, and performance verification.

This is not a cosmetic reskin. It is a navigation, responsive-layout, workflow, state-management, and PWA hardening project.

## 2. Reference direction

The supplied desktop reference contributes:

- a quiet, high-contrast analytical canvas;
- a compact primary rail plus contextual navigation;
- one dominant metric or task per region;
- an optional right rail for items needing attention;
- charts and lists with little decorative chrome.

The supplied mobile reference contributes:

- a compact title bar;
- two-column summary metrics;
- one chart at a time;
- stacked operational rows;
- persistent bottom navigation.

Do not copy:

- generic finance content;
- equal-weight cards for information with unequal importance;
- a five-tab structure that attempts to expose every admin module;
- low-contrast pastel chart series;
- decorative gradients or glass effects;
- desktop tables squeezed into horizontal phone scrolling.

The chosen direction is **calm operational precision**: Swiss/minimal structure, Akiba teal as the recognizable action color, restrained motion, and high information density that remains touch-safe.

## 3. Users and roles

The existing roles remain authoritative:

| Role | Primary needs |
| --- | --- |
| Super Admin | Full visibility, policy, pricing, admin management, overrides, audit |
| Ops Admin | Merchant, discovery, incident, referral, notification, and voucher operations |
| Finance Admin | Subscription evidence, collections, fund approvals, financial audit |
| Insights Admin | Polls, verified insights, pass analytics, exports, communications |
| Read-only | Safe inspection without write affordances |

Navigation is permission-aware, but route and API authorization must remain server-enforced. A hidden link is never treated as security.

## 4. Product principles

1. **Action before reporting.** Pending decisions, incidents, and high-frequency operational actions appear before passive metrics.
2. **One obvious next action.** Each card or detail header has at most one primary action.
3. **Progressive disclosure.** Lists expose decision-making facts; full history lives in detail views.
4. **Stable navigation.** Mobile destinations keep one canonical order. Unauthorized destinations are omitted rather than replaced by a different module.
5. **Context survives navigation.** Back restores query, filters, sort, pagination, and scroll position.
6. **No silent states.** Loading, empty, error, offline, stale, permission-denied, and success states are explicit.
7. **Safety is visible.** Destructive, financial, publish, and override actions disclose impact and confirmation requirements.
8. **Offline is honest.** The application shell may load offline; live administrative data and write actions may not pretend to be available.

## 5. Information architecture

### 5.1 Desktop primary modules

The desktop shell uses a 72px primary rail. Selecting a module reveals a 240–264px contextual navigation panel when that module has children.

1. Home
2. Work
3. Rewards
4. Finance
5. Merchants
6. Insights
7. Communications
8. System

Members and Leads live under contextual modules rather than occupying the primary rail.

### 5.2 Mobile primary navigation

Use a fixed bottom bar with up to five labelled destinations in this canonical order:

1. Home
2. Queue
3. Rewards
4. Finance
5. More

`More` opens a full-height sheet containing permitted secondary destinations: Merchants, Insights, Members, Leads, Communications, Games, Audit, Team, and Settings.

Merchants moves to `More` on mobile because merchant review work is already surfaced through Home and Queue, while Finance contains frequent, time-sensitive payment and reimbursement decisions that benefit from persistent access. Merchants remains a desktop primary module.

Home, Queue, and More are always present. Rewards is present when the role can read voucher or funded-voucher operations. Finance is present only with `finance.read`. Removing an unauthorized destination never causes another module to take over its semantic slot or reorder the remaining destinations.

The bottom bar:

- is fixed only below the desktop-navigation breakpoint;
- includes icon and text for every item;
- marks the current item using shape, label weight, and color;
- reserves `env(safe-area-inset-bottom)`;
- never covers page content;
- may show a queue-count badge, not decorative notification dots.

### 5.3 Global search

Replace the current static “Search admin data” surface with a real command search.

Initial searchable entities:

- merchants by name or ID;
- members by username, phone, email where available, or legacy wallet identifier;
- referral code, user, email, and ledger reference;
- subscription payment or invoice ID;
- voucher, fund, allocation, and program ID.

Desktop shortcut: `/` or `Cmd/Ctrl+K`.  
Mobile entry: search icon in the page header.  
Results must be grouped by entity type and keyboard-operable.

## 6. Route disposition

Legend:

- **Primary**: direct desktop or mobile top-level destination.
- **Contextual**: reachable within a module, queue, detail view, or `More`.
- **Merge**: capability stays, standalone navigation is removed.
- **Hide**: shipped route is not shown because it is retired or nonfunctional.
- **Rebuild**: current route is not reused for the named future capability.

| Route | Capability | Disposition | Target location |
| --- | --- | --- | --- |
| `/overview` | System summary | Primary | Home |
| `/ops-queue` | Operational incidents | Primary | Queue |
| `/merchants` | Merchant directory | Primary desktop; contextual mobile | Desktop Merchants; mobile More → Merchants |
| `/merchants/[id]` | Merchant detail and controls | Contextual | Merchants detail |
| `/directory-reviews` | Merchant profile-review queue | Merge | Queue filter |
| `/directory-reviews/[id]` | Public-profile review and decision | Contextual | Queue detail |
| `/discovery-items` | Product candidate moderation | Merge | Queue filter |
| `/discovery-photos` | Photo moderation | Merge | Queue filter |
| `/verified-discovery-health` | Projection and queue health | Contextual | System monitoring |
| `/leads` | Partner and merchant leads | Contextual | More → Leads |
| `/vouchers` | Voucher inventory and health | Primary | Rewards |
| `/vouchers/programs` | Program inventory and state | Contextual | Rewards → Programs |
| `/vouchers/funds` | Fund inventory and lifecycle | Contextual | Rewards → Funds |
| `/vouchers/funds/new` | Create fund | Contextual | Funds flow |
| `/vouchers/funds/[fundId]` | Fund detail | Contextual | Funds detail |
| `/vouchers/funds/[fundId]/edit` | Edit fund | Contextual | Funds detail action |
| Fund allocation routes | Allocation create/detail/edit | Contextual | Fund detail |
| `/vouchers/allocations` | Allocation inventory | Contextual | Rewards → Allocations |
| `/vouchers/pricing` | Versioned Mile pricing | Contextual | Rewards → Pricing |
| `/vouchers/weekly-challenge` | Sponsored top-three prizes | Hide | Irrelevant to the redesigned Rewards workflow |
| `/vouchers/grants` | Direct reimbursable voucher issuance | Rebuild, high priority | Rewards → Issue voucher; Home quick action |
| `/finance/subscriptions` | Subscription payment queue | Primary mobile and desktop module | Finance |
| `/finance/subscriptions/[id]` | Evidence and decision | Contextual | Finance detail |
| `/finance/subscriptions/collections` | Renewal and overage collection | Contextual | Finance → Collections |
| `/finance/voucher-reimbursements` | Funded-voucher payables, batches, payment evidence, and reconciliation | New, high priority | Finance → Voucher reimbursements |
| `/finance` | Retired merchant-commerce finance | Hide | None |
| `/finance/settlements` | Retired liability settlement UI | Hide/Rebuild | Future funded-voucher reimbursement route must be new |
| `/referrals` | Referral funnel and controls | Contextual | Rewards → Referrals |
| `/referrals/queue` | Referral reward review | Merge | Queue filter and Referrals subsection |
| `/referrals/lookup` | Referral search tool | Merge | Global search and Referrals action |
| `/referrals/program` | Versioned program settings | Contextual | Rewards → Referrals → Program |
| `/users` | Member directory | Contextual | More → Members |
| `/push-notifications` | Push campaign workspace | Contextual | More → Communications |
| `/push-preview` | Campaign preview | Merge | Composer preview mode; preserve public behavior only if still required |
| `/games/skill-games` | Skill-game operations and insight | Contextual | Insights → Games |
| `/games/dice` | Unwired placeholder | Hide | Restore only after a canonical source ships |
| `/games/raffles` | Unwired placeholder | Hide | Restore only after a canonical source ships |
| `/audit-log` | Administrative audit | Contextual | System → Audit |
| `/team` | Admin accounts and roles | Contextual | System → Team |
| `/settings` | Policy, account, security, recipients | Contextual | System → Settings |
| `/orders` | Retired shopper commerce | Hide | None |
| `/fulfillment` | Retired shopper commerce | Hide | None |
| `/refunds` | Retired shopper commerce | Hide | None |
| `/settlement` | Retired shopper commerce | Hide | None |
| `/reconciliation` | Mixed legacy reconciliation | Hide, then salvage | Move valid referral anomalies into Queue before deletion |

### 6.1 Legacy decision rule

A surface is legacy when one or more are true:

- middleware currently blocks it;
- its API returns or should return `410 Gone`;
- it depends on shopper-payment or merchant-payout operations Akiba no longer runs;
- it contains only placeholder instructions and has no canonical data source;
- it duplicates a capability now owned by a funded-voucher workflow.

Historical tables and migrations are not deleted as part of this UI project.

## 7. Application shell

### 7.1 Phone: 320–767px

```text
┌─────────────────────────────┐
│ Page title    Search  Account│
├─────────────────────────────┤
│ Context / filters            │
│ Main content                 │
│                              │
│ Safe bottom content padding  │
├─────────────────────────────┤
│ Home Queue Rewards Finance More │
└─────────────────────────────┘
```

- No desktop sidebar exists in layout flow.
- Page gutter: 16px; 12px may be used at 320px only where necessary.
- Header is sticky and 56–64px tall plus top safe area.
- The main container uses `min-height: 100dvh`.
- Lists use page scrolling; avoid nested scrolling.
- Primary detail actions may use a safe-area-aware sticky bottom action bar.

### 7.2 Tablet: 768–1023px

- Use a compact navigation rail or top-level drawer, selected by content fit.
- Two-column cards may appear when each retains at least 280px usable width.
- Detail pages may use a 40/60 master-detail layout in landscape.
- Bottom navigation may remain if the rail would make the content narrower than its minimum.

### 7.3 Desktop: 1024px and above

```text
┌──────┬───────────────┬────────────────────────┬────────────────┐
│ 72px │ 240–264px     │ Flexible main canvas   │ 300–336px      │
│ rail │ context nav   │ max content 1440px     │ attention rail │
└──────┴───────────────┴────────────────────────┴────────────────┘
```

- Context nav collapses to the icon rail when the main task needs width.
- Attention rail is optional and used only when it helps make a decision.
- Tables remain available on desktop but must share a card/list data model with mobile.
- At 1440px+, increase whitespace between regions rather than inflating controls.

## 8. Visual system

The automated design-system search supported minimal/Swiss structure and dense dashboard spacing. Its blue/orange “booking” palette and funnel layout are rejected as product-inappropriate. Akiba’s existing brand teal remains the anchor.

### 8.1 Color tokens

Final values must pass contrast testing before implementation. Starting tokens:

| Token | Value | Use |
| --- | --- | --- |
| `canvas` | `#F6F8FA` | App background |
| `surface` | `#FFFFFF` | Main surfaces |
| `surface-subtle` | `#F1F5F4` | Selected/quiet regions |
| `ink` | `#0F172A` | Primary text |
| `ink-muted` | `#475569` | Secondary text |
| `border` | `#D7E0E3` | Dividers and control boundaries |
| `primary` | `#0F766E` | Primary actions and current location |
| `primary-strong` | `#115E59` | Hover/pressed and white-text pairing |
| `info` | `#0369A1` | Informational state |
| `warning` | `#B45309` | Needs attention |
| `danger` | `#B91C1C` | Destructive/error |
| `success` | `#15803D` | Confirmed/healthy |

Never communicate state using color alone. Every status includes text and, where helpful, an icon.

### 8.2 Typography

- Keep Inter for the first release to avoid a global font migration during navigation work.
- Body text is at least 16px on mobile.
- Data-dense desktop cells may use 14px with sufficient line height.
- Use tabular numerals for amounts, counts, dates, and identifiers.
- Type scale: 12, 14, 16, 18, 24, 32px.
- Do not use uppercase tracked labels as a universal hierarchy device.

### 8.3 Shape and elevation

- Radius scale: 6px controls, 10px cards, 14px sheets/dialogs.
- Borders carry most grouping; shadows are reserved for floating layers.
- Cards are not all identical. Urgent work, metrics, charts, and records have distinct internal structure.
- Use Lucide consistently at 16, 20, and 24px with one stroke-weight policy.

### 8.4 Motion

- Motion is functional and restrained.
- Press/selection feedback: 80–150ms.
- Sheet/dialog transitions: 180–240ms.
- Exit is shorter than entry.
- Animate transform and opacity only where possible.
- Respect `prefers-reduced-motion` and render final states immediately.
- No staggered dashboard-card entrance animations.

## 9. Core components

Build these primitives before page migration:

1. `AppShell`
2. `PrimaryRail`
3. `ContextNav`
4. `MobileBottomNav`
5. `MobileMoreSheet`
6. `PageHeader`
7. `CommandSearch`
8. `FilterBar` and scroll-safe `FilterChips`
9. `MetricCard`
10. `AttentionCard`
11. `RecordCard`
12. `DataTable` with shared column definitions
13. `ResponsiveRecordView` switching cards/tables by container width
14. `StatusBadge`
15. `EmptyState`, `ErrorState`, `OfflineState`, and `Skeleton`
16. `DetailHeader`
17. `StickyActionBar`
18. `ConfirmActionDialog`
19. `Timeline`
20. `AccessibleChart` with textual summary and table fallback
21. `InstallPrompt`
22. `UpdateAvailableToast`
23. `ConnectionStatus`

Components respond to their container where practical; page-level shell decisions use viewport breakpoints.

## 10. Screen specifications

### 10.1 Home

Home is an action launchpad, not an analytics dashboard.

Order on mobile:

1. Key action items
2. `Allocate voucher fund` and `Issue voucher` quick actions
3. New merchants
4. Collapsed administrative activity

```text
┌─────────────────────────────┐
│ Key action items          6 │
│ 2 payments need review      │
│ 1 fund awaits approval      │
│ 3 merchant profiles pending │
├─────────────────────────────┤
│ Allocate fund │ Issue voucher│
├─────────────────────────────┤
│ New merchants               │
│ Merchant name · status · age│
│ Merchant name · status · age│
├─────────────────────────────┤
│ Admin activity          Show│
└─────────────────────────────┘
```

#### Key action items

This section aggregates permitted actions rather than passive statistics:

- subscription payments awaiting review;
- collection follow-ups;
- funds or allocations awaiting approval/publication;
- reimbursement batches awaiting submission or payment;
- merchant profiles awaiting review;
- operational incidents requiring action;
- failed or blocked direct voucher issuance attempts when actionable.

Each item shows a count, oldest-item age, severity, and a deep link to the relevant filtered queue. Items with a count of zero are omitted unless the zero state is operationally meaningful.

#### Quick actions

`Allocate voucher fund` is visible with `voucher_funds.write` when funded vouchers are enabled. It first asks the operator to select an eligible fund, then opens `/vouchers/funds/[fundId]/allocations/new`.

`Issue voucher` opens `/vouchers/grants` and is visible only with `voucher_funds.grant`. The button label stays “Issue voucher” throughout the flow; “grant” remains an internal permission and API term.

#### New merchants

For roles with `merchants.read`, show the five most recently onboarded merchants with name, created date, subscription state, profile-review state, and a direct link to merchant detail. The section ends with `View all merchants` inside `More → Merchants` on mobile.

#### Admin activity

Administrative activity is collapsed by default and placed after operational content for roles with `audit.read`. Expanding it loads the recent entries on demand. It is never shown as a primary metric or attention card.

The Miles trend is removed from Home. It may remain available inside a relevant analytical report if a concrete operational use is later defined.

Desktop uses the same priority order: key action items occupy the dominant central region, quick actions remain immediately visible, new merchants occupy the supporting rail, and administrative activity stays collapsed below the main work.

### 10.2 Unified Queue

Queue types:

- operational incident;
- merchant profile review;
- discovery item;
- discovery photo;
- referral reward review;
- subscription payment review;
- flagged skill-game session.

Required controls:

- search;
- status, type, assignee, urgency, and age filters;
- `All`, `Mine`, `Urgent`, `Waiting`, and `Resolved` saved views;
- sort by urgency then age by default;
- role-aware action buttons;
- count and oldest-item age per category.

The first implementation may aggregate links/counts from existing sources instead of creating a new cross-domain mutation API. It must not fabricate assignment or resolution state that existing APIs do not support.

### 10.3 Merchant directory

List priority:

1. Name and active state
2. Subscription state
3. Profile-review state
4. Voucher-template count
5. Team size
6. Last relevant activity

Mobile cards expose one primary action: `Open merchant`. Secondary actions move to overflow.

Merchant detail tabs:

- Overview
- Public profile
- Vouchers
- Team
- Notes
- History, when available

Trial and publishing actions show actor, consequence, and resulting state before confirmation.

### 10.4 Rewards

Landing sections:

- reimbursable voucher controls;
- active funds and budget utilization;
- allocations requiring action;
- direct voucher issuance;
- issued, redeemed, expired, and revoked reimbursable vouchers;
- current Mile pricing;
- referral funnel and pending rewards.

Funds and allocations preserve their existing maker-checker boundaries. Publish, approve, pause, resume, end, reschedule, budget adjustment, and revoke actions must have distinct confirmation copy.

Weekly Challenge is absent from redesigned navigation and is not part of the overhaul delivery plan.

#### 10.4.1 Issue voucher

`/vouchers/grants` is rebuilt as the operator-facing `Issue voucher` page for direct reimbursable voucher issuance.

Flow:

1. Search for a canonical member by username, phone, email, wallet address, or member ID.
2. Show masked identity and require an explicit selection.
3. Select an active allocation that allows `internal_grant`.
4. Request the Platform eligibility preview.
5. Show satisfied requirements, safe ineligibility reasons, availability, expiry, merchant, and maximum reimbursement commitment.
6. Require an operator reason and explicit confirmation.
7. Submit with an idempotency key.
8. Show the issued voucher ID, recipient, merchant, expiry, reimbursement value, and audit reference.

Issuance requires `voucher_funds.grant`, is rechecked server-side, and provides no eligibility bypass in the first release. Refreshing or retrying the same confirmed request must return the original result rather than issuing twice.

#### 10.4.2 Reimbursable voucher controls

Rewards owns the voucher lifecycle rather than the movement of reimbursement money. It provides:

- fund and allocation state controls;
- budget, quantity, reserved exposure, and remaining availability;
- an issued-voucher register filtered by fund, allocation, merchant, recipient, and state;
- direct issuance;
- pause/resume/end distribution controls;
- individual revocation with reason and impact disclosure;
- eligibility and issuance-failure visibility;
- links from a redeemed voucher to its Finance reimbursement status.

Rewards does not mark merchants paid. Payables, batches, payment evidence, and reconciliation remain in Finance.

### 10.5 Finance

Finance is a persistent mobile and desktop destination. Its landing view prioritizes actionable balances and queues, not decorative charts.

Finance subsections:

- Subscription payments
- Collections
- Voucher reimbursements

Payment detail displays:

- merchant and invoice identity;
- amount, currency, and method;
- submitted evidence with secure expiring access;
- reviewer and review age;
- decision history;
- confirm, reject, take-over, and override actions according to role.

`/finance/voucher-reimbursements` uses the existing planned `/api/admin/voucher-reimbursements` contract and is independent of the legacy settlement console. It shows merchant payables, reimbursement batches, payment evidence, maker-checker requirements, payment state, and reconciliation incidents. It must not reactivate `/finance/settlements` or `/api/admin/settlements`.

### 10.6 Insights

Subsections:

- Pass
- Polls
- Verified reports
- Skill games

Charts show no more than two primary series on phone. Exact values are available by tap and keyboard. Each chart includes a one-sentence summary and accessible tabular data or export.

Poll detail tabs:

- Summary
- Questions
- Responses
- Verified insight
- Notes

### 10.7 Members

List shows username/identity, phone where authorized, risk state, and join date. The legacy wallet identifier is available in search and detail but is not a primary mobile column.

### 10.8 Communications

Push campaign flow:

1. Audience
2. Message
3. Preview
4. Review
5. Send

Show estimated audience before send. Preserve a draft if the sheet/page is accidentally dismissed. Delivery history includes sent, delivered/accepted where measurable, failed, and unknown without presenting estimates as facts.

### 10.9 System

- Audit log supports admin, action, target, and date filters.
- Team management is visible to permitted roles; creation stays Super Admin-only.
- Settings separates Organization, Notifications, Security, Profile, Password, and Session.
- Required password-change mode removes unrelated navigation until the password is changed.

### 10.10 Authentication

- Support password managers, paste, and appropriate autocomplete attributes.
- Preserve the requested deep link through login.
- Show precise authentication errors without exposing account existence.
- PWA standalone mode returns to the intended route after authentication.
- Session expiry gives a clear re-authentication path and never leaves a write action looking successful.

## 11. PWA requirements

### 11.1 Installability

Add:

- App Router manifest metadata;
- icons at 192×192 and 512×512;
- maskable 512×512 icon with safe-zone review;
- Apple touch icon;
- `theme-color` and background color;
- standalone display mode;
- app name and short name normalized to one approved brand;
- HTTPS production verification;
- a service worker registered only in supported production-like contexts.

Do not block use behind an install prompt. Show installation education only after the admin has completed a successful session and the browser reports install eligibility.

### 11.2 Service-worker policy

The admin contains sensitive data. Cache policy is intentionally conservative:

| Resource | Strategy |
| --- | --- |
| Versioned JS/CSS/fonts/icons | Cache-first with revisioned names |
| Public login shell assets | Stale-while-revalidate where safe |
| Authenticated HTML/RSC payloads | Network-only; no persistent service-worker cache |
| `/api/**` responses | Network-only; never store in Cache Storage |
| Evidence, receipts, previews, signed URLs | Network-only; never cache |
| Mutation requests | Network-only; no background replay |
| Offline navigation | Dedicated non-sensitive offline document |

Do not implement offline queues for approvals, financial decisions, profile publication, voucher revocation, pricing, or notifications.

### 11.3 Offline and connection states

- When offline, show the app shell and a dedicated message: live data and actions require a connection.
- Disable write actions with an explanation.
- Do not show previously viewed sensitive records from service-worker storage.
- Reconnect automatically triggers a safe refetch of the visible query.
- Never auto-replay a mutation after reconnect.

### 11.4 Updates

- Detect a waiting service worker.
- Show `Update available` with a deliberate `Reload` action.
- Do not reload while a form is dirty or mutation is pending.
- After activation, display the new version and preserve the intended route where safe.

### 11.5 Notifications

Existing web-push administration does not imply this admin PWA should subscribe its administrators. Admin-device notifications are out of scope until notification types, permissions, privacy, and revocation are separately specified.

## 12. Accessibility requirements

Target WCAG 2.2 AA.

- Normal text contrast at least 4.5:1; large text and meaningful non-text UI at least 3:1.
- Visible focus for every interactive control.
- Keyboard parity for all pointer actions.
- Skip link to main content on the navigation-heavy shell.
- Logical headings with one page `h1`.
- Route changes move focus to the main heading without breaking browser history.
- Web pointer targets meet WCAG minimums; product target is 44×44px for mobile controls with at least 8px separation.
- Sticky headers, bottom navigation, and action bars never obscure focused elements.
- Modals trap focus, close with Escape, and restore focus to the trigger.
- Errors appear inline and in a focusable summary for multi-field submissions.
- Status never relies on color alone.
- Charts have summaries and data alternatives.
- Tables use real headers, captions where useful, and `aria-sort` for sortable columns.
- Toasts use polite live regions and do not steal focus.
- Zoom to 200% does not cause loss of content or function.
- Reduced-motion mode removes nonessential movement.

Automated checks do not replace keyboard and screen-reader verification.

## 13. Data, state, and error behavior

### 13.1 Loading

- Use skeletons that reserve final layout dimensions.
- Show immediate pressed/loading feedback for mutations.
- Disable repeated submission while a mutation is pending.

### 13.2 Empty

State what is empty and whether that is healthy. Examples:

- `No payments need review.`
- `No merchants match these filters. Clear filters.`
- `No verified report has been published for this poll.`

### 13.3 Errors

Every error states:

1. what failed;
2. whether data may be stale;
3. what the user can do next.

Never replace server authorization or validation messages with a generic success or failure toast.

### 13.4 Staleness and concurrency

- Display last-refreshed time where decisions are time-sensitive.
- Refetch before consequential actions if the record may have changed.
- Surface `409` or equivalent conflicts with the latest state and recovery path.
- Do not silently overwrite another admin’s decision.

## 14. Security and privacy constraints

- Keep session cookies secure, HTTP-only, same-site, and appropriately scoped.
- Preserve CSRF protections for state-changing requests.
- Keep role checks on APIs and server-rendered route entry.
- Redact sensitive evidence and personal data from client logs, analytics, service-worker logs, and error reports.
- Do not prefetch signed evidence or receipt URLs into persistent caches.
- Review Content Security Policy and service-worker scope before launch.
- Disable `ADMIN_OPEN_ACCESS` in production and test that production cannot infer an open-access default.
- Record administrative mutations in the audit log with actor and target.
- PWA installation on a shared device must not create a bypass around login or password-change enforcement.

## 15. Performance requirements

Targets on representative mobile hardware and a production build:

- no horizontal overflow at supported widths;
- CLS below 0.1;
- responsive input feedback under 100ms for local interactions;
- route-level loading feedback for waits over approximately 1 second;
- virtualize or paginate lists beyond 50 rendered complex rows;
- lazy-load heavy chart and preview modules;
- reserve image and chart dimensions;
- avoid shipping desktop-only table code on a mobile route when a split is practical;
- meet agreed Core Web Vitals thresholds before launch, measured rather than inferred.

## 16. Testing and verification

### 16.1 Unit and integration

- Preserve existing Vitest coverage.
- Add tests for navigation construction by role and feature flag.
- Add tests for route disposition so blocked legacy links cannot re-enter navigation.
- Test PWA metadata generation and cache-rule helpers.
- Test mutation states and conflict handling.

### 16.2 Browser journeys

Add Playwright coverage for:

1. login and return-to route;
2. forced password change;
3. mobile bottom navigation and `More` sheet;
4. global search keyboard and touch operation;
5. merchant list → detail → back with filter preservation;
6. profile review decision flow;
7. subscription payment start-review and decision flow;
8. referral review flow;
9. voucher fund/allocation role boundaries;
10. read-only role without mutation affordances;
11. offline shell and disabled writes;
12. service-worker update while a form is dirty;
13. installability metadata;
14. keyboard-only critical journeys.

Run visual/responsive checks at 320, 375, 414, 768, 1024, 1280, and 1440 CSS pixels plus phone landscape.

### 16.3 Quality gates

Before release:

- production build passes;
- unit/integration suite passes;
- critical Playwright journeys pass;
- no serious automated accessibility violations;
- manual keyboard pass completed;
- mobile screen-reader smoke test completed;
- affordance critique completed on Home, Queue, Merchant Detail, Payment Detail, and Rewards;
- measured performance and web-quality audit completed;
- PWA install, offline, reconnect, update, and logout tested in a supported Chromium browser;
- sensitive responses are absent from Cache Storage and service-worker logs.

## 17. Delivery phases

### Phase 0 — Decisions and safeguards

- Approve the route disposition table.
- Normalize the visible product name: `AkibaMiles Admin` versus `MiniMiles Admin Console`.
- Confirm which queue types can be aggregated without new APIs.
- Remove the blocked legacy `/finance/settlements` navigation item.
- Set the mobile primary destinations to Home, Queue, Rewards, Finance, and More.
- Hide Dice, Raffles, and Weekly Challenge.
- Reserve `/finance/voucher-reimbursements` and `/api/admin/voucher-reimbursements` for the funded reimbursement console.

### Phase 1 — Foundations

- Add semantic tokens and shared responsive primitives.
- Build the new shell, role-aware navigation, states, and global search frame.
- Add PWA metadata, icons, safe offline document, and conservative service worker.
- Establish Playwright and accessibility baselines.

### Phase 2 — High-frequency operations

- Rebuild Home around key action items, fund allocation, direct voucher issuance, and new merchants.
- Build the real `Issue voucher` workflow at `/vouchers/grants`.
- Migrate fund and allocation controls required by Home quick actions.
- Migrate Subscription Payments and Collections.
- Add the funded Voucher Reimbursements console.

### Phase 3 — Rewards and growth

- Complete the reimbursable voucher register, lifecycle controls, Funds, Allocations, Pricing, and Referrals.
- Build Unified Queue entry points.
- Migrate Merchants and Profile Reviews.
- Migrate Leads and Communications.

### Phase 4 — Intelligence and system

- Migrate Polls, Pass, Verified Reports, Skill Games, Members, Audit, Team, and Settings.
- Salvage nonlegacy reconciliation signals into Queue/System monitoring.

### Phase 5 — Hardening and retirement

- Complete browser, accessibility, security, and web-quality gates.
- Remove retired navigation and unused UI components.
- Keep historical database structures unless separately approved for data migration.
- Document any remaining placeholders or deferred APIs.

## 18. Release acceptance criteria

The overhaul is accepted when:

1. Every retained capability in the route table is reachable by a permitted user.
2. No blocked or placeholder surface appears in production navigation.
3. All primary journeys are usable at 320px without horizontal page scrolling.
4. Desktop retains efficient data tables and bulk scanning.
5. Mobile uses cards or responsive rows instead of compressed desktop tables.
6. Navigation exposes at most five mobile top-level destinations.
7. Role-based navigation matches server authorization.
8. All consequential actions provide pending, success, error, and conflict feedback.
9. The PWA installs with approved identity and icons.
10. Authenticated pages, APIs, evidence, receipts, and mutation requests are never persisted by the service worker.
11. Offline, reconnect, update, login expiry, and logout behave predictably.
12. WCAG 2.2 AA automated and manual gates pass for critical journeys.
13. The production build, unit suite, and Playwright critical suite pass.
14. A measured web-quality report is attached to the release review.
15. Home presents key action items, fund allocation, direct voucher issuance, and new merchants before any administrative activity.
16. Miles trend and Weekly Challenge do not appear in the redesigned Home or Rewards navigation.
17. Finance is present in mobile navigation for roles with `finance.read`; Merchants is reachable through `More`, Home, Queue, and deep links.
18. Direct issuance cannot bypass eligibility, quantity, budget, idempotency, or permission enforcement.

## 19. Required product decisions

These decisions are intentionally not assumed:

1. Final visible brand name for manifest, title bar, and installed app.
2. Whether Voucher Programs represents an active retained business workflow or should be labelled legacy within Rewards.
3. Whether `push-preview` must remain publicly accessible.
4. Which cross-domain queue items support assignment and resolution today.

The approved UI term in this specification is **Reimbursable vouchers**. Existing route, permission, database, and API contracts may continue to use funded-voucher or grant terminology internally.

## 20. Skills and review gate

The required skill set and installation procedure are codified in `../AGENTS.md`. The implementation must not start until those skills are present in the active session or an explicit fallback has been documented.

Installed for this program in addition to the pre-existing design skills:

- `playwright`
- `security-best-practices`
- `web-design-guidelines`
- `accessibility`
- `web-quality-audit`

No low-adoption PWA-specific third-party skill was installed. PWA implementation should be checked against current official Next.js and browser-platform documentation at implementation time.
