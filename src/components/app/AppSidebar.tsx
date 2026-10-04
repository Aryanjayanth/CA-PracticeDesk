import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import {
  LayoutDashboard,
  Users,
  Briefcase,
  ClipboardList,
  FileText,
  Repeat,
  Wallet,
  Shuffle,
  CircleDollarSign,
  AlertTriangle,
  CalendarClock,
  Scale,
  BarChart3,
  UserCog,
  ShieldCheck,
  History,
  Settings,
  TriangleAlert,
  Building2,
  ChevronDown,
  ArrowLeftRight,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useRoles, type Role } from "@/hooks/use-roles";
import { useCurrentFirm, useSuperAdmin } from "@/hooks/use-firm";
import { useAdminPrivacy } from "@/hooks/use-admin-privacy";
import { EntityAvatar } from "./EntityAvatar";
import { cn } from "@/lib/utils";

const M: Role[] = ["owner", "admin"];
const F: Role[] = ["owner", "admin", "accountant"];
const S: Role[] = ["owner", "admin", "accountant", "staff"];

type Item = { title: string; url: string; icon: typeof Users; roles: Role[] };
const groups: { label: string; items: Item[]; open?: boolean }[] = [
  {
    label: "Practice",
    open: true,
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, roles: F },
      { title: "Clients", url: "/clients", icon: Users, roles: S },
      { title: "Services", url: "/services", icon: Briefcase, roles: S },
      { title: "Jobs", url: "/jobs", icon: ClipboardList, roles: S },
      { title: "Recurring Jobs", url: "/recurring", icon: Repeat, roles: S },
    ],
  },
  {
    label: "Billing & Payments",
    open: true,
    items: [
      { title: "Invoices", url: "/invoices", icon: FileText, roles: F },
      { title: "Payment Entry", url: "/payments", icon: Wallet, roles: [...F, "cashier"] },
      { title: "Payment Clearing", url: "/clearing", icon: Shuffle, roles: F },
      { title: "Unallocated", url: "/unallocated", icon: CircleDollarSign, roles: F },
    ],
  },
  {
    label: "Receivables & Reports",
    items: [
      { title: "Outstanding", url: "/outstanding", icon: AlertTriangle, roles: F },
      { title: "Ageing", url: "/ageing", icon: CalendarClock, roles: F },
      { title: "Reconciliation", url: "/reconciliation", icon: Scale, roles: F },
      { title: "Exceptions", url: "/exceptions", icon: TriangleAlert, roles: F },
      { title: "Reports", url: "/reports", icon: BarChart3, roles: F },
    ],
  },
  {
    label: "Administration",
    items: [
      { title: "Users", url: "/users", icon: UserCog, roles: M },
      { title: "Roles & Permissions", url: "/roles", icon: ShieldCheck, roles: M },
      { title: "Audit Trail", url: "/audit", icon: History, roles: M },
      { title: "Import / Export", url: "/import-export", icon: ArrowLeftRight, roles: M },
      { title: "Settings", url: "/settings", icon: Settings, roles: M },
    ],
  },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { has, loading } = useRoles();
  const { isSuperAdmin } = useSuperAdmin();
  const { privacyMode } = useAdminPrivacy();
  const { data: firm } = useCurrentFirm();
  const path = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (u: string) => path === u || path.startsWith(u + "/");
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      groups.map((g) => [g.label, !!g.open || g.items.some((i) => isActive(i.url))]),
    ),
  );

  const isPlatformMode = isSuperAdmin && privacyMode;

  return (
    <Sidebar collapsible="icon" className="no-print">
      <SidebarHeader className="border-b border-sidebar-border py-2.5 px-2 group-data-[collapsible=icon]:p-2">
        <Link
          to={isPlatformMode ? "/admin" : "/dashboard"}
          className="flex items-center gap-2.5 rounded-md p-1 transition-colors hover:bg-sidebar-accent/50 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md">
            <img src="/logo.png" alt="CA PracticeDesk" className="h-6 w-6 object-contain" />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold leading-tight text-sidebar-foreground">
                {isPlatformMode ? "CA PracticeDesk" : (firm?.name ?? "CA PracticeDesk")}
              </div>
              <div className="text-[11px] leading-tight text-muted-foreground opacity-75">
                {isPlatformMode ? "Super Admin" : "PracticeDesk"}
              </div>
            </div>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-1 py-2 overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {/* Platform Links for Super Admin */}
        {isSuperAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Platform</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/admin")} tooltip="Firms Console">
                    <Link to="/admin">
                      <Building2 className="h-4 w-4" />
                      <span>Firms Console</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/settings")} tooltip="Settings">
                    <Link to="/settings">
                      <Settings className="h-4 w-4" />
                      <span>Settings</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Firm practice modules (hidden when Super Admin has privacy mode active) */}
        {!loading &&
          firm &&
          !isPlatformMode &&
          groups.map((g) => {
            const items = g.items.filter((i) => has(...i.roles));
            if (!items.length) return null;
            const isOpen = collapsed || open[g.label];
            return (
              <SidebarGroup key={g.label}>
                <SidebarGroupLabel asChild>
                  <button
                    type="button"
                    onClick={() => setOpen((o) => ({ ...o, [g.label]: !o[g.label] }))}
                    className="flex w-full items-center justify-between"
                  >
                    {g.label}
                    <ChevronDown
                      className={cn("h-3.5 w-3.5 transition-transform", !isOpen && "-rotate-90")}
                    />
                  </button>
                </SidebarGroupLabel>
                {isOpen && (
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {items.map((i) => (
                        <SidebarMenuItem key={i.url}>
                          <SidebarMenuButton asChild isActive={isActive(i.url)} tooltip={i.title}>
                            <Link to={i.url}>
                              <i.icon className="h-4 w-4" />
                              <span>{i.title}</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                )}
              </SidebarGroup>
            );
          })}
      </SidebarContent>
    </Sidebar>
  );
}
