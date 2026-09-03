"use client";
import { useState, useEffect, useCallback } from "react";
import {
  useInterviewStore,
  type Candidate,
  type RoundStatus,
  API_BASE_URL,
  apiHeaders,
  normalizeCandidate,
} from "@/lib/interviewStore";
import {
  Search, RefreshCw, Calendar, Video, Monitor,
  ChevronDown, ChevronUp, Star, CheckCircle,
} from "lucide-react";

const MANAGER_API     = process.env.NEXT_PUBLIC_MANAGER_API_BASE_URL || "http://localhost:8001";
const AUTO_REFRESH_MS = 30_000;

/* ── Status colours — mirrors HR Interviews ── */
const SC: Record<RoundStatus, { bg: string; color: string; label: string; dot: string }> = {
  active:    { bg: "rgba(253,200,56,0.2)",  color: "#7A5A00", label: "Ongoing",     dot: "#F5C518" },
  passed:    { bg: "rgba(52,199,89,0.15)",  color: "#1a7a3a", label: "Completed",   dot: "#34C759" },
  failed:    { bg: "rgba(220,53,69,0.13)",  color: "#b02030", label: "Didn't Pass", dot: "#DC3545" },
  "on-hold": { bg: "rgba(238,208,90,0.22)", color: "#7A5A10", label: "On Hold",     dot: "#F0A500" },
  pending:   { bg: "rgba(221,208,232,0.3)", color: "#9090B0", label: "Locked",      dot: "#9090B0" },
};

type ManagerDecision = {
  candidate_id:     string;
  status:           "pending_manager" | "approved" | "rejected";
  manager_decision: string | null;
  overall_rating:   number | null;
  recommendation:   string;
  hr_approved_at:   string;
};

type SF = "All" | "Technical" | "System Design" | "Managerial" | "HR Round" | "Offer";
const STATUS_FILTERS: SF[] = ["All", "Technical", "System Design", "Managerial", "HR Round", "Offer"];

function currentStage(c: Candidate) {
  if (!c.rounds?.length) return "Screening";
  const active = c.rounds.find(r => r.status === "active");
  if (active) return active.type;
  if (c.rounds.every(r => r.status === "passed")) return "Offer";
  return "Screening";
}

