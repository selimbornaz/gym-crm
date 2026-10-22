"use client";

import { useId } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney, formatMoneyCompact } from "@/lib/format";

export type SeriesKind = "money" | "count";
export interface Point {
  label: string; // libellé lisible (« 21/10 », « oct. 2026 »)
  value: number;
}

const fmt = (kind: SeriesKind, v: number) => (kind === "money" ? formatMoney(v) : v.toLocaleString("fr-FR"));

/** Infobulle commune : verre dépoli, chiffres tabulaires, texte en encre neutre. */
function GlassTip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-popover/90 px-2.5 py-1.5 text-[11px] shadow-float backdrop-blur-xl">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

/**
 * Sparkline lisse : une seule série, sans axes, dégradé très léger sous la
 * courbe ; survol = réticule + valeur (les graphiques restent interactifs).
 */
export function Sparkline({
  data,
  kind,
  color = "var(--chart-1)",
  height = 44,
  label,
}: {
  data: Point[];
  kind: SeriesKind;
  color?: string;
  height?: number;
  label: string;
}) {
  const id = useId().replace(/:/g, "");
  return (
    <div style={{ height }} className="-mx-1" role="img" aria-label={label}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip
            cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as Point | undefined;
              return active && p ? <GlassTip label={p.label} value={fmt(kind, p.value)} /> : null;
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.75}
            fill={`url(#spark-${id})`}
            dot={false}
            activeDot={{ r: 3.5, strokeWidth: 2, stroke: "var(--card)", fill: color }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Grande courbe de la carte « héros » (encaissements quotidiens ou membres actifs). */
export function HeroArea({ data, kind, label }: { data: Point[]; kind: SeriesKind; label: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <div className="h-52" role="img" aria-label={label}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id={`hero-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.24} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={36}
            tick={{ fill: "var(--subtle-foreground)", fontSize: 11 }}
          />
          <YAxis
            width={kind === "money" ? 56 : 32}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            tickFormatter={(v: number) => (kind === "money" ? formatMoneyCompact(v) : String(v))}
            tick={{ fill: "var(--subtle-foreground)", fontSize: 11 }}
          />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)", strokeWidth: 1, strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as Point | undefined;
              return active && p ? <GlassTip label={p.label} value={fmt(kind, p.value)} /> : null;
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill={`url(#hero-${id})`}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)", fill: "var(--chart-1)" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Barres mensuelles fines (12 mois), extrémités arrondies ancrées à la base. */
export function MonthlyBars({ data, kind, label }: { data: Point[]; kind: SeriesKind; label: string }) {
  return (
    <div className="h-48" role="img" aria-label={label}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barCategoryGap="28%">
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--subtle-foreground)", fontSize: 11 }} />
          <YAxis
            width={kind === "money" ? 56 : 28}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            tickFormatter={(v: number) => (kind === "money" ? formatMoneyCompact(v) : String(v))}
            tick={{ fill: "var(--subtle-foreground)", fontSize: 11 }}
          />
          <Tooltip
            cursor={{ fill: "var(--accent)", opacity: 0.5, radius: 6 }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as Point | undefined;
              return active && p ? <GlassTip label={p.label} value={fmt(kind, p.value)} /> : null;
            }}
          />
          <Bar dataKey="value" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
