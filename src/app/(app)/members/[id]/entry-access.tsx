"use client";

import { useEffect, useState, useTransition } from "react";
import { Download, KeyRound, Loader2, RefreshCw, Share2 } from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { regenerateCheckinPin } from "../actions";

interface Props {
  memberId: string;
  name: string;
  memberCode: string;
  pin: string | null;
  canRegenerate: boolean;
}

/**
 * Accès à la salle : code d'entrée à 4 chiffres et image du QR code à envoyer
 * au membre (il la garde dans les photos de son téléphone et la présente à
 * l'accueil). Le QR contient le n° de membre, comme la carte imprimée.
 */
export function EntryAccessCard({ memberId, name, memberCode, pin, canRegenerate }: Props) {
  const [regenerating, startRegenerate] = useTransition();
  const [building, setBuilding] = useState(false);
  // Partage de fichiers (téléphones surtout) : détecté après le rendu serveur.
  const [canShareFiles, setCanShareFiles] = useState(false);
  useEffect(() => setCanShareFiles(typeof navigator.canShare === "function"), []);

  async function exportImage(share: boolean) {
    setBuilding(true);
    try {
      const blob = await buildPassImage({ name, memberCode, pin });
      const file = new File([blob], `${memberCode}-dopamine-fitness.png`, { type: "image/png" });
      if (share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Mon QR code Dopamine Fitness" });
      } else {
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement("a"), { href: url, download: file.name });
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") toast.error("Impossible de créer l'image du QR code.");
    } finally {
      setBuilding(false);
    }
  }

  return (
    <Card className="h-fit overflow-hidden">
      <span aria-hidden className="bg-brand-metal absolute inset-x-0 top-0 h-[3px]" />
      <div className="flex items-center justify-between px-5 pb-1 pt-4">
        <span className="flex items-center gap-2 text-eyebrow">
          <KeyRound className="size-3.5 text-brand" strokeWidth={1.75} aria-hidden /> Accès à la salle
        </span>
        {canRegenerate && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            disabled={regenerating}
            onClick={() => {
              if (!confirm("Créer un nouveau code ? L'ancien ne fonctionnera plus.")) return;
              startRegenerate(async () => {
                const r = await regenerateCheckinPin(memberId);
                if (r.error) toast.error(r.error);
                else toast.success(r.message);
              });
            }}
          >
            {regenerating ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />} Nouveau code
          </Button>
        )}
      </div>
      <div className="px-5 pb-4">
        <p className="text-[12px] text-muted-foreground">Code d&apos;entrée à donner à l&apos;accueil</p>
        <p className="font-display mt-1 text-[52px] leading-none tracking-[0.18em] text-brand" aria-label={pin ? `Code ${pin.split("").join(" ")}` : "Aucun code"}>
          {pin ?? "––––"}
        </p>
      </div>
      <div className="flex flex-wrap gap-2 border-t px-5 py-3">
        <Button size="sm" variant="outline" disabled={building} onClick={() => exportImage(false)}>
          {building ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />} Image du QR code
        </Button>
        {canShareFiles && (
          <Button size="sm" variant="outline" disabled={building} onClick={() => exportImage(true)}>
            <Share2 aria-hidden /> Partager
          </Button>
        )}
      </div>
    </Card>
  );
}

/** Lit la famille réelle d'une police next/font (variable CSS posée sur <html>). */
function fontFamily(variable: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return value || fallback;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Image 1080 × 1350 (format portrait de téléphone) : logo, QR code, nom, codes. */
async function buildPassImage({ name, memberCode, pin }: { name: string; memberCode: string; pin: string | null }) {
  await document.fonts.ready;
  const display = fontFamily("--font-bebas", "Impact, sans-serif");
  const body = fontFamily("--font-barlow", "Segoe UI, sans-serif");
  const W = 1080;
  const H = 1350;
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = canvas.getContext("2d")!;

  // Fond noir avec halo orange sous le QR code ; le haut reste noir pur pour que
  // le fond du logo s'y fonde sans cadre visible.
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 730, 40, W / 2, 730, 400);
  glow.addColorStop(0, "rgba(255,106,0,0.22)");
  glow.addColorStop(1, "rgba(255,106,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Logo officiel, sans retouche (fond noir identique).
  const logo = await loadImage("/brand/dopamine-fitness.webp");
  ctx.drawImage(logo, (W - 300) / 2, 30, 300, 300);

  // QR code sur carte blanche (contraste maximal pour la caméra de l'accueil).
  const qr = document.createElement("canvas");
  await QRCode.toCanvas(qr, memberCode, { width: 520, margin: 2, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
  ctx.fillStyle = "#fff";
  roundRect(ctx, (W - 600) / 2, 360, 600, 600, 36);
  ctx.fill();
  ctx.drawImage(qr, (W - 520) / 2, 400, 520, 520);

  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  ctx.font = `600 52px ${body}`;
  ctx.fillText(name, W / 2, 1040, W - 120);
  ctx.fillStyle = "#b8b8b8";
  ctx.font = `500 34px ${body}`;
  ctx.fillText(memberCode, W / 2, 1090);

  if (pin) {
    ctx.fillStyle = "#8f8f8f";
    ctx.font = `600 28px ${body}`;
    ctx.fillText("CODE D'ENTRÉE", W / 2, 1170);
    const metal = ctx.createLinearGradient(0, 1180, 0, 1280);
    metal.addColorStop(0, "#ffa240");
    metal.addColorStop(1, "#ff5a00");
    ctx.fillStyle = metal;
    ctx.font = `110px ${display}`;
    ctx.fillText(pin.split("").join(" "), W / 2, 1280);
  }

  ctx.fillStyle = "#8f8f8f";
  ctx.font = `500 26px ${body}`;
  ctx.fillText("Présentez ce QR code à l'accueil", W / 2, H - 28);

  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
