"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keccak256, toHex } from "viem";
import type { NodeApiRow } from "../_lib/api";

export type NodeState = "earned" | "available" | "locked";
export type Anchor = { x: number; y: number };

// ─── Layout constants ────────────────────────────────────────────────────────
const NODE_R = 28; // hex circumradius (vertex distance from center)
const HEX_HALF_H = NODE_R * 0.866; // flat-side half-height (sin 60°)
const ATOM_R = 5;
const ORBIT_R = 44;
const COL_W = 200;
const ROW_H = 150;
const PAD = 80;

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 1.2;

// ─── Flat-top hexagon polygon points (centered at 0,0) ───────────────────────
const HEX_POINTS = `${NODE_R},0 ${NODE_R / 2},${HEX_HALF_H} ${-NODE_R / 2},${HEX_HALF_H} ${-NODE_R},0 ${-NODE_R / 2},${-HEX_HALF_H} ${NODE_R / 2},${-HEX_HALF_H}`;
const ATOM_HEX_HALF_H = ATOM_R * 0.866;
const ATOM_HEX_POINTS = `${ATOM_R},0 ${ATOM_R / 2},${ATOM_HEX_HALF_H} ${-ATOM_R / 2},${ATOM_HEX_HALF_H} ${-ATOM_R},0 ${-ATOM_R / 2},${-ATOM_HEX_HALF_H} ${ATOM_R / 2},${-ATOM_HEX_HALF_H}`;

// ─── State colours (solid fills — no gradients/filters) ─────────────────────
const STATE = {
  earned: { fill: "#3c8460", stroke: "#205c3e", text: "#1c1810", initials: "#f4eee0" },
  available: { fill: "#9a6b2a", stroke: "#6e4c1d", text: "#1c1810", initials: "#f4eee0" },
  locked: { fill: "#a89c84", stroke: "#7a7060", text: "#7a7060", initials: "#3a3426" },
};

// ─── Initials helper ─────────────────────────────────────────────────────────
function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 3).map(w => w[0]).join("").toUpperCase();
}

// ─── Per-skill atom palette ─────────────────────────────────────────────────
const ATOM_PALETTE = [
  "#6B5CA5", "#3A7A8A", "#B07A30", "#3D8059", "#8A4060",
  "#3A6A9A", "#7A6540", "#9A4A2A", "#4A8060", "#2A6090",
];
function skillColor(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = ((h * 31) + label.charCodeAt(i)) & 0xffff;
  return ATOM_PALETTE[h % ATOM_PALETTE.length];
}

// ─── Skill hash → label resolver (DB JOIN miss fallback) ────────────────────
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

// ─── Tier / layout computation ────────────────────────────────────────────────
function computeTiers(nodes: NodeApiRow[]): Map<number, number> {
  const tiers = new Map<number, number>();
  for (const n of nodes) {
    if (n.prerequisites.length === 0) tiers.set(n.node_id, 0);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of nodes) {
      if (tiers.has(n.node_id)) continue;
      const pts = n.prerequisites.map(id => tiers.get(id));
      if (pts.every(t => t !== undefined)) {
        tiers.set(n.node_id, Math.max(...(pts as number[])) + 1);
        changed = true;
      }
    }
  }
  for (const n of nodes) {
    if (!tiers.has(n.node_id)) tiers.set(n.node_id, 0);
  }
  return tiers;
}

type LayoutResult = {
  positions: Map<number, { x: number; y: number }>;
  tiers: Map<number, number>;
  svgWidth: number;
  svgHeight: number;
};

function computeLayout(nodes: NodeApiRow[]): LayoutResult {
  if (nodes.length === 0) {
    return { positions: new Map(), tiers: new Map(), svgWidth: 600, svgHeight: 400 };
  }
  const tiers = computeTiers(nodes);
  const byTier = new Map<number, number[]>();
  for (const [id, tier] of tiers) {
    if (!byTier.has(tier)) byTier.set(tier, []);
    byTier.get(tier)!.push(id);
  }
  const maxCount = Math.max(...Array.from(byTier.values()).map(v => v.length));
  const maxTier = Math.max(...Array.from(tiers.values()));
  const svgWidth = (maxTier + 1) * COL_W + 2 * PAD;
  const svgHeight = Math.max(maxCount * ROW_H + 2 * PAD, 420);

  const positions = new Map<number, { x: number; y: number }>();
  for (const [tier, ids] of byTier) {
    const count = ids.length;
    const startY = PAD + ((maxCount - count) * ROW_H) / 2 + ROW_H / 2;
    ids.forEach((id, i) => {
      positions.set(id, { x: PAD + tier * COL_W, y: startY + i * ROW_H });
    });
  }
  return { positions, tiers, svgWidth, svgHeight };
}

