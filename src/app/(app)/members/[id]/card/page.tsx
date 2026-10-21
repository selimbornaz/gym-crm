import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { PrintButton } from "@/components/app/print-button";
import { requirePagePermission } from "@/lib/auth/context";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Carte membre" };

/**
 * Carte membre imprimable. Le QR code encode UNIQUEMENT le numéro de membre
 * (aucune donnée personnelle) ; le scan à l'accueil le résout côté serveur.
 */
export default async function MemberCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePagePermission("members.read_all", "members.read_assigned");
  const { data: member } = await ctx.supabase
    .from("members")
    .select("member_code, first_name, last_name, registered_on")
    .eq("organization_id", ctx.org.id)
    .eq("id", id)
    .maybeSingle();
  if (!member) notFound();

  const qrSvg = await QRCode.toString(member.member_code, { type: "svg", margin: 1, errorCorrectionLevel: "M" });

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="no-print">
        <PrintButton />
      </div>
      <div className="flex w-[340px] items-center gap-4 rounded-2xl border-2 bg-white p-5 text-black shadow-sm">
        <div className="size-28 shrink-0" dangerouslySetInnerHTML={{ __html: qrSvg }} aria-label={`QR code ${member.member_code}`} role="img" />
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-zinc-500">{ctx.org.name}</p>
          <p className="mt-1 text-lg font-semibold leading-tight">
            {member.first_name} {member.last_name}
          </p>
          <p className="mt-1 font-mono text-sm">{member.member_code}</p>
          <p className="mt-2 text-xs text-zinc-500">Membre depuis le {formatDate(member.registered_on)}</p>
        </div>
      </div>
    </div>
  );
}
