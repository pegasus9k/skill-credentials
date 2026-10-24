/**
 * Backend client for the administrator wizard.
 * The indexer + REST API run at localhost:3001 (FRONTEND_WIRING.md).
 * Override with NEXT_PUBLIC_API_URL for non-local demos.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export type SkillRow = { skill_id: string; skill_label: string; description?: string };

/**
 * Shape of a row from GET /badges. Note that the indexer stores the on-chain
 * identifiers (course_id, badge_code) as raw bytes32 hashes — it joins those
 * against the metadata JSON pinned to IPFS to resolve the human labels
 * (course_name, badge_name, evaluation_type, week).
 */
export type BadgeRow = {
  token_id: number;
  season_id: string;
  course_id: string; // bytes32 hash, e.g. "0x578bc31…"
  course_name?: string; // resolved display name from metadata, e.g. "Aprendizagem Profunda"
  badge_code: string; // bytes32 hash
  badge_name?: string; // resolved label from metadata, e.g. "APROF_W5"
  description?: string | null; // resolved description from metadata (for edit pre-fill)
  evaluation_type?: string | null;
  week?: number | null;
  metadata_cid: string;
  skills: { skill_id?: string; skill_label: string; points: number }[];
  total_points?: number;
};

export type NodeRow = {
  node_id: number;
  season_id: string;
  node_code: string;
  node_name: string | null;
  description?: string | null; // resolved description from metadata (for edit pre-fill)
  prereq_mode: "NONE" | "AND" | "OR";
  prerequisites: number[];
  thresholds: { skill_id: string; skill_label: string | null; min_points: number }[];
  metadata_cid: string;
  department?: string | null;
};

const json = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} — ${text || "request failed"}`);
  }
  return res.json() as Promise<T>;
};

export const fetchSkills = (): Promise<SkillRow[]> =>
  fetch(`${API_URL}/skills`, { cache: "no-store" }).then(json<SkillRow[]>);

export const fetchBadges = (): Promise<BadgeRow[]> =>
  fetch(`${API_URL}/badges`, { cache: "no-store" }).then(json<BadgeRow[]>);

export const fetchNodes = (): Promise<NodeRow[]> =>
  fetch(`${API_URL}/nodes`, { cache: "no-store" }).then(json<NodeRow[]>);

/**
 * Pin badge metadata JSON to the fake-IPFS endpoint and receive a 32-byte
 * digest as { metadataCID: "0x..." }. The on-chain field stores this raw
 * bytes32 and the indexer reads back via GET /metadata/:cid.
 */
export type MetadataPayload = {
  name: string;
  description: string;
  image?: string;
  properties: {
    season: string;
    course: string;
    courseName?: string;
    evaluationType?: string;
    week?: number | null;
    badgeCode: string;
    institution: string;
  };
  attributes: { trait_type: string; value: number }[];
};

export const pinMetadata = async (payload: MetadataPayload): Promise<{ metadataCID: string }> => {
  const res = await fetch(`${API_URL}/metadata/pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return json<{ metadataCID: string }>(res);
};
