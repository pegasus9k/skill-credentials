"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CreateNodeForm } from "./_components/CreateNodeForm";
import { Wizard } from "./_components/Wizard";
import { type BadgeRow, type NodeRow, type SkillRow, fetchBadges, fetchNodes, fetchSkills } from "./_lib/api";
import { SEASONS } from "./_lib/curriculum";
import { hashLabel } from "./_lib/hash";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

type ActiveTab = "badge" | "node";

const AdministratorPage: NextPage = () => {
  const { address } = useAccount();
  const [season, setSeason] = useState(SEASONS[0]);
  const [activeTab, setActiveTab] = useState<ActiveTab>("badge");
  const [badges, setBadges] = useState<BadgeRow[]>([]);
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const seasonHash = hashLabel(season);

  const { data: isFrozenChain } = useScaffoldReadContract({
    contractName: "SkillBadge",
    functionName: "seasonFrozen",
    args: [seasonHash],
  } as any);
  const isFrozen = Boolean(isFrozenChain);

  const { writeContractAsync: writeBadge, isMining: badgeMining } = useScaffoldWriteContract({
    contractName: "SkillBadge",
  });
  const { writeContractAsync: writeTree, isMining: treeMining } = useScaffoldWriteContract({
    contractName: "SkillGraph",
  });

  const refresh = useCallback(async () => {
    try {
      const [s, b, n] = await Promise.all([
        fetchSkills().catch(() => [] as SkillRow[]),
        fetchBadges(),
        fetchNodes().catch(() => [] as NodeRow[]),
      ]);
      setSkills(s);
      setBadges(b);
      setNodes(n);
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e?.message || "Failed to reach backend at /badges");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onFreeze = async () => {
    if (isFrozen) return;
    // Irreversible — once both contracts mark the season frozen, no badge or
    // node can be defined or updated under that seasonId, so we gate the call
    // on an explicit user confirmation.
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        `Freeze season ${season}? This is irreversible — badges and competency nodes can no longer be defined or edited under this seasonId.`,
      );
      if (!ok) return;
    }
    try {
      await writeBadge({ functionName: "freezeSeason", args: [seasonHash] } as any);
      await writeTree({ functionName: "freezeSeason", args: [seasonHash] } as any);
      notification.success(`Season ${season} frozen on both contracts`);
    } catch {
      // useTransactor already shows toasts on failure.
    }
  };

  const shortAddr = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—";

  return (
    <div className="platform min-h-screen">
      {/* ── Top admin bar ─────────────────────────────────────────── */}
      <div
        className="hairline-b flex items-center justify-between gap-4 flex-wrap px-8"
        style={{ padding: "14px 32px", background: "color-mix(in srgb, var(--ink-1) 85%, transparent)" }}
      >
        <div className="flex items-baseline gap-3 mono" style={{ fontSize: 11, letterSpacing: "0.08em" }}>
          <span className="serif" style={{ fontSize: 22, color: "var(--fg)", letterSpacing: "-0.02em" }}>
            Skill Credentials<span style={{ color: "var(--accent)" }}>.</span>
          </span>
          <span style={{ color: "var(--fg-mute)", textTransform: "uppercase", letterSpacing: "0.12em" }}>ADMIN</span>
          <span style={{ color: "var(--fg-faint)" }}>/</span>
          <span style={{ color: "var(--fg-mute)", textTransform: "uppercase", letterSpacing: "0.12em" }}>IST</span>
          <span style={{ color: "var(--fg-faint)" }}>/</span>
          <span style={{ color: "var(--fg)", textTransform: "uppercase", letterSpacing: "0.12em" }}>
            Administrator · {season}
          </span>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <span className={`pill ${isFrozen ? "pill-frozen" : "pill-open"}`}>
            <span className="pill-dot" />
            {isFrozen ? "Season frozen" : "Season open"}
          </span>
          <button
            type="button"
            className="k-btn"
            disabled={isFrozen || badgeMining || treeMining}
            onClick={onFreeze}
            title="Freezes the season on SkillBadge + SkillGraph (HEI_ADMIN_ROLE)"
          >
            ❄ Freeze season
          </button>
          <Link href="/" className="k-btn k-btn-ghost" style={{ textDecoration: "none" }}>
            ← Back to site
          </Link>
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
                background: "color-mix(in srgb, var(--cyan) 35%, var(--ink-3))",
                color: "var(--cyan)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--font-display)",
                fontSize: 14,
              }}
            >
              G
            </span>
            <div className="flex flex-col leading-tight">
              <span className="mono" style={{ fontSize: 9.5, letterSpacing: "0.1em", color: "var(--fg-faint)" }}>
                ADMINISTRATOR
              </span>
              <span className="mono" style={{ fontSize: 11, color: "var(--fg-dim)" }}>
                {shortAddr}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Section tabs ─────────────────────────────────────────── */}
      <div className="hairline-b flex items-center justify-between gap-6 flex-wrap" style={{ padding: "10px 32px" }}>
        <div className="flex flex-wrap items-center gap-6">
          {[
            { n: "01", label: "CREATE BADGE", tab: "badge" as ActiveTab },
            { n: "02", label: "CREATE NODE", tab: "node" as ActiveTab },
            { n: "03", label: "UPDATE HISTORY", tab: null },
            { n: "04", label: "SEASON LEDGER", tab: null },
          ].map(t => {
            const isActive = t.tab === activeTab;
            const isEnabled = t.tab !== null;
            return (
              <button
                key={t.n}
                type="button"
                onClick={() => t.tab && setActiveTab(t.tab)}
                disabled={!isEnabled}
                className="mono"
                style={{
                  all: "unset",
                  fontSize: 10.5,
                  letterSpacing: "0.14em",
                  color: isActive ? "var(--accent)" : "var(--fg-mute)",
                  cursor: isEnabled ? "pointer" : "not-allowed",
                  opacity: isEnabled ? 1 : 0.5,
                  paddingBottom: 2,
                  borderBottom: isActive ? "1px solid var(--accent)" : "1px solid transparent",
                }}
                title={!isEnabled ? "Coming soon" : undefined}
              >
                <span style={{ color: "var(--fg-faint)", marginRight: 8 }}>{t.n}</span>
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2.5">
          <span className="mono" style={{ fontSize: 10, color: "var(--fg-mute)", letterSpacing: "0.12em" }}>
            ACTIVE SEASON
          </span>
          <select
            className="k-input"
            value={season}
            onChange={e => setSeason(e.target.value)}
            style={{ width: 110, padding: "6px 8px", fontSize: 11 }}
          >
            {SEASONS.map(s => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────── */}
      <main className="mx-auto" style={{ maxWidth: 1280, padding: "32px" }}>
        <header className="mb-5">
          <h1
            className="serif"
            style={{ fontSize: 36, fontWeight: 400, letterSpacing: "-0.02em", margin: 0, color: "var(--fg)" }}
          >
            {activeTab === "badge" ? "Create badge definition" : "Define competency node"}
          </h1>
          <p className="mono mt-1.5" style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--fg-mute)" }}>
            {activeTab === "badge"
              ? "BADGEDEF · LEDGER · SEASON-SCOPED · IMMUTABLE IDENTITY"
              : "NODE · DAG INFRASTRUCTURE · SEASON-SCOPED · UNLOCKABLE"}
          </p>
        </header>

        {loadError && (
          <div
            className="mono mb-4"
            style={{
              padding: "10px 12px",
              border: "1px solid color-mix(in srgb, var(--magenta) 40%, var(--rule))",
              background: "color-mix(in srgb, var(--magenta) 8%, transparent)",
              color: "var(--magenta)",
              fontSize: 11,
              letterSpacing: "0.06em",
              borderRadius: 3,
            }}
          >
            BACKEND UNREACHABLE · {loadError} · is the indexer running on{" "}
            {process.env.NEXT_PUBLIC_API_URL || "localhost:3001"}?
          </div>
        )}

        {activeTab === "badge" && (
          <Wizard badges={badges} skills={skills} isFrozen={isFrozen} onAfterSubmit={refresh} />
        )}

        {activeTab === "node" && (
          <CreateNodeForm
            season={season}
            nodes={nodes}
            skills={skills}
            isFrozen={isFrozen}
            onAfterSubmit={refresh}
          />
        )}
      </main>
    </div>
  );
};

export default AdministratorPage;
