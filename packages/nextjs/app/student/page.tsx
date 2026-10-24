"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { type Anchor, CompetencyGraph, getNodeState } from "./_components/CompetencyGraph";
import { NodePopup } from "./_components/NodePopup";
import { StudentSidebar } from "./_components/StudentSidebar";
import { type NodeApiRow, type StudentData, fetchNodes, fetchStudent } from "./_lib/api";
import type { NextPage } from "next";
import { useAccount } from "wagmi";

type Tab = "graph" | "portfolio";

const StudentPage: NextPage = () => {
  const { address } = useAccount();

  // ── Data state ──────────────────────────────────────────────────────────────
  const [studentData, setStudentData] = useState<StudentData | null>(null);
  const [nodes, setNodes] = useState<NodeApiRow[]>([]);
  const [loadingStudent, setLoadingStudent] = useState(false);
  const [loadingNodes, setLoadingNodes] = useState(false);
  const [studentError, setStudentError] = useState<string | null>(null);
  const [nodesError, setNodesError] = useState<string | null>(null);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>("graph");
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [selectedBadgeIds, setSelectedBadgeIds] = useState<Set<number>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [popupAnchor, setPopupAnchor] = useState<Anchor | null>(null);

  // ── Fetch helpers ───────────────────────────────────────────────────────────
  const loadNodes = useCallback(async () => {
    setLoadingNodes(true);
    setNodesError(null);
    try {
      setNodes(await fetchNodes());
    } catch (e: any) {
      setNodesError(e?.message ?? "Failed to fetch nodes");
    } finally {
      setLoadingNodes(false);
    }
  }, []);

  const loadStudent = useCallback(
    async (wallet: string) => {
      setLoadingStudent(true);
      setStudentError(null);
      try {
        setStudentData(await fetchStudent(wallet));
      } catch (e: any) {
        const msg: string = e?.message ?? "";
        if (msg.includes("404") || msg.includes("Student not found")) {
          setStudentError("NOT_FOUND");
        } else {
          setStudentError(msg || "Failed to fetch student data");
        }
      } finally {
        setLoadingStudent(false);
      }
    },
    [],
  );

  useEffect(() => {
    loadNodes();
  }, [loadNodes]);

  useEffect(() => {
    if (address) loadStudent(address);
  }, [address, loadStudent]);

  // ── Derived state ───────────────────────────────────────────────────────────
  const earnedNodeIds = useMemo(
    () => studentData?.competencies.map(c => c.node_id) ?? [],
    [studentData],
  );

  const earnedSet = useMemo(() => new Set(earnedNodeIds), [earnedNodeIds]);

  const selectedNode = useMemo(
    () => (selectedNodeId !== null ? nodes.find(n => n.node_id === selectedNodeId) ?? null : null),
    [selectedNodeId, nodes],
  );

  const selectedNodeState = useMemo(() => {
    if (!selectedNode) return null;
    return getNodeState(selectedNode, earnedSet);
  }, [selectedNode, earnedSet]);

  const allocationMode = selectedNodeState === "available";

  // ── Interaction handlers ─────────────────────────────────────────────────────
  const handleNodeClick = useCallback((nodeId: number) => {
    setSelectedNodeId(prev => (prev === nodeId ? null : nodeId));
    setSelectedBadgeIds(new Set());
  }, []);

  const handleBadgeToggle = useCallback((tokenId: number) => {
    setSelectedBadgeIds(prev => {
      const next = new Set(prev);
      if (next.has(tokenId)) next.delete(tokenId);
      else next.add(tokenId);
      return next;
    });
  }, []);

  const handleAllocateSuccess = useCallback(async () => {
    if (!address) return;
    setSelectedNodeId(null);
    setSelectedBadgeIds(new Set());
    await loadStudent(address);
  }, [address, loadStudent]);

  const handleClosePopup = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedBadgeIds(new Set());
  }, []);

  // ── Wallet guard ────────────────────────────────────────────────────────────
  const shortAddr = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—";

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="platform" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <div
        className="hairline-b flex items-center justify-between gap-4 flex-wrap"
        style={{
          padding: "14px 28px",
          background: "color-mix(in srgb, var(--ink-1) 85%, transparent)",
          flexShrink: 0,
        }}
      >
        <div className="flex items-baseline gap-3 mono" style={{ fontSize: 11, letterSpacing: "0.08em" }}>
          <span
            className="serif"
            style={{ fontSize: 22, color: "var(--fg)", letterSpacing: "-0.02em" }}
          >
            Skill Credentials<span style={{ color: "var(--accent)" }}>.</span>
          </span>
          <span style={{ color: "var(--fg-faint)" }}>/</span>
          <span style={{ color: "var(--fg-mute)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            {studentData?.student.degree ?? "…"}
          </span>
          <span style={{ color: "var(--fg-faint)" }}>/</span>
          <span style={{ color: "var(--fg)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Portfolio · {studentData?.student.student_name?.split(" ")[0] ?? "…"}
          </span>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <Link
            href="/administrator"
            className="k-btn"
            style={{
              textDecoration: "none",
              fontSize: 11,
              letterSpacing: "0.06em",
              borderColor: "color-mix(in srgb, var(--amber) 50%, var(--rule))",
              color: "var(--amber)",
            }}
          >
            ◆ ADMINISTRATOR
          </Link>
          <Link href="/" className="k-btn k-btn-ghost" style={{ textDecoration: "none" }}>
            ← Back to site
          </Link>
          {/* Student avatar */}
          <div
            className="flex items-center gap-2"
            style={{
              padding: "4px 10px 4px 4px",
              border: "1px solid var(--rule)",
              borderRadius: 999,
              background: "var(--ink-2)",
            }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "color-mix(in srgb, var(--accent) 30%, var(--ink-3))",
                color: "var(--accent)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--font-display)",
                fontSize: 14,
              }}
            >
              {studentData?.student.student_name?.[0]?.toUpperCase() ?? "?"}
            </span>
            <div className="flex flex-col leading-tight">
              <span
                className="mono"
                style={{ fontSize: 9.5, letterSpacing: "0.1em", color: "var(--fg-faint)" }}
              >
                STUDENT
              </span>
              <span className="mono" style={{ fontSize: 11, color: "var(--fg-dim)" }}>
                {studentData?.student.student_name?.split(" ")[0] ?? shortAddr}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tab bar ───────────────────────────────────────────────────────── */}
      <div
        className="hairline-b flex items-center gap-6"
        style={{ padding: "10px 28px", flexShrink: 0 }}
      >
        {(["graph", "portfolio"] as Tab[]).map((tab, i) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className="mono"
            style={{
              all: "unset",
              cursor: "pointer",
              fontSize: 10.5,
              letterSpacing: "0.14em",
              color: activeTab === tab ? "var(--accent)" : "var(--fg-mute)",
              paddingBottom: 2,
              borderBottom: activeTab === tab ? "1px solid var(--accent)" : "1px solid transparent",
              transition: "color 0.12s",
            }}
          >
            <span style={{ color: "var(--fg-faint)", marginRight: 8 }}>0{i + 1}</span>
            {tab === "graph" ? "COMPETENCY GRAPH" : "PORTFOLIO"}
          </button>
        ))}
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ── No wallet ─────────────────────────────────────────────────── */}
        {!address && (
          <div className="flex items-center justify-center" style={{ flex: 1, padding: 32 }}>
            <div
              className="mono"
              style={{
                padding: "18px 24px",
                border: "1px solid var(--rule)",
                borderRadius: 4,
                background: "var(--ink-2)",
                fontSize: 11,
                letterSpacing: "0.08em",
                color: "var(--fg-mute)",
                textAlign: "center",
              }}
            >
              CONNECT A WALLET TO VIEW YOUR STUDENT PORTFOLIO
            </div>
          </div>
        )}

        {/* ── Student not found ─────────────────────────────────────────── */}
        {address && studentError === "NOT_FOUND" && (
          <div className="flex items-center justify-center" style={{ flex: 1, padding: 32 }}>
            <div
              className="mono"
              style={{
                padding: "18px 24px",
                border: "1px dashed var(--rule)",
                borderRadius: 4,
                background: "var(--ink-2)",
                fontSize: 11,
                letterSpacing: "0.08em",
                color: "var(--fg-mute)",
                textAlign: "center",
              }}
            >
              NO STUDENT PROFILE FOUND FOR THIS WALLET<br />
              <span style={{ color: "var(--fg-faint)", fontSize: 10, marginTop: 6, display: "block" }}>
                Connect a registered student wallet.
              </span>
            </div>
          </div>
        )}

        {/* ── Backend error ─────────────────────────────────────────────── */}
        {address && studentError && studentError !== "NOT_FOUND" && (
          <div
            className="mono"
            style={{
              margin: "16px 28px",
              padding: "10px 14px",
              border: "1px solid color-mix(in srgb, var(--magenta) 40%, var(--rule))",
              background: "color-mix(in srgb, var(--magenta) 8%, transparent)",
              color: "var(--magenta)",
              fontSize: 11,
              letterSpacing: "0.06em",
              borderRadius: 3,
            }}
          >
            BACKEND UNREACHABLE · {studentError}
          </div>
        )}

        {/* ── Loading spinner ────────────────────────────────────────────── */}
        {address && (loadingStudent || loadingNodes) && !studentData && !studentError && (
          <div className="flex items-center justify-center" style={{ flex: 1 }}>
            <span className="mono" style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--fg-faint)" }}>
              LOADING…
            </span>
          </div>
        )}

        {/* ── Main content ──────────────────────────────────────────────── */}
        {address && studentData && !studentError && (
          <>
            {/* ── COMPETENCY GRAPH tab ──────────────────────────────────── */}
            {activeTab === "graph" && (
              <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
                {/* Sidebar toggle */}
                <button
                  type="button"
                  onClick={() => setSidebarOpen(o => !o)}
                  className="mono"
                  style={{
                    position: "absolute",
                    left: sidebarOpen ? 270 : 4,
                    top: "50%",
                    transform: "translateY(-50%)",
                    zIndex: 5,
                    padding: "6px 4px",
                    border: "1px solid var(--rule)",
                    borderRadius: 2,
                    background: "var(--ink-1)",
                    color: "var(--fg-mute)",
                    fontSize: 10,
                    cursor: "pointer",
                    transition: "left 0.2s",
                    writingMode: "vertical-rl",
                    letterSpacing: "0.1em",
                  }}
                  aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
                >
                  {sidebarOpen ? "◀" : "▶"}
                </button>

                {/* Sidebar */}
                {sidebarOpen && (
                  <StudentSidebar
                    studentData={studentData}
                    nodes={nodes}
                    allocationMode={allocationMode}
                    selectedNodeState={selectedNodeState}
                    selectedBadgeIds={selectedBadgeIds}
                    onBadgeToggle={handleBadgeToggle}
                  />
                )}

                {/* Graph panel */}
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    position: "relative",
                  }}
                >
                  {/* Legend row */}
                  <div
                    className="hairline-b flex items-center justify-between flex-wrap"
                    style={{ padding: "8px 16px", flexShrink: 0, gap: 12 }}
                  >
                    <div className="flex items-center gap-4">
                      {[
                        { state: "earned", color: "#2e7350", label: "EARNED" },
                        { state: "available", color: "#9a6b2a", label: "AVAILABLE" },
                        { state: "locked", color: "#9a9080", label: "LOCKED" },
                      ].map(item => (
                        <div key={item.state} className="flex items-center gap-1.5">
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: item.color,
                              display: "inline-block",
                            }}
                          />
                          <span
                            className="mono"
                            style={{ fontSize: 9.5, letterSpacing: "0.1em", color: "var(--fg-mute)" }}
                          >
                            {item.label}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Node count */}
                    <span
                      className="mono"
                      style={{ fontSize: 9.5, letterSpacing: "0.08em", color: "var(--fg-faint)" }}
                    >
                      {earnedNodeIds.length} / {nodes.length} unlocked
                    </span>
                  </div>

                  {/* Graph area with popup overlay */}
                  <div
                    style={{
                      flex: 1,
                      position: "relative",
                      overflow: "hidden",
                      display: "flex",
                    }}
                  >
                    {/* No nodes empty state */}
                    {nodes.length === 0 && !loadingNodes && (
                      <div
                        className="flex items-center justify-center"
                        style={{ flex: 1 }}
                      >
                        <p
                          className="mono"
                          style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--fg-faint)" }}
                        >
                          {nodesError
                            ? `NODES ERROR · ${nodesError}`
                            : "NO COMPETENCY NODES DEFINED YET"}
                        </p>
                      </div>
                    )}

                    {/* All nodes locked hint */}
                    {nodes.length > 0 && earnedNodeIds.length === 0 && (
                      <div
                        className="mono"
                        style={{
                          position: "absolute",
                          bottom: 16,
                          left: "50%",
                          transform: "translateX(-50%)",
                          fontSize: 9.5,
                          letterSpacing: "0.08em",
                          color: "var(--fg-faint)",
                          pointerEvents: "none",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Earn badges to begin unlocking competencies
                      </div>
                    )}

                    {/* SVG competency graph */}
                    {nodes.length > 0 && (
                      <CompetencyGraph
                        nodes={nodes}
                        earnedNodeIds={earnedNodeIds}
                        selectedNodeId={selectedNodeId}
                        onNodeClick={handleNodeClick}
                        onAnchorChange={setPopupAnchor}
                      />
                    )}

                    {/* Node detail popup (absolute overlay) */}
                    {selectedNode && selectedNodeState && popupAnchor && (
                      <NodePopup
                        node={selectedNode}
                        nodeState={selectedNodeState}
                        allNodes={nodes}
                        earnedNodeIds={earnedNodeIds}
                        studentBadges={studentData.badges}
                        competencies={studentData.competencies}
                        selectedBadgeIds={selectedBadgeIds}
                        anchor={popupAnchor}
                        onAllocateSuccess={handleAllocateSuccess}
                        onClose={handleClosePopup}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── PORTFOLIO tab ─────────────────────────────────────────── */}
            {activeTab === "portfolio" && (
              <div className="flex items-center justify-center" style={{ flex: 1 }}>
                <div
                  className="mono text-center"
                  style={{
                    padding: "24px 32px",
                    border: "1px dashed var(--rule)",
                    borderRadius: 4,
                    color: "var(--fg-mute)",
                    fontSize: 11,
                    letterSpacing: "0.08em",
                  }}
                >
                  COMING SOON
                  <span
                    style={{
                      display: "block",
                      fontSize: 10,
                      color: "var(--fg-faint)",
                      marginTop: 6,
                      letterSpacing: "0.04em",
                      textTransform: "none",
                    }}
                  >
                    Full badge portfolio with filtering
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default StudentPage;
