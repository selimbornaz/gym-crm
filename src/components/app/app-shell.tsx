"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Bell, Building2, Check, Dumbbell, LogOut, Menu, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { InitialsAvatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import type { StaffRole } from "@/lib/permissions";
import { visibleSections } from "./nav-config";

interface ShellProps {
  permissions: string[];
  orgName: string;
  orgId: string;
  organizations: Array<{ id: string; name: string; role: StaffRole }>;
  userName: string;
  userEmail: string | null;
  role: StaffRole;
  unread: number;
  signOutAction: () => Promise<void>;
  switchOrgAction: (formData: FormData) => Promise<void>;
  children: ReactNode;
}

export function AppShell(props: ShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const sections = visibleSections(props.permissions);

  return (
    <div className="flex min-h-screen">
      <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-background lg:flex">
        <Brand orgName={props.orgName} />
        <NavLinks sections={sections} />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent className="left-0 right-auto w-72 border-l-0 border-r sm:max-w-xs">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Brand orgName={props.orgName} />
          <NavLinks sections={sections} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/70 px-4 backdrop-blur-xl backdrop-saturate-150 md:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Ouvrir le menu">
            <Menu />
          </Button>
          <OrgSwitcher {...props} />
          <div className="ml-auto flex items-center gap-1">
            {props.permissions.includes("notifications.read") && (
              <Button asChild variant="ghost" size="icon" aria-label={`Notifications (${props.unread} non lues)`}>
                <Link href="/notifications" className="relative">
                  <Bell />
                  {props.unread > 0 && (
                    <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-white">
                      {props.unread > 99 ? "99+" : props.unread}
                    </span>
                  )}
                </Link>
              </Button>
            )}
            <ThemeMenu />
            <UserMenu {...props} />
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6 lg:p-8">{props.children}</main>
      </div>
    </div>
  );
}

function Brand({ orgName }: { orgName: string }) {
  return (
    <div className="flex h-14 items-center gap-2.5 px-4">
      <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-b from-zinc-700 to-zinc-950 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.15),0_1px_2px_rgb(0_0_0/0.2)] dark:from-zinc-200 dark:to-zinc-400 dark:text-zinc-950">
        <Dumbbell className="size-3.5" strokeWidth={2} aria-hidden />
      </span>
      <div className="min-w-0 leading-tight">
        <p className="text-[13px] font-semibold tracking-[-0.01em]">Gym CRM</p>
        <p className="truncate text-[11px] text-muted-foreground">{orgName}</p>
      </div>
    </div>
  );
}

function NavLinks({ sections, onNavigate }: { sections: ReturnType<typeof visibleSections>; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 overflow-y-auto px-3 pb-3 pt-1" aria-label="Navigation principale">
      {sections.map((section) => (
        <div key={section.title} className="mb-5">
          <p className="text-eyebrow mb-1.5 px-2.5">{section.title}</p>
          <ul className="grid gap-px">
            {section.items.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-all duration-300 ease-out",
                      active
                        ? "edge-highlight bg-card font-medium text-foreground shadow-card ring-1 ring-border"
                        : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
                    )}
                  >
                    <Icon
                      className={cn("size-4 transition-colors duration-300 ease-out", active ? "text-foreground" : "text-subtle-foreground group-hover:text-foreground")}
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function OrgSwitcher({ orgName, orgId, organizations, switchOrgAction }: ShellProps) {
  if (organizations.length <= 1) {
    return <span className="hidden truncate text-sm font-medium sm:inline lg:hidden">{orgName}</span>;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-56">
          <Building2 aria-hidden /> <span className="truncate">{orgName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Changer de salle</DropdownMenuLabel>
        {organizations.map((o) => (
          <form key={o.id} action={switchOrgAction}>
            <input type="hidden" name="orgId" value={o.id} />
            <DropdownMenuItem asChild>
              <button type="submit" className="w-full">
                {o.id === orgId ? <Check aria-hidden /> : <span className="size-4" />}
                <span className="truncate">{o.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">{t.roles[o.role]}</span>
              </button>
            </DropdownMenuItem>
          </form>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeMenu() {
  const { setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Thème">
          <Sun className="dark:hidden" />
          <Moon className="hidden dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setTheme("light")}>
          <Sun aria-hidden /> Clair
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("dark")}>
          <Moon aria-hidden /> Sombre
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("system")}>
          <Monitor aria-hidden /> Système
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ userName, userEmail, role, signOutAction }: ShellProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Mon compte">
          <InitialsAvatar name={userName || "?"} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          <span className="block truncate font-medium text-foreground">{userName}</span>
          <span className="block truncate">{userEmail}</span>
          <span className="mt-1 block">{t.roles[role]}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOut aria-hidden /> Se déconnecter
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
