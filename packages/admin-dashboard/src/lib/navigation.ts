// Role-aware navigation tree for the AkibaMiles Admin shell.
// Spec: ../../docs/admin-dashboard-pwa-ui-overhaul-spec.md §5, §6, §16.1.
//
// Framework-agnostic on purpose (no React/Next imports besides lucide icon
// components, which are inert on import) so the construction logic is
// directly unit-testable without rendering anything.
//
// Every `permission` string below is copied from the actual
// `requireAdminSession("...")` / `hasPermission(role, "...")` call already
// enforced server-side by the target page itself (verified by grepping each
// page under src/app/(dashboard)/ before writing this file) — nav visibility
// must mirror real authorization, never invent it. `src/middleware.ts`
// remains the authority on which routes are blocked outright; this file is
// reconciled to it via BLOCKED_NAV_ROUTES, never the reverse.

import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  ListChecks,
  Store,
  Tag,
  Landmark,
  BarChart2,
  BellRing,
  ScrollText,
  Users,
  Inbox,
  Share2,
  Gamepad2,
  ShieldCheck,
  Settings,
  ClipboardCheck,
  ClipboardList,
  Search,
  Sparkles,
  Image as ImageIcon,
  Activity,
  Ticket,
  HandCoins,
  WalletCards,
} from "lucide-react";
import type { AdminRole } from "@/types";
import { hasPermission } from "@/types";

export interface NavNode {
  id: string;
  label: string;
  icon: LucideIcon;
  targetRoute: string;
  exact?: boolean;
  /** Omitted = always visible to any authenticated session (matches a page that calls requireAdminSession() with no argument). */
  permission?: string;
  /** Feature gate applied in addition to the permission check. */
  featureGate?: "funded-admin" | "funded-finance";
  children?: NavNode[];
}

export interface MobilePrimarySlot {
  id: string;
  label: string;
  icon: LucideIcon;
  /** null for the "more" slot, which opens MobileMoreSheet instead of navigating. */
  targetRoute: string | null;
  /** Routes within the same module that should keep this slot highlighted. */
  matchRoutes?: string[];
}

export interface AdminNav {
  desktopPrimary: NavNode[];
  /** Fixed 5 slots, always rendered in this position for every role (spec §5.2 "stable navigation") — never filtered or reordered. */
  mobilePrimary: MobilePrimarySlot[];
  mobileMore: NavNode[];
}

// Routes that must never be emitted by this module regardless of role or
// flag — either middleware-blocked (src/middleware.ts) or spec §6 "Hide"
// disposition (unwired placeholder with no canonical data source).
export const BLOCKED_NAV_ROUTES: readonly string[] = [
  "/finance/settlements",
  "/games/dice",
  "/games/raffles",
  "/orders",
  "/fulfillment",
  "/refunds",
  "/settlement",
  "/reconciliation",
];

