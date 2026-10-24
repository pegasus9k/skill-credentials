"use client";

import React, { useState } from "react";
import type { BadgeRow } from "../_lib/api";

export const Field = ({
  label,
  hint,
  children,
  full,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  full?: boolean;
}) => (
  <label className="flex flex-col gap-1.5" style={{ gridColumn: full ? "1 / -1" : undefined }}>
    <span
      className="mono flex items-baseline justify-between"
      style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--fg-mute)" }}
    >
      <span>{label}</span>
      {hint && <span style={{ color: "var(--fg-faint)", textTransform: "none", letterSpacing: "0.04em" }}>{hint}</span>}
    </span>
    {children}
  </label>
);

export const KInput = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} className={`k-input ${props.className || ""}`} />
);

export const KSelect = (props: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select
    {...props}
    className={`k-input ${props.className || ""}`}
    style={{ cursor: "pointer", ...(props.style || {}) }}
  />
);

export const KTextarea = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea
    {...props}
    className={`k-input ${props.className || ""}`}
    style={{
      fontFamily: "var(--font-ui)",
      fontSize: 13,
      lineHeight: 1.4,
      resize: "vertical",
      minHeight: 64,
      ...(props.style || {}),
    }}
  />
);

/** Multi-skill chip selector with per-skill points (1-5).
 *  Mirrors the on-chain skillIds[]/points[] arrays. */
