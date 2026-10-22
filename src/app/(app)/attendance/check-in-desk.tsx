"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock3, Loader2, ScanLine, Search, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { MembershipBadge } from "@/components/app/status-badge";
import { InitialsAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { checkInMember, searchForCheckIn, type CheckInCandidate, type CheckInOutcome } from "./actions";

/**
 * Poste d'accueil : saisie/scan du n° membre (douchette USB = clavier + Entrée,
 * ou caméra si le navigateur supporte BarcodeDetector) et recherche instantanée.
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

  // Après un passage, retour sur le champ de scan pour le membre suivant.
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
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <Card className="p-5">
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const code = codeInput.current?.value.trim();
            if (code) submit({ member_code: code, method: "member_code" });
            if (codeInput.current) codeInput.current.value = "";
          }}
        >
          <Label htmlFor="member_code" className="text-eyebrow">N° membre ou QR code</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <ScanLine className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-subtle-foreground" strokeWidth={1.5} aria-hidden />
              <Input
                id="member_code"
                ref={codeInput}
                placeholder="Scannez une carte ou tapez M-000123"
                autoComplete="off"
                autoFocus
                className="h-12 pl-11 pr-14 font-mono text-[15px] tracking-[0.02em]"
              />
              <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border bg-secondary px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted-foreground">
                Entrée
              </kbd>
            </div>
            <CameraScanner onCode={(code) => submit({ member_code: code, method: "qr" })} />
          </div>
        </form>

        <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-[0.08em] text-subtle-foreground">
          <span className="h-px flex-1 bg-border" /> ou <span className="h-px flex-1 bg-border" />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="search" className="text-eyebrow">Rechercher un membre</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" strokeWidth={1.75} aria-hidden />
            <Input id="search" type="search" placeholder="Nom, prénom ou téléphone" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" className="pl-9" />
          </div>
          <ul className="mt-1 grid gap-0.5" aria-live="polite">
            {searching && (
              <li className="flex items-center gap-2 px-2 py-2 text-[13px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Recherche…
              </li>
            )}
            {results.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => submit({ member_id: m.id, method: "search" })}
                  className="group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-all duration-300 ease-out hover:bg-accent/60 disabled:opacity-60"
                >
                  <InitialsAvatar name={m.full_name} className="size-8 text-[10px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{m.full_name}</span>
                    <span className="block font-mono text-[11px] text-subtle-foreground">{m.member_code} · {m.phone ?? "—"}</span>
                  </span>
                  <MembershipBadge status={m.membership_status} />
                </button>
              </li>
            ))}
            {!searching && query.trim().length >= 2 && results.length === 0 && (
              <li className="px-2 py-2 text-[13px] text-muted-foreground">Aucun membre trouvé.</li>
            )}
          </ul>
        </div>
      </Card>

      <div aria-live="assertive" className="min-h-72">
        {pending && (
          <Card className="flex h-full min-h-72 items-center justify-center gap-3 text-[13px] text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-hidden /> Vérification de l&apos;accès…
          </Card>
        )}
        {!pending && state.error && (
          <Card className="flex h-full min-h-72 items-center justify-center p-6 text-center text-[13px] text-red-600 dark:text-red-400">{state.error}</Card>
        )}
        {!pending && outcome && (
          <Verdict
            outcome={outcome}
            onOverride={(reason) => submit({ member_id: outcome.member.id, method: "manual", override_reason: reason })}
            overrideOpen={overrideFor === outcome.member.id}
            setOverrideOpen={(open) => setOverrideFor(open ? outcome.member.id : null)}
          />
        )}
        {!pending && !outcome && !state.error && (
          <div className="flex h-full min-h-72 flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl border bg-card shadow-card">
              <ScanLine className="size-5 text-subtle-foreground" strokeWidth={1.5} aria-hidden />
            </span>
            <p className="text-[13px] font-medium">Prêt à scanner</p>
            <p className="max-w-64 text-[12px] text-muted-foreground">Scannez une carte membre ou recherchez un nom pour enregistrer l&apos;entrée.</p>
          </div>
        )}
      </div>
    </div>
  );
}

const TONES = {
  success: { ring: "ring-emerald-500/25", band: "from-emerald-500/[0.10]", icon: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/25 dark:text-emerald-400", text: "text-emerald-700 dark:text-emerald-400" },
  warning: { ring: "ring-amber-500/25", band: "from-amber-500/[0.10]", icon: "bg-amber-500/10 text-amber-600 ring-amber-500/25 dark:text-amber-400", text: "text-amber-700 dark:text-amber-400" },
  info: { ring: "ring-indigo-500/25", band: "from-indigo-500/[0.10]", icon: "bg-indigo-500/10 text-indigo-600 ring-indigo-500/25 dark:text-indigo-300", text: "text-indigo-700 dark:text-indigo-300" },
  danger: { ring: "ring-red-500/25", band: "from-red-500/[0.10]", icon: "bg-red-500/10 text-red-600 ring-red-500/25 dark:text-red-400", text: "text-red-700 dark:text-red-400" },
} as const;

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
  const s = TONES[tone];
  const Icon = outcome.result === "granted" ? CheckCircle2 : outcome.result === "duplicate" ? Clock3 : XCircle;
  const title = outcome.result === "granted" ? "Accès autorisé" : outcome.result === "duplicate" ? "Déjà enregistré" : "Accès refusé";

  return (
    <Card className={cn("h-full overflow-hidden ring-1", s.ring)}>
      <div aria-hidden className={cn("pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b to-transparent", s.band)} />
      <div className="relative grid gap-5 p-6">
        <div className="flex items-center gap-4">
          <span className={cn("flex size-12 items-center justify-center rounded-2xl ring-1 ring-inset", s.icon)}>
            <Icon className="size-6" strokeWidth={1.75} aria-hidden />
          </span>
          <div>
            <p className={cn("text-[20px] font-semibold leading-tight tracking-[-0.02em]", s.text)}>{title}</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{outcome.message}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border bg-background/60 p-3">
          <InitialsAvatar name={outcome.member.name} className="size-10 text-xs" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-medium tracking-[-0.01em]">{outcome.member.name}</p>
            <p className="font-mono text-[11px] text-subtle-foreground">{outcome.member.code}</p>
          </div>
          <a
            href={`/members/${outcome.member.id}`}
            className="rounded-md px-2 py-1 text-[12px] font-medium text-muted-foreground transition-all duration-300 ease-out hover:bg-accent hover:text-foreground"
          >
            Fiche →
          </a>
        </div>

        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-eyebrow">Formule</dt>
            <dd className="mt-1.5 text-[13px] font-medium">{outcome.membership.plan ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-eyebrow">Valable jusqu&apos;au</dt>
            <dd className="mt-1.5 text-[13px] font-medium tabular-nums">{formatDate(outcome.membership.end_date)}</dd>
          </div>
        </dl>

        {outcome.membership.access_restrictions && (
          <p className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-400">
            <ShieldAlert className="size-4 shrink-0" strokeWidth={1.75} aria-hidden /> {outcome.membership.access_restrictions}
          </p>
        )}

        {outcome.result === "denied" && outcome.can_override &&
          (overrideOpen ? (
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
            <Button variant="outline" className="justify-self-start" onClick={() => setOverrideOpen(true)}>
              <ShieldCheck aria-hidden /> Autoriser exceptionnellement…
            </Button>
          ))}
      </div>
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
      <Button type="button" variant="outline" size="icon" className="size-12" onClick={() => setOpen((o) => !o)} aria-label="Scanner avec la caméra">
        <ScanLine />
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-zinc-950/80 p-4 backdrop-blur-sm" role="dialog" aria-label="Scan QR">
          <video ref={video} className="w-full max-w-sm rounded-2xl ring-1 ring-white/10" muted playsInline />
          <Button variant="secondary" onClick={() => setOpen(false)}>Fermer</Button>
        </div>
      )}
    </>
  );
}
