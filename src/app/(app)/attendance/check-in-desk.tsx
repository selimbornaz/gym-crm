"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, CheckCircle2, Clock3, Loader2, ScanLine, Search, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
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
  const [cameraSupported, setCameraSupported] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const outcome = state.data as CheckInOutcome | undefined;

  useEffect(() => {
    setCameraSupported(!!navigator.mediaDevices?.getUserMedia);
  }, []);

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
          <Label htmlFor="member_code" className="text-eyebrow">Code à 4 chiffres, n° membre ou QR code</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <ScanLine className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-subtle-foreground" strokeWidth={1.5} aria-hidden />
              <Input
                id="member_code"
                ref={codeInput}
                placeholder="Code (ex. 7392), M-000123 ou scan"
                autoComplete="off"
                autoFocus
                className="h-12 pl-11 pr-14 font-mono text-[15px] tracking-[0.02em]"
                onChange={(e) => {
                  // Code d'entrée complet : envoyé aussitôt, sans appuyer sur Entrée.
                  const value = e.currentTarget.value.trim();
                  if (/^\d{4}$/.test(value)) {
                    submit({ member_code: value, method: "pin" });
                    e.currentTarget.value = "";
                  }
                }}
              />
              <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border bg-secondary px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted-foreground">
                Entrée
              </kbd>
            </div>
            {cameraSupported && (
              <Button
                type="button"
                variant={cameraOn ? "default" : "outline"}
                size="icon"
                className="size-12"
                onClick={() => setCameraOn((on) => !on)}
                aria-pressed={cameraOn}
                aria-label={cameraOn ? "Arrêter la caméra" : "Scanner avec la caméra"}
              >
                {cameraOn ? <CameraOff /> : <Camera />}
              </Button>
            )}
          </div>
        </form>

        {cameraOn && (
          <CameraScanner
            onCode={(code) => submit({ member_code: code, method: "qr" })}
            onClose={() => setCameraOn(false)}
          />
        )}

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
            <p className="max-w-64 text-[12px] text-muted-foreground">Tapez le code à 4 chiffres, scannez le QR code du membre ou recherchez son nom.</p>
          </div>
        )}
      </div>
    </div>
  );
}

const TONES = {
  success: { ring: "ring-emerald-500/25", band: "from-emerald-500/[0.10]", icon: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/25 dark:text-emerald-400", text: "text-emerald-700 dark:text-emerald-400" },
  warning: { ring: "ring-amber-500/25", band: "from-amber-500/[0.10]", icon: "bg-amber-500/10 text-amber-600 ring-amber-500/25 dark:text-amber-400", text: "text-amber-700 dark:text-amber-400" },
  info: { ring: "ring-info/25", band: "from-info/[0.10]", icon: "bg-info/10 text-info ring-info/25", text: "text-info" },
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

/** Délai pendant lequel un même QR code n'est pas relu (le membre range son téléphone). */
const SAME_CODE_PAUSE_MS = 6000;
/** Délai minimal entre deux lectures, le temps d'afficher le verdict. */
const BETWEEN_SCANS_MS = 2500;

/**
 * Caméra de l'accueil, en continu : le membre présente le QR code de son
 * téléphone (ou sa carte), l'entrée est envoyée aussitôt, puis la caméra reste
 * prête pour le suivant. Lecture native (BarcodeDetector) quand le navigateur
 * la propose, sinon décodage jsQR (Chrome/Edge sous Windows n'ont pas l'API native).
 */
function CameraScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "ready" | "read" | "error">("starting");
  // Référence stable : le flux caméra ne redémarre pas à chaque rendu du parent.
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    let last = { code: "", at: 0 };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } } });
        const el = video.current;
        if (!el || stopped) return;
        el.srcObject = stream;
        await el.play();
        setStatus("ready");

        const decode = await createDecoder();
        const loop = async () => {
          if (stopped || !video.current) return;
          const code = await decode(video.current).catch(() => null);
          const now = Date.now();
          if (code && now - last.at > BETWEEN_SCANS_MS && !(code === last.code && now - last.at < SAME_CODE_PAUSE_MS)) {
            last = { code, at: now };
            setStatus("read");
            onCodeRef.current(code);
            window.setTimeout(() => !stopped && setStatus("ready"), 1200);
          }
          timer = window.setTimeout(loop, 160);
        };
        loop();
      } catch {
        if (!stopped) setStatus("error");
      }
    })();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="mt-4 grid gap-2">
      <div
        className={cn(
          "relative aspect-video overflow-hidden rounded-xl bg-black ring-2 transition-all duration-300 ease-out",
          status === "read" ? "ring-emerald-500" : "ring-border",
        )}
      >
        <video ref={video} className="size-full object-cover" muted playsInline aria-label="Caméra de l'accueil" />
        <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 size-40 -translate-x-1/2 -translate-y-1/2 rounded-2xl border-2 border-white/70 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]" />
        {status === "starting" && (
          <span className="absolute inset-0 flex items-center justify-center gap-2 text-[13px] text-white/80">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Ouverture de la caméra…
          </span>
        )}
        {status === "error" && (
          <span className="absolute inset-0 flex items-center justify-center p-6 text-center text-[13px] text-white/90">
            Caméra indisponible : autorisez l&apos;accès à la caméra dans le navigateur, ou branchez une webcam.
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] text-muted-foreground" aria-live="polite">
          {status === "read" ? "QR code lu ✓" : "Le membre présente le QR code de son téléphone devant la caméra."}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>Arrêter</Button>
      </div>
    </div>
  );
}

type Decode = (video: HTMLVideoElement) => Promise<string | null>;

async function createDecoder(): Promise<Decode> {
  if ("BarcodeDetector" in window) {
    // @ts-expect-error BarcodeDetector n'est pas encore dans les types DOM standard
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    return async (v) => ((await detector.detect(v)) as Array<{ rawValue: string }>)[0]?.rawValue || null;
  }
  const jsQR = (await import("jsqr")).default;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  return async (v) => {
    if (!context || !v.videoWidth) return null;
    // Image réduite : décodage rapide sans charger le processeur de l'accueil.
    const scale = Math.min(1, 640 / v.videoWidth);
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    context.drawImage(v, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" })?.data || null;
  };
}
