"use client";

import React, { useMemo, useState } from "react";
import { type NodeRow, type SkillRow, API_URL } from "../_lib/api";
import { PREREQ_MODES, DEFAULT_SKILLS } from "../_lib/curriculum";
import { hashLabel, toBytes32 } from "../_lib/hash";
import { Field } from "./atoms";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

// ─── Skill hash → label reverse map ─────────────────────────────────────────
// Built once at module level from the hardcoded skill vocabulary.
// Used to resolve "UNKNOWN" threshold labels when the DB JOIN misses.
const SKILL_HASH_MAP: ReadonlyMap<string, string> = new Map(
  DEFAULT_SKILLS.map(s => [hashLabel(s.label), s.label]),
);
function resolveSkillLabel(skillId: string, rawLabel: string | null): string {
  if (rawLabel && rawLabel !== "UNKNOWN") return rawLabel;
  return SKILL_HASH_MAP.get(skillId) ?? skillId.slice(0, 8) + "…";
}

// ─── Slug + helpers ───────────────────────────────────────────────────────────
function toNodeCode(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, ".");
}

// ─── Deterministic colour per skill (same palette as student page) ─────────────
const ATOM_PALETTE = [
  "#6B5CA5", "#3A7A8A", "#B07A30", "#3D8059", "#8A4060",
  "#3A6A9A", "#7A6540", "#9A4A2A", "#4A8060", "#2A6090",
];
function skillColor(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = ((h * 31) + label.charCodeAt(i)) & 0xffff;
  return ATOM_PALETTE[h % ATOM_PALETTE.length];
}

// ─── Form type ────────────────────────────────────────────────────────────────
type NodeForm = {
  nodeName: string;
  description: string;
  skills: Record<string, number>; // { skillLabel: minPoints (1–20) }
  prereqMode: 0 | 1 | 2;
  prereqNodeIds: number[];
  department: string;
  metadataCID: string;
  editingNodeId: number | null; // null = create flow, number = editing this node
};

const emptyForm = (): NodeForm => ({
  nodeName: "",
  description: "",
  skills: {},
  prereqMode: 0,
  prereqNodeIds: [],
  department: "",
  metadataCID: "",
  editingNodeId: null,
});

// ─── NodeThresholdMatrix ─────────────────────────────────────────────────────
// Like SkillMatrix in atoms.tsx but sliders go 1-20 (min threshold points)
function NodeThresholdMatrix({
  skills,
  value,
  onChange,
  maxSkills = 6,
}: {
  skills: { label: string; description: string }[];
  value: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
  maxSkills?: number;
}) {
  const toggle = (k: string) => {
    const next = { ...value };
    if (k in next) {
      delete next[k];
    } else if (Object.keys(next).length < maxSkills) {
      next[k] = 5;
    }
    onChange(next);
  };
  const setPts = (k: string, p: number) => onChange({ ...value, [k]: p });
  const count = Object.keys(value).length;

  return (
    <div className="flex flex-col gap-2">
      {/* Skill chip toggles */}
      <div className="flex flex-wrap gap-1.5">
        {skills.map(s => {
          const on = s.label in value;
          const atLimit = !on && count >= maxSkills;
          return (
            <button
              key={s.label}
              type="button"
              title={atLimit ? `Max ${maxSkills} skills` : s.description}
              onClick={() => !atLimit && toggle(s.label)}
              className="mono"
              style={{
                padding: "4px 9px",
                fontSize: 10.5,
                letterSpacing: "0.1em",
                border: `1px solid ${on ? "var(--accent)" : "var(--rule)"}`,
                background: on ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "transparent",
                color: on ? "var(--accent)" : atLimit ? "var(--fg-faint)" : "var(--fg-mute)",
                borderRadius: 2,
                cursor: atLimit ? "not-allowed" : "pointer",
                opacity: atLimit ? 0.5 : 1,
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Sliders for selected skills */}
      {count > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "72px 1fr 36px",
            columnGap: 10,
            rowGap: 6,
            padding: "10px 12px",
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
              <input
                type="range"
                min="1"
                max="20"
                value={p}
                onChange={e => setPts(k, +e.target.value)}
              />
              <span
                className="mono self-center text-right"
                style={{ fontSize: 11, color: "var(--accent)" }}
              >
                {p}
              </span>
            </React.Fragment>
          ))}
        </div>
      )}

      <span className="mono" style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.06em" }}>
        {count}/{maxSkills} skills · threshold range 1–20 pts
      </span>
    </div>
  );
}

// ─── NodeMiniPreview ──────────────────────────────────────────────────────────
// Live SVG preview of the molecular node as the GM fills in the form.
// Visual language matches the student-page DAG: flat-top hexagons with
// initials inside the main node and small hex atoms orbiting it.
const PREV_R = 32;
const PREV_ORBIT = 50;
const PREV_ATOM = 7;
const PREV_PREREQ_R = 10;

// Flat-top hexagon polygon points for an arbitrary centre + circumradius.
function hexAt(cx: number, cy: number, r: number): string {
  const s = r * 0.866;
  return `${cx + r},${cy} ${cx + r / 2},${cy + s} ${cx - r / 2},${cy + s} ${cx - r},${cy} ${cx - r / 2},${cy - s} ${cx + r / 2},${cy - s}`;
}

function previewInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 3).map(w => w[0]).join("").toUpperCase();
}