// ─── Public helper ────────────────────────────────────────────────────────────
export function getNodeState(node: NodeApiRow, earnedSet: Set<number>): NodeState {
  if (earnedSet.has(node.node_id)) return "earned";
  if (node.prerequisites.length === 0) return "available";
  const ok =
    node.prereq_mode === "OR"
      ? node.prerequisites.some(id => earnedSet.has(id))
      : node.prerequisites.every(id => earnedSet.has(id));
  return ok ? "available" : "locked";
}

// ─── Split long node names across two SVG <tspan> lines ─────────────────────
function splitLabel(name: string): [string, string | null] {
  if (name.length <= 14) return [name, null];
  const words = name.split(" ");
  let line1 = "";
  for (const w of words) {
    if ((line1 + (line1 ? " " : "") + w).length > 14) break;
    line1 += (line1 ? " " : "") + w;
  }
  const rest = name.slice(line1.length).trim();
  return [line1, rest || null];
}

// ─── Atom animation params (deterministic from skill_id) ────────────────────
function atomAnimParams(skillId: string, fallbackIdx: number) {
  const seedSrc = skillId && skillId.length >= 10 ? skillId.slice(2, 10) : (fallbackIdx + 1).toString(16).padStart(4, "0");
  const seed = parseInt(seedSrc, 16) || (fallbackIdx + 7);
  const dur = 36 + (seed % 28); // 36–64s — slow, organic
  const ccw = (seed >> 3) & 1;
  const beginOffset = -((seed % 100) / 100) * dur;
  const radiusJitter = ((seed >> 2) % 9) - 4; // –4..+4 px
  return { dur, ccw: !!ccw, beginOffset, radiusJitter };
}

// ─── Component ───────────────────────────────────────────────────────────────
type Props = {
  nodes: NodeApiRow[];
  earnedNodeIds: number[];
  selectedNodeId: number | null;
  onNodeClick: (nodeId: number) => void;
  onAnchorChange?: (anchor: Anchor | null) => void;
};

