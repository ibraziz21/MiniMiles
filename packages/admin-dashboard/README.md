# AkibaMiles Admin Dashboard

Internal admin UI for AkibaMiles staff. Not merchant-facing.

Runs on port **3002** (merchant dashboard is 3001, react-app is 3000).

## Setup

```bash
cd packages/admin-dashboard
cp .env.template .env.local
# Fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, SESSION_SECRET, ADMIN_BOOTSTRAP_SECRET
pnpm install
pnpm dev
```

## SQL migrations

Run in order against your Supabase project:

```bash
# From packages/admin-dashboard/sql/
psql $DATABASE_URL -f 001_admin_users.sql
psql $DATABASE_URL -f 002_admin_audit_logs.sql
psql $DATABASE_URL -f 003_polls.sql
psql $DATABASE_URL -f 004_verified_insights.sql
psql $DATABASE_URL -f 005_risk_flags.sql
psql $DATABASE_URL -f 006_ops_incidents.sql
```

Or paste each file into the Supabase SQL editor.

## Admin roles

| Role | Permissions |
|---|---|
| `super_admin` | All permissions |
| `ops_admin` | Merchants, orders, support actions |
| `finance_admin` | Finance, invoices, exports |
| `insights_admin` | Polls and verified insights |
| `readonly` | View-only across all sections |

## Bootstrapping the first super_admin

The login API accepts an `ADMIN_BOOTSTRAP_SECRET` environment variable. Use the
`/api/auth/bootstrap` endpoint (POST with `{ email, password, secret }`) to
create the first super_admin account when the `admin_users` table is empty.

## Architecture

- **Next.js 14 App Router** with TypeScript
- **Supabase** (service key only — never exposed to browser)
- **iron-session** for httpOnly session cookies
- **Tailwind CSS** matching merchant-dashboard design tokens
- All privileged operations go through API routes (never client components)
- Every sensitive action writes to `admin_audit_logs`
