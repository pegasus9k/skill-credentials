export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export type StudentBadge = {
  token_id: number;
  badge_name: string | null;
  course_name: string | null;
  evaluation_type: string | null;
  grade_commitment: string;
  committed_to_node: number; // 0 = free; >0 = committed to that node_id
  allocation_status: "free" | "committed";
  minted_at: string;
  skills: { skill_label: string; points: number }[];
};

export type StudentCompetency = {
  node_id: number;
  node_name: string;
  prereq_mode: string;
  badge_ids: number[];
  unlocked_at: string;
};

export type StudentData = {
  student: {
    wallet_address: string;
    student_name: string;
    email: string | null;
    degree: string | null;
    status: string;
  };
  badges: StudentBadge[];
  competencies: StudentCompetency[];
};

export type NodeApiRow = {
  node_id: number;
  season_id: string;
  node_code: string;
  prereq_mode: "NONE" | "AND" | "OR";
  metadata_cid: string;
  metadata_uri?: string | null;
  node_name: string | null;
  department?: string | null;
  thresholds: { skill_id: string; skill_label: string | null; min_points: number }[];
  prerequisites: number[];
};

const asJson = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} — ${text || "request failed"}`);
  }
  return res.json() as Promise<T>;
};

export const fetchStudent = (wallet: string): Promise<StudentData> =>
  fetch(`${API_URL}/student/${wallet}`, { cache: "no-store" }).then(asJson<StudentData>);

export const fetchNodes = (): Promise<NodeApiRow[]> =>
  fetch(`${API_URL}/nodes`, { cache: "no-store" }).then(asJson<NodeApiRow[]>);
