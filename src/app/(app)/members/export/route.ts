import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/auth/context";
import { sanitizeSearch } from "@/lib/validation";
import { t } from "@/i18n";
import type { MemberRow } from "@/lib/types";

/** Échappe une cellule CSV et neutralise l'injection de formules tableur. */
function cell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Export CSV des membres (permission `members.export`). Les colonnes exportées
 * sont limitées aux données utiles à la gestion (pas de notes internes).
 * Chaque export est journalisé.
 */
export async function GET(request: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return new NextResponse("Non authentifié", { status: 401 });
  if (!ctx.can("members.export")) return new NextResponse("Action non autorisée", { status: 403 });

  const q = sanitizeSearch(request.nextUrl.searchParams.get("q") ?? undefined);
  const status = request.nextUrl.searchParams.get("status");

  let query = ctx.supabase
    .from("member_directory")
    .select("member_code, first_name, last_name, phone, email, birth_date, gender, registered_on, membership_status, membership_end_date, coach_name")
    .eq("organization_id", ctx.org.id)
    .order("last_name")
    .limit(10_000);
  if (q) query = query.or(`first_name.ilike.*${q}*,last_name.ilike.*${q}*,member_code.ilike.*${q}*,phone.ilike.*${q}*`);
  if (status) query = query.eq("membership_status", status);

  const { data, error } = await query;
  if (error) return new NextResponse("Export impossible", { status: 500 });
  const rows = (data ?? []) as Partial<MemberRow>[];

  await ctx.supabase.rpc("log_member_export", { p_org: ctx.org.id, p_count: rows.length, p_filters: { q, status } });
  const header = ["N° membre", "Prénom", "Nom", "Téléphone", "Email", "Naissance", "Genre", "Inscription", "Statut", "Fin abonnement", "Coach"];
  const lines = rows.map((m) =>
    [
      m.member_code, m.first_name, m.last_name, m.phone, m.email, m.birth_date,
      m.gender ? t.gender[m.gender] : "", m.registered_on,
      m.membership_status ? t.membershipStatus[m.membership_status] : "", m.membership_end_date, m.coach_name,
    ].map(cell).join(";"),
  );
  // BOM UTF-8 + séparateur « ; » : ouverture directe dans Excel (paramètres FR).
  const csv = `﻿${header.map(cell).join(";")}\r\n${lines.join("\r\n")}`;
  const date = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="membres-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
