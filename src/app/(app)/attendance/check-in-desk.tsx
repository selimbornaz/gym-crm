"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock3, Loader2, ScanLine, ShieldAlert, XCircle } from "lucide-react";
import { MembershipBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { checkInMember, searchForCheckIn, type CheckInCandidate, type CheckInOutcome } from "./actions";

/**
 * Poste d'accueil : recherche instantanée, saisie/scan du n° membre (douchette
 * USB = clavier + Entrée, ou caméra si le navigateur supporte BarcodeDetector).
 * Le verdict affiché vient du serveur ; l'interface ne décide jamais de l'accès.
 */
export function CheckInDesk({ preselected }: { preselected?: CheckInCandidate | null }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CheckInCandidate[]>(preselected ? [preselected] : []);
  const [searching, setSearching] = useState(false);
  const [state, dispatch, pending] = useActionState(checkInMember, {});
  const [overrideFor, setOverrideFor] = useState<string | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const outcome = state.data as CheckInOutcome | undefined;

  // Recherche avec anti-rebond (300 ms).
  useEffect(() => {
    if (query.trim().length < 2) return;
    const timer = setTimeout(async () => {
      setSearching(true);
      setResults(await searchForCheckIn(query));
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Après un passage, on revient sur le champ de scan pour le membre suivant.
  useEffect(() => {
    if (outcome) codeInput.current?.focus();
  }, [outcome]);

  function submit(fields: Record<string, string>) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    setOverrideFor(null);
    startTransition(() => dispatch(fd));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardContent className="grid gap-5 p-5">
          <form
            className="grid gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const code = codeInput.current?.value.trim();
              if (code) submit({ member_code: code, method: "member_code" });
              if (codeInput.current) codeInput.current.value = "";
            }}
          >
            <Label htmlFor="member_code">N° membre ou scan QR</Label>
            <div className="flex gap-2">
              <Input id="member_code" ref={codeInput} placeholder="Ex. M-000123" autoComplete="off" autoFocus className="font-mono" />
              <Button type="submit" disabled={pending}>Valider</Button>
              <CameraScanner onCode={(code) => submit({ member_code: code, method: "qr" })} />
            </div>
          </form>

          <div className="grid gap-1.5">
            <Label htmlFor="search">Ou rechercher un membre</Label>
            <Input id="search" type="search" placeholder="Nom, prénom ou téléphone" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
            <ul className="mt-1 grid gap-1" aria-live="polite">
              {searching && <li className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Recherche…</li>}
              {results.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => submit({ member_id: m.id, method: "search" })}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2 text-left hover:bg-accent disabled:opacity-60"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{m.full_name}</span>
                      <span className="block text-xs text-muted-foreground">{m.member_code} · {m.phone ?? "—"}</span>
                    </span>
                    <MembershipBadge status={m.membership_status} />
                  </button>
                </li>
              ))}
              {!searching && query.trim().length >= 2 && results.length === 0 && <li className="text-sm text-muted-foreground">Aucun membre trouvé.</li>}
            </ul>
          </div>
        </CardContent>
      </Card>

      <div aria-live="assertive">
        {pending && (
          <Card><CardContent className="flex items-center gap-3 p-6 text-muted-foreground"><Loader2 className="animate-spin" /> Vérification de l&apos;accès…</CardContent></Card>
        )}
        {!pending && state.error && (
          <Card className="border-danger/40"><CardContent className="p-6 text-danger">{state.error}</CardContent></Card>
        )}
        {!pending && outcome && <Verdict outcome={outcome} onOverride={(reason) => submit({ member_id: outcome.member.id, method: "manual", override_reason: reason })} overrideOpen={overrideFor === outcome.member.id} setOverrideOpen={(open) => setOverrideFor(open ? outcome.member.id : null)} />}
        {!pending && !outcome && !state.error && (
          <Card className="h-full border-dashed"><CardContent className="flex h-full min-h-48 items-center justify-center p-6 text-center text-sm text-muted-foreground">Scannez une carte ou recherchez un membre pour enregistrer son entrée.</CardContent></Card>
        )}
      </div>
    </div>
  );
}