export default function ManagerCandidates() {
  const { candidates, setCandidates, refreshKey } = useInterviewStore();

  const [decisions,     setDecisions]     = useState<Record<string, ManagerDecision>>({});
  const [loading,       setLoading]       = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [sf,            setSf]            = useState<SF>("All");
  const [q,             setQ]             = useState("");
  const [expanded,      setExpanded]      = useState<number | null>(null);

  const fetchAll = useCallback(async () => {
  setLoading(true);
  try {
    /* 1 ── Fetch same candidates as HR Interviews page */
    const hrRes = await fetch(`${API_BASE_URL}/interviews/`, { headers: apiHeaders() });
    if (hrRes.ok) {
      const data       = await hrRes.json();
      const normalized = (data.interviews || data.candidates || []).map(normalizeCandidate);
      if (normalized.length) setCandidates(normalized);
    }

    /* 2 ── Fetch manager decisions to overlay */
    const mgRes = await fetch(`${MANAGER_API}/manager/approved-candidates`);
    if (mgRes.ok) {
      const mgData = await mgRes.json();
      const map: Record<string, ManagerDecision> = {};
      for (const ac of (mgData.candidates || [])) {
        const entry: ManagerDecision = {
          candidate_id:     ac.candidate_id,
          status:           ac.status,
          manager_decision: ac.manager_decision ?? null,
          overall_rating:   ac.overall_rating ?? null,
          recommendation:   ac.recommendation ?? "",
          hr_approved_at:   ac.hr_approved_at ?? "",
        };
        map[ac.candidate_id]                  = entry;
        map[ac.candidate_name?.toLowerCase()] = entry;
      }
      setDecisions(map);
    }
  } catch { /* keep stale data on error */ }
  finally {
    setLoading(false);
    setLastRefreshed(new Date());
  }
}, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchAll]);

  /* Reset decisions when HR Interviews global refresh fires */
  useEffect(() => {
    if (refreshKey === 0) return;
    fetchAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  /* resolve manager decision for a candidate */
  function decision(c: Candidate): ManagerDecision | null {
    return decisions[c.backendId ?? ""] ?? decisions[c.name.toLowerCase()] ?? null;
  }

  /* filter candidates */
  const filtered = candidates.filter(c => {
    const matchQ = !q ||
      c.name.toLowerCase().includes(q.toLowerCase()) ||
      c.role.toLowerCase().includes(q.toLowerCase());
    const matchF = sf === "All" ? true :
      sf === "Offer" ? c.rounds.every(r => r.status === "passed") :
      currentStage(c) === sf;
    return matchQ && matchF;
  });

  const managerBadge = (d: ManagerDecision | null) => {
    if (!d) return null;
    /* Use manager_decision if set, otherwise fall back to status */
    const decision = d.manager_decision ?? d.status;
    const map: Record<string, { bg: string; color: string; label: string }> = {
      approved:        { bg: "rgba(16,185,129,0.12)", color: "#065f46", label: "✓ Approved"        },
      rejected:        { bg: "rgba(220,38,38,0.1)",   color: "#b91c1c", label: "✗ Rejected"        },
      pending_manager: { bg: "rgba(245,158,11,0.12)", color: "#92400e", label: "⏳ Pending Review" },
    };
    const m = map[decision] ?? map["pending_manager"];
    return (
      <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: m.bg, color: m.color }}>
        {m.label}
      </span>
    );
  };

  const maxRounds = Math.max(...candidates.map(c => c.rounds.length), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#1e1b4b", margin: 0 }}>Candidates</h1>
          <p style={{ fontSize: 13, color: "#9ca3af", marginTop: 4 }}>
            {filtered.length} candidate{filtered.length !== 1 ? "s" : ""} ·{" "}
            {lastRefreshed ? `Updated ${lastRefreshed.toLocaleTimeString()}` : "Loading…"}
          </p>
        </div>
        <button onClick={() => fetchAll()} disabled={loading} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.22)", borderRadius: 9, fontSize: 12, fontWeight: 600, color: "#4f46e5", cursor: "pointer", fontFamily: "inherit", opacity: loading ? 0.6 : 1 }}>
          <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* ── Toolbar ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid rgba(221,208,232,0.5)", borderRadius: 10, padding: "8px 14px", flex: "1 1 220px", maxWidth: 320 }}>
          <Search size={14} color="#9ca3af" />
          <input placeholder="Search name or role…" value={q} onChange={e => setQ(e.target.value)}
            style={{ border: "none", outline: "none", fontSize: 13, color: "#1e1b4b", background: "transparent", width: "100%", fontFamily: "inherit" }} />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {STATUS_FILTERS.map(f => (
            <button key={f} onClick={() => setSf(f)} style={{ padding: "5px 14px", borderRadius: 20, border: "1px solid", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", borderColor: sf === f ? "#6366F1" : "rgba(221,208,232,0.6)", background: sf === f ? "rgba(99,102,241,0.1)" : "transparent", color: sf === f ? "#4f46e5" : "#9ca3af" }}>{f}</button>
          ))}
        </div>
      </div>

      {/* ── Main table — same layout as HR Interviews ── */}
      <div style={{ background: "#fff", border: "1px solid rgba(221,208,232,0.4)", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          {/* thead */}
          <div style={{ display: "grid", gridTemplateColumns: `220px repeat(${maxRounds}, minmax(150px,1fr)) 160px`, background: "#f8f7ff", borderBottom: "2px solid rgba(221,208,232,0.4)", minWidth: 700 }}>
            {["Candidate", ...Array.from({ length: maxRounds }, (_, i) => `Round ${i + 1}`), "Manager Decision"].map(h => (
              <div key={h} style={{ padding: "11px 14px", fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", borderRight: "1px solid rgba(221,208,232,0.2)" }}>{h}</div>
            ))}
          </div>

          {/* rows */}
          {filtered.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>No candidates found.</div>
          )}
          {filtered.map(c => {
            const dec    = decision(c);
            const isExp  = expanded === c.id;
            const rowBg  = dec?.status === "approved" ? "rgba(240,253,244,0.5)" : dec?.status === "rejected" ? "rgba(254,242,242,0.4)" : "#fff";

            return (
              <div key={c.id}>
                {/* Main row */}
                <div
                  onClick={() => setExpanded(isExp ? null : c.id)}
                  style={{ display: "grid", gridTemplateColumns: `220px repeat(${maxRounds}, minmax(150px,1fr)) 160px`, background: rowBg, borderBottom: "1px solid rgba(221,208,232,0.2)", cursor: "pointer", minWidth: 700, transition: "background .12s" }}
                >
                  {/* Candidate cell */}
                  <div style={{ padding: "14px", display: "flex", alignItems: "center", gap: 10, borderRight: "1px solid rgba(221,208,232,0.2)" }}>
                    <div style={{ width: 34, height: 34, borderRadius: "50%", background: c.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{c.initials}</div>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#1e1b4b" }}>{c.name}</span>
                        {isExp ? <ChevronUp size={11} color="#9ca3af" /> : <ChevronDown size={11} color="#9ca3af" />}
                      </div>
                      <div style={{ fontSize: 11, color: "#9ca3af" }}>{c.role}</div>
                      <div style={{ fontSize: 11, color: "#9ca3af" }}>{c.email}</div>
                      {dec && <span style={{ fontSize: 10, color: "#6366f1", fontWeight: 600 }}>✓ HR Approved</span>}
                    </div>
                  </div>

                  {/* Round columns — same as HR Interviews */}
                  {Array.from({ length: maxRounds }, (_, i) => {
                    const r = c.rounds[i];
                    if (!r) return (
                      <div key={i} style={{ padding: "14px", display: "flex", alignItems: "center", justifyContent: "center", borderRight: "1px solid rgba(221,208,232,0.2)", color: "#e5e7eb", fontSize: 18 }}>—</div>
                    );
                    const s = SC[r.status];
                    return (
                      <div key={i} style={{ padding: "12px 14px", borderRight: "1px solid rgba(221,208,232,0.2)", display: "flex", flexDirection: "column", gap: 5 }}>
                        {/* Round badge + type */}
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: "linear-gradient(135deg,#6366f1,#818cf8)", color: "#fff" }}>R{r.roundNo}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "#1e1b4b" }}>{r.type}</span>
                        </div>
                        {/* Status pill */}
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color, alignSelf: "flex-start" }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot, flexShrink: 0 }} />
                          {s.label}
                        </span>
                        {/* Date */}
                        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#9ca3af" }}>
                          <Calendar size={10} />
                          {r.date !== "TBD" ? `${r.date} · ${r.time}` : "TBD"}
                        </div>
                        {/* Mode icon */}
                        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#9ca3af" }}>
                          {r.mode === "Video Call" ? <Video size={10} /> : <Monitor size={10} />}
                          {r.mode} · {r.duration}
                        </div>
                      </div>
                    );
                  })}

                  {/* Manager Decision cell */}
                  <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: 6, justifyContent: "center" }}>
                    {managerBadge(dec) ?? <span style={{ fontSize: 11, color: "#d1d5db" }}>Not sent yet</span>}
                    {dec?.overall_rating != null && (
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <Star size={11} color="#f59e0b" fill="#f59e0b" />
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#1e1b4b" }}>{dec.overall_rating}/5</span>
                      </div>
                    )}
                    {dec?.recommendation && (
                      <span style={{ fontSize: 10, color: "#9ca3af" }}>{dec.recommendation}</span>
                    )}
                  </div>
                </div>

                {/* Expanded detail row */}
                {isExp && (() => {
                  // Gather all completed rounds with feedback
                  const completedRounds = c.rounds.filter(
                    r => (r.status === "passed" || r.status === "failed") && r.feedback
                  );
                  const lastFeedback = completedRounds.length
                    ? completedRounds[completedRounds.length - 1].feedback!
                    : null;

                  // Parse raw skills string "Apex: 4/5, SOQL: 3/5, ..."
                  // into [{skill, pct}] for display
                  function parseSkillsString(raw: string): { skill: string; rating: string; pct: number }[] {
                    return raw.split(",").map(s => s.trim()).filter(Boolean).map(s => {
                      const m = s.match(/^(.+?):\s*(\d+(?:\.\d+)?)\/(\d+)$/);
                      if (m) {
                        const score = parseFloat(m[2]);
                        const max   = parseFloat(m[3]);
                        return { skill: m[1].trim(), rating: `${m[2]}/${m[3]}`, pct: Math.round((score / max) * 100) };
                      }
                      return { skill: s, rating: "—", pct: 0 };
                    });
                  }

                  // Skills: prefer raw string from candidate profile, fallback to round feedback
                  const profileSkills = c.skills ? parseSkillsString(c.skills) : [];

                  // Aggregate skills from round feedback as fallback
                  const skillMap: Record<string, number[]> = {};
                  completedRounds.forEach(r => {
                    (r.feedback?.skills || []).forEach(sk => {
                      if (!skillMap[sk.skill]) skillMap[sk.skill] = [];
                      skillMap[sk.skill].push(sk.score);
                    });
                  });
                  const feedbackSkills = Object.entries(skillMap).map(([skill, scores]) => ({
                    skill,
                    rating: `${(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)}/5`,
                    pct: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 20),
                  })).sort((a, b) => b.pct - a.pct).slice(0, 6);

                  const displaySkills = profileSkills.length > 0 ? profileSkills : feedbackSkills;

                  // Match dimensions
                  const avgComm    = completedRounds.length
                    ? completedRounds.reduce((s, r) => s + (r.feedback?.communication || 0), 0) / completedRounds.length * 20 : 0;
                  const avgCulture = completedRounds.length
                    ? completedRounds.reduce((s, r) => s + (r.feedback?.cultural_fit   || 0), 0) / completedRounds.length * 20 : 0;
                  const skillAvg   = displaySkills.length
                    ? displaySkills.reduce((s, sk) => s + sk.pct, 0) / displaySkills.length : 0;
                  const expScore   = Math.min(100, (c.rounds.filter(r => r.status === "passed").length / Math.max(c.rounds.length, 1)) * 100);

                  const dimensions = [
                    { label: "Skills",        pct: Math.round(skillAvg   || (c.aiScore ? c.aiScore : 0)) },
                    { label: "Experience",    pct: Math.round(expScore) },
                    { label: "Communication", pct: Math.round(avgComm) },
                    { label: "Culture Fit",   pct: Math.round(avgCulture) },
                  ];

                  const aiSummary = c.summary || lastFeedback?.summary || null;

                  const GradBar = ({ pct }: { pct: number }) => (
                    <div style={{ flex: 1, height: 8, borderRadius: 99, background: "#f0eef8", overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", borderRadius: 99,
                        background: "linear-gradient(90deg,#6ec6f5,#a78bfa,#ec4899)", transition: "width .4s ease" }}/>
                    </div>
                  );

                  return (
                    <div style={{ borderBottom: "1px solid rgba(221,208,232,0.2)", background: "#fafafe", padding: "16px 20px" }}>
                      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>

                        {/* Left column: AI Summary + Profile Info */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: "1 1 220px" }}>

                          {/* AI Summary */}
                          {aiSummary && (
                            <div style={{ background: "#fff", border: "1px solid rgba(221,208,232,0.4)", borderRadius: 12, padding: "16px 18px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                                <span style={{ fontSize: 14 }}>🤖</span>
                                <span style={{ fontSize: 11, fontWeight: 800, color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.06em" }}>AI Summary</span>
                              </div>
                              <p style={{ fontSize: 13, color: "#374151", lineHeight: 1.7, margin: 0 }}>{aiSummary}</p>
                            </div>
                          )}

                          {/* Profile: Experience + AI Score */}
                          <div style={{ background: "#fff", border: "1px solid rgba(221,208,232,0.4)", borderRadius: 12, padding: "16px 18px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
                              <span style={{ fontSize: 13 }}>👤</span>
                              <span style={{ fontSize: 11, fontWeight: 800, color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.06em" }}>Profile</span>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontSize: 12, color: "#6b7280" }}>Experience</span>
                                <span style={{ fontSize: 13, fontWeight: 700, color: "#1e1b4b" }}>
                                  {c.yoe && c.yoe !== "N/A" ? `${c.yoe}` : `${c.rounds.filter(r => r.status === "passed").length} rounds cleared`}
                                </span>
                              </div>
                              {c.aiScore != null && c.aiScore > 0 && (
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <span style={{ fontSize: 12, color: "#6b7280" }}>AI Resume Score</span>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    {/* mini circular-ish score badge */}
                                    <div style={{ position: "relative", width: 40, height: 40 }}>
                                      <svg width="40" height="40" viewBox="0 0 40 40">
                                        <circle cx="20" cy="20" r="16" fill="none" stroke="#f0eef8" strokeWidth="4"/>
                                        <circle cx="20" cy="20" r="16" fill="none"
                                          stroke="url(#scoreGrad)" strokeWidth="4"
                                          strokeDasharray={`${(c.aiScore / 100) * 100.5} 100.5`}
                                          strokeLinecap="round"
                                          transform="rotate(-90 20 20)"/>
                                        <defs>
                                          <linearGradient id="scoreGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                            <stop offset="0%" stopColor="#6ec6f5"/>
                                            <stop offset="100%" stopColor="#a78bfa"/>
                                          </linearGradient>
                                        </defs>
                                      </svg>
                                      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center",
                                        justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#1e1b4b" }}>
                                        {c.aiScore}
                                      </span>
                                    </div>
                                    <span style={{ fontSize: 11, color: "#6b7280" }}>/100</span>
                                  </div>
                                </div>
                              )}
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontSize: 12, color: "#6b7280" }}>Email</span>
                                <span style={{ fontSize: 12, color: "#4f46e5" }}>{c.email}</span>
                              </div>
                              {dec?.hr_approved_at && (
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <span style={{ fontSize: 12, color: "#6b7280" }}>HR Approved</span>
                                  <span style={{ fontSize: 12, fontWeight: 700, color: "#065f46" }}>
                                    {new Date(dec.hr_approved_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Middle: Match Dimensions */}
                        {dimensions.some(d => d.pct > 0) && (
                          <div style={{ flex: "1 1 200px", background: "#fff", border: "1px solid rgba(221,208,232,0.4)", borderRadius: 12, padding: "16px 18px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
                              <span style={{ fontSize: 13 }}>📈</span>
                              <span style={{ fontSize: 11, fontWeight: 800, color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.06em" }}>Match Dimensions</span>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                              {dimensions.map(({ label, pct }) => (
                                <div key={label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                  <span style={{ fontSize: 12, color: "#374151", width: 110, flexShrink: 0 }}>{label}</span>
                                  <GradBar pct={pct}/>
                                  <span style={{ fontSize: 12, fontWeight: 700, color: "#1e1b4b", width: 36, textAlign: "right" }}>{pct}%</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Right: Skills */}
                        {displaySkills.length > 0 && (
                          <div style={{ flex: "1 1 200px", background: "#fff", border: "1px solid rgba(221,208,232,0.4)", borderRadius: 12, padding: "16px 18px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
                              <span style={{ fontSize: 13 }}>✅</span>
                              <span style={{ fontSize: 11, fontWeight: 800, color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.06em" }}>Skills</span>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                              {displaySkills.map(({ skill, rating, pct }) => (
                                <div key={skill} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                  <span style={{ fontSize: 12, color: "#374151", width: 130, flexShrink: 0, wordBreak: "break-word" }}>{skill}</span>
                                  <GradBar pct={pct}/>
                                  <span style={{ fontSize: 11, fontWeight: 700, color: "#1e1b4b", width: 40, textAlign: "right", flexShrink: 0 }}>{rating}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Fallback when nothing available */}
                        {!aiSummary && dimensions.every(d => d.pct === 0) && displaySkills.length === 0 && (
                          <div style={{ flex: 1, background: "#fff", border: "1px solid rgba(221,208,232,0.4)",
                            borderRadius: 12, padding: "20px 18px", display: "flex", gap: 24, flexWrap: "wrap" }}>
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", marginBottom: 4 }}>Email</div>
                              <div style={{ fontSize: 13, color: "#1e1b4b" }}>{c.email}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", marginBottom: 4 }}>Experience</div>
                              <div style={{ fontSize: 13, color: "#1e1b4b" }}>{c.yoe && c.yoe !== "N/A" ? c.yoe : "—"}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", marginBottom: 4 }}>Rounds Progress</div>
                              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                                {c.rounds.map((r, i) => {
                                  const done = r.status === "passed"; const fail = r.status === "failed"; const act = r.status === "active";
                                  return (
                                    <span key={i} style={{ padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700,
                                      background: done ? "rgba(16,185,129,0.12)" : fail ? "rgba(220,38,38,0.1)" : act ? "rgba(245,158,11,0.12)" : "rgba(221,208,232,0.35)",
                                      color: done ? "#065f46" : fail ? "#b91c1c" : act ? "#92400e" : "#9ca3af" }}>
                                      R{r.roundNo} {done ? "✓" : fail ? "✗" : act ? "●" : "○"}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", marginBottom: 4 }}>Manager Decision</div>
                              {managerBadge(dec) ?? <span style={{ fontSize: 12, color: "#9ca3af" }}>—</span>}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      </div>

      <p style={{ fontSize: 11, color: "#c4bdd0", textAlign: "right", margin: 0 }}>
        Auto-refreshes every 30 s ·{" "}
        <button onClick={fetchAll} style={{ background: "none", border: "none", color: "#6366f1", fontSize: 11, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>Refresh now</button>
      </p>

      <style>{`@keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }`}</style>
    </div>
  );
}