// Spec §5.1: "Members and Leads live under contextual modules rather than
// occupying the primary rail." The spec doesn't name which module on
// desktop (only specifying "More → Members"/"More → Leads" for mobile,
// where there is no desktop-rail equivalent) — Leads is nested under
// Merchants (partner/merchant lead pipeline) and Members under System
// (admin-facing user directory, alongside Team) as the closest semantic fit.
const DESKTOP_PRIMARY_MODULES: NavNode[] = [
  {
    id: "home",
    label: "Home",
    icon: LayoutDashboard,
    targetRoute: "/overview",
  },
  {
    id: "work",
    label: "Work",
    icon: ListChecks,
    targetRoute: "/ops-queue",
    // No single permission gate — the Unified Queue page itself is
    // permission-filtered per source (src/lib/unifiedQueue.ts), so this stays
    // visible to any authenticated role, same as the mobile Queue slot.
  },
  {
    id: "rewards",
    label: "Rewards",
    icon: Tag,
    targetRoute: "/vouchers",
    children: [
      { id: "rewards-overview", label: "Overview", icon: LayoutDashboard, targetRoute: "/vouchers", exact: true, permission: "vouchers.read" },
      { id: "rewards-programs", label: "Programs", icon: Ticket, targetRoute: "/vouchers/programs", permission: "vouchers.read" },
      {
        id: "rewards-reimbursable",
        label: "Reimbursable vouchers",
        icon: HandCoins,
        targetRoute: "/vouchers/funds",
        children: [
          { id: "rewards-funds", label: "Voucher funds", icon: Landmark, targetRoute: "/vouchers/funds", permission: "voucher_funds.read", featureGate: "funded-admin" },
          { id: "rewards-allocations", label: "Merchant allocations", icon: Store, targetRoute: "/vouchers/allocations", permission: "voucher_funds.read", featureGate: "funded-admin" },
          { id: "rewards-issue", label: "Issue voucher", icon: WalletCards, targetRoute: "/vouchers/grants", permission: "voucher_funds.grant", featureGate: "funded-admin" },
        ],
      },
      { id: "rewards-pricing", label: "Pricing", icon: Tag, targetRoute: "/vouchers/pricing", permission: "vouchers.read" },
      {
        id: "rewards-referrals",
        label: "Referrals",
        icon: Share2,
        targetRoute: "/referrals",
        children: [
          { id: "rewards-referrals-overview", label: "Overview", icon: LayoutDashboard, targetRoute: "/referrals", exact: true, permission: "referrals.read" },
          { id: "rewards-referrals-queue", label: "Review Queue", icon: ClipboardCheck, targetRoute: "/referrals/queue", permission: "referrals.read" },
          { id: "rewards-referrals-lookup", label: "Lookup", icon: Search, targetRoute: "/referrals/lookup", permission: "referrals.read" },
          { id: "rewards-referrals-program", label: "Program", icon: Settings, targetRoute: "/referrals/program", permission: "referrals.read" },
        ],
      },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    icon: Landmark,
    targetRoute: "/finance",
    children: [
      { id: "finance-overview", label: "Overview", icon: LayoutDashboard, targetRoute: "/finance", exact: true, permission: "finance.read" },
      { id: "finance-subscriptions", label: "Subscription payments", icon: Inbox, targetRoute: "/finance/subscriptions", permission: "finance.read" },
      { id: "finance-collections", label: "Collections", icon: ClipboardCheck, targetRoute: "/finance/subscriptions/collections", permission: "finance.read" },
      { id: "finance-reimbursements", label: "Voucher reimbursements", icon: HandCoins, targetRoute: "/finance/voucher-reimbursements", permission: "voucher_settlements.read", featureGate: "funded-finance" },
    ],
  },
  {
    id: "merchants",
    label: "Merchants",
    icon: Store,
    targetRoute: "/merchants",
    children: [
      { id: "merchants-directory", label: "Directory", icon: Store, targetRoute: "/merchants", exact: true, permission: "merchants.read" },
      { id: "merchants-profile-reviews", label: "Profile Reviews", icon: ClipboardCheck, targetRoute: "/directory-reviews", permission: "merchants.read" },
      { id: "merchants-discovery-items", label: "Discovery Items", icon: Sparkles, targetRoute: "/discovery-items", permission: "discovery.read" },
      { id: "merchants-discovery-photos", label: "Discovery Photos", icon: ImageIcon, targetRoute: "/discovery-photos", permission: "discovery.read" },
      { id: "merchants-discovery-health", label: "Discovery Health", icon: Activity, targetRoute: "/verified-discovery-health", permission: "discovery.read" },
      { id: "merchants-leads", label: "Leads", icon: Inbox, targetRoute: "/leads", permission: "leads.read" },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    icon: BarChart2,
    targetRoute: "/insights/polls",
    // No own page at /insights — visibility is derived entirely from children.
    children: [
      { id: "insights-polls", label: "Polls", icon: ClipboardList, targetRoute: "/insights/polls", permission: "polls.read" },
      { id: "insights-pass", label: "Pass Analytics", icon: BarChart2, targetRoute: "/insights/pass", permission: "users.read" },
      { id: "insights-verified", label: "Verified Reports", icon: ShieldCheck, targetRoute: "/insights/verified", permission: "insights.read" },
      { id: "insights-skill-games", label: "Skill Games", icon: Gamepad2, targetRoute: "/games/skill-games", permission: "orders.read" },
    ],
  },
  {
    id: "communications",
    label: "Comms",
    icon: BellRing,
    targetRoute: "/push-notifications",
    permission: "notifications.read",
  },
  {
    id: "system",
    label: "System",
    icon: ScrollText,
    targetRoute: "/audit-log",
    // No own page at a dedicated /system route — visibility is derived entirely from children.
    children: [
      { id: "system-audit", label: "Audit Log", icon: ScrollText, targetRoute: "/audit-log", permission: "audit.read" },
      { id: "system-team", label: "Admin Team", icon: ShieldCheck, targetRoute: "/team", permission: "audit.read" },
      { id: "system-members", label: "Members", icon: Users, targetRoute: "/users", permission: "users.read" },
      { id: "system-settings", label: "Settings", icon: Settings, targetRoute: "/settings" },
    ],
  },
];

const MOBILE_MORE_DESTINATIONS: NavNode[] = [
  { id: "more-merchants", label: "Merchants", icon: Store, targetRoute: "/merchants", permission: "merchants.read" },
  { id: "more-insights", label: "Insights", icon: BarChart2, targetRoute: "/insights/polls", permission: "polls.read" },
  { id: "more-members", label: "Members", icon: Users, targetRoute: "/users", permission: "users.read" },
  { id: "more-leads", label: "Leads", icon: Inbox, targetRoute: "/leads", permission: "leads.read" },
  { id: "more-communications", label: "Communications", icon: BellRing, targetRoute: "/push-notifications", permission: "notifications.read" },
  { id: "more-games", label: "Games", icon: Gamepad2, targetRoute: "/games/skill-games", permission: "orders.read" },
  { id: "more-audit", label: "Audit", icon: ScrollText, targetRoute: "/audit-log", permission: "audit.read" },
  { id: "more-team", label: "Team", icon: ShieldCheck, targetRoute: "/team", permission: "audit.read" },
  { id: "more-settings", label: "Settings", icon: Settings, targetRoute: "/settings" },
];

function filterNode(node: NavNode, role: AdminRole, fundedVouchersEnabled: boolean, fundedFinanceEnabled: boolean): NavNode | null {
  if (BLOCKED_NAV_ROUTES.includes(node.targetRoute)) return null;
  if (node.featureGate === "funded-admin" && !fundedVouchersEnabled) return null;
  if (node.featureGate === "funded-finance" && !fundedFinanceEnabled) return null;

  if (node.children && node.children.length > 0) {
    const children = node.children
      .map((child) => filterNode(child, role, fundedVouchersEnabled, fundedFinanceEnabled))
      .filter((child): child is NavNode => child !== null);
    if (children.length === 0) return null;
    // A branch's own targetRoute is never permission-checked directly (it's
    // not a leaf) — reassign it to the first surviving child so clicking the
    // module icon always lands somewhere the role can actually open, instead
    // of a static route the role might lack permission for.
    return { ...node, targetRoute: children[0].targetRoute, children };
  }

  if (node.permission && !hasPermission(role, node.permission)) return null;
  return node;
}

export function buildNav(role: AdminRole, fundedVouchersEnabled: boolean, fundedFinanceEnabled = fundedVouchersEnabled): AdminNav {
  const desktopPrimary = DESKTOP_PRIMARY_MODULES.map((node) =>
    filterNode(node, role, fundedVouchersEnabled, fundedFinanceEnabled),
  ).filter((node): node is NavNode => node !== null);

  const mobileMore = MOBILE_MORE_DESTINATIONS.map((node) =>
    filterNode(node, role, fundedVouchersEnabled, fundedFinanceEnabled),
  ).filter((node): node is NavNode => node !== null);

  const moduleById = new Map(desktopPrimary.map((node) => [node.id, node]));
  const preferredMobileModules = ["home", "work", "rewards", "finance"];
  const fallbackMobileModules = ["merchants", "insights", "communications", "system"];
  const mobileModules = [...preferredMobileModules, ...fallbackMobileModules]
    .map((id) => moduleById.get(id))
    .filter((node): node is NavNode => Boolean(node))
    .slice(0, 4);

  const mobilePrimary: MobilePrimarySlot[] = [
    ...mobileModules.map((node) => ({
      id: node.id === "work" ? "queue" : node.id,
      label: node.id === "work" ? "Queue" : node.label,
      icon: node.icon,
      targetRoute: node.targetRoute,
      matchRoutes: allNodeRoutes(node),
    })),
    { id: "more", label: "More", icon: Settings, targetRoute: null },
  ];

  return {
    desktopPrimary,
    mobilePrimary,
    mobileMore,
  };
}

function allNodeRoutes(node: NavNode): string[] {
  return [node.targetRoute, ...(node.children?.flatMap(allNodeRoutes) ?? [])];
}
