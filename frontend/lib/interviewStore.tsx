"use client";
import React, { createContext, useContext, useState } from "react";

/* ΓöÇΓöÇ Types ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
export type RoundStatus = "pending" | "active" | "passed" | "failed" | "on-hold";

export type SkillRating = { skill: string; score: number };

export type RoundFeedback = {
  rating?: number;
  interviewer_name?: string;
  interviewer_email?: string;
  submitted_at?: string;
  summary?: string;
  skills?: SkillRating[];
  strengths?: string[];
  improvements?: string[];
  recommendation?: "Strong Hire" | "Hire" | "Hold" | "No Hire" | "ΓÇö";
  communication?: number;
  cultural_fit?: number;
  adaptability?: number;
};

export type Round = {
  roundNo: number;
  type: string;
  date: string;
  time: string;
  interviewer: string;
  interviewerEmail: string;
  mode: "Video Call" | "In-person";
  duration: string;
  status: RoundStatus;
  mailSent: boolean;
  feedback?: RoundFeedback;
};

export type Candidate = {
  id: number;
  backendId?: string;
  name: string;
  initials: string;
  color: string;
  email: string;
  role: string;
  rounds: Round[];
  /* enriched profile fields from interview_details / candidates collection */
  yoe?:        string;
  aiScore?:    number;
  skills?:     string;   /* raw comma-separated string e.g. "Apex: 4/5, SOQL: 3/5" */
  summary?:    string;   /* AI analysis summary */
};

