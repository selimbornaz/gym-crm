"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Bell, Building2, Check, LogOut, Menu, Monitor, Moon, Sun } from "lucide-react";
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
import { BrandLogo } from "./brand-logo";
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
  offlineNotice?: string | null;
  signOutAction: () => Promise<void>;
  switchOrgAction: (formData: FormData) => Promise<void>;
  children: ReactNode;
}

export function AppShell(props: ShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const sections = visibleSections(props.permissions);

  return (
    <div className="flex min-h-screen">
      {/* La navigation reste noire dans les deux thèmes (identité Dopamine Fitness). */}
      <aside className="dark brand-rail no-print sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r text-foreground [color-scheme:dark] lg:flex">
        <Brand />
        <NavLinks sections={sections} />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent className="dark brand-rail left-0 right-auto w-72 border-l-0 border-r text-foreground [color-scheme:dark] sm:max-w-xs">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Brand />
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
        {props.offlineNotice && (
          <Link role="status" href="/sync" className="no-print block border-b border-warning/30 bg-warning/10 px-4 py-2 text-center text-xs font-medium text-warning hover:bg-warning/15 md:px-6">
            {props.offlineNotice}
          </Link>
        )}
        <main className="min-w-0 flex-1 p-4 md:p-6 lg:p-8">{props.children}</main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    // Bandeau noir pur : le fond du logo s'y fond sans cadre visible.
    <div className="relative mb-3 flex shrink-0 justify-center bg-black py-2">
      <BrandLogo className="w-40" />
      <span aria-hidden className="hairline-brand absolute inset-x-0 bottom-0" />
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
                      "group relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-all duration-300 ease-out",
                      active
                        ? "bg-brand-metal font-semibold text-primary-foreground shadow-[0_8px_24px_-10px_rgb(255_106_0/0.7),inset_0_1px_0_rgb(255_255_255/0.25)]"
                        : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
                    )}
                  >
                    <Icon
                      className={cn("size-4 transition-colors duration-300 ease-out", active ? "text-primary-foreground" : "text-subtle-foreground group-hover:text-foreground")}
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
  const [signingOut, startSignOut] = useTransition();
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
        {/* Pas de <form> ici : le menu se ferme au clic et retire le formulaire avant
            son envoi. On appelle directement l'action serveur, qui redirige vers /login. */}
        <DropdownMenuItem
          disabled={signingOut}
          onSelect={(event) => {
            event.preventDefault();
            startSignOut(() => signOutAction());
          }}
        >
          <LogOut aria-hidden /> {signingOut ? "Déconnexion…" : "Se déconnecter"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
