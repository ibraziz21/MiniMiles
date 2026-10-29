# Merchant removal

Apply `sql/015_archive_merchants.sql` to the shared Supabase database before releasing this dashboard change. It adds a service-role-only RPC; no merchant rows change during migration.

Admins with `merchants.write` can choose Remove from the Merchants list or merchant detail. Removal requires the exact merchant name and a reason. The operation locks the merchant row and atomically sets its existing platform status to `archived`, records `archived_at`, and inserts an admin audit log. An audit failure rolls back removal. Repeating removal is harmless.

The default list excludes archived merchants; choose Archived merchants to inspect their details. Public directory queries already require partner status `active`; the existing status-change trigger queues projection refresh. The operation retains vouchers, transactions, team records and subscription billing. It does not cancel a subscription, erase personal data, or automatically classify merchants as inactive. Review paid subscriptions before removal.
