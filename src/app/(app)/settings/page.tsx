import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requirePagePermission } from "@/lib/auth/context";
import { formatMoney } from "@/lib/format";
import type { PaymentMethodRow, PlanRow } from "@/lib/types";
import { t } from "@/i18n";
import { MethodDialog, OrganizationForm, PlanDialog, SettingsForm } from "./settings-forms";

export const metadata: Metadata = { title: "Paramètres" };

export default async function SettingsPage() {
  const ctx = await requirePagePermission("settings.manage");
  const db = ctx.supabase;
  const [{ data: org }, { data: settings }, { data: plans }, { data: methods }] = await Promise.all([
    db.from("organizations").select("name, legal_name, tax_id, address, phone, email, receipt_footer").eq("id", ctx.org.id).single(),
    db.from("organization_settings").select("*").eq("organization_id", ctx.org.id).single(),
    db.from("membership_plans").select("*").eq("organization_id", ctx.org.id).order("sort_order").order("name"),
    db.from("payment_methods").select("id, name, code, is_active").eq("organization_id", ctx.org.id).order("name"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Paramètres" description="Configuration propre à votre salle. Les modifications sont journalisées." />
      <Tabs defaultValue="plans">
        <TabsList>
          <TabsTrigger value="plans">Formules</TabsTrigger>
          <TabsTrigger value="gym">Salle</TabsTrigger>
          <TabsTrigger value="methods">Moyens de paiement</TabsTrigger>
          <TabsTrigger value="notifications">Fonctionnement & notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="plans" className="grid gap-4">
          <div className="flex justify-end">
            <PlanDialog />
          </div>
          <Table>
            <THead>
              <tr><Th>Formule</Th><Th>Type</Th><Th>Durée</Th><Th className="text-right">Prix</Th><Th>Restrictions</Th><Th>Statut</Th><Th /></tr>
            </THead>
            <TBody>
              {((plans ?? []) as PlanRow[]).map((p) => (
                <Tr key={p.id}>
                  <Td>
                    <p className="font-medium">{p.name}</p>
                    {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                  </Td>
                  <Td>{t.planKind[p.kind]}{p.sessions_included && ` · ${p.sessions_included} séances`}</Td>
                  <Td>{p.duration_value} {t.durationUnit[p.duration_unit]}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(p.price)}</Td>
                  <Td className="text-xs text-muted-foreground">{p.access_restrictions ?? "—"}</Td>
                  <Td>{p.is_active ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</Td>
                  <Td className="text-right"><PlanDialog plan={p} /></Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TabsContent>

        <TabsContent value="gym">
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>Informations de la salle</CardTitle>
              <CardDescription>Affichées sur les reçus.</CardDescription>
            </CardHeader>
            <CardContent>
              <OrganizationForm org={org} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="methods" className="grid max-w-2xl gap-4">
          <div className="flex justify-end">
            <MethodDialog />
          </div>
          <Table>
            <THead><tr><Th>Moyen</Th><Th>Statut</Th><Th /></tr></THead>
            <TBody>
              {((methods ?? []) as PaymentMethodRow[]).map((m) => (
                <Tr key={m.id}>
                  <Td className="font-medium">{m.name}</Td>
                  <Td>{m.is_active ? <Badge variant="success">Actif</Badge> : <Badge variant="secondary">Inactif</Badge>}</Td>
                  <Td className="text-right"><MethodDialog method={m} /></Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            Les paiements par carte sont enregistrés manuellement (TPE). Aucun paiement en ligne n&apos;est traité par l&apos;application.
          </p>
        </TabsContent>

        <TabsContent value="notifications">
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>Fonctionnement</CardTitle>
              <CardDescription>Alertes, contrôle d&apos;accès et numérotation.</CardDescription>
            </CardHeader>
            <CardContent>
              <SettingsForm settings={settings} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