/* ΓöÇΓöÇ Seed data ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
const seed: Candidate[] = [
  {
    id: 1, name: "Yuki Tanaka", initials: "YT", color: "#B875A0",
    email: "yuki.tanaka@email.com", role: "Frontend Engineer",
    rounds: [
      { roundNo: 1, type: "Technical",    date: "Today",       time: "11:00 AM", interviewer: "Priya R.",  interviewerEmail: "priya.r@recruitai.app",  mode: "Video Call", duration: "60 min", status: "active",  mailSent: false },
      { roundNo: 2, type: "System Design",date: "Tomorrow",    time: "2:00 PM",  interviewer: "Arjun K.", interviewerEmail: "arjun.k@recruitai.app",  mode: "Video Call", duration: "60 min", status: "pending", mailSent: false },
      { roundNo: 3, type: "Managerial",   date: "28 May 2026", time: "11:00 AM", interviewer: "CEO",      interviewerEmail: "ceo@recruitai.app",       mode: "In-person",  duration: "45 min", status: "pending", mailSent: false },
    ],
  },
  {
    id: 2, name: "Sarah Mitchell", initials: "SM", color: "#8A6AAE",
    email: "sarah.mitchell@email.com", role: "Senior Backend Engineer",
    rounds: [
      { roundNo: 1, type: "Technical",    date: "20 May 2026", time: "10:00 AM", interviewer: "Arjun K.", interviewerEmail: "arjun.k@recruitai.app",  mode: "Video Call", duration: "60 min", status: "passed",  mailSent: true  },
      { roundNo: 2, type: "System Design",date: "Today",       time: "2:30 PM",  interviewer: "Priya R.", interviewerEmail: "priya.r@recruitai.app",  mode: "Video Call", duration: "60 min", status: "active",  mailSent: false },
      { roundNo: 3, type: "Managerial",   date: "25 May 2026", time: "10:00 AM", interviewer: "Rahul D.", interviewerEmail: "rahul.d@recruitai.app",  mode: "In-person",  duration: "60 min", status: "pending", mailSent: false },
      { roundNo: 4, type: "HR Round",     date: "26 May 2026", time: "3:00 PM",  interviewer: "Sneha M.", interviewerEmail: "sneha.m@recruitai.app",  mode: "Video Call", duration: "30 min", status: "pending", mailSent: false },
    ],
  },
  {
    id: 3, name: "Marco Greco", initials: "MG", color: "#7AB8D8",
    email: "marco.greco@email.com", role: "DevOps Engineer",
    rounds: [
      { roundNo: 1, type: "Technical", date: "Tomorrow",   time: "10:00 AM", interviewer: "Sneha M.", interviewerEmail: "sneha.m@recruitai.app", mode: "In-person",  duration: "60 min", status: "active",  mailSent: false },
      { roundNo: 2, type: "Practical", date: "27 May 2026",time: "11:00 AM", interviewer: "Rahul D.", interviewerEmail: "rahul.d@recruitai.app", mode: "Video Call", duration: "60 min", status: "pending", mailSent: false },
    ],
  },
  {
    id: 4, name: "Aisha Levi", initials: "AL", color: "#C078B0",
    email: "aisha.levi@email.com", role: "Data Scientist",
    rounds: [
      { roundNo: 1, type: "Case Study", date: "20 May 2026", time: "3:00 PM",  interviewer: "Rahul D.", interviewerEmail: "rahul.d@recruitai.app", mode: "Video Call", duration: "60 min", status: "passed",  mailSent: true  },
      { roundNo: 2, type: "Technical",  date: "22 May 2026", time: "10:00 AM", interviewer: "Arjun K.", interviewerEmail: "arjun.k@recruitai.app", mode: "Video Call", duration: "60 min", status: "passed",  mailSent: true  },
      { roundNo: 3, type: "Managerial", date: "Tomorrow",    time: "2:00 PM",  interviewer: "Priya R.", interviewerEmail: "priya.r@recruitai.app", mode: "In-person",  duration: "45 min", status: "active",  mailSent: false },
      { roundNo: 4, type: "HR Round",   date: "29 May 2026", time: "11:00 AM", interviewer: "Sneha M.", interviewerEmail: "sneha.m@recruitai.app", mode: "Video Call", duration: "30 min", status: "pending", mailSent: false },
    ],
  },
  {
    id: 5, name: "Priya Sharma", initials: "PS", color: "#A898D8",
    email: "priya.sharma@email.com", role: "Product Manager",
    rounds: [
      { roundNo: 1, type: "Product",     date: "19 May 2026", time: "11:30 AM", interviewer: "Sneha M.", interviewerEmail: "sneha.m@recruitai.app", mode: "In-person", duration: "45 min", status: "passed", mailSent: true  },
      { roundNo: 2, type: "Culture Fit", date: "Today",       time: "3:00 PM",  interviewer: "CEO",      interviewerEmail: "ceo@recruitai.app",      mode: "In-person", duration: "45 min", status: "active", mailSent: false },
    ],
  },
  {
    id: 6, name: "Ravi Kumar", initials: "RK", color: "#B875A0",
    email: "ravi.kumar@email.com", role: "Frontend Engineer",
    rounds: [
      { roundNo: 1, type: "Technical",    date: "23 May 2026", time: "10:00 AM", interviewer: "Priya R.", interviewerEmail: "priya.r@recruitai.app", mode: "Video Call", duration: "60 min", status: "active",  mailSent: false },
      { roundNo: 2, type: "System Design",date: "25 May 2026", time: "11:00 AM", interviewer: "Arjun K.", interviewerEmail: "arjun.k@recruitai.app", mode: "Video Call", duration: "60 min", status: "pending", mailSent: false },
    ],
  },
  {
    id: 7, name: "Neha Joshi", initials: "NJ", color: "#8A6AAE",
    email: "neha.joshi@email.com", role: "UX Designer",
    rounds: [
      { roundNo: 1, type: "Portfolio",   date: "22 May 2026", time: "2:00 PM", interviewer: "Priya R.", interviewerEmail: "priya.r@recruitai.app", mode: "Video Call", duration: "45 min", status: "passed", mailSent: true  },
      { roundNo: 2, type: "Culture Fit", date: "24 May 2026", time: "3:00 PM", interviewer: "CEO",      interviewerEmail: "ceo@recruitai.app",      mode: "In-person", duration: "45 min", status: "active", mailSent: false },
    ],
  },
  {
    id: 8, name: "Amit Singh", initials: "AS", color: "#7AB8D8",
    email: "amit.singh@email.com", role: "Backend Engineer",
    rounds: [
      { roundNo: 1, type: "Technical",    date: "Today",       time: "9:00 AM",  interviewer: "Arjun K.", interviewerEmail: "arjun.k@recruitai.app", mode: "Video Call", duration: "60 min", status: "active",  mailSent: false },
      { roundNo: 2, type: "System Design",date: "26 May 2026", time: "10:00 AM", interviewer: "Priya R.", interviewerEmail: "priya.r@recruitai.app", mode: "Video Call", duration: "60 min", status: "pending", mailSent: false },
      { roundNo: 3, type: "HR Round",     date: "27 May 2026", time: "3:00 PM",  interviewer: "Sneha M.", interviewerEmail: "sneha.m@recruitai.app", mode: "Video Call", duration: "30 min", status: "pending", mailSent: false },
    ],
  },
  {
    id: 9, name: "Divya Menon", initials: "DM", color: "#C078B0",
    email: "divya.menon@email.com", role: "Data Analyst",
    rounds: [
      { roundNo: 1, type: "Technical", date: "21 May 2026", time: "11:00 AM", interviewer: "Rahul D.", interviewerEmail: "rahul.d@recruitai.app", mode: "Video Call", duration: "60 min", status: "failed", mailSent: true },
    ],
  },
  {
    id: 10, name: "Karan Mehta", initials: "KM", color: "#A898D8",
    email: "karan.mehta@email.com", role: "Product Manager",
    rounds: [
      { roundNo: 1, type: "Product",    date: "22 May 2026", time: "10:00 AM", interviewer: "Priya R.", interviewerEmail: "priya.r@recruitai.app", mode: "Video Call", duration: "60 min", status: "passed", mailSent: true },
      { roundNo: 2, type: "Managerial", date: "24 May 2026", time: "2:00 PM",  interviewer: "CEO",      interviewerEmail: "ceo@recruitai.app",      mode: "In-person", duration: "45 min", status: "passed", mailSent: true },
      { roundNo: 3, type: "HR Round",   date: "Today",       time: "4:00 PM",  interviewer: "Sneha M.", interviewerEmail: "sneha.m@recruitai.app", mode: "Video Call", duration: "30 min", status: "active", mailSent: false },
    ],
  },
];

/* ΓöÇΓöÇ Context ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
type StoreCtx = {
  candidates: Candidate[];
  setCandidates: React.Dispatch<React.SetStateAction<Candidate[]>>;
  updateCandidate: (id: number, updater: (c: Candidate) => Candidate) => void;
  addRound: (candidateId: number) => Promise<void> | void;
  removeRound: (candidateId: number, roundNo: number) => Promise<void> | void;
  managerDecisions: Record<number, "approved" | "rejected" | undefined>;
  approveManagerFeedback: (candidateId: number) => void;
  rejectManagerFeedback: (candidateId: number) => void;
  /* ── Global refresh signal ── */
  refreshKey: number;
  refreshAll: () => void;
};

