"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Bell, Bot, Building2, Check, LogOut, Menu, Monitor, Moon, Sun } from "lucide-react";
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
  /** Conversations du chatbot en attente (null : pas d'accès à la boîte de réception). */
  chatAttention: number | null;
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
        <SheetContent className="dark brand-rail left-0 right-auto w-72 border-l-0 border-r bg-black! text-foreground [color-scheme:dark] sm:max-w-xs">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Brand />
          <NavLinks sections={sections} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass no-print sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-background/60 px-5 md:px-8 lg:px-12">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Ouvrir le menu">
            <Menu />
          </Button>
          <OrgSwitcher {...props} />
          <div className="ml-auto flex items-center gap-1">
            {props.chatAttention !== null && <ChatbotButton attention={props.chatAttention} />}
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
        <main className="page-enter min-w-0 flex-1 px-5 pb-16 pt-8 md:px-8 md:pt-10 lg:px-12 lg:pt-12">{props.children}</main>
      </div>
    </div>
  );
}

/** Accès au chatbot (boîte de réception, statistiques, réglages) avec son propre compteur. */
function ChatbotButton({ attention }: { attention: number }) {
  const active = usePathname().startsWith("/chatbot");
  return (
    <Link
      href="/chatbot"
      aria-label={`Chatbot (${attention} conversation${attention > 1 ? "s" : ""} en attente)`}
      className={cn(
        "relative mr-1 flex h-10 items-center gap-2 rounded-full px-4 text-[13px] font-semibold text-primary-foreground transition-all duration-300 ease-out",
        "bg-brand-metal shadow-[0_8px_24px_-10px_rgb(255_106_0/0.7),inset_0_1px_0_rgb(255_255_255/0.28)] hover:brightness-110",
        active && "ring-2 ring-brand/60 ring-offset-2 ring-offset-background",
      )}
    >
      <Bot className="size-[18px]" strokeWidth={2} aria-hidden />
      <span className="hidden sm:inline">Chatbot</span>
      {attention > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-5 text-white ring-2 ring-background">
          {attention > 99 ? "99+" : attention}
        </span>
      )}
    </Link>
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
    <nav className="flex-1 overflow-y-auto px-4 pb-6 pt-2" aria-label="Navigation principale">
      {sections.map((section) => (
        <div key={section.title} className="mb-7">
          <p className="text-eyebrow mb-2 px-3">{section.title}</p>
          <ul className="grid gap-0.5">
            {section.items.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex h-10 items-center gap-3 rounded-xl px-3 text-[13.5px] font-medium transition-all duration-300 ease-out-soft",
                      active
                        ? "bg-white/[0.08] font-semibold text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]"
                        : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
                    )}
                  >
                    {/* Trait orange de l'élément actif. */}
                    <span
                      aria-hidden
                      className={cn(
                        "bg-brand-metal absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full transition-all duration-500 ease-out-soft",
                        active ? "opacity-100" : "scale-y-0 opacity-0",
                      )}
                    />
                    <Icon
                      className={cn("size-[18px] transition-colors duration-300 ease-out", active ? "text-primary" : "text-subtle-foreground group-hover:text-foreground")}
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
