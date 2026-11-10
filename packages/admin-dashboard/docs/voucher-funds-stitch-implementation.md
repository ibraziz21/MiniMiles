> Updated 10 November: the user removed the separate approval step. The current UI uses Submit → Publish. Apply `sql/023_funding_submit_publish.sql` to the Platform database before release; it is tested locally but has not been applied live. The earlier workflow notes below describe the original implementation and are superseded on this point.

# Voucher funds — Stitch implementation

Source: `/Users/ibraziz21/Downloads/voucher funds.zip`.

Implemented the fund register, fund detail, creation form, allocation budget step, voucher-rules step, review and published outcome. The supplied lavender canvas, white cards, teal actions, balance hierarchy, status pills, merchant identity, budget meter and outcome layout are retained. Actual fund data and uploaded merchant assets are used; test screenshots are explicitly labelled as fixtures.

## Workflow

- Fund register has All/Active/Draft/Ended filters with actual counts, available balance, authorized pool and Nairobi dates. Query failures remain unavailable states, rather than healthy empty/zero balances. A filtered register return URL survives opening a fund and returning.
- Fund detail shows the authoritative budget view, actual committed/available amounts, percentages and merchant allocations. Extra fund metadata, eligibility versions and existing state actions are under Fund details & actions.
- Create/edit fund keeps all existing fields and version checks. Primary fields match the export; country, sponsorship, public campaign and authorization reference are under More options. The existing notes field is labelled as internal. Creation saves a draft and says approval is required; it does not invent immediate activation or a points ledger.
- Allocation setup now has budget → voucher rules → review steps. New allocations calculate quantity from budget at the worst-case per-voucher ceiling, including percentage-discount caps. Manual quantity remains available under More options; draft edits preserve saved quantities instead of recalculating them. Budget, country, dates, eligibility, distribution, redemption schedule, additional merchants and expected-version payloads remain supported.
- Required country gates remain locked. Optional policy, additional merchants, claim lifespan and distribution controls are retained under More options. Saved custom eligibility policies/timezones and independent redemption windows remain intact. Unsupported legacy policy edits remain blocked explicitly.
- Final save creates a draft allocation and opens `/vouchers/funds/[fundId]/allocations/[allocationId]/review`. Submission, approval and publication remain separate API transitions. Review shows saved data and actual merchant-readiness results. The published outcome is displayed only for a saved active/scheduled allocation after a successful publish navigation.
- Native prompt/confirm popups for funding state actions are replaced with labelled dialogs, error handling and retry locks. Fund approval revision and rescheduling version checks remain. Rescheduling uses explicit Nairobi conversion instead of the browser's local timezone.
- Full allocation details remain available and link into the redesigned issued register. Their activity status counts now paginate through all matching records without fetching unused member PII or stopping at 200 rows.

The export's unimplemented member-push dispatch, generic “all members” eligibility, fixed two-claim limit and instant activation claims were not fabricated. Existing economic APIs, server permission checks, maker/checker and readiness rules remain unchanged. No real fund, rule set, allocation, voucher or balance was created, changed or published.

## Validation

- Production build and 288 unit tests pass. Existing draft-policy, membership, timezone and financial-route tests remain in place. New tests cover safe register returns, cent-safe quantity calculation, money display and Nairobi dates.
- 26 shared responsive/keyboard browser tests pass.
- The full create → submit → approve → publish journey for both fund and allocation was exercised against an isolated local fixture service, with every financial browser request intercepted. Assertions check payloads, approval revision, country gates, backing calculations, failed rule-save preventing allocation creation, budget-overrun rejection, retained back-navigation values and publish errors not producing a success screen.
- Register plus seven workflow surfaces fit 320, 375, 414, 768, 1024, 1280 and 1440px (56 checks), including the main scrolling container. Keyboard focus moves to each new wizard heading or error summary. Actual read-only fund, review and full-allocation pages were inspected separately.
- Local Lighthouse audits score 100 for performance, accessibility and best practices on fund register, create form and fund detail. A definition-list semantic issue in the detail budget summary was corrected and re-audited.

Screenshots, the repeatable isolated journey, fixture service and audit JSON are under ignored `output/playwright/`. Native 200% browser zoom and VoiceOver were not verified. No schema/dependency changes or deployment.
