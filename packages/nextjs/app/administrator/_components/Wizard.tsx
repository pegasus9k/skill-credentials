"use client";

import React, { useEffect, useMemo, useState } from "react";
import { type BadgeRow, type SkillRow, pinMetadata } from "../_lib/api";
import { COURSES, COURSE_BUDGET, DEFAULT_SKILLS, DEGREES, EVENTS, SEASONS } from "../_lib/curriculum";
import { hashLabel, toBytes32 } from "../_lib/hash";
import { ExistingBadgesPanel, Field, KInput, KSelect, KTextarea, SkillMatrix, StepDots } from "./atoms";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

type WizardForm = {
  seasonId: string; // string label (e.g. "2026-S2"); hashed at submit
  degree: string; // UI-only filter
  courseId: string; // string label (e.g. "AAut112"); hashed at submit
  event: string; // event code (e.g. "W6")
  badgeCode: string; // string label (e.g. "AAut112_W6"); hashed at submit
  description: string; // pinned to IPFS, not on-chain
  skills: Record<string, number>; // { skillLabel: points }
  metadataCID: string; // 0x... bytes32; populated by Mock button or manual
  editingTokenId: number | null; // null = create flow, number = editing this badge
};

const emptyForm = (): WizardForm => ({
  seasonId: SEASONS[0],
  // Bug 1 fix: derive from DEGREES[0] so the form's degree always matches an
  // available dropdown option (curriculum.ts now exports MECD/MEGE, not MAIS).
  degree: DEGREES[0]?.id ?? "",
  courseId: "",
  event: "",
  badgeCode: "",
  description: "",
  skills: {},
  metadataCID: "",
  editingTokenId: null,
});

