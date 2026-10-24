"use client";

import React, { useMemo, useState } from "react";
import { keccak256, toHex } from "viem";
import type { NodeApiRow, StudentBadge, StudentCompetency } from "../_lib/api";
import type { Anchor, NodeState } from "./CompetencyGraph";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

// ─── Skill hash → label resolver ─────────────────────────────────────────────
const KNOWN_SKILL_LABELS = [
  "CODE","DATA","ML","DL","OPT","CTR","SIG","PWR","GRID","REN","THERMO","SIM","MATH",
];
const SKILL_HASH_MAP: ReadonlyMap<string, string> = new Map(
  KNOWN_SKILL_LABELS.map(l => [keccak256(toHex(l)), l]),
);
function resolveSkillLabel(skillId: string, rawLabel: string | null): string {
  if (rawLabel && rawLabel !== "UNKNOWN") return rawLabel;
  return SKILL_HASH_MAP.get(skillId) ?? skillId.slice(0, 6) + "…";
}

// ─── Threshold progress bar ───────────────────────────────────────────────────
function ThresholdBar({
  skill,
  current,
  required,
}: {
  skill: string;
  current: number;
  required: number;
}) {
  const pct = Math.min(100, required > 0 ? (current / required) * 100 : 0);
  const met = current >= required;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="mono" style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--fg-mute)" }}>
          {skill}
        </span>
        <span
          className="mono"
          style={{
            fontSize: 11,
            letterSpacing: "0.06em",
            color: met ? "var(--green)" : current > 0 ? "var(--accent)" : "var(--fg-faint)",
          }}
        >
          {current} / {required}
        </span>
      </div>
      <div
        style={{
          height: 5,
          background: "var(--ink-3)",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: met ? "var(--green)" : "var(--accent)",
            transition: "width 0.2s ease",
          }}
        />
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
type Props = {
  node: NodeApiRow;
  nodeState: NodeState;
  allNodes: NodeApiRow[];
  earnedNodeIds: number[];
  studentBadges: StudentBadge[];
  competencies: StudentCompetency[];
  selectedBadgeIds: Set<number>;
  anchor: Anchor;
  onAllocateSuccess: () => void;
  onClose: () => void;
};

// Popup geometry — used both for positioning and viewport clamping.
const POPUP_W = 340;
const POPUP_H_MAX = 480;
const POPUP_MARGIN = 12;
const ANCHOR_OFFSET_X = 28;
const ANCHOR_OFFSET_Y = 30;