function NodeMiniPreview({
  nodeName,
  selectedSkills,
  prereqCount,
}: {
  nodeName: string;
  selectedSkills: string[];
  prereqCount: number;
}) {
  const cx = 120;
  const cy = 115;

  return (
    <aside
      style={{
        border: "1px solid var(--rule)",
        borderRadius: 3,
        background: "color-mix(in srgb, var(--ink-2) 60%, transparent)",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <span
        className="mono"
        style={{ fontSize: 9.5, letterSpacing: "0.12em", color: "var(--fg-mute)" }}
      >
        LIVE PREVIEW
      </span>

      <svg width={240} height={220} style={{ display: "block", margin: "0 auto" }}>
        {/* Prereq hexes (small grey hexes above, connected by dashed lines) */}
        {prereqCount > 0 &&
          Array.from({ length: Math.min(prereqCount, 4) }).map((_, i) => {
            const total = Math.min(prereqCount, 4);
            const spread = 60;
            const x = cx - (spread * (total - 1)) / 2 + i * spread;
            const y = cy - PREV_ORBIT - 28;
            return (
              <g key={i}>
                <polygon
                  points={hexAt(x, y, PREV_PREREQ_R)}
                  fill="#e4dfd4"
                  stroke="#9a9080"
                  strokeWidth={1}
                  strokeLinejoin="round"
                />
                <line
                  x1={x}
                  y1={y + PREV_PREREQ_R * 0.866}
                  x2={cx}
                  y2={cy - PREV_R * 0.866}
                  stroke="#9a9080"
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  strokeOpacity={0.6}
                />
              </g>
            );
          })}

        {/* Orbiting skill atoms (hexagons) */}
        {selectedSkills.map((sk, i) => {
          const angle = (2 * Math.PI * i) / selectedSkills.length - Math.PI / 2;
          const ax = cx + Math.cos(angle) * PREV_ORBIT;
          const ay = cy + Math.sin(angle) * PREV_ORBIT;
          const c = skillColor(sk);
          return (
            <polygon
              key={sk}
              points={hexAt(ax, ay, PREV_ATOM)}
              fill={c}
              fillOpacity={0.9}
              stroke={c}
              strokeWidth={0.6}
              strokeOpacity={0.7}
              strokeLinejoin="round"
            >
              <title>{sk}</title>
            </polygon>
          );
        })}

        {/* Main node hexagon — amber when named, muted grey while empty */}
        <polygon
          points={hexAt(cx, cy, PREV_R)}
          fill={nodeName ? "#9a6b2a" : "#a89c84"}
          stroke={nodeName ? "#6e4c1d" : "#7a7060"}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />

        {/* Initials inside the hex (or placeholder dots when empty) */}
        {nodeName ? (
          (() => {
            const initials = previewInitials(nodeName);
            return (
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fontFamily="monospace"
                fontSize={initials.length >= 3 ? 13 : 16}
                fontWeight={700}
                letterSpacing="0.06em"
                fill="#f4eee0"
                style={{ pointerEvents: "none" }}
              >
                {initials}
              </text>
            );
          })()
        ) : (
          <text
            x={cx}
            y={cy}
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily="monospace"
            fontSize={11}
            fill="#f4eee0"
            fillOpacity={0.55}
            letterSpacing="0.2em"
          >
            ···
          </text>
        )}

        {/* Node name label below the hex */}
        <text
          x={cx}
          y={cy + PREV_R * 0.866 + 18}
          textAnchor="middle"
          fontSize={nodeName ? 10.5 : 9.5}
          fontFamily="monospace"
          letterSpacing={nodeName ? "0.04em" : "0.08em"}
          fontWeight={nodeName ? 500 : 400}
          fill={nodeName ? "#1c1810" : "#8a8070"}
        >
          {nodeName
            ? nodeName.length > 20
              ? nodeName.slice(0, 18) + "…"
              : nodeName
            : "NAME THE NODE"}
        </text>
      </svg>

      {/* Skill atoms legend */}
      {selectedSkills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedSkills.map(sk => (
            <span
              key={sk}
              className="mono"
              style={{
                fontSize: 9,
                letterSpacing: "0.06em",
                padding: "1px 5px",
                borderRadius: 2,
                border: `1px solid ${skillColor(sk)}40`,
                color: skillColor(sk),
                background: `${skillColor(sk)}14`,
              }}
            >
              {sk}
            </span>
          ))}
        </div>
      )}
    </aside>
  );
}

