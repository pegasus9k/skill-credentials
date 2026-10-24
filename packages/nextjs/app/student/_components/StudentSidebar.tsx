"use client";

import React, { useState } from "react";
import type { NodeApiRow, StudentBadge, StudentData } from "../_lib/api";
import type { NodeState } from "./CompetencyGraph";

// ─── Hex chip ────────────────────────────────────────────────────────────────
// CSS clip-path hexagon showing course initials
function HexChip({ initials, color }: { initials: string; color: string }) {
  return (
    <div
      style={{
        width: 32,
        height: 36,
        clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
        background: color,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: "0.04em",
          color: "white",
          userSelect: "none",
        }}
      >
        {initials}
      </span>
    </div>
  );
}

// Deterministic colour from course name (from the warm palette)
const HEX_PALETTE = [
  "#6B5CA5", "#3A7A8A", "#9A6B2A", "#3D8059", "#8A4060",
  "#3A6A9A", "#7A6540", "#9A4A2A", "#4A8060", "#2A6090",
];
function courseColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h * 31) + name.charCodeAt(i)) & 0xffff;
  return HEX_PALETTE[h % HEX_PALETTE.length];
}

function getCourseInitials(courseName: string): string {
  const words = courseName.trim().split(/\s+/).filter(w => w.length > 0);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return courseName.slice(0, 2).toUpperCase();
}

// ─── Badge card ───────────────────────────────────────────────────────────────
type BadgeCardProps = {
  badge: StudentBadge;
  committedNodeName?: string;
  showCheckbox: boolean;
  checked: boolean;
  onToggle: () => void;
};