const Ctx = createContext<StoreCtx | null>(null);

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
export const API_KEY      = process.env.NEXT_PUBLIC_API_KEY || "";

export function apiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    ...extra,
  };
}

function hashId(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 2147483647;
  }
  return Math.abs(hash) + 1;
}

function initialsOf(name: string) {
  const parts = (name || "Candidate").trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0]?.slice(0, 2).toUpperCase() || "CA";
}

function colorOf(name: string) {
  const palette = ["#B875A0", "#8A6AAE", "#7AB8D8", "#C078B0", "#A898D8", "#60A5FA"];
  let hash = 0;
  for (let i = 0; i < (name || "Candidate").length; i += 1) {
    hash = (hash * 31 + (name || "Candidate").charCodeAt(i)) % palette.length;
  }
  return palette[hash];
}

export function normalizeCandidate(raw: any): Candidate {
  const rounds: Round[] = Array.isArray(raw.rounds)
    ? raw.rounds.map((round: any) => ({
        roundNo:          Number(round.roundNo || 1),
        type:             round.type             || "Technical",
        date:             round.date             || "TBD",
        time:             round.time             || "TBD",
        interviewer:      round.interviewer      || "TBD",
        interviewerEmail: round.interviewerEmail || "",
        mode:             (round.mode === "In-person" ? "In-person" : "Video Call") as "Video Call" | "In-person",
        duration:         round.duration         || "60 min",
        status:           (round.status          || "pending") as RoundStatus,
        mailSent:         Boolean(round.mailSent),
      }))
    : [];

  // ── Auto-unlock: if all previous rounds passed, the next pending
  //    round should be "active" so HR can send the email for it.
  //    This fixes "Locked" showing on rounds that should be schedulable.
  const unlocked = rounds.map((r, idx) => {
    if (r.status !== "pending") return r;
    // Check if every round before this one has passed
    const allPriorPassed = rounds.slice(0, idx).every(
      prev => prev.status === "passed"
    );
    if (allPriorPassed) return { ...r, status: "active" as RoundStatus };
    return r;
  });

  const name      = raw.name || "Unknown Candidate";
  const backendId = typeof raw.id === "string"
    ? raw.id
    : typeof raw._id === "string"
      ? raw._id
      : undefined;

  return {
    id:       backendId ? hashId(backendId) : Number(raw.id || 0),
    backendId,
    name,
    initials: raw.initials || initialsOf(name),
    color:    raw.color    || colorOf(name),
    email:    raw.email    || "",
    role:     raw.role     || "Candidate",
    rounds:   unlocked,
    yoe:      raw.yoe      || raw.years_experience || undefined,
    aiScore:  raw.score    != null ? Number(raw.score)
            : raw.ai_score != null ? Number(raw.ai_score)
            : undefined,
    skills:   raw.skills   || undefined,
    summary:  raw.summary  || raw.analysis_summary || undefined,
  };
}