export function SkillMatrix({
  skills,
  value,
  onChange,
  max = 4,
}: {
  skills: { label: string; description: string }[];
  value: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
  max?: number;
}) {
  const toggle = (k: string) => {
    const next = { ...value };
    if (k in next) delete next[k];
    else if (Object.keys(next).length < max) next[k] = 3;
    onChange(next);
  };
  const setPts = (k: string, p: number) => onChange({ ...value, [k]: p });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {skills.map(s => {
          const on = s.label in value;
          return (
            <button
              key={s.label}
              type="button"
              title={s.description}
              onClick={() => toggle(s.label)}
              className="mono"
              style={{
                padding: "4px 9px",
                fontSize: 10.5,
                letterSpacing: "0.1em",
                border: `1px solid ${on ? "var(--accent)" : "var(--rule)"}`,
                background: on ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "transparent",
                color: on ? "var(--accent)" : "var(--fg-mute)",
                borderRadius: 2,
                cursor: "pointer",
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>
      {Object.keys(value).length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "70px 1fr 28px",
            columnGap: 10,
            rowGap: 6,
            padding: "8px 10px",
            border: "1px dashed var(--rule)",
            borderRadius: 2,
            background: "color-mix(in srgb, var(--ink-2) 60%, transparent)",
          }}
        >
          {Object.entries(value).map(([k, p]) => (
            <React.Fragment key={k}>
              <span
                className="mono self-center"
                style={{ fontSize: 10.5, color: "var(--fg-dim)", letterSpacing: "0.1em" }}
              >
                {k}
              </span>
              <input type="range" min="1" max="10" value={p} onChange={e => setPts(k, +e.target.value)} />
              <span className="mono self-center text-right" style={{ fontSize: 11, color: "var(--accent)" }}>
                {p}
              </span>
            </React.Fragment>
          ))}
        </div>
      )}
      <span className="mono" style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.06em" }}>
        {Object.keys(value).length}/{max} skill{max > 1 ? "s" : ""} selected
      </span>
    </div>
  );
}

/** Course-budget progress bar — used + projected (this draft) vs 60-pt cap. */
export function BudgetBar({ used, projected, budget }: { used: number; projected: number; budget: number }) {
  const usedPct = Math.min(100, (used / budget) * 100);
  const projPct = Math.min(100, (projected / budget) * 100);
  const over = projected > budget;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2.5 mb-1.5">
        <span className="mono" style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--fg-mute)" }}>
          COURSE BUDGET · {budget} PTS
        </span>
        <span
          className="mono"
          style={{
            fontSize: 11.5,
            letterSpacing: "0.06em",
            color: over ? "var(--magenta)" : projected === used ? "var(--fg-dim)" : "var(--accent)",
          }}
        >
          {used}
          <span style={{ color: "var(--fg-faint)" }}>{projected !== used ? ` + ${projected - used}` : ""}</span>
          <span style={{ color: "var(--fg-faint)" }}> / {budget}</span>
          {over && <span style={{ marginLeft: 8 }}>· OVER {projected - budget}</span>}
        </span>
      </div>
      <div
        style={{
          height: 8,
          background: "var(--ink-2)",
          border: "1px solid var(--rule)",
          borderRadius: 2,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${usedPct}%`,
            background: "color-mix(in srgb, var(--accent) 65%, transparent)",
          }}
        />
        {projected > used && (
          <div
            style={{
              position: "absolute",
              left: `${usedPct}%`,
              top: 0,
              bottom: 0,
              width: `${Math.max(0, projPct - usedPct)}%`,
              background: over
                ? "repeating-linear-gradient(45deg, var(--magenta), var(--magenta) 4px, color-mix(in srgb, var(--magenta) 60%, transparent) 4px, color-mix(in srgb, var(--magenta) 60%, transparent) 8px)"
                : "repeating-linear-gradient(45deg, var(--accent), var(--accent) 4px, color-mix(in srgb, var(--accent) 50%, transparent) 4px, color-mix(in srgb, var(--accent) 50%, transparent) 8px)",
            }}
          />
        )}
      </div>
    </div>
  );
}

export function StepDots({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => {
        const done = i < step;
        const cur = i === step;
        return (
          <span
            key={i}
            style={{
              width: cur ? 22 : 6,
              height: 6,
              borderRadius: 3,
              background: done || cur ? "var(--accent)" : "var(--rule)",
              transition: "width .25s, background .25s",
              display: "inline-block",
            }}
          />
        );
      })}
    </div>
  );
}

/** Sidebar for Step 4 — course budget card + accordion of existing badges. */
export function ExistingBadgesPanel({
  badges,
  courseId,
  used,
  projected,
  draftPts,
  budget,
  editingTokenId = null,
}: {
  badges: BadgeRow[];
  courseId: string;
  used: number;
  projected: number;
  draftPts: number;
  budget: number;
  editingTokenId?: number | null;
}) {
  const [openId, setOpenId] = useState<number | null>(badges[0]?.token_id ?? null);
  const totalPts = badges.reduce((s, b) => s + b.skills.reduce((a, sk) => a + sk.points, 0), 0);

  // In edit mode, derive the old point sum for the badge under edit so the
  // caption can say "WAS X, NOW Y" instead of the misleading "ADDS Y".
  const editingBadge = editingTokenId != null ? badges.find(b => b.token_id === editingTokenId) : null;
  const editingOldPts = editingBadge ? editingBadge.skills.reduce((s, sk) => s + sk.points, 0) : 0;
  const netDelta = editingBadge ? draftPts - editingOldPts : 0;

  if (badges.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <aside
          style={{
            border: "1px solid var(--rule)",
            borderRadius: 3,
            background: "var(--ink-2)",
            padding: "14px 16px",
          }}
        >
          <div className="mono mb-2.5" style={{ fontSize: 10.5, letterSpacing: "0.12em", color: "var(--fg-mute)" }}>
            COURSE BUDGET · {courseId}
          </div>
          <BudgetBar used={used} projected={projected} budget={budget} />
          <div className="mono mt-2" style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.06em" }}>
            THIS DRAFT ADDS {draftPts} PT{draftPts === 1 ? "" : "S"}
          </div>
        </aside>
        <aside
          style={{
            border: "1px dashed var(--rule)",
            borderRadius: 3,
            padding: "18px 14px",
            background: "color-mix(in srgb, var(--ink-2) 30%, transparent)",
          }}
        >
          <div
            className="mono text-center"
            style={{ fontSize: 10.5, letterSpacing: "0.08em", color: "var(--fg-faint)" }}
          >
            NO EXISTING BADGES — THIS WILL BE THE FIRST
          </div>
        </aside>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 sticky top-0">
      <aside
        style={{
          border: "1px solid var(--rule)",
          borderRadius: 3,
          background: "var(--ink-2)",
          padding: "14px 16px",
        }}
      >
        <div className="flex items-baseline justify-between gap-2 mb-2.5">
          <div className="mono" style={{ fontSize: 10.5, letterSpacing: "0.12em", color: "var(--fg-mute)" }}>
            COURSE BUDGET · {courseId}
          </div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: "0.06em", color: "var(--fg-faint)" }}>
            {used} / {budget}
          </div>
        </div>
        <BudgetBar used={used} projected={projected} budget={budget} />
        <div className="mono mt-2" style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.06em" }}>
          {editingBadge ? (
            <>
              {badges.length - 1} OTHER · EDITING #{editingTokenId}: WAS {editingOldPts}, NOW {draftPts} PT
              {draftPts === 1 ? "" : "S"}
              {netDelta !== 0 && (
                <span style={{ marginLeft: 6, color: netDelta > 0 ? "var(--accent)" : "var(--green)" }}>
                  ({netDelta > 0 ? "+" : ""}
                  {netDelta} NET)
                </span>
              )}
            </>
          ) : (
            <>
              {badges.length} EXISTING · THIS DRAFT ADDS {draftPts} PT{draftPts === 1 ? "" : "S"}
            </>
          )}
        </div>
      </aside>

      <aside
        style={{
          border: "1px solid var(--rule)",
          borderRadius: 3,
          background: "var(--ink-2)",
          overflow: "hidden",
        }}
      >
        <div
          className="flex items-baseline justify-between gap-2"
          style={{ padding: "10px 16px", borderBottom: "1px solid var(--rule-soft)" }}
        >
          <div className="mono" style={{ fontSize: 10.5, letterSpacing: "0.12em", color: "var(--fg-mute)" }}>
            EXISTING BADGES
          </div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--accent)" }}>
            {badges.length} · {totalPts}PT
          </div>
        </div>

        <div style={{ maxHeight: 480, overflowY: "auto" }}>
          {badges.map(b => {
            const skills = b.skills;
            const pts = skills.reduce((s, sk) => s + sk.points, 0);
            const isOpen = openId === b.token_id;
            const isEditingRow = editingTokenId === b.token_id;
            const evCode = b.week != null ? `W${b.week}` : b.evaluation_type || "—";
            return (
              <div key={b.token_id} style={{ borderBottom: "1px solid var(--rule-soft)" }}>
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : b.token_id)}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    display: "block",
                    width: "100%",
                    padding: "10px 16px",
                    background: isEditingRow
                      ? "color-mix(in srgb, var(--cyan) 8%, transparent)"
                      : isOpen
                        ? "color-mix(in srgb, var(--accent) 8%, transparent)"
                        : "transparent",
                    borderLeft: isEditingRow
                      ? "2px solid var(--cyan)"
                      : isOpen
                        ? "2px solid var(--accent)"
                        : "2px solid transparent",
                  }}
                >
                  {isEditingRow && (
                    <div
                      className="mono"
                      style={{
                        fontSize: 9,
                        letterSpacing: "0.12em",
                        color: "var(--cyan)",
                        marginBottom: 4,
                      }}
                    >
                      ✎ EDITING — REPLACED BY DRAFT
                    </div>
                  )}
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="min-w-0 flex flex-col gap-[3px]">
                      <span className="mono" style={{ fontSize: 10, color: "var(--cyan)", letterSpacing: "0.08em" }}>
                        {evCode}
                      </span>
                      <span
                        className="mono truncate"
                        style={{ fontSize: 11, color: "var(--fg)", letterSpacing: "0.04em" }}
                      >
                        {b.badge_name || b.badge_code}
                      </span>
                    </div>
                    <span
                      className="mono whitespace-nowrap"
                      style={{ fontSize: 10, color: "var(--accent)", letterSpacing: "0.06em" }}
                    >
                      {pts}PT
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-[3px] mt-1.5">
                    {skills.map((sk, i) => (
                      <span
                        key={sk.skill_id || sk.skill_label || i}
                        className="mono"
                        style={{
                          fontSize: 9,
                          letterSpacing: "0.06em",
                          padding: "1px 5px",
                          border: "1px solid color-mix(in srgb, var(--accent) 35%, var(--rule))",
                          color: "var(--accent)",
                          borderRadius: 2,
                        }}
                      >
                        {sk.skill_label}·{sk.points}
                      </span>
                    ))}
                  </div>
                </button>
                {isOpen && (
                  <div className="flex flex-col gap-2" style={{ padding: "2px 16px 12px" }}>
                    <div className="flex items-baseline gap-2.5">
                      <span className="mono" style={{ fontSize: 9, letterSpacing: "0.1em", color: "var(--fg-faint)" }}>
                        CID
                      </span>
                      <span
                        className="mono truncate flex-1"
                        style={{ fontSize: 10, color: "var(--fg-dim)", letterSpacing: "0.04em" }}
                      >
                        {b.metadata_cid || "—"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