function BadgeCard({ badge, committedNodeName, showCheckbox, checked, onToggle }: BadgeCardProps) {
  const isFree = badge.allocation_status === "free";
  const courseName = badge.course_name ?? "Unknown Course";
  const initials = getCourseInitials(courseName);
  const chipColor = courseColor(courseName);

  return (
    <div
      onClick={isFree && showCheckbox ? onToggle : undefined}
      style={{
        display: "flex",
        gap: 9,
        padding: "8px 10px",
        borderRadius: 3,
        border: checked
          ? "1px solid color-mix(in srgb, var(--accent) 60%, var(--rule))"
          : "1px solid var(--rule-soft)",
        background: checked
          ? "color-mix(in srgb, var(--accent) 8%, var(--ink-2))"
          : isFree
            ? "var(--ink-2)"
            : "color-mix(in srgb, var(--ink-3) 60%, transparent)",
        cursor: isFree && showCheckbox ? "pointer" : "default",
        opacity: !isFree && showCheckbox ? 0.55 : 1,
        transition: "border-color 0.12s, background 0.12s",
      }}
    >
      {/* Checkbox (allocation mode only) */}
      {showCheckbox && (
        <div style={{ paddingTop: 2, flexShrink: 0 }}>
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 2,
              border: checked
                ? "1.5px solid var(--accent)"
                : "1.5px solid var(--rule)",
              background: checked ? "var(--accent)" : "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {checked && (
              <span style={{ color: "var(--ink-1)", fontSize: 9, lineHeight: 1 }}>✓</span>
            )}
          </div>
        </div>
      )}

      {/* Hex chip */}
      <HexChip initials={initials} color={chipColor} />

      {/* Badge info */}
      <div className="flex flex-col gap-1 min-w-0" style={{ flex: 1 }}>
        <span
          style={{
            fontFamily: "var(--font-ui, system-ui)",
            fontSize: 11.5,
            color: !isFree ? "var(--fg-mute)" : "var(--fg)",
            lineHeight: 1.3,
            fontWeight: 500,
          }}
        >
          {badge.badge_name ?? `Token #${badge.token_id}`}
        </span>

        {/* Skill tags */}
        {badge.skills.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {badge.skills.map(sk => (
              <span
                key={sk.skill_label}
                className="mono"
                style={{
                  fontSize: 9,
                  letterSpacing: "0.06em",
                  padding: "1px 5px",
                  borderRadius: 2,
                  border: "1px solid color-mix(in srgb, var(--accent) 35%, var(--rule))",
                  color: "var(--accent)",
                  background: "color-mix(in srgb, var(--accent) 6%, transparent)",
                }}
              >
                +{sk.points} {sk.skill_label}
              </span>
            ))}
          </div>
        )}

        {/* Allocation status */}
        {!isFree && committedNodeName && (
          <span
            className="mono"
            style={{
              fontSize: 9,
              letterSpacing: "0.06em",
              color: "var(--fg-faint)",
              marginTop: 1,
            }}
          >
            → {committedNodeName}
          </span>
        )}
        {isFree && !showCheckbox && (
          <span
            className="mono"
            style={{
              fontSize: 9,
              letterSpacing: "0.06em",
              color: "var(--green)",
              marginTop: 1,
            }}
          >
            FREE
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Course accordion ─────────────────────────────────────────────────────────
type CourseAccordionProps = {
  courseName: string;
  badges: StudentBadge[];
  nodeMap: Map<number, NodeApiRow>;
  allocationMode: boolean;
  selectedBadgeIds: Set<number>;
  onBadgeToggle: (tokenId: number) => void;
};

function CourseAccordion({
  courseName,
  badges,
  nodeMap,
  allocationMode,
  selectedBadgeIds,
  onBadgeToggle,
}: CourseAccordionProps) {
  const [open, setOpen] = useState(true);
  const freeCount = badges.filter(b => b.allocation_status === "free").length;

  return (
    <div style={{ borderBottom: "1px solid var(--rule-soft)" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          padding: "8px 12px",
          background: open ? "color-mix(in srgb, var(--ink-2) 60%, transparent)" : "transparent",
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 10,
            letterSpacing: "0.06em",
            color: "var(--fg-dim)",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {courseName}
        </span>
        <div className="flex items-center gap-1.5" style={{ flexShrink: 0 }}>
          {/* Total badges chip — mockup style: amber bordered pill */}
          <span
            className="mono"
            style={{
              fontSize: 9,
              letterSpacing: "0.06em",
              padding: "2px 8px",
              borderRadius: 999,
              color: badges.length > 0 ? "var(--accent)" : "var(--fg-faint)",
              border: `1px solid color-mix(in srgb, ${badges.length > 0 ? "var(--accent)" : "var(--rule)"} 45%, var(--rule))`,
              background: badges.length > 0 ? "color-mix(in srgb, var(--accent) 8%, var(--ink-2))" : "var(--ink-2)",
              whiteSpace: "nowrap",
            }}
          >
            {badges.length} {badges.length === 1 ? "badge" : "badges"}
          </span>
          {/* Tiny green dot when there are still free badges to allocate */}
          {freeCount > 0 && (
            <span
              title={`${freeCount} free`}
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--green)",
                display: "inline-block",
              }}
            />
          )}
          <span style={{ fontSize: 9, color: "var(--fg-faint)" }}>{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {open && (
        <div className="flex flex-col gap-1.5" style={{ padding: "6px 10px 10px" }}>
          {badges.length === 0 ? (
            <p
              className="mono"
              style={{ fontSize: 9.5, letterSpacing: "0.06em", color: "var(--fg-faint)", padding: "4px 2px" }}
            >
              No badges earned yet
            </p>
          ) : (
            badges.map(badge => {
              const committedNode = badge.committed_to_node > 0 ? nodeMap.get(badge.committed_to_node) : undefined;
              const isFree = badge.allocation_status === "free";
              return (
                <BadgeCard
                  key={badge.token_id}
                  badge={badge}
                  committedNodeName={committedNode?.node_name ?? committedNode?.node_code}
                  showCheckbox={allocationMode}
                  checked={selectedBadgeIds.has(badge.token_id)}
                  onToggle={isFree ? () => onBadgeToggle(badge.token_id) : () => {}}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main sidebar component ───────────────────────────────────────────────────
type SidebarProps = {
  studentData: StudentData;
  nodes: NodeApiRow[];
  allocationMode: boolean;
  selectedNodeState: NodeState | null;
  selectedBadgeIds: Set<number>;
  onBadgeToggle: (tokenId: number) => void;
};

export function StudentSidebar({
  studentData,
  nodes,
  allocationMode,
  selectedBadgeIds,
  onBadgeToggle,
}: SidebarProps) {
  const nodeMap = new Map(nodes.map(n => [n.node_id, n]));
  const { student, badges, competencies } = studentData;

  // Group badges by course name
  const badgesByCourse = new Map<string, StudentBadge[]>();
  for (const badge of badges) {
    const key = badge.course_name ?? "Unknown Course";
    if (!badgesByCourse.has(key)) badgesByCourse.set(key, []);
    badgesByCourse.get(key)!.push(badge);
  }
  const courseNames = Array.from(badgesByCourse.keys()).sort();

  const shortAddr = student.wallet_address
    ? `${student.wallet_address.slice(0, 6)}…${student.wallet_address.slice(-4)}`
    : "—";

  return (
    <aside
      style={{
        width: 280,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid var(--rule)",
        background: "color-mix(in srgb, var(--ink-1) 80%, transparent)",
        overflowY: "auto",
      }}
    >
      {/* ── Student profile card ───────────────────────────────────────────── */}
      <div
        style={{
          padding: "14px 14px 12px",
          borderBottom: "1px solid var(--rule)",
          background: "color-mix(in srgb, var(--ink-2) 55%, transparent)",
        }}
      >
        {/* Avatar + name */}
        <div className="flex items-center gap-2.5 mb-3">
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "color-mix(in srgb, var(--accent) 30%, var(--ink-3))",
              color: "var(--accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-display)",
              fontSize: 16,
              flexShrink: 0,
            }}
          >
            {(student.student_name?.[0] ?? "?").toUpperCase()}
          </div>
          <div className="flex flex-col min-w-0">
            <span
              className="serif"
              style={{ fontSize: 14, color: "var(--fg)", letterSpacing: "-0.01em", lineHeight: 1.2 }}
            >
              {student.student_name ?? "Unknown Student"}
            </span>
            <span
              className="mono"
              style={{ fontSize: 9.5, color: "var(--fg-faint)", letterSpacing: "0.06em" }}
            >
              {shortAddr}
            </span>
          </div>
        </div>

        {/* Stats row */}
        <div
          className="grid"
          style={{ gridTemplateColumns: "1fr 1fr", gap: 8 }}
        >
          <div
            style={{
              padding: "7px 10px",
              border: "1px solid var(--rule)",
              borderRadius: 3,
              background: "var(--ink-2)",
            }}
          >
            <div
              className="mono"
              style={{ fontSize: 9, letterSpacing: "0.1em", color: "var(--fg-faint)", marginBottom: 2 }}
            >
              BADGES
            </div>
            <div className="serif" style={{ fontSize: 18, color: "var(--fg)", lineHeight: 1 }}>
              {badges.length}
            </div>
          </div>
          <div
            style={{
              padding: "7px 10px",
              border: "1px solid var(--rule)",
              borderRadius: 3,
              background: "var(--ink-2)",
            }}
          >
            <div
              className="mono"
              style={{ fontSize: 9, letterSpacing: "0.1em", color: "var(--fg-faint)", marginBottom: 2 }}
            >
              UNLOCKED
            </div>
            <div className="flex items-baseline gap-0.5" style={{ lineHeight: 1 }}>
              <span className="serif" style={{ fontSize: 18, color: "var(--fg)" }}>
                {competencies.length}
              </span>
              <span className="mono" style={{ fontSize: 11, color: "var(--fg-faint)" }}>
                / {nodes.length}
              </span>
            </div>
          </div>
        </div>

        {/* Degree pill */}
        {student.degree && (
          <div className="mt-2.5">
            <span
              className="mono"
              style={{
                fontSize: 9,
                letterSpacing: "0.1em",
                padding: "2px 7px",
                border: "1px solid var(--rule)",
                borderRadius: 2,
                color: "var(--fg-mute)",
                background: "var(--ink-2)",
              }}
            >
              {student.degree}
            </span>
          </div>
        )}
      </div>

      {/* ── Allocation hint ────────────────────────────────────────────────── */}
      {allocationMode && (
        <div
          style={{
            padding: "8px 14px",
            background: "color-mix(in srgb, var(--accent) 8%, transparent)",
            borderBottom: "1px solid color-mix(in srgb, var(--accent) 30%, var(--rule))",
          }}
        >
          <p
            className="mono"
            style={{ fontSize: 9.5, letterSpacing: "0.06em", color: "var(--accent)", margin: 0 }}
          >
            SELECT BADGES TO ALLOCATE ↑
          </p>
        </div>
      )}

      {/* ── Courses header ─────────────────────────────────────────────────── */}
      <div
        className="flex items-baseline justify-between"
        style={{ padding: "10px 14px 6px", borderBottom: "1px solid var(--rule-soft)" }}
      >
        <span className="mono" style={{ fontSize: 9.5, letterSpacing: "0.12em", color: "var(--fg-mute)" }}>
          COURSES
        </span>
        <span className="mono" style={{ fontSize: 9, letterSpacing: "0.06em", color: "var(--fg-faint)" }}>
          {courseNames.length} · {badges.length} badges
        </span>
      </div>

      {/* ── Course accordions ──────────────────────────────────────────────── */}
      <div style={{ flex: 1 }}>
        {courseNames.length === 0 ? (
          <div style={{ padding: "24px 14px" }}>
            <p
              className="mono"
              style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--fg-faint)", textAlign: "center" }}
            >
              No badges earned yet
            </p>
          </div>
        ) : (
          courseNames.map(courseName => (
            <CourseAccordion
              key={courseName}
              courseName={courseName}
              badges={badgesByCourse.get(courseName) ?? []}
              nodeMap={nodeMap}
              allocationMode={allocationMode}
              selectedBadgeIds={selectedBadgeIds}
              onBadgeToggle={onBadgeToggle}
            />
          ))
        )}
      </div>
    </aside>
  );
}