export function NodePopup({
  node,
  nodeState,
  allNodes,
  earnedNodeIds,
  studentBadges,
  competencies,
  selectedBadgeIds,
  anchor,
  onAllocateSuccess,
  onClose,
}: Props) {
  const { writeContractAsync, isMining } = useScaffoldWriteContract({ contractName: "SkillGraph" });
  const [waitingForIndexer, setWaitingForIndexer] = useState(false);

  const nodeMap = useMemo(() => new Map(allNodes.map(n => [n.node_id, n])), [allNodes]);
  const earnedSet = useMemo(() => new Set(earnedNodeIds), [earnedNodeIds]);

  // Skill totals from currently-selected badges (live update)
  const skillTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const badge of studentBadges) {
      if (!selectedBadgeIds.has(badge.token_id)) continue;
      for (const skill of badge.skills) {
        totals[skill.skill_label] = (totals[skill.skill_label] || 0) + skill.points;
      }
    }
    return totals;
  }, [studentBadges, selectedBadgeIds]);

  const allThresholdsMet = useMemo(
    () =>
      node.thresholds.length > 0 &&
      node.thresholds.every(t => {
        const label = resolveSkillLabel(t.skill_id, t.skill_label);
        return (skillTotals[label] || 0) >= t.min_points;
      }),
    [node.thresholds, skillTotals],
  );

  const canAllocate = nodeState === "available" && allThresholdsMet && selectedBadgeIds.size > 0;
  const isBusy = isMining || waitingForIndexer;

  const handleAllocate = async () => {
    if (!canAllocate || isBusy) return;
    try {
      await writeContractAsync({
        functionName: "allocateBadges",
        args: [BigInt(node.node_id), Array.from(selectedBadgeIds).map(id => BigInt(id))],
      } as any);
      setWaitingForIndexer(true);
      setTimeout(() => {
        setWaitingForIndexer(false);
        onAllocateSuccess();
      }, 6000);
    } catch {
      // useTransactor already surfaces the toast
    }
  };

  // Resolve the badges that were committed to unlock this node (EARNED mode).
  // The student's `competencies[]` row carries the on-chain badge_ids that
  // were spent on the allocation; we look up each one in studentBadges to get
  // the human-readable name + course + skill chips.
  const earnedBadges = useMemo(() => {
    if (nodeState !== "earned") return [];
    const comp = competencies.find(c => c.node_id === node.node_id);
    if (!comp) return [];
    return comp.badge_ids.map(id => {
      const b = studentBadges.find(sb => sb.token_id === id);
      return {
        tokenId: id,
        name: b?.badge_name ?? `Token #${id}`,
        courseName: b?.course_name ?? null,
        skills: b?.skills ?? [],
      };
    });
  }, [nodeState, node.node_id, competencies, studentBadges]);

  // Missing prerequisite nodes (LOCKED mode)
  const missingPrereqs = useMemo(() => {
    if (nodeState !== "locked") return [];
    return node.prerequisites
      .filter(id => !earnedSet.has(id))
      .map(id => nodeMap.get(id))
      .filter(Boolean) as NodeApiRow[];
  }, [nodeState, node.prerequisites, earnedSet, nodeMap]);

  const nodeName = node.node_name ?? node.node_code;
  const department = node.department;

  // ── State badge pill ───────────────────────────────────────────────────────
  const statePill = {
    earned: { label: "EARNED", color: "var(--green)", bg: "color-mix(in srgb, var(--green) 12%, transparent)" },
    available: { label: "AVAILABLE", color: "var(--accent)", bg: "color-mix(in srgb, var(--accent) 12%, transparent)" },
    locked: { label: "LOCKED", color: "var(--fg-mute)", bg: "color-mix(in srgb, var(--fg-mute) 10%, transparent)" },
  }[nodeState];

  // ── Position: anchor right of the clicked node, clamp to graph panel ──────
  const containerW = typeof window !== "undefined" ? window.innerWidth : 1280;
  const containerH = typeof window !== "undefined" ? window.innerHeight : 800;
  let left = anchor.x + ANCHOR_OFFSET_X;
  let top = anchor.y - ANCHOR_OFFSET_Y;
  // If the popup would overflow right, flip to the left side of the node.
  if (left + POPUP_W > containerW - POPUP_MARGIN) {
    left = anchor.x - ANCHOR_OFFSET_X - POPUP_W;
  }
  if (left < POPUP_MARGIN) left = POPUP_MARGIN;
  if (top + POPUP_H_MAX > containerH - POPUP_MARGIN) {
    top = Math.max(POPUP_MARGIN, containerH - POPUP_H_MAX - POPUP_MARGIN);
  }
  if (top < POPUP_MARGIN) top = POPUP_MARGIN;

  return (
    <div
      style={{
        position: "absolute",
        top,
        left,
        width: POPUP_W,
        background: "var(--ink-1)",
        border: "1px solid var(--rule)",
        borderRadius: 4,
        boxShadow: "0 4px 24px rgba(28,24,16,0.14)",
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        maxHeight: "calc(100% - 32px)",
        overflow: "hidden",
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: "14px 16px 12px",
          borderBottom: "1px solid var(--rule)",
          background: "color-mix(in srgb, var(--ink-2) 60%, transparent)",
        }}
      >
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5">
            <span
              className="mono"
              style={{
                fontSize: 9.5,
                letterSpacing: "0.1em",
                padding: "2px 7px",
                borderRadius: 2,
                border: `1px solid color-mix(in srgb, ${statePill.color} 50%, var(--rule))`,
                color: statePill.color,
                background: statePill.bg,
              }}
            >
              {statePill.label}
            </span>
            {department && (
              <span
                className="mono"
                style={{
                  fontSize: 9.5,
                  letterSpacing: "0.1em",
                  padding: "2px 7px",
                  borderRadius: 2,
                  border: "1px solid var(--rule)",
                  color: "var(--fg-mute)",
                  background: "color-mix(in srgb, var(--ink-2) 60%, transparent)",
                }}
              >
                {department.toUpperCase()}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="k-btn k-btn-ghost"
            style={{ padding: "2px 6px", fontSize: 14, lineHeight: 1 }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <h2
          className="serif"
          style={{ fontSize: 20, fontWeight: 400, letterSpacing: "-0.01em", margin: 0, color: "var(--fg)" }}
        >
          {nodeName}
        </h2>
        <p className="mono" style={{ fontSize: 9.5, letterSpacing: "0.06em", color: "var(--fg-faint)", marginTop: 3 }}>
          {node.node_code}
        </p>
      </div>

      {/* ── Scrollable body ─────────────────────────────────────────────────── */}
      <div style={{ overflowY: "auto", flex: 1, padding: "14px 16px" }}>
        {/* SKILL THRESHOLDS */}
        {node.thresholds.length > 0 && (
          <div className="flex flex-col gap-2.5 mb-4">
            <span
              className="mono"
              style={{ fontSize: 9.5, letterSpacing: "0.12em", color: "var(--fg-mute)" }}
            >
              SKILL THRESHOLDS
            </span>
            {node.thresholds.map(t => {
              const label = resolveSkillLabel(t.skill_id, t.skill_label);
              return (
                <ThresholdBar
                  key={t.skill_id}
                  skill={label}
                  current={nodeState === "locked" ? 0 : (skillTotals[label] ?? 0)}
                  required={t.min_points}
                />
              );
            })}
          </div>
        )}

        {/* ── EARNED mode ──────────────────────────────────────────────── */}
        {nodeState === "earned" && (
          <div className="flex flex-col gap-3">
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 3,
                background: "color-mix(in srgb, var(--green) 10%, transparent)",
                border: "1px solid color-mix(in srgb, var(--green) 30%, var(--rule))",
              }}
            >
              <span
                className="mono"
                style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--green)" }}
              >
                ○ COMPETENCY UNLOCKED
              </span>
            </div>
            {earnedBadges.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span
                  className="mono flex items-baseline justify-between"
                  style={{ fontSize: 9.5, letterSpacing: "0.1em", color: "var(--fg-mute)" }}
                >
                  <span>ALLOCATED BADGES</span>
                  <span style={{ color: "var(--fg-faint)" }}>{earnedBadges.length}</span>
                </span>
                {earnedBadges.map(b => (
                  <div
                    key={b.tokenId}
                    style={{
                      padding: "7px 10px",
                      border: "1px solid var(--rule-soft)",
                      borderRadius: 3,
                      background: "var(--ink-2)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className="mono"
                        style={{
                          fontSize: 11,
                          letterSpacing: "0.04em",
                          color: "var(--fg)",
                          fontWeight: 500,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          minWidth: 0,
                        }}
                      >
                        {b.name}
                      </span>
                      <span
                        className="mono"
                        style={{
                          fontSize: 9,
                          letterSpacing: "0.06em",
                          color: "var(--fg-faint)",
                          flexShrink: 0,
                        }}
                      >
                        #{b.tokenId}
                      </span>
                    </div>
                    {b.courseName && (
                      <span
                        className="mono"
                        style={{
                          fontSize: 9.5,
                          letterSpacing: "0.04em",
                          color: "var(--fg-mute)",
                        }}
                      >
                        {b.courseName}
                      </span>
                    )}
                    {b.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {b.skills.map(sk => (
                          <span
                            key={sk.skill_label}
                            className="mono"
                            style={{
                              fontSize: 9,
                              letterSpacing: "0.06em",
                              padding: "1px 5px",
                              borderRadius: 2,
                              border: "1px solid color-mix(in srgb, var(--green) 35%, var(--rule))",
                              color: "var(--green)",
                              background: "color-mix(in srgb, var(--green) 8%, transparent)",
                            }}
                          >
                            +{sk.points} {sk.skill_label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── AVAILABLE mode ───────────────────────────────────────────── */}
        {nodeState === "available" && (
          <div className="flex flex-col gap-3">
            <div
              style={{
                padding: "8px 10px",
                borderRadius: 3,
                background: "color-mix(in srgb, var(--accent) 8%, transparent)",
                border: "1px dashed color-mix(in srgb, var(--accent) 40%, var(--rule))",
              }}
            >
              <p className="mono" style={{ fontSize: 9.5, letterSpacing: "0.06em", color: "var(--fg-mute)", margin: 0 }}>
                Check badges in the sidebar to meet the thresholds above.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <span
                className="mono"
                style={{ fontSize: 9.5, letterSpacing: "0.1em", color: "var(--fg-mute)" }}
              >
                SELECTED BADGES · {selectedBadgeIds.size}
              </span>
              {selectedBadgeIds.size === 0 && (
                <p className="mono" style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.04em" }}>
                  None selected yet
                </p>
              )}
              {Array.from(selectedBadgeIds).map(id => {
                const b = studentBadges.find(sb => sb.token_id === id);
                return (
                  <div
                    key={id}
                    className="mono"
                    style={{
                      fontSize: 10.5,
                      letterSpacing: "0.04em",
                      color: "var(--fg-dim)",
                      padding: "4px 8px",
                      border: "1px solid color-mix(in srgb, var(--accent) 40%, var(--rule))",
                      borderRadius: 2,
                      background: "color-mix(in srgb, var(--accent) 6%, var(--ink-2))",
                    }}
                  >
                    {b?.badge_name ?? `Token #${id}`}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── LOCKED mode ──────────────────────────────────────────────── */}
        {nodeState === "locked" && (
          <div className="flex flex-col gap-3">
            <div
              style={{
                padding: "8px 10px",
                borderRadius: 3,
                background: "color-mix(in srgb, var(--fg-mute) 6%, transparent)",
                border: "1px solid var(--rule)",
              }}
            >
              <p
                className="mono"
                style={{ fontSize: 9.5, letterSpacing: "0.06em", color: "var(--fg-mute)", margin: 0 }}
              >
                Complete missing prerequisites to unlock this node.
              </p>
            </div>
            {missingPrereqs.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span
                  className="mono"
                  style={{ fontSize: 9.5, letterSpacing: "0.1em", color: "var(--fg-mute)" }}
                >
                  MISSING PREREQUISITES
                </span>
                {missingPrereqs.map(prereq => (
                  <div
                    key={prereq.node_id}
                    className="flex items-center gap-2 mono"
                    style={{
                      fontSize: 11,
                      letterSpacing: "0.04em",
                      color: "var(--fg-mute)",
                      padding: "5px 10px",
                      border: "1px solid var(--rule-soft)",
                      borderRadius: 2,
                      background: "var(--ink-2)",
                    }}
                  >
                    <span style={{ color: "var(--fg-faint)" }}>🔒</span>
                    {prereq.node_name ?? prereq.node_code}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Footer CTA ──────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: "12px 16px",
          borderTop: "1px solid var(--rule)",
          background: "color-mix(in srgb, var(--ink-2) 50%, transparent)",
        }}
      >
        {nodeState === "available" && (
          <button
            type="button"
            onClick={handleAllocate}
            disabled={!canAllocate || isBusy}
            style={{
              width: "100%",
              padding: "11px 16px",
              borderRadius: 2,
              border: "none",
              cursor: canAllocate && !isBusy ? "pointer" : "not-allowed",
              background: canAllocate && !isBusy ? "var(--fg)" : "var(--ink-3)",
              color: canAllocate && !isBusy ? "var(--ink-1)" : "var(--fg-faint)",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 11,
              letterSpacing: "0.12em",
              transition: "background 0.15s, color 0.15s",
            }}
          >
            {isMining
              ? "ANCHORING ON-CHAIN…"
              : waitingForIndexer
                ? "ANCHORING ON-CHAIN… (6s)"
                : canAllocate
                  ? "○ ALLOCATE BADGES"
                  : "SELECT MORE BADGES"}
          </button>
        )}
        {nodeState === "locked" && (
          <div
            className="mono text-center"
            style={{
              fontSize: 10,
              letterSpacing: "0.12em",
              color: "var(--fg-faint)",
              padding: "8px 0",
            }}
          >
            🔒 COMPLETE PREREQUISITES FIRST
          </div>
        )}
        {nodeState === "earned" && (
          <div
            className="mono text-center"
            style={{
              fontSize: 10,
              letterSpacing: "0.12em",
              color: "var(--green)",
              padding: "8px 0",
            }}
          >
            ○ COMPETENCY EARNED — READ-ONLY
          </div>
        )}
      </div>
    </div>
  );
}