/* ΓöÇΓöÇ Provider ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
export function InterviewStoreProvider({ children }: { children: React.ReactNode }) {
  const [candidates, setCandidates] = useState<Candidate[]>(seed);
  const [managerDecisions, setManagerDecisions] = useState<Record<number, "approved" | "rejected" | undefined>>({});
  const [refreshKey, setRefreshKey] = useState(0);

  /* refreshAll: increment key → every dependent page's useEffect fires */
  function refreshAll() {
    const MANAGER_API = process.env.NEXT_PUBLIC_MANAGER_API_BASE_URL || "http://localhost:8001";
    /* 1. Reset candidates to seed immediately for visual feedback */
    setCandidates(seed);
    setManagerDecisions({});
    /* 2. Wipe manager backend — approvals AND offers */
    fetch(`${MANAGER_API}/manager/reset`, { method: "DELETE" }).catch(() => {});
    fetch(`${MANAGER_API}/manager/offers/reset`, { method: "DELETE" }).catch(() => {});
    /* 3. Re-fetch candidates from HR backend */
    fetch(`${API_BASE_URL}/interviews/`, { cache: "no-store", headers: apiHeaders() })
      .then(async res => {
        if (!res.ok) return;
        const data = await res.json();
        const loaded = (data.candidates || []).map(normalizeCandidate);
        if (loaded.length > 0) setCandidates(loaded);
      })
      .catch(() => { /* keep seed on error */ });
    /* 4. Signal all pages to reset via refreshKey */
    setRefreshKey(k => k + 1);
  }

  function approveManagerFeedback(candidateId: number) {
    setManagerDecisions(prev => ({ ...prev, [candidateId]: "approved" }));
  }

  function rejectManagerFeedback(candidateId: number) {
    setManagerDecisions(prev => ({ ...prev, [candidateId]: "rejected" }));
  }

  React.useEffect(() => {
    let active = true;
    fetch(`${API_BASE_URL}/interviews/`, { cache: "no-store", headers: apiHeaders() })
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to fetch interviews");
        const data = await res.json();
        if (!active) return;
        const loaded = (data.candidates || []).map(normalizeCandidate);
        if (loaded.length > 0) setCandidates(loaded);
      })
      .catch((err) => {
        if (!active) return;
        console.warn("Interview backend unavailable, using seeded data:", err);
      });
    return () => { active = false; };
  }, []);

  function updateCandidate(id: number, updater: (c: Candidate) => Candidate) {
    setCandidates(prev => prev.map(c => c.id === id ? updater(c) : c));
  }

  async function addRound(candidateId: number) {
    // Optimistic update
    setCandidates(prev => prev.map(c => {
      if (c.id !== candidateId) return c;
      const next = c.rounds.length + 1;
      const newRound: Round = {
        roundNo: next, type: "New Round", date: "TBD", time: "TBD",
        interviewer: "TBD", interviewerEmail: "", mode: "Video Call",
        duration: "60 min", status: "pending", mailSent: false,
      };
      return { ...c, rounds: [...c.rounds, newRound] };
    }));

    const candidate = candidates.find(c => c.id === candidateId);
    if (!candidate?.backendId) return;

    try {
      const res  = await fetch(`${API_BASE_URL}/interviews/${candidate.backendId}/round`, {
        method: "POST", headers: apiHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Could not add round");

      const newRound = data.newRound as Round;
      setCandidates(prev => prev.map(c => c.id === candidateId
        ? { ...c, rounds: c.rounds.map(r => r.roundNo === newRound.roundNo ? { ...r, ...newRound } : r) }
        : c
      ));
    } catch (err) {
      console.error("Failed to add round on backend:", err);
    }
  }

  async function removeRound(candidateId: number, roundNo: number) {
    // Optimistic update
    setCandidates(prev => prev.map(c => {
      if (c.id !== candidateId) return c;
      const filtered    = c.rounds.filter(r => r.roundNo !== roundNo);
      const renumbered  = filtered.map((r, i) => ({ ...r, roundNo: i + 1 }));
      return { ...c, rounds: renumbered };
    }));

    const candidate = candidates.find(c => c.id === candidateId);
    if (!candidate?.backendId) return;

    try {
      const res  = await fetch(`${API_BASE_URL}/interviews/${candidate.backendId}/round/${roundNo}`, {
        method: "DELETE", headers: apiHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Could not delete round");
    } catch (err) {
      console.error("Failed to delete round on backend:", err);
    }
  }

  return (
    <Ctx.Provider value={{ candidates, setCandidates, updateCandidate, addRound, removeRound, managerDecisions, approveManagerFeedback, rejectManagerFeedback, refreshKey, refreshAll }}>
      {children}
    </Ctx.Provider>
  );
}

export function useInterviewStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useInterviewStore must be used within InterviewStoreProvider");
  return ctx;
}