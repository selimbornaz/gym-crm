"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney, formatMoneyCompact } from "@/lib/format";

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const monthLabel = (key: string) => MONTHS[Number(key.slice(5, 7)) - 1] ?? key;
const monthLong = (key: string) => `${monthLabel(key)} ${key.slice(0, 4)}`;

const axis = { tickLine: false, axisLine: false, tick: { fill: "var(--muted-foreground)", fontSize: 12 } } as const;
const grid = { stroke: "var(--chart-grid)", vertical: false } as const;

function Tip({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium capitalize">{title}</p>
      {rows.map(([k, v]) => (
        <p key={k} className="flex justify-between gap-4"><span className="text-muted-foreground">{k}</span><span className="font-medium tabular-nums">{v}</span></p>
      ))}
    </div>
  );
}

/** Membres actifs en fin de mois (série unique). */
export function ActiveMembersChart({ data }: { data: Array<{ month: string; active_members: number; new_members: number }> }) {
  return (
    <div className="h-56" role="img" aria-label="Évolution des membres actifs sur 12 mois">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="active-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...grid} />
          <XAxis dataKey="month" tickFormatter={monthLabel} {...axis} />
          <YAxis allowDecimals={false} {...axis} />
          <Tooltip
            cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
              return active && p ? <Tip title={monthLong(p.month)} rows={[["Membres actifs", String(p.active_members)], ["Nouvelles inscriptions", String(p.new_members)]]} /> : null;
            }}
          />
          <Area type="monotone" dataKey="active_members" stroke="var(--chart-1)" strokeWidth={2} fill="url(#active-fill)" activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Nouvelles inscriptions par mois. */
export function NewMembersChart({ data }: { data: Array<{ month: string; new_members: number }> }) {
  return (
    <div className="h-56" role="img" aria-label="Nouvelles inscriptions par mois">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid {...grid} />
          <XAxis dataKey="month" tickFormatter={monthLabel} {...axis} />
          <YAxis allowDecimals={false} {...axis} />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
              return active && p ? <Tip title={monthLong(p.month)} rows={[["Inscriptions", String(p.new_members)]]} /> : null;
            }}
          />
          <Bar dataKey="new_members" fill="var(--chart-3)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Encaissements nets mensuels (paiements - remboursements). */
export function RevenueChart({ data }: { data: Array<{ month: string; net: number }> }) {
  return (
    <div className="h-56" role="img" aria-label="Encaissements nets par mois sur 12 mois">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid {...grid} />
          <XAxis dataKey="month" tickFormatter={monthLabel} {...axis} />
          <YAxis tickFormatter={(v: number) => formatMoneyCompact(v)} width={72} {...axis} />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
              return active && p ? <Tip title={monthLong(p.month)} rows={[["Encaissé net", formatMoney(p.net)]]} /> : null;
            }}
          />
          <Bar dataKey="net" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