export function Wizard({
  badges,
  skills,
  isFrozen,
  onAfterSubmit,
}: {
  badges: BadgeRow[];
  skills: SkillRow[];
  isFrozen: boolean;
  onAfterSubmit: () => void;
}) {
  const [form, setForm] = useState<WizardForm>(emptyForm);
  const [step, setStep] = useState(0);
  const [pinning, setPinning] = useState(false);
  const [defined, setDefined] = useState(false);

  const { writeContractAsync, isMining } = useScaffoldWriteContract({ contractName: "SkillBadge" });

  // Skills displayed in the chip selector. Prefer backend list; fall back
  // to the static defaults so the UI doesn't flicker before /skills lands.
  const skillOptions = useMemo(() => {
    if (skills.length > 0)
      return skills.map(s => ({ label: s.skill_label, description: s.description || s.skill_label }));
    return DEFAULT_SKILLS;
  }, [skills]);

  const courseList = COURSES[form.degree] || [];
  const eventList = form.courseId ? EVENTS[form.courseId] || [] : [];

  // The /badges payload returns course_id as a bytes32 hash (the indexer
  // never stores the original label). Hash the in-form course label to
  // compare apples-to-apples — without this the filter is silently empty
  // and the "already defined" detection never fires.
  const courseIdHash = form.courseId ? hashLabel(form.courseId) : "";
  const courseBadges = useMemo(
    () => (courseIdHash ? badges.filter(b => b.course_id === courseIdHash) : []),
    [badges, courseIdHash],
  );
  // When editing, the existing version of this badge is *replaced* by the
  // current draft — so we must exclude its old points from `used`, otherwise
  // the bar reads "40 + 6" (treating the edit as a new badge) instead of the
  // correct "20 + 6" (W5's old 20 pts gone, replaced by the new 6 pts).
  const used = courseBadges.reduce((sum, b) => {
    if (form.editingTokenId !== null && b.token_id === form.editingTokenId) return sum;
    return sum + b.skills.reduce((s, sk) => s + sk.points, 0);
  }, 0);
  const draftPts = Object.values(form.skills).reduce((s, v) => s + v, 0);
  const projected = used + draftPts;
  const overBudget = projected > COURSE_BUDGET;

  // Map each course event-code to whether a badge has already been anchored
  // for it. We derive the event code from the resolved badge_name (format:
  // "<COURSE>_<EVENT>", e.g. "APROF_W5") because the wizard always builds
  // badge codes that way; falling back to week/evaluation_type covers
  // legacy rows. If the set has the event's code, the row is locked.
  const definedEvents = useMemo(() => {
    const set = new Set<string>();
    for (const b of courseBadges) {
      const fromName = b.badge_name?.split("_").pop()?.toUpperCase();
      if (fromName) {
        set.add(fromName);
        continue;
      }
      if (b.week != null) set.add(`W${b.week}`);
      else if (b.evaluation_type) set.add(b.evaluation_type.toUpperCase());
    }
    return set;
  }, [courseBadges]);

  // Reverse lookup: event-code → existing badge for this course. Used by the
  // Step-3 "Edit" click to pre-fill Step 4 with the on-chain row's contents.
  const badgeByEvent = useMemo(() => {
    const m = new Map<string, BadgeRow>();
    for (const b of courseBadges) {
      const fromName = b.badge_name?.split("_").pop()?.toUpperCase();
      const ev = fromName ?? (b.week != null ? `W${b.week}` : b.evaluation_type?.toUpperCase() ?? "");
      if (ev) m.set(ev, b);
    }
    return m;
  }, [courseBadges]);

  const canStep1 = !!form.seasonId && !!form.degree;
  const canStep2 = canStep1 && !!form.courseId;
  const canStep3 = canStep2 && !!form.event;
  const canSubmit =
    canStep3 &&
    Object.keys(form.skills).length > 0 &&
    !overBudget &&
    !isFrozen &&
    !!form.badgeCode &&
    !!form.metadataCID &&
    !pinning &&
    !isMining &&
    !defined;

  // Walk back if the user invalidates an upstream step
  useEffect(() => {
    if (!canStep1) setStep(0);
    else if (!canStep2 && step > 1) setStep(1);
    else if (!canStep3 && step > 2) setStep(2);
  }, [canStep1, canStep2, canStep3, step]);

  // Field setters that cascade-clear deeper picks. Any edit invalidates the
  // metadataCID — pinned JSON is content-addressed, so a stale CID after a
  // field change would point at JSON that no longer matches the form.
  const setSeason = (seasonId: string) =>
    setForm(f => ({ ...f, seasonId, courseId: "", event: "", badgeCode: "", skills: {}, metadataCID: "" }));
  const setDegree = (degree: string) =>
    setForm(f => ({ ...f, degree, courseId: "", event: "", badgeCode: "", skills: {}, metadataCID: "" }));
  const setCourse = (courseId: string) =>
    setForm(f => ({ ...f, courseId, event: "", badgeCode: "", skills: {}, metadataCID: "" }));
  const setEvent = (ev: string) => {
    const auto = form.courseId && ev ? `${form.courseId.toUpperCase()}_${ev}` : "";
    setForm(f => ({ ...f, event: ev, badgeCode: auto, metadataCID: "" }));
  };

  const onPin = async () => {
    if (!form.event || !form.courseId || Object.keys(form.skills).length === 0) return;
    setPinning(true);
    try {
      const courseName = courseList.find(c => c.code === form.courseId)?.name;
      const eventName = eventList.find(e => e.code === form.event)?.name;
      const evType = eventName?.toLowerCase().includes("exam")
        ? "Exam"
        : eventName?.toLowerCase().includes("project")
          ? "Project"
          : eventName?.toLowerCase().includes("lab")
            ? "Lab"
            : "Evaluation";
      const wkMatch = /^W(\d+)$/.exec(form.event);
      const payload = {
        name: form.badgeCode,
        description: form.description || "",
        properties: {
          season: form.seasonId,
          course: form.courseId,
          courseName,
          evaluationType: evType,
          week: wkMatch ? Number(wkMatch[1]) : null,
          badgeCode: form.badgeCode,
          institution: "IST",
        },
        attributes: Object.entries(form.skills).map(([trait_type, value]) => ({ trait_type, value })),
      };
      const { metadataCID: pinned } = await pinMetadata(payload);
      setForm(f => ({ ...f, metadataCID: pinned }));
      notification.success("Pinned metadata to IPFS");
    } catch (e: any) {
      notification.error(`Pin failed: ${e?.message || "unknown"}`);
    } finally {
      setPinning(false);
    }
  };

  // ── Enter / exit edit mode ──────────────────────────────────────────────
  // Loads an existing badge into the form for re-anchoring via updateBadge.
  // Season / degree / course / event are kept locked to the on-chain row;
  // only badge code, description, and skill vector are user-editable.
  const enterEditMode = (eventCode: string) => {
    const badge = badgeByEvent.get(eventCode.toUpperCase());
    if (!badge) return;
    const nextSkills: Record<string, number> = {};
    for (const sk of badge.skills) {
      if (sk.skill_label && sk.skill_label !== "UNKNOWN") {
        nextSkills[sk.skill_label] = sk.points;
      }
    }
    const autoCode = `${form.courseId.toUpperCase()}_${eventCode}`;
    setForm(f => ({
      ...f,
      event: eventCode,
      badgeCode: badge.badge_name ?? autoCode,
      description: badge.description ?? "",
      skills: nextSkills,
      metadataCID: badge.metadata_cid, // keep existing CID until re-pin
      editingTokenId: badge.token_id,
    }));
    setStep(3); // jump straight to Step 4
  };

  const exitEditMode = () => {
    setForm(f => ({
      ...f,
      event: "",
      badgeCode: "",
      description: "",
      skills: {},
      metadataCID: "",
      editingTokenId: null,
    }));
    setStep(2); // back to event picker
  };

  const isEditing = form.editingTokenId !== null;

  const onSubmit = async () => {
    if (!canSubmit) return;
    const skillEntries = Object.entries(form.skills);
    try {
      let txHash: `0x${string}` | undefined;
      if (isEditing && form.editingTokenId !== null) {
        // UPDATE path — same shape minus seasonId/courseId (immutable on-chain).
        const updateParams = {
          badgeCode: hashLabel(form.badgeCode),
          skillIds: skillEntries.map(([k]) => hashLabel(k)),
          points: skillEntries.map(([, v]) => v),
          metadataCID: toBytes32(form.metadataCID),
        } as const;
        txHash = await writeContractAsync({
          functionName: "updateBadge",
          args: [BigInt(form.editingTokenId), updateParams],
        } as any);
      } else {
        // CREATE path
        const params = {
          seasonId: hashLabel(form.seasonId),
          courseId: hashLabel(form.courseId),
          badgeCode: hashLabel(form.badgeCode),
          skillIds: skillEntries.map(([k]) => hashLabel(k)),
          points: skillEntries.map(([, v]) => v),
          metadataCID: toBytes32(form.metadataCID),
        } as const;
        txHash = await writeContractAsync({
          functionName: "defineBadge",
          args: [params],
        } as any);
      }
      // The SE-2 hook returns undefined silently when contracts aren't
      // deployed or wallet is wrong-network; only flag DEFINED on a real hash.
      if (!txHash) return;
      notification.success(isEditing ? "Badge definition updated on-chain" : "Badge definition anchored on-chain");
      setDefined(true);
    } catch {
      // useTransactor already surfaces an error toast; nothing to do here.
    }
  };

  // Once a badge is anchored on-chain, hold the DEFINED state for 6s so the
  // indexer can catch BadgeDefined and upsert into `badges`, then refresh +
  // reset the wizard. Owning the timer in an effect (rather than an inline
  // setTimeout) keeps the cleanup tied to the render lifecycle and guarantees
  // setDefined(true) has flushed before the timer is queued.
  useEffect(() => {
    if (!defined) return;
    const t = setTimeout(() => {
      onAfterSubmit();
      setForm(emptyForm());
      setStep(0);
      setDefined(false);
    }, 6000);
    return () => clearTimeout(t);
  }, [defined, onAfterSubmit]);

  const STEP_TITLES = ["Season & degree", "Course", "Evaluation event", "Define badge"];
  const STEP_HINTS = [
    "scope of this badge",
    `${courseList.length} in ${form.degree}`,
    `${eventList.length} on syllabus`,
    "skill points + description",
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Step indicator */}
      <div className="flex items-center gap-3.5 flex-wrap">
        <span
          className="mono"
          style={{
            fontSize: 10.5,
            letterSpacing: "0.16em",
            color: "var(--accent)",
            padding: "4px 10px",
            border: "1px solid color-mix(in srgb, var(--accent) 50%, var(--rule))",
            background: "color-mix(in srgb, var(--accent) 10%, transparent)",
            borderRadius: 2,
          }}
        >
          STEP {step + 1}/4
        </span>
        <span className="serif" style={{ fontSize: 22, fontWeight: 500, color: "var(--fg)", letterSpacing: "-0.01em" }}>
          {STEP_TITLES[step]}
        </span>
        <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-faint)", letterSpacing: "0.06em" }}>
          {STEP_HINTS[step]}
        </span>
        <div className="flex-1" />
        <StepDots step={step} total={4} />
      </div>

      {/* Breadcrumb of completed steps */}
      {step > 0 && (
        <div
          className="mono flex flex-wrap gap-2"
          style={{ fontSize: 10.5, color: "var(--fg-dim)", letterSpacing: "0.04em" }}
        >
          <button
            type="button"
            onClick={() => setStep(0)}
            style={{
              all: "unset",
              cursor: "pointer",
              padding: "3px 9px",
              border: "1px solid var(--rule)",
              borderRadius: 2,
              color: "var(--fg-dim)",
            }}
          >
            {form.seasonId} · {form.degree}
          </button>
          {step >= 2 && form.courseId && (
            <button
              type="button"
              onClick={() => setStep(1)}
              style={{
                all: "unset",
                cursor: "pointer",
                padding: "3px 9px",
                border: "1px solid var(--rule)",
                borderRadius: 2,
                color: "var(--fg-dim)",
              }}
            >
              {form.courseId} — {courseList.find(c => c.code === form.courseId)?.name}
            </button>
          )}
          {step >= 3 && form.event && (
            <button
              type="button"
              onClick={() => setStep(2)}
              style={{
                all: "unset",
                cursor: "pointer",
                padding: "3px 9px",
                border: "1px solid var(--rule)",
                borderRadius: 2,
                color: "var(--fg-dim)",
              }}
            >
              {form.event} — {eventList.find(e => e.code === form.event)?.name}
            </button>
          )}
        </div>
      )}

      {/* STEP 1 — Season & Degree */}
      {step === 0 && (
        <section
          style={{
            border: "1px solid var(--rule)",
            borderRadius: 3,
            padding: "18px 20px 20px",
            background: "color-mix(in srgb, var(--ink-2) 60%, transparent)",
          }}
        >
          <div className="grid gap-3.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <Field label="SEASON ID">
              <KSelect value={form.seasonId} onChange={e => setSeason(e.target.value)}>
                {SEASONS.map(s => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </KSelect>
            </Field>
            <Field label="DEGREE">
              <KSelect value={form.degree} onChange={e => setDegree(e.target.value)}>
                {DEGREES.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.label} — {d.full}
                  </option>
                ))}
              </KSelect>
            </Field>
            <div style={{ gridColumn: "1 / -1" }} className="flex justify-end mt-1.5">
              <button type="button" className="k-btn k-btn-primary" onClick={() => setStep(1)} disabled={!canStep1}>
                Next · pick course →
              </button>
            </div>
          </div>
        </section>
      )}

      {/* STEP 2 — Course */}
      {step === 1 && (
        <section
          style={{
            border: "1px solid var(--rule)",
            borderRadius: 3,
            padding: "18px 20px 20px",
            background: "color-mix(in srgb, var(--ink-2) 60%, transparent)",
          }}
        >
          <div className="flex flex-col gap-2.5">
            <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
              {courseList.map(c => {
                // Same hash/label normalisation as Step 3: badges' course_id
                // is a bytes32 hash, course-card code is the human label.
                const cHash = hashLabel(c.code);
                const cBadges = badges.filter(b => b.course_id === cHash);
                const cUsed = cBadges.reduce((s, b) => s + b.skills.reduce((a, sk) => a + sk.points, 0), 0);
                const isSel = form.courseId === c.code;
                const ratio = cUsed / COURSE_BUDGET;
                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => setCourse(c.code)}
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      padding: "12px 14px",
                      border: `1px solid ${isSel ? "var(--accent)" : "var(--rule)"}`,
                      background: isSel ? "color-mix(in srgb, var(--accent) 10%, var(--ink-2))" : "var(--ink-2)",
                      borderRadius: 3,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      transition: "border-color .15s, background .15s",
                    }}
                  >
                    <div className="flex items-baseline justify-between gap-1.5">
                      <span className="mono" style={{ fontSize: 12, color: "var(--fg)", letterSpacing: "0.04em" }}>
                        {c.code}
                      </span>
                      <span
                        className="mono"
                        style={{
                          fontSize: 10,
                          letterSpacing: "0.06em",
                          color:
                            cUsed >= COURSE_BUDGET ? "var(--magenta)" : cUsed > 0 ? "var(--accent)" : "var(--fg-faint)",
                        }}
                      >
                        {cUsed}/{COURSE_BUDGET}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--fg-dim)", lineHeight: 1.3 }}>{c.name}</div>
                    <div style={{ height: 3, background: "var(--ink-3)", borderRadius: 2, overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${Math.min(100, ratio * 100)}%`,
                          height: "100%",
                          background: ratio >= 1 ? "var(--magenta)" : "var(--accent)",
                        }}
                      />
                    </div>
                    <div className="mono" style={{ fontSize: 9.5, color: "var(--fg-faint)", letterSpacing: "0.06em" }}>
                      {cBadges.length} BADGE{cBadges.length === 1 ? "" : "S"} · {(EVENTS[c.code] || []).length} EVENTS
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-between mt-1.5">
              <button type="button" className="k-btn" onClick={() => setStep(0)}>
                ← Back
              </button>
              <button type="button" className="k-btn k-btn-primary" onClick={() => setStep(2)} disabled={!canStep2}>
                Next · pick event →
              </button>
            </div>
          </div>
        </section>
      )}

      {/* STEP 3 — Evaluation Event */}
      {step === 2 && (
        <section
          style={{
            border: "1px solid var(--rule)",
            borderRadius: 3,
            padding: "18px 20px 20px",
            background: "color-mix(in srgb, var(--ink-2) 60%, transparent)",
          }}
        >
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-col gap-1">
              {eventList.map(ev => {
                const isDefined = definedEvents.has(ev.code.toUpperCase());
                const isSel = form.event === ev.code;
                // After the season is frozen the on-chain updateBadge call
                // reverts, so we hard-lock the row. Otherwise a DEFINED event
                // becomes a clickable "Edit" entry-point into the update flow.
                const lockedByFreeze = isDefined && isFrozen;
                const editable = isDefined && !isFrozen;
                return (
                  <button
                    key={ev.code}
                    type="button"
                    onClick={() => {
                      if (lockedByFreeze) return;
                      if (editable) enterEditMode(ev.code);
                      else setEvent(ev.code);
                    }}
                    disabled={lockedByFreeze}
                    title={
                      lockedByFreeze
                        ? "Season is frozen — this badge can no longer be edited"
                        : editable
                          ? "Load this badge into the form to update it"
                          : undefined
                    }
                    style={{
                      all: "unset",
                      cursor: lockedByFreeze ? "not-allowed" : "pointer",
                      padding: "10px 14px",
                      border: `1px solid ${
                        lockedByFreeze
                          ? "var(--rule)"
                          : isDefined
                            ? "color-mix(in srgb, var(--green) 35%, var(--rule))"
                            : isSel
                              ? "var(--accent)"
                              : "var(--rule)"
                      }`,
                      background: lockedByFreeze
                        ? "color-mix(in srgb, var(--ink-3) 40%, transparent)"
                        : isDefined
                          ? "color-mix(in srgb, var(--green) 6%, var(--ink-2))"
                          : isSel
                            ? "color-mix(in srgb, var(--accent) 10%, var(--ink-2))"
                            : "var(--ink-2)",
                      borderRadius: 3,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      transition: "border-color .15s, background .15s",
                      opacity: lockedByFreeze ? 0.55 : 1,
                    }}
                  >
                    <div className="flex items-baseline gap-3.5 min-w-0">
                      <span
                        className="mono"
                        style={{
                          fontSize: 11.5,
                          color: lockedByFreeze ? "var(--fg-faint)" : isDefined ? "var(--fg-dim)" : "var(--fg)",
                          letterSpacing: "0.06em",
                          minWidth: 42,
                        }}
                      >
                        {ev.code}
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          color: lockedByFreeze ? "var(--fg-faint)" : "var(--fg-dim)",
                          textDecoration: lockedByFreeze ? "line-through" : "none",
                          textDecorationColor: "color-mix(in srgb, var(--fg-mute) 50%, transparent)",
                        }}
                      >
                        {ev.name}
                      </span>
                    </div>
                    {lockedByFreeze ? (
                      <span
                        className="mono whitespace-nowrap"
                        style={{
                          fontSize: 9.5,
                          letterSpacing: "0.12em",
                          color: "var(--cyan)",
                          padding: "2px 8px",
                          border: "1px solid color-mix(in srgb, var(--cyan) 40%, var(--rule))",
                          borderRadius: 2,
                          background: "color-mix(in srgb, var(--cyan) 8%, transparent)",
                        }}
                      >
                        ❄ FROZEN
                      </span>
                    ) : editable ? (
                      <span
                        className="mono whitespace-nowrap"
                        style={{
                          fontSize: 9.5,
                          letterSpacing: "0.12em",
                          color: "var(--green)",
                          padding: "2px 8px",
                          border: "1px solid color-mix(in srgb, var(--green) 40%, var(--rule))",
                          borderRadius: 2,
                          background: "color-mix(in srgb, var(--green) 10%, transparent)",
                        }}
                      >
                        ✓ DEFINED · Edit →
                      </span>
                    ) : isSel ? (
                      <span
                        className="mono"
                        style={{ fontSize: 9.5, color: "var(--accent)", letterSpacing: "0.1em" }}
                      >
                        SELECTED
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-between mt-1.5">
              <button type="button" className="k-btn" onClick={() => setStep(1)}>
                ← Back
              </button>
              <button type="button" className="k-btn k-btn-primary" onClick={() => setStep(3)} disabled={!canStep3}>
                Next · define badge →
              </button>
            </div>
          </div>
        </section>
      )}

      {/* STEP 4 — Define Badge */}
      {step === 3 && (
        <div
          className="grid gap-4 items-start"
          style={{ gridTemplateColumns: courseBadges.length > 0 ? "minmax(0, 1fr) 320px" : "1fr" }}
        >
          <section
            style={{
              border: "1px solid var(--rule)",
              borderRadius: 3,
              padding: "18px 20px 20px",
              background: "color-mix(in srgb, var(--ink-2) 60%, transparent)",
            }}
          >
            <form
              className="flex flex-col gap-3.5 mt-2.5"
              onSubmit={e => {
                e.preventDefault();
                onSubmit();
              }}
            >
              {/* Post-anchor status — pinned to the top of the form so the
                  user can see it without scrolling past the form fields. */}
              {defined && (
                <div
                  className="mono flex items-center gap-2"
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.1em",
                    padding: "10px 12px",
                    border: "1px solid color-mix(in srgb, var(--green) 50%, var(--rule))",
                    borderRadius: 2,
                    background: "color-mix(in srgb, var(--green) 10%, transparent)",
                    color: "var(--green)",
                  }}
                >
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      background: "var(--green)",
                      display: "inline-block",
                      animation: "platform-pulse 1.4s ease-in-out infinite",
                    }}
                  />
                  <span>
                    ✓ {isEditing ? "UPDATED" : "DEFINED"} — SYNCING LEDGER…
                  </span>
                </div>
              )}

              {isEditing && !defined && (
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
                  <span>✎ EDITING BADGE #{form.editingTokenId} — RE-PIN IF YOU CHANGE FIELDS</span>
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

              {overBudget && (
                <div
                  className="mono"
                  style={{
                    padding: "10px 12px",
                    border: "1px solid color-mix(in srgb, var(--magenta) 50%, var(--rule))",
                    background: "color-mix(in srgb, var(--magenta) 10%, transparent)",
                    borderRadius: 3,
                    fontSize: 10.5,
                    color: "var(--magenta)",
                    letterSpacing: "0.08em",
                  }}
                >
                  ⚠ OVER BUDGET — reduce skill points to stay within the {COURSE_BUDGET}-pt course cap.
                </div>
              )}

              <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <Field label="BADGE CODE">
                  <KInput
                    value={form.badgeCode}
                    onChange={e => setForm(f => ({ ...f, badgeCode: e.target.value, metadataCID: "" }))}
                    placeholder={`${form.courseId.toUpperCase()}_${form.event || "EV"}`}
                  />
                </Field>
                <Field label="EVENT" hint="from step 3">
                  <div
                    className="k-input"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      background: "var(--ink-3)",
                      color: "var(--fg-dim)",
                      cursor: "default",
                    }}
                  >
                    {form.event} · {eventList.find(e => e.code === form.event)?.name || ""}
                  </div>
                </Field>
              </div>

              <Field label="DESCRIPTION" hint="what the student demonstrated · pinned to IPFS">
                <KTextarea
                  rows={3}
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value, metadataCID: "" }))}
                  placeholder="e.g. Built and evaluated a CNN classifier on a 3.4k-glyph subset; calibrated probabilities + ablation against a SVM baseline."
                />
              </Field>

              <Field
                label="SKILL VECTOR · max 4"
                hint="each skill carries 1–10 pts; sum is what counts toward the budget"
              >
                <SkillMatrix
                  skills={skillOptions}
                  value={form.skills}
                  onChange={skills => setForm(f => ({ ...f, skills, metadataCID: "" }))}
                  max={4}
                />
              </Field>

              {/* ── Actions row — Pin Metadata → Anchor (matches Create Node) ── */}
              <div
                style={{
                  borderTop: "1px dashed var(--rule)",
                  paddingTop: 14,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {/* CID confirmation panel — only after pin succeeds */}
                {form.metadataCID && (
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
                  <button type="button" className="k-btn" onClick={() => setStep(2)} disabled={defined}>
                    ← Back
                  </button>

                  <button
                    type="button"
                    className="k-btn"
                    onClick={onPin}
                    disabled={
                      pinning ||
                      defined ||
                      !form.event ||
                      !form.badgeCode ||
                      Object.keys(form.skills).length === 0
                    }
                    title={
                      !form.badgeCode
                        ? "Set a badge code first"
                        : Object.keys(form.skills).length === 0
                          ? "Pick at least one skill"
                          : undefined
                    }
                  >
                    {pinning
                      ? "…pinning"
                      : form.metadataCID
                        ? isEditing
                          ? "↻ Re-pin Metadata"
                          : "↻ Re-pin"
                        : "↑ Pin Metadata"}
                  </button>

                  <div className="flex-1" />

                  <span className="mono" style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em" }}>
                    GAS EST. ~ 78000
                  </span>

                  <button
                    type="submit"
                    className="k-btn k-btn-primary"
                    disabled={!canSubmit}
                    title={!form.metadataCID ? "Pin metadata first" : undefined}
                  >
                    {defined
                      ? "✓ DEFINED · syncing…"
                      : isMining
                        ? isEditing
                          ? "Updating…"
                          : "Mining…"
                        : isEditing
                          ? "Update badge def →"
                          : "Anchor badge def →"}
                  </button>
                </div>
              </div>
            </form>
          </section>
          {courseBadges.length > 0 && (
            <ExistingBadgesPanel
              badges={courseBadges}
              courseId={form.courseId}
              used={used}
              projected={projected}
              draftPts={draftPts}
              budget={COURSE_BUDGET}
              editingTokenId={form.editingTokenId}
            />
          )}
        </div>
      )}
    </div>
  );
}