// ─── NodeLedger ───────────────────────────────────────────────────────────────
const MODE_COLORS: Record<string, string> = {
  NONE: "var(--fg-mute)",
  AND: "var(--cyan)",
  OR: "var(--accent)",
};

function NodeLedger({
  nodes,
  isFrozen,
  onEdit,
}: {
  nodes: NodeRow[];
  isFrozen: boolean;
  onEdit: (nodeId: number) => void;
}) {
  const [open, setOpen] = useState(true);

  // Group by season
  const bySeason = useMemo(() => {
    const m = new Map<string, NodeRow[]>();
    for (const n of nodes) {
      if (!m.has(n.season_id)) m.set(n.season_id, []);
      m.get(n.season_id)!.push(n);
    }
    return m;
  }, [nodes]);

  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.node_id, n])), [nodes]);

  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        borderRadius: 3,
        background: "color-mix(in srgb, var(--ink-2) 40%, transparent)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
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
          padding: "10px 16px",
          borderBottom: open ? "1px solid var(--rule)" : "none",
          background: "color-mix(in srgb, var(--ink-2) 80%, transparent)",
        }}
      >
        <span className="mono" style={{ fontSize: 10.5, letterSpacing: "0.14em", color: "var(--fg-mute)" }}>
          DEFINED NODES
          <span
            style={{
              marginLeft: 10,
              padding: "2px 7px",
              borderRadius: 2,
              border: "1px solid var(--rule)",
              color: "var(--accent)",
              background: "color-mix(in srgb, var(--accent) 8%, transparent)",
              fontSize: 9.5,
            }}
          >
            {nodes.length}
          </span>
        </span>
        <span style={{ color: "var(--fg-faint)", fontSize: 10 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div>
          {nodes.length === 0 ? (
            <div
              className="mono text-center"
              style={{
                padding: "20px",
                fontSize: 10.5,
                letterSpacing: "0.08em",
                color: "var(--fg-faint)",
              }}
            >
              NO NODES DEFINED YET — THIS WILL BE THE FIRST
            </div>
          ) : (
            Array.from(bySeason.entries()).map(([season, sNodes]) => (
              <div key={season}>
                {/* Season divider */}
                <div
                  className="mono"
                  style={{
                    padding: "6px 16px",
                    fontSize: 9.5,
                    letterSpacing: "0.12em",
                    color: "var(--fg-faint)",
                    borderBottom: "1px solid var(--rule-soft)",
                    background: "color-mix(in srgb, var(--ink-3) 30%, transparent)",
                  }}
                >
                  {season}
                </div>

                {sNodes.map(node => {
                  const prereqNames = node.prerequisites
                    .map(id => nodeMap.get(id)?.node_name ?? nodeMap.get(id)?.node_code ?? `#${id}`)
                    .join(", ");

                  return (
                    <div
                      key={node.node_id}
                      style={{
                        padding: "10px 16px",
                        borderBottom: "1px solid var(--rule-soft)",
                        display: "flex",
                        gap: 12,
                        alignItems: "flex-start",
                      }}
                    >
                      {/* Node ID */}
                      <span
                        className="mono"
                        style={{
                          fontSize: 9,
                          letterSpacing: "0.08em",
                          color: "var(--fg-faint)",
                          minWidth: 24,
                          paddingTop: 2,
                        }}
                      >
                        #{node.node_id}
                      </span>

                      {/* Name + code + mode */}
                      <div className="flex flex-col gap-1 flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span style={{ fontSize: 13, color: "var(--fg)", fontWeight: 500 }}>
                            {node.node_name ?? node.node_code}
                          </span>
                          <span
                            className="mono"
                            style={{
                              fontSize: 9,
                              letterSpacing: "0.08em",
                              padding: "1px 5px",
                              border: "1px solid var(--rule)",
                              borderRadius: 2,
                              color: "var(--fg-faint)",
                              background: "var(--ink-2)",
                            }}
                          >
                            {node.node_code}
                          </span>
                          <span
                            className="mono"
                            style={{
                              fontSize: 9,
                              letterSpacing: "0.1em",
                              padding: "1px 6px",
                              borderRadius: 2,
                              color: MODE_COLORS[node.prereq_mode] ?? "var(--fg-mute)",
                              border: `1px solid color-mix(in srgb, ${MODE_COLORS[node.prereq_mode] ?? "var(--fg-mute)"} 35%, var(--rule))`,
                              background: `color-mix(in srgb, ${MODE_COLORS[node.prereq_mode] ?? "var(--fg-mute)"} 8%, transparent)`,
                            }}
                          >
                            {node.prereq_mode}
                          </span>
                        </div>

                        {/* Prereq names */}
                        {prereqNames && (
                          <span
                            className="mono"
                            style={{ fontSize: 9.5, color: "var(--fg-mute)", letterSpacing: "0.04em" }}
                          >
                            requires: {prereqNames}
                          </span>
                        )}

                        {/* Threshold chips */}
                        {node.thresholds.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {node.thresholds.map(t => {
                              const label = resolveSkillLabel(t.skill_id, t.skill_label);
                              return (
                                <span
                                  key={t.skill_id}
                                  className="mono"
                                  style={{
                                    fontSize: 9,
                                    letterSpacing: "0.06em",
                                    padding: "1px 5px",
                                    borderRadius: 2,
                                    border: "1px solid color-mix(in srgb, var(--accent) 30%, var(--rule))",
                                    color: "var(--accent)",
                                    background: "color-mix(in srgb, var(--accent) 6%, transparent)",
                                  }}
                                >
                                  {label}≥{t.min_points}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Status — clickable Edit while season is open, frozen pill otherwise */}
                      {isFrozen ? (
                        <span
                          className="mono"
                          style={{
                            fontSize: 9,
                            letterSpacing: "0.1em",
                            color: "var(--cyan)",
                            padding: "2px 7px",
                            border: "1px solid color-mix(in srgb, var(--cyan) 40%, var(--rule))",
                            borderRadius: 2,
                            background: "color-mix(in srgb, var(--cyan) 8%, transparent)",
                            flexShrink: 0,
                          }}
                        >
                          ❄ FROZEN
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onEdit(node.node_id)}
                          title="Load this node into the form to update it"
                          className="mono"
                          style={{
                            all: "unset",
                            cursor: "pointer",
                            fontSize: 9,
                            letterSpacing: "0.1em",
                            color: "var(--green)",
                            padding: "2px 7px",
                            border: "1px solid color-mix(in srgb, var(--green) 40%, var(--rule))",
                            borderRadius: 2,
                            background: "color-mix(in srgb, var(--green) 10%, transparent)",
                            flexShrink: 0,
                            transition: "background 0.12s",
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = "color-mix(in srgb, var(--green) 20%, transparent)";
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = "color-mix(in srgb, var(--green) 10%, transparent)";
                          }}
                        >
                          ✓ DEFINED · Edit →
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
type Props = {
  season: string;
  nodes: NodeRow[];
  skills: SkillRow[];
  isFrozen: boolean;
  onAfterSubmit: () => void;
};

export function CreateNodeForm({ season, nodes, skills, isFrozen, onAfterSubmit }: Props) {
  const [form, setForm] = useState<NodeForm>(emptyForm());
  const [pinning, setPinning] = useState(false);
  const [defined, setDefined] = useState(false);

  const { writeContractAsync, isMining } = useScaffoldWriteContract({ contractName: "SkillGraph" });

  const nodeCode = useMemo(() => toNodeCode(form.nodeName), [form.nodeName]);

  const skillOptions = useMemo(() => {
    if (skills.length > 0)
      return skills.map(s => ({ label: s.skill_label, description: s.description ?? s.skill_label }));
    return DEFAULT_SKILLS;
  }, [skills]);

  // Derived validation
  const selectedSkillLabels = Object.keys(form.skills);
  const prereqModeLabel = PREREQ_MODES.find(m => m.v === form.prereqMode)?.label ?? "NONE";
  const needsPrereqSelection = form.prereqMode !== 0 && nodes.length > 0;
  const prereqSelectionMissing = needsPrereqSelection && form.prereqNodeIds.length === 0;

  const canPin =
    !!form.nodeName.trim() &&
    selectedSkillLabels.length > 0 &&
    !prereqSelectionMissing &&
    !pinning &&
    !isFrozen;

  const canAnchor =
    canPin &&
    !!form.metadataCID &&
    !isMining &&
    !defined &&
    !isFrozen;

  // ── Pin metadata ─────────────────────────────────────────────────────────
  const onPin = async () => {
    if (!canPin) return;
    setPinning(true);
    try {
      const prereqMeta = form.prereqNodeIds.map(id => {
        const n = nodes.find(n => n.node_id === id);
        return { nodeId: id, name: n?.node_name ?? n?.node_code ?? `#${id}` };
      });

      const payload = {
        name: form.nodeName.trim(),
        description: form.description.trim(),
        properties: {
          credentialType: "Competency",
          prereqMode: prereqModeLabel,
          season,
          prerequisites: prereqMeta,
          department: form.department.trim() || undefined,
          institution: "IST",
        },
        thresholds: Object.entries(form.skills).map(([trait_type, value]) => ({
          trait_type,
          value,
        })),
      };

      const res = await fetch(`${API_URL}/metadata/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${res.status} — ${text || "pin failed"}`);
      }
      const { metadataCID } = (await res.json()) as { metadataCID: string };
      setForm(f => ({ ...f, metadataCID }));
      notification.success("Metadata pinned to IPFS");
    } catch (e: any) {
      notification.error(`Pin failed: ${e?.message ?? "unknown"}`);
    } finally {
      setPinning(false);
    }
  };

  const isEditing = form.editingNodeId !== null;

  // ── Enter / exit edit mode ─────────────────────────────────────────────
  // Loads an existing node into the form for updateNode(). Season is locked
  // (the contract enforces it), but every other field is editable.
  const enterEditMode = (nodeId: number) => {
    const node = nodes.find(n => n.node_id === nodeId);
    if (!node) return;
    const nextSkills: Record<string, number> = {};
    for (const t of node.thresholds) {
      const label = resolveSkillLabel(t.skill_id, t.skill_label);
      if (label && !label.endsWith("…")) {
        nextSkills[label] = t.min_points;
      }
    }
    const modeNum: 0 | 1 | 2 =
      node.prereq_mode === "OR" ? 2 : node.prereq_mode === "AND" ? 1 : 0;
    setForm({
      nodeName: node.node_name ?? node.node_code,
      description: node.description ?? "",
      skills: nextSkills,
      prereqMode: modeNum,
      prereqNodeIds: [...node.prerequisites],
      department: node.department ?? "",
      metadataCID: node.metadata_cid, // keep existing CID until re-pin
      editingNodeId: node.node_id,
    });
    setDefined(false);
    // Scroll the form into view so the GM sees the loaded data.
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const exitEditMode = () => {
    setForm(emptyForm());
    setDefined(false);
  };

  // ── Anchor on-chain ───────────────────────────────────────────────────────
  const onAnchor = async () => {
    if (!canAnchor) return;
    const skillEntries = Object.entries(form.skills);
    try {
      if (isEditing && form.editingNodeId !== null) {
        // UPDATE path — same fields minus seasonId (immutable on-chain).
        const updateParams = {
          nodeCode: hashLabel(nodeCode),
          skillIds: skillEntries.map(([k]) => hashLabel(k)),
          points: skillEntries.map(([, v]) => v),
          prereqMode: form.prereqMode,
          prerequisiteNodes: form.prereqNodeIds.map(id => BigInt(id)),
          metadataCID: toBytes32(form.metadataCID),
        } as const;
        await writeContractAsync({
          functionName: "updateNode",
          args: [BigInt(form.editingNodeId), updateParams],
        } as any);
        notification.success("Node definition updated on-chain");
      } else {
        const params = {
          seasonId: hashLabel(season),
          nodeCode: hashLabel(nodeCode),
          skillIds: skillEntries.map(([k]) => hashLabel(k)),
          points: skillEntries.map(([, v]) => v),
          prereqMode: form.prereqMode,
          prerequisiteNodes: form.prereqNodeIds.map(id => BigInt(id)),
          metadataCID: toBytes32(form.metadataCID),
          versionOf: 0n,
        } as const;
        await writeContractAsync({ functionName: "defineNode", args: [params] } as any);
        notification.success("Node anchored on-chain");
      }
      setDefined(true);
      setTimeout(() => {
        onAfterSubmit();
        setForm(emptyForm());
        setDefined(false);
      }, 6000);
    } catch {
      // useTransactor surfaces the toast
    }
  };

  // ── Toggle prereq node selection ──────────────────────────────────────────
  const togglePrereqNode = (nodeId: number) => {
    setForm(f => {
      const ids = f.prereqNodeIds.includes(nodeId)
        ? f.prereqNodeIds.filter(id => id !== nodeId)
        : [...f.prereqNodeIds, nodeId];
      return { ...f, prereqNodeIds: ids };
    });
  };

  const hasCID = !!form.metadataCID;

  return (
    <div className="flex flex-col gap-5">
      {/* ── Zones 1 + 2: form + live preview ─────────────────────────── */}
      <div
        className="grid gap-5 items-start"
        style={{ gridTemplateColumns: "minmax(0, 1fr) 260px" }}
      >
        {/* ── Zone 1: Form ──────────────────────────────────────────────── */}
        <section
          style={{
            border: "1px solid var(--rule)",
            borderRadius: 3,
            padding: "18px 20px 20px",
            background: "color-mix(in srgb, var(--ink-2) 60%, transparent)",
          }}
        >
          <div className="flex flex-col gap-4">
            {isEditing && (
              <div
                className="mono flex items-center justify-between gap-3 flex-wrap"
                style={{
                  padding: "8px 12px",
                  border: "1px solid color-mix(in srgb, var(--cyan) 40%, var(--rule))",
                  borderRadius: 2,
                  background: "color-mix(in srgb, var(--cyan) 8%, transparent)",
                  fontSize: 10.5,
                  letterSpacing: "0.08em",
                  color: "var(--cyan)",
                }}
              >
                <span>✎ EDITING NODE #{form.editingNodeId} — RE-PIN IF YOU CHANGE FIELDS</span>
                <button
                  type="button"
                  onClick={exitEditMode}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    padding: "2px 8px",
                    borderRadius: 2,
                    border: "1px solid color-mix(in srgb, var(--cyan) 40%, var(--rule))",
                    color: "var(--cyan)",
                    fontSize: 10,
                    letterSpacing: "0.06em",
                  }}
                >
                  ✕ Cancel edit
                </button>
              </div>
            )}

            {/* Row 1 — Identity */}
            <div className="grid gap-3.5" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
              <Field label="SEASON ID" hint="auto-set">
                <div
                  className="k-input"
                  style={{ background: "var(--ink-3)", color: "var(--fg-dim)", cursor: "default" }}
                >
                  {season}
                </div>
              </Field>

              <Field label="NODE NAME">
                <input
                  className="k-input"
                  value={form.nodeName}
                  onChange={e => {
                    setForm(f => ({ ...f, nodeName: e.target.value, metadataCID: "" }));
                    setDefined(false);
                  }}
                  placeholder="Deep Feature Extraction"
                />
              </Field>

              <Field label="NODE CODE" hint="auto-generated · hashed">
                <div
                  className="k-input mono"
                  style={{
                    background: "var(--ink-3)",
                    color: nodeCode ? "var(--fg-dim)" : "var(--fg-faint)",
                    cursor: "default",
                    fontSize: 11,
                    letterSpacing: "0.06em",
                  }}
                >
                  {nodeCode || "AUTO"}
                </div>
              </Field>
            </div>

            {/* Row 2 — Description */}
            <Field label="DESCRIPTION" hint="shown to students · pinned to IPFS">
              <textarea
                className="k-input"
                rows={2}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value, metadataCID: "" }))}
                placeholder="e.g. Designs and evaluates deep feature extraction pipelines for structured and unstructured data."
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  lineHeight: 1.4,
                  resize: "vertical",
                }}
              />
            </Field>

            {/* Row 3 — Threshold Vector */}
            <Field
              label="THRESHOLD VECTOR"
              hint="skill points required to unlock"
            >
              <NodeThresholdMatrix
                skills={skillOptions}
                value={form.skills}
                onChange={skills => setForm(f => ({ ...f, skills, metadataCID: "" }))}
              />
            </Field>

            {/* Row 4 — Prereq Mode + Nodes */}
            <div className="flex flex-col gap-2.5">
              <Field label="PREREQUISITE MODE">
                <select
                  className="k-input"
                  value={form.prereqMode}
                  onChange={e => {
                    const v = +e.target.value as 0 | 1 | 2;
                    setForm(f => ({ ...f, prereqMode: v, prereqNodeIds: [], metadataCID: "" }));
                  }}
                  style={{ cursor: "pointer" }}
                >
                  {PREREQ_MODES.map(m => (
                    <option key={m.v} value={m.v}>
                      {m.label} — {m.hint}
                    </option>
                  ))}
                </select>
              </Field>

              {/* Prerequisite node multi-select */}
              {form.prereqMode !== 0 && (
                <Field
                  label={form.prereqMode === 1 ? "ALL OF THESE NODES" : "ANY OF THESE NODES"}
                  hint={`${form.prereqNodeIds.length} selected`}
                >
                  {nodes.length === 0 ? (
                    <div
                      className="k-input mono"
                      style={{
                        color: "var(--fg-faint)",
                        fontSize: 10.5,
                        letterSpacing: "0.06em",
                        cursor: "default",
                      }}
                    >
                      No nodes defined yet — this will be a base node
                    </div>
                  ) : (
                    <div
                      style={{
                        border: "1px solid var(--rule)",
                        borderRadius: 2,
                        background: "var(--ink-2)",
                        maxHeight: 180,
                        overflowY: "auto",
                      }}
                    >
                      {nodes.map(n => {
                        const sel = form.prereqNodeIds.includes(n.node_id);
                        return (
                          <button
                            key={n.node_id}
                            type="button"
                            onClick={() => {
                              togglePrereqNode(n.node_id);
                              setForm(f => ({ ...f, metadataCID: "" }));
                            }}
                            style={{
                              all: "unset",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "8px 12px",
                              borderBottom: "1px solid var(--rule-soft)",
                              width: "100%",
                              background: sel
                                ? "color-mix(in srgb, var(--accent) 10%, var(--ink-2))"
                                : "transparent",
                              borderLeft: sel ? "2px solid var(--accent)" : "2px solid transparent",
                              transition: "background 0.12s",
                            }}
                          >
                            {/* Selection indicator */}
                            <div
                              style={{
                                width: 12,
                                height: 12,
                                borderRadius: 2,
                                border: sel ? "1.5px solid var(--accent)" : "1.5px solid var(--rule)",
                                background: sel ? "var(--accent)" : "transparent",
                                flexShrink: 0,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              {sel && (
                                <span style={{ color: "var(--ink-1)", fontSize: 8, lineHeight: 1 }}>
                                  ✓
                                </span>
                              )}
                            </div>
                            <span style={{ fontSize: 12.5, color: "var(--fg)", flex: 1 }}>
                              {n.node_name ?? n.node_code}
                            </span>
                            <span
                              className="mono"
                              style={{
                                fontSize: 9,
                                letterSpacing: "0.06em",
                                color: "var(--fg-faint)",
                                padding: "1px 5px",
                                border: "1px solid var(--rule)",
                                borderRadius: 2,
                              }}
                            >
                              {n.node_code}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Validation: AND/OR with no selection */}
                  {prereqSelectionMissing && (
                    <p
                      className="mono"
                      style={{
                        fontSize: 10,
                        letterSpacing: "0.06em",
                        color: "var(--magenta)",
                        marginTop: 4,
                      }}
                    >
                      ⚠ Select at least one prerequisite node
                    </p>
                  )}
                </Field>
              )}
            </div>

            {/* Row 5 — Department */}
            <Field label="DEPARTMENT" hint="optional · IPFS metadata">
              <input
                className="k-input"
                value={form.department}
                onChange={e => setForm(f => ({ ...f, department: e.target.value, metadataCID: "" }))}
                placeholder="e.g. Electrical Engineering"
              />
            </Field>

            {/* Row 6 — Actions */}
            <div
              style={{
                borderTop: "1px dashed var(--rule)",
                paddingTop: 14,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {/* CID display */}
              {hasCID && (
                <div
                  className="mono flex items-center gap-2"
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.04em",
                    padding: "7px 10px",
                    border: "1px solid color-mix(in srgb, var(--green) 35%, var(--rule))",
                    borderRadius: 2,
                    background: "color-mix(in srgb, var(--green) 6%, transparent)",
                    color: "var(--fg-dim)",
                  }}
                >
                  <span style={{ color: "var(--green)" }}>✓ CID</span>
                  <span
                    style={{
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {form.metadataCID}
                  </span>
                </div>
              )}

              <div className="flex items-center gap-2.5 flex-wrap">
                {/* Pin Metadata */}
                <button
                  type="button"
                  className="k-btn"
                  onClick={onPin}
                  disabled={!canPin || pinning}
                  title={!form.nodeName.trim() ? "Enter a node name first" : prereqSelectionMissing ? "Select prerequisite nodes" : undefined}
                >
                  {pinning
                    ? "…pinning"
                    : hasCID
                      ? isEditing
                        ? "↻ Re-pin Metadata"
                        : "↻ Re-pin"
                      : "↑ Pin Metadata"}
                </button>

                <div className="flex-1" />

                {/* Gas estimate */}
                <span
                  className="mono"
                  style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em" }}
                >
                  GAS EST. ~ 120000
                </span>

                {/* Anchor Node */}
                <button
                  type="button"
                  className="k-btn k-btn-primary"
                  onClick={onAnchor}
                  disabled={!canAnchor}
                  title={!hasCID ? "Pin metadata first" : undefined}
                >
                  {defined
                    ? isEditing
                      ? "✓ UPDATED · syncing…"
                      : "✓ DEFINED · syncing…"
                    : isMining
                      ? isEditing
                        ? "Updating…"
                        : "Anchoring…"
                      : isEditing
                        ? "Update node def →"
                        : "Anchor Node →"}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ── Zone 2: Live Preview ───────────────────────────────────────── */}
        <div className="flex flex-col gap-3 sticky" style={{ top: 16 }}>
          <NodeMiniPreview
            nodeName={form.nodeName}
            selectedSkills={selectedSkillLabels}
            prereqCount={form.prereqNodeIds.length}
          />

          {/* Quick stats */}
          <aside
            style={{
              border: "1px solid var(--rule)",
              borderRadius: 3,
              background: "color-mix(in srgb, var(--ink-2) 60%, transparent)",
              padding: "12px 14px",
            }}
          >
            <div className="flex flex-col gap-1.5">
              {[
                { label: "SEASON", value: season },
                { label: "CODE", value: nodeCode || "—" },
                {
                  label: "MODE",
                  value: PREREQ_MODES.find(m => m.v === form.prereqMode)?.label ?? "NONE",
                },
                { label: "PREREQS", value: String(form.prereqNodeIds.length) },
                { label: "SKILLS", value: `${selectedSkillLabels.length}/6` },
                { label: "CID", value: hasCID ? "✓ pinned" : "not pinned" },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-baseline justify-between gap-2">
                  <span
                    className="mono"
                    style={{ fontSize: 9, letterSpacing: "0.1em", color: "var(--fg-faint)" }}
                  >
                    {label}
                  </span>
                  <span
                    className="mono"
                    style={{
                      fontSize: 10.5,
                      letterSpacing: "0.04em",
                      color: label === "CID" && hasCID ? "var(--green)" : "var(--fg-dim)",
                    }}
                  >
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>

      {/* ── Zone 3: Existing Nodes Ledger ─────────────────────────────── */}
      <div>
        <div
          style={{
            height: 1,
            background: "var(--rule)",
            margin: "4px 0 16px",
          }}
        />
        <NodeLedger nodes={nodes} isFrozen={isFrozen} onEdit={enterEditMode} />
      </div>
    </div>
  );
}
