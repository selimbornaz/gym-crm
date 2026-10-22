import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Banknote, CreditCard, FileText, Landmark, ShieldAlert, Wallet, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsCount, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requirePagePermission } from "@/lib/auth/context";
import { formatMoney } from "@/lib/format";
import type { PaymentMethodRow, PlanRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { MethodDialog, OrganizationForm, PlanDialog, SettingsForm } from "./settings-forms";

export const metadata: Metadata = { title: "Paramètres" };

const METHOD_ICON: Record<string, LucideIcon> = { cash: Banknote, transfer: Landmark, card: CreditCard, cheque: FileText };

export default async function SettingsPage() {
  const ctx = await requirePagePermission("settings.manage");
  const db = ctx.supabase;
  const [{ data: org }, { data: settings }, { data: plans }, { data: methods }] = await Promise.all([
    db.from("organizations").select("name, legal_name, tax_id, address, phone, email, receipt_footer").eq("id", ctx.org.id).single(),
    db.from("organization_settings").select("*").eq("organization_id", ctx.org.id).single(),
    db.from("membership_plans").select("*").eq("organization_id", ctx.org.id).order("sort_order").order("name"),
    db.from("payment_methods").select("id, name, code, is_active").eq("organization_id", ctx.org.id).order("name"),
  ]);
  const planList = (plans ?? []) as PlanRow[];
  const methodList = (methods ?? []) as PaymentMethodRow[];

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
      <PageHeader title="Paramètres" description="Configuration propre à votre salle. Chaque modification est journalisée." />
      <Tabs defaultValue="plans">
        <TabsList>
          <TabsTrigger value="plans">Formules <TabsCount>{planList.length}</TabsCount></TabsTrigger>
          <TabsTrigger value="gym">Salle</TabsTrigger>
          <TabsTrigger value="methods">Moyens de paiement <TabsCount>{methodList.length}</TabsCount></TabsTrigger>
          <TabsTrigger value="notifications">Fonctionnement</TabsTrigger>
        </TabsList>

        {/* Formules ---------------------------------------------------------------- */}
        <TabsContent value="plans" className="grid gap-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] text-muted-foreground">Un changement de prix ne modifie jamais les abonnements déjà vendus.</p>
            <PlanDialog />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {planList.map((p) => (
              <Card key={p.id} interactive className={cn("flex flex-col p-5", !p.is_active && "opacity-60")}>
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline">{t.planKind[p.kind]}</Badge>
                  {p.is_active ? <Badge variant="success" dot>En vente</Badge> : <Badge variant="secondary">Inactive</Badge>}
                </div>
                <h3 className="mt-4 text-[15px] font-semibold tracking-[-0.015em]">{p.name}</h3>
                <p className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-figure text-[26px] leading-none">{formatMoney(p.price).replace(/\s?DT$/, "")}</span>
                  <span className="text-[12px] text-muted-foreground">
                    DT / {p.duration_value} {t.durationUnit[p.duration_unit]}
                  </span>
                </p>
                {p.sessions_included && <p className="mt-2 text-[12px] text-muted-foreground">{p.sessions_included} séances de coaching incluses</p>}
                {p.access_restrictions && (
                  <p className="mt-3 flex items-center gap-1.5 text-[12px] text-amber-700 dark:text-amber-400">
                    <ShieldAlert className="size-3.5" strokeWidth={1.75} aria-hidden /> {p.access_restrictions}
                  </p>
                )}
                {p.description && <p className="mt-2 text-[12px] text-subtle-foreground">{p.description}</p>}
                <div className="mt-auto flex justify-end pt-4">
                  <PlanDialog plan={p} />
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Salle ------------------------------------------------------------------- */}
        <TabsContent value="gym">
          <SettingsSection title="Informations de la salle" description="Nom commercial, coordonnées et mentions affichées sur chaque reçu imprimé.">
            <OrganizationForm org={org} />
          </SettingsSection>
        </TabsContent>

        {/* Moyens de paiement ----------------------------------------------------- */}
        <TabsContent value="methods">
          <SettingsSection
            title="Moyens de paiement"
            description="Proposés à l'encaissement. Les cartes bancaires sont saisies manuellement (TPE) : aucun paiement en ligne n'est traité."
            action={<MethodDialog />}
          >
            <ul className="divide-y divide-border/70">
              {methodList.map((m) => {
                const Icon = METHOD_ICON[m.code] ?? Wallet;
                return (
                  <li key={m.id} className={cn("flex items-center gap-3 px-1 py-3 transition-colors duration-300 ease-out", !m.is_active && "opacity-60")}>
                    <span className="flex size-8 items-center justify-center rounded-lg border bg-secondary/60">
                      <Icon className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                    </span>
                    <span className="flex-1 text-[13px] font-medium">{m.name}</span>
                    {m.is_active ? <Badge variant="success" dot>Actif</Badge> : <Badge variant="secondary">Inactif</Badge>}
                    <MethodDialog method={m} />
                  </li>
                );
              })}
            </ul>
          </SettingsSection>
        </TabsContent>

        {/* Fonctionnement ---------------------------------------------------------- */}
        <TabsContent value="notifications">
          <SettingsSection title="Fonctionnement" description="Délai d'alerte d'expiration, anti double-scan à l'entrée, numérotation des reçus et des membres, notifications.">
            <SettingsForm settings={settings} />
          </SettingsSection>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Section de réglages : description à gauche, formulaire à droite (style Stripe). */
function SettingsSection({ title, description, action, children }: { title: string; description: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div>
        <h2 className="text-[15px] font-semibold tracking-[-0.015em]">{title}</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
        {action && <div className="mt-4">{action}</div>}
      </div>
      <Card className="p-5">{children}</Card>
    </div>
  );
}