export function CompetencyGraph({
  nodes,
  earnedNodeIds,
  selectedNodeId,
  onNodeClick,
  onAnchorChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<number, SVGGElement>());

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  // Live container size — drives the viewBox so the SVG always fills the panel.
  const [containerSize, setContainerSize] = useState({ w: 1200, h: 700 });
  const initializedRef = useRef(false);

  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const earnedSet = useMemo(() => new Set(earnedNodeIds), [earnedNodeIds]);
  const stateMap = useMemo(() => {
    const m = new Map<number, NodeState>();
    for (const n of nodes) m.set(n.node_id, getNodeState(n, earnedSet));
    return m;
  }, [nodes, earnedSet]);
  const { positions, tiers, svgWidth, svgHeight } = useMemo(() => computeLayout(nodes), [nodes]);

  // ── Measure container; center graph initially. ──────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(1, r.width);
      const h = Math.max(1, r.height);
      setContainerSize({ w, h });
      if (!initializedRef.current && w > 1 && h > 1) {
        // Center the graph within the panel on first measurement.
        setPan({ x: svgWidth / 2 - w / 2, y: svgHeight / 2 - h / 2 });
        initializedRef.current = true;
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [svgWidth, svgHeight]);

  // Recompute popup anchor whenever selection or pan/zoom moves.
  useEffect(() => {
    if (!onAnchorChange) return;
    const containerEl = containerRef.current;
    if (selectedNodeId == null || !containerEl) {
      onAnchorChange(null);
      return;
    }
    const nodeEl = nodeRefs.current.get(selectedNodeId);
    if (!nodeEl) {
      onAnchorChange(null);
      return;
    }
    const nodeRect = nodeEl.getBoundingClientRect();
    const containerRect = containerEl.getBoundingClientRect();
    onAnchorChange({
      x: nodeRect.right - containerRect.left,
      y: (nodeRect.top + nodeRect.bottom) / 2 - containerRect.top,
    });
  }, [selectedNodeId, pan, zoom, onAnchorChange]);

  // ── Pan handlers ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isDragging) return;
    if (!containerRef.current) return;

    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragRef.current.moved = true;
      // 1 screen pixel ↔ (1 / zoom) world units when the SVG fills the panel.
      const scale = 1 / zoom;
      setPan({
        x: dragRef.current.panX - dx * scale,
        y: dragRef.current.panY - dy * scale,
      });
    };
    const onUp = () => {
      dragRef.current = null;
      setIsDragging(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isDragging, zoom]);

  const startPan = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y, moved: false };
    setIsDragging(true);
  };

  // Apply a new zoom while keeping the world point at the viewport centre stable.
  const applyZoom = useCallback(
    (next: number) => {
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
      const oldViewW = containerSize.w / zoom;
      const oldViewH = containerSize.h / zoom;
      const newViewW = containerSize.w / newZoom;
      const newViewH = containerSize.h / newZoom;
      setPan(p => ({
        x: p.x + (oldViewW - newViewW) / 2,
        y: p.y + (oldViewH - newViewH) / 2,
      }));
      setZoom(newZoom);
    },
    [containerSize.w, containerSize.h, zoom],
  );

  // ── Wheel zoom — only with Ctrl/Meta held; otherwise let the page scroll ──
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
      applyZoom(zoom * factor);
    },
    [applyZoom, zoom],
  );

  const zoomIn = () => applyZoom(zoom * ZOOM_STEP);
  const zoomOut = () => applyZoom(zoom / ZOOM_STEP);
  const resetView = () => {
    setZoom(1);
    setPan({
      x: svgWidth / 2 - containerSize.w / 2,
      y: svgHeight / 2 - containerSize.h / 2,
    });
  };

  // ── Empty state ──────────────────────────────────────────────────────────
  if (nodes.length === 0) {
    return (
      <div ref={containerRef} className="flex items-center justify-center" style={{ flex: 1, minHeight: 240 }}>
        <p className="mono" style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--fg-faint)" }}>
          NO COMPETENCY NODES DEFINED YET
        </p>
      </div>
    );
  }

  // viewBox is sized to the panel so the SVG renders at 1:1 px when zoom = 1,
  // and panning slides an unbounded window through the world coordinate space.
  const viewBox = `${pan.x} ${pan.y} ${containerSize.w / zoom} ${containerSize.h / zoom}`;

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        flex: 1,
        overflow: "hidden",
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        onWheel={onWheel}
        style={{
          display: "block",
          cursor: isDragging ? "grabbing" : "grab",
          userSelect: "none",
        }}
      >
        {/* Pan capture surface — huge transparent rect; nodes render above and stop propagation. */}
        <rect
          x={-1e5}
          y={-1e5}
          width={2e5}
          height={2e5}
          fill="transparent"
          onMouseDown={startPan}
        />

        {/* ── Edges ───────────────────────────────────────────────────────── */}
        {nodes.flatMap(node => {
          const toPos = positions.get(node.node_id);
          if (!toPos) return [];
          const toState = stateMap.get(node.node_id) ?? "locked";
          return node.prerequisites.map(prereqId => {
            const fromPos = positions.get(prereqId);
            if (!fromPos) return null;
            const fromState = stateMap.get(prereqId) ?? "locked";
            const bothEarned = fromState === "earned" && toState === "earned";
            const color = bothEarned ? "#3c8460" : toState === "available" ? "#9a6b2a" : "#a89c84";
            const dash = toState === "locked" ? "5 4" : undefined;
            const opacity = toState === "locked" ? 0.35 : 0.7;
            const x1 = fromPos.x + NODE_R;
            const y1 = fromPos.y;
            const x2 = toPos.x - NODE_R;
            const y2 = toPos.y;
            const bend = Math.abs(x2 - x1) * 0.45;
            return (
              <path
                key={`${prereqId}->${node.node_id}`}
                d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={color}
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeDasharray={dash}
                strokeOpacity={opacity}
              />
            );
          });
        })}

        {/* ── Nodes ───────────────────────────────────────────────────────── */}
        {nodes.map(node => {
          const pos = positions.get(node.node_id);
          if (!pos) return null;
          const state = stateMap.get(node.node_id) ?? "locked";
          const { stroke, fill, text, initials: initialsColor } = STATE[state];
          const isSelected = node.node_id === selectedNodeId;
          const atoms = node.thresholds;
          const name = node.node_name ?? node.node_code;
          const [line1, line2] = splitLabel(name);
          const initials = getInitials(name);
          const tier = tiers.get(node.node_id) ?? 0;
          const subLabel =
            tier === 0 && node.prerequisites.length === 0
              ? "ORIGIN"
              : `TIER-${tier} · ${atoms.length} REQ`;

          return (
            <g
              key={node.node_id}
              ref={el => {
                if (el) nodeRefs.current.set(node.node_id, el);
                else nodeRefs.current.delete(node.node_id);
              }}
              transform={`translate(${pos.x}, ${pos.y})`}
              onClick={e => {
                e.stopPropagation();
                if (dragRef.current?.moved) return; // suppress click after pan
                onNodeClick(node.node_id);
              }}
              onMouseDown={e => e.stopPropagation()}
              style={{ cursor: "pointer" }}
              opacity={state === "locked" ? 0.55 : 1}
            >
              {/* ─── Selection ring (slow rotation) ─────────────── */}
              {isSelected && (
                <g>
                  <animateTransform
                    attributeName="transform"
                    type="rotate"
                    from="0 0 0"
                    to="360 0 0"
                    dur="22s"
                    repeatCount="indefinite"
                  />
                  <circle
                    r={NODE_R + 10}
                    fill="none"
                    stroke={STATE[state].stroke}
                    strokeWidth={1.4}
                    strokeOpacity={0.55}
                    strokeDasharray="4 4"
                  />
                </g>
              )}

              {/* ─── Orbiting skill atoms ────────────────────────── */}
              {atoms.map((atom, i) => {
                const baseAngle = (2 * Math.PI * i) / atoms.length - Math.PI / 2;
                const { dur, ccw, beginOffset, radiusJitter } = atomAnimParams(atom.skill_id, i);
                const r = ORBIT_R + radiusJitter;
                const baseX = Math.cos(baseAngle) * r;
                const baseY = Math.sin(baseAngle) * r;
                const label = resolveSkillLabel(atom.skill_id, atom.skill_label);
                const aColor = skillColor(label);
                return (
                  <g key={atom.skill_id}>
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      from={ccw ? "360 0 0" : "0 0 0"}
                      to={ccw ? "0 0 0" : "360 0 0"}
                      dur={`${dur}s`}
                      begin={`${beginOffset}s`}
                      repeatCount="indefinite"
                    />
                    <g transform={`translate(${baseX} ${baseY})`}>
                      <polygon
                        points={ATOM_HEX_POINTS}
                        fill={aColor}
                        fillOpacity={state === "locked" ? 0.3 : 0.9}
                        stroke={aColor}
                        strokeWidth={0.6}
                        strokeOpacity={state === "locked" ? 0.2 : 0.7}
                      >
                        <title>
                          {label} — min {atom.min_points} pts
                        </title>
                      </polygon>
                    </g>
                  </g>
                );
              })}

              {/* ─── Main node hexagon (solid fill + initials inside) ──── */}
              <polygon
                points={HEX_POINTS}
                fill={fill}
                stroke={stroke}
                strokeWidth={isSelected ? 2.5 : 1.5}
                strokeLinejoin="round"
              />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontFamily="monospace"
                fontSize={initials.length >= 3 ? 11.5 : 13.5}
                fontWeight={700}
                letterSpacing="0.06em"
                fill={initialsColor}
                style={{ pointerEvents: "none" }}
              >
                {initials}
              </text>

              {/* ─── Labels (below hex) — fontWeight on parent so all lines bold when selected ─── */}
              <text
                textAnchor="middle"
                fontFamily="monospace"
                letterSpacing="0.04em"
                fontSize={11.5}
                fontWeight={isSelected ? 600 : 500}
                fill={text}
              >
                <tspan x={0} dy={HEX_HALF_H + 18}>
                  {line1}
                </tspan>
                {line2 && (
                  <tspan x={0} dy={13.5}>
                    {line2.length > 16 ? line2.slice(0, 14) + "…" : line2}
                  </tspan>
                )}
              </text>
              <text
                textAnchor="middle"
                fontFamily="monospace"
                fontSize={8.5}
                letterSpacing="0.14em"
                fill={state === "locked" ? "#9a9080" : "#8a8268"}
                y={HEX_HALF_H + (line2 ? 46 : 32)}
              >
                {subLabel}
              </text>
            </g>
          );
        })}
      </svg>

      {/* ── Zoom controls (top-right, below the legend bar) ─────────────── */}
      <div
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          zIndex: 4,
        }}
      >
        {[
          { label: "+", onClick: zoomIn, title: "Zoom in" },
          { label: "−", onClick: zoomOut, title: "Zoom out" },
          { label: "⊙", onClick: resetView, title: "Reset view" },
        ].map(b => (
          <button
            key={b.label}
            type="button"
            onClick={b.onClick}
            title={b.title}
            style={{
              width: 30,
              height: 30,
              borderRadius: 3,
              border: "1px solid var(--rule)",
              background: "var(--ink-1)",
              color: "var(--fg-mute)",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 14,
              lineHeight: 1,
              cursor: "pointer",
              transition: "background 0.12s, color 0.12s, border-color 0.12s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "var(--ink-2)";
              e.currentTarget.style.color = "var(--fg)";
              e.currentTarget.style.borderColor = "var(--fg-mute)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "var(--ink-1)";
              e.currentTarget.style.color = "var(--fg-mute)";
              e.currentTarget.style.borderColor = "var(--rule)";
            }}
          >
            {b.label}
          </button>
        ))}
        <div
          className="mono text-center"
          style={{
            marginTop: 4,
            fontSize: 9,
            letterSpacing: "0.06em",
            color: "var(--fg-faint)",
          }}
        >
          {Math.round(zoom * 100)}%
        </div>
      </div>
    </div>
  );
}