// Classes complètes (Tailwind ne détecte pas les noms construits dynamiquement).
const TONE_TEXT = { success: "text-success", warning: "text-warning", info: "text-info", danger: "text-danger" } as const;

function Verdict({
  outcome,
  onOverride,
  overrideOpen,
  setOverrideOpen,
}: {
  outcome: CheckInOutcome;
  onOverride: (reason: string) => void;
  overrideOpen: boolean;
  setOverrideOpen: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const tone = outcome.result === "granted" ? (outcome.overridden ? "warning" : "success") : outcome.result === "duplicate" ? "info" : "danger";
  const Icon = outcome.result === "granted" ? CheckCircle2 : outcome.result === "duplicate" ? Clock3 : XCircle;
  const title = outcome.result === "granted" ? "Accès autorisé" : outcome.result === "duplicate" ? "Déjà enregistré" : "Accès refusé";

  return (
    <Card className={cn("border-2", tone === "success" && "border-success/50", tone === "warning" && "border-warning/50", tone === "info" && "border-info/50", tone === "danger" && "border-danger/50")}>
      <CardContent className="grid gap-4 p-6">
        <div className={cn("flex items-center gap-3 text-xl font-semibold", TONE_TEXT[tone])}>
          <Icon className="size-8" aria-hidden /> {title}
        </div>
        <div>
          <p className="text-lg font-medium">{outcome.member.name}</p>
          <p className="font-mono text-sm text-muted-foreground">{outcome.member.code}</p>
        </div>
        <p className="text-sm">{outcome.message}</p>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div><dt className="text-xs text-muted-foreground">Formule</dt><dd>{outcome.membership.plan ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Valable jusqu&apos;au</dt><dd>{formatDate(outcome.membership.end_date)}</dd></div>
        </dl>
        {outcome.membership.access_restrictions && (
          <p className="flex items-center gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
            <ShieldAlert className="size-4" aria-hidden /> {outcome.membership.access_restrictions}
          </p>
        )}
        <a href={`/members/${outcome.member.id}`} className="text-sm underline">Ouvrir la fiche</a>

        {outcome.result === "denied" && outcome.can_override && (
          overrideOpen ? (
            <form
              className="grid gap-2 border-t pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (reason.trim().length >= 3) onOverride(reason.trim());
              }}
            >
              <Label htmlFor="override_reason">Motif de la dérogation (journalisé)</Label>
              <Textarea id="override_reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. paiement promis demain" />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setOverrideOpen(false)}>Annuler</Button>
                <Button type="submit" variant="destructive" disabled={reason.trim().length < 3}>Autoriser exceptionnellement</Button>
              </div>
            </form>
          ) : (
            <Button variant="outline" onClick={() => setOverrideOpen(true)}>Autoriser exceptionnellement…</Button>
          )
        )}
      </CardContent>
    </Card>
  );
}

/** Scan caméra si l'API BarcodeDetector existe (Chrome/Edge Android, desktop récents). */
function CameraScanner({ onCode }: { onCode: (code: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [open, setOpen] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  // Référence stable : le flux caméra ne redémarre pas à chaque rendu du parent.
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current || stopped) return;
        video.current.srcObject = stream;
        await video.current.play();
        // @ts-expect-error BarcodeDetector n'est pas encore dans les types DOM standard
        const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        const tick = async () => {
          if (stopped || !video.current) return;
          const codes: Array<{ rawValue: string }> = await detector.detect(video.current).catch(() => []);
          if (codes[0]?.rawValue) {
            setOpen(false);
            onCodeRef.current(codes[0].rawValue);
            return;
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setOpen(false);
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open]);

  if (!supported) return null;
  return (
    <>
      <Button type="button" variant="outline" size="icon" onClick={() => setOpen((o) => !o)} aria-label="Scanner avec la caméra">
        <ScanLine />
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/80 p-4" role="dialog" aria-label="Scan QR">
          <video ref={video} className="w-full max-w-sm rounded-xl" muted playsInline />
          <Button variant="secondary" onClick={() => setOpen(false)}>Fermer</Button>
        </div>
      )}
    </>
  );
}
