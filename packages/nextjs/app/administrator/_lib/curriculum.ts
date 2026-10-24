/**
 * Catalog of degrees → courses → evaluation events that constrain
 * the Create Badge wizard.
 *
 * Demo scenario: two degrees, one course each, three events per course.
 * Blue track (MECD/AProf) feeds "Deep Feature Extraction" node.
 * Green track (MEGE/ARed) feeds "Electric Grid Analysis" node.
 * Cross-pollination: Tier 3 "Intelligent Grid Forecaster" requires both.
 *
 * Degree is a UI-only navigation filter — the contract sees only seasonId
 * and courseId.
 */

export type Degree = { id: string; label: string; full: string };
export type Course = { code: string; name: string };
export type EvalEvent = { code: string; name: string };

export const DEGREES: Degree[] = [
  { id: "MECD", label: "MECD", full: "Mestrado em Engenharia e Ciência de Dados" },
  { id: "MEGE", label: "MEGE", full: "Mestrado em Engenharia e Gestão da Energia" },
];

export const COURSES: Record<string, Course[]> = {
  MECD: [{ code: "AProf", name: "Aprendizagem Profunda" }],
  MEGE: [{ code: "ARed", name: "Análise de Redes Elétricas" }],
};

export const EVENTS: Record<string, EvalEvent[]> = {
  AProf: [
    { code: "W5", name: "Lab · Neural Networks I" },
    { code: "W7", name: "Project · Neural Networks II" },
    { code: "EXAM", name: "Theory exam" },
  ],
  ARed: [
    { code: "W4", name: "Lab · Grid Analysis I" },
    { code: "W6", name: "Lab · Grid Control I" },
    { code: "EXAM", name: "Theory exam" },
  ],
};

export const COURSE_BUDGET = 60;

/**
 * Skill labels — matches the 13 on-chain skill dimensions exactly.
 * Shown in the chip selector; the actual on-chain skillId is keccak256(label).
 */
export const DEFAULT_SKILLS: { label: string; description: string }[] = [
  { label: "CODE", description: "Programming & Software" },
  { label: "CTR", description: "Control Theory" },
  { label: "DATA", description: "Data Analysis" },
  { label: "DL", description: "Deep Learning" },
  { label: "GRID", description: "Grid Systems" },
  { label: "MATH", description: "Mathematics" },
  { label: "ML", description: "Machine Learning" },
  { label: "OPT", description: "Optimization" },
  { label: "PWR", description: "Power Engineering" },
  { label: "REN", description: "Renewables" },
  { label: "SIG", description: "Signal Processing" },
  { label: "SIM", description: "Simulation" },
  { label: "THERMO", description: "Thermal Systems" },
];

export const SEASONS = ["2025-S1"];

export const PREREQ_MODES = [
  { v: 0, label: "NONE", hint: "Base node — no prerequisites" },
  { v: 1, label: "AND", hint: "All prerequisites required" },
  { v: 2, label: "OR", hint: "Any single prerequisite suffices" },
];
