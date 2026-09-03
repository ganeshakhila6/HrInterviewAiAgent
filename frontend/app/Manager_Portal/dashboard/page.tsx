"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import ManagerSummaryModal from "@/components/ManagerSummaryModal";
import { useInterviewStore } from "@/lib/interviewStore";
import type { Candidate } from "@/lib/interviewStore";
import { getCandidatesAwaitingApproval } from "@/lib/managerFeedback";
import {
  Briefcase, Users, Clock, MapPin, ChevronDown,
  MessageSquare, ThumbsUp, ThumbsDown, CheckCircle,
  ArrowRight, XCircle, RefreshCw, AlertCircle, Linkedin,
} from "lucide-react";

const MANAGER_API     = process.env.NEXT_PUBLIC_MANAGER_API_BASE_URL || "http://localhost:8001";
const HR_API          = process.env.NEXT_PUBLIC_API_BASE_URL         || "http://localhost:8000";
const JOBS_REFRESH_MS = 30_000;

type PendingCandidate = {
  candidate_id:    string;
  candidate_name:  string;
  candidate_email: string;
  initials:        string;
  color:           string;
  role:            string;
  rounds:          { roundNo: number; type: string; status: string }[];
  overall_rating:  number | null;
  recommendation:  string;
  hr_note:         string;
  hr_approved_at:  string;
  status:          "pending_manager" | "approved" | "rejected";
};

type HiringRole = {
  id:           number;
  title:        string;
  dept:         string;
  location:     string;
  candidates:   number;
  posted:       string;
  openings:     number;
  urgent:       boolean;
  status:       string;
  description:  string;
  experience:   string;
  job_offer_id: string;
  source:       "salesforce" | "linkedin" | string;
  pipeline:     any[];
};

function normalizeJobs(raw: any[]): HiringRole[] {
  return raw.map((j: any, i: number) => ({
    id:           i + 1,
    title:        j.title        || j.job_offer_name || "Untitled Role",
    dept:         j.dept         || j.position_name  || "General",
    location:     j.location     || "Remote",
    candidates:   Number(j.candidates ?? j.total_applicants ?? 0) || 0,
    posted:       j.posted       || "Recently",
    openings:     Number(j.openings ?? 1),
    urgent:       Boolean(j.urgent),
    status:       j.status       || "Active",
    description:  j.description  || j.jd_text || "",
    experience:   j.experience   || "",
    job_offer_id: j.job_offer_id || "",
    source:       j.source       || "salesforce",
    pipeline:     j.pipeline     || [],
  }));
}

const outerCard: React.CSSProperties = {
  background:"#fff", border:"1px solid #e5e7eb",
  borderRadius:14, marginBottom:24, overflow:"hidden",
};

/* ── Source section banner ─────────────────────────────────────────────────── */
function SourceBanner({
  source, totalJobs, activeJobs, totalCandidates,
}: {
  source: "salesforce" | "linkedin";
  totalJobs: number;
  activeJobs: number;
  totalCandidates: number;
}) {
  const isSF = source === "salesforce";
  const bg        = isSF ? "#e8f4fb" : "#e8f0fb";
  const iconBg    = isSF ? "#00a1e0" : "#0a66c2";
  const titleColor = isSF ? "#0066b3" : "#0a66c2";
  const subColor   = "#6b7280";

  return (
    <div style={{
      background: bg, padding:"14px 20px",
      display:"flex", alignItems:"center", justifyContent:"space-between",
      borderBottom:"1px solid #e5e7eb",
    }}>
      {/* Left: icon + title */}
      <div style={{ display:"flex", alignItems:"center", gap:14 }}>
        <div style={{
          width:42, height:42, borderRadius:10, background:iconBg,
          display:"flex", alignItems:"center", justifyContent:"center",
          flexShrink:0,
        }}>
          {isSF
            ? <span style={{ color:"#fff", fontSize:18, fontWeight:900 }}>☁</span>
            : <Linkedin size={20} color="#fff" strokeWidth={2.5}/>
          }
        </div>
        <div>
          <div style={{ fontSize:15, fontWeight:800, color:titleColor }}>
            {isSF ? "Salesforce" : "LinkedIn"}
            <span style={{ fontWeight:400, color:"#6b7280", marginLeft:6 }}>— Job Openings</span>
          </div>
          <div style={{ fontSize:12, color:subColor, marginTop:2 }}>
            {isSF
              ? "Jobs and candidate pipeline synced from Salesforce CRM"
              : "Job postings and applicants sourced from LinkedIn Recruiter"}
          </div>
        </div>
      </div>
      {/* Right: stats */}
      <div style={{ display:"flex", gap:20, flexShrink:0, marginLeft:16 }}>
        {[
          { val: totalJobs,       label: "jobs" },
          { val: activeJobs,      label: "active" },
          { val: totalCandidates, label: "candidates" },
        ].map(({ val, label }) => (
          <div key={label} style={{ textAlign:"right" }}>
            <span style={{ fontSize:14, fontWeight:800, color:"#1e1b4b" }}>{val}</span>
            <span style={{ fontSize:12, color:"#6b7280", marginLeft:4 }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Pipeline dropdown ─────────────────────────────────────────────────────── */
function PipelineDropdown({ pipeline }: { pipeline: any[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position:"relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display:"inline-flex", alignItems:"center", gap:5,
          padding:"5px 12px", borderRadius:8, fontSize:12, fontWeight:600,
          background:"rgba(99,102,241,0.07)", border:"1px solid rgba(99,102,241,0.22)",
          color:"#4f46e5", cursor:"pointer", fontFamily:"inherit",
        }}
      >
        <Users size={12}/> Pipeline <ChevronDown size={11}/>
      </button>
      {open && (
        <div style={{
          position:"absolute", bottom:"calc(100% + 6px)", left:0, zIndex:50,
          background:"#fff", border:"1px solid #e5e7eb", borderRadius:10,
          boxShadow:"0 8px 24px rgba(30,27,75,0.12)", minWidth:220, padding:"10px 0",
        }}>
          {pipeline.length === 0 ? (
            <div style={{ padding:"8px 14px", fontSize:12, color:"#9ca3af" }}>No candidates yet</div>
          ) : (
            pipeline.slice(0, 6).map((p: any, i: number) => (
              <div key={i} style={{
                display:"flex", alignItems:"center", gap:10,
                padding:"7px 14px", borderBottom: i < pipeline.length - 1 ? "1px solid #f3f4f6" : "none",
              }}>
                <div style={{
                  width:28, height:28, borderRadius:"50%", background: p.color || "#6366f1",
                  color:"#fff", display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:10, fontWeight:700, flexShrink:0,
                }}>
                  {p.initials || (p.name || "?")[0]}
                </div>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:"#1e1b4b",
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {p.name}
                  </div>
                  <div style={{ fontSize:11, color:"#9ca3af" }}>Score: {p.score ?? "—"}</div>
                </div>
              </div>
            ))
          )}
          {pipeline.length > 6 && (
            <div style={{ padding:"6px 14px", fontSize:11, color:"#9ca3af" }}>
              +{pipeline.length - 6} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Single job card ───────────────────────────────────────────────────────── */
function JobCard({ r, onViewDesc }: { r: HiringRole; onViewDesc: (r: HiringRole) => void }) {
  const isSF      = r.source !== "linkedin";
  const accentColor = isSF ? "#00a1e0" : "#0a66c2";

  return (
    <div style={{
      background:"#fff",
      border:"1px solid #e5e7eb",
      borderLeft:`3px solid ${accentColor}`,
      borderRadius:10,
      padding:"16px 18px",
      display:"flex", flexDirection:"column",
      opacity: r.status !== "Active" ? 0.68 : 1,
    }}>
      {/* Title row */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:4 }}>
        <div style={{ fontSize:14, fontWeight:800, color:"#1e1b4b", lineHeight:1.3 }}>{r.title}</div>
        {r.status === "Active"
          ? <span style={{ padding:"2px 10px", borderRadius:20, fontSize:11, fontWeight:700,
              background:"rgba(16,185,129,0.1)", color:"#065f46", flexShrink:0, marginLeft:8 }}>Active</span>
          : <span style={{ padding:"2px 10px", borderRadius:20, fontSize:11, fontWeight:700,
              background:"rgba(156,163,175,0.12)", color:"#6b7280", flexShrink:0, marginLeft:8 }}>{r.status}</span>
        }
      </div>
      <div style={{ fontSize:12, color:accentColor, fontWeight:600, marginBottom:12 }}>{r.dept}</div>

      {/* Meta rows */}
      <div style={{ display:"flex", flexDirection:"column", gap:5, fontSize:12, color:"#6b7280", marginBottom:14 }}>
        <span style={{ display:"flex", alignItems:"center", gap:6 }}>
          <MapPin size={11} color="#9ca3af"/> {r.location}
        </span>
        <span style={{ display:"flex", alignItems:"center", gap:6 }}>
          <Briefcase size={11} color="#9ca3af"/> {r.experience || "N/A"}
        </span>
        <span style={{ display:"flex", alignItems:"center", gap:6 }}>
          <Users size={11} color="#9ca3af"/> {r.candidates} candidates
        </span>
        <span style={{ display:"flex", alignItems:"center", gap:6 }}>
          <Clock size={11} color="#9ca3af"/> {r.posted}
        </span>
      </div>

      {/* Action buttons */}
      <div style={{ display:"flex", gap:8, marginTop:"auto" }}>
        <button
          onClick={() => onViewDesc(r)}
          style={{
            display:"inline-flex", alignItems:"center", gap:5,
            padding:"5px 12px", borderRadius:8, fontSize:12, fontWeight:600,
            background:"#fff", border:"1px solid #d1d5db",
            color:"#374151", cursor:"pointer", fontFamily:"inherit",
          }}
        >
          <ChevronDown size={12}/> View desc
        </button>
        <PipelineDropdown pipeline={r.pipeline}/>
      </div>
    </div>
  );
}

/* ── Source group (banner + grid) ──────────────────────────────────────────── */
function SourceGroup({
  source, roles, onViewDesc, loading,
}: {
  source:      "salesforce" | "linkedin";
  roles:       HiringRole[];
  onViewDesc:  (r: HiringRole) => void;
  loading:     boolean;
}) {
  const activeJobs      = roles.filter(r => r.status === "Active").length;
  const totalCandidates = roles.reduce((s, r) => s + r.candidates, 0);

  return (
    <div style={outerCard}>
      <SourceBanner
        source={source}
        totalJobs={roles.length}
        activeJobs={activeJobs}
        totalCandidates={totalCandidates}
      />

      <div style={{ padding:"18px 20px" }}>
        {loading && roles.length === 0 && (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(230px,1fr))", gap:12 }}>
            {[1,2,3].map(n => (
              <div key={n} style={{ borderRadius:10, height:160,
                background:"linear-gradient(90deg,#f8f7ff 25%,#f0eef8 50%,#f8f7ff 75%)",
                backgroundSize:"200% 100%", animation:"shimmer 1.4s infinite" }}/>
            ))}
          </div>
        )}

        {!loading && roles.length === 0 && (
          <p style={{ fontSize:13, color:"#9ca3af", margin:0, padding:"4px 0" }}>
            No {source === "linkedin" ? "LinkedIn" : "Salesforce"} jobs found.
          </p>
        )}

        {roles.length > 0 && (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(230px,1fr))", gap:12 }}>
            {roles.map(r => <JobCard key={r.id} r={r} onViewDesc={onViewDesc}/>)}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
export default function ManagerDashboard() {
  const { candidates, managerDecisions, approveManagerFeedback, rejectManagerFeedback } = useInterviewStore();
  const router = useRouter();
  const [summaryCandidate, setSummaryCandidate] = useState<Candidate | null>(null);
  const [selectedRole,     setSelectedRole]     = useState<HiringRole | null>(null);

  /* ── Job roles ── */
  const [hiringRoles,  setHiringRoles]  = useState<HiringRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [rolesError,   setRolesError]   = useState(false);

  const fetchJobs = useCallback(async () => {
    setRolesLoading(true);
    setRolesError(false);
    try {
      const res  = await fetch(`${HR_API}/jobs-page`, { cache:"no-store" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setHiringRoles(normalizeJobs(data.jobs || []));
    } catch {
      setRolesError(true);
    } finally {
      setRolesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    const id = setInterval(fetchJobs, JOBS_REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchJobs]);

  const sfRoles = hiringRoles.filter(r => r.source !== "linkedin");
  const liRoles = hiringRoles.filter(r => r.source === "linkedin");

  /* ── Pending approvals ── */
  const [pendingApprovals, setPendingApprovals] = useState<PendingCandidate[]>([]);
  const [pendingLoading,   setPendingLoading]   = useState(false);
  const [pendingError,     setPendingError]     = useState<string | null>(null);

  async function fetchPendingApprovals() {
    setPendingLoading(true);
    setPendingError(null);
    try {
      const res  = await fetch(`${MANAGER_API}/manager/approved-candidates?status=pending_manager`);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      setPendingApprovals(data.candidates || []);
    } catch {
      setPendingError("Could not load pending approvals — manager backend may be offline.");
      setPendingApprovals([]);
    } finally {
      setPendingLoading(false);
    }
  }

  useEffect(() => { fetchPendingApprovals(); }, []);

  const [localDecisions, setLocalDecisions] = useState<Record<string, "approved" | "rejected">>({});

  async function submitDecision(candidateId: string, decision: "approved" | "rejected") {
    setLocalDecisions(p => ({ ...p, [candidateId]: decision }));
    try {
      await fetch(`${MANAGER_API}/manager/approved-candidates/${candidateId}/decision`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      fetchPendingApprovals();
    } catch (err) {
      console.warn("Decision submit failed:", err);
      setLocalDecisions(p => { const n = { ...p }; delete n[candidateId]; return n; });
    }
  }

  const awaitingFeedback    = getCandidatesAwaitingApproval(candidates);
  const pendingFeedback     = awaitingFeedback.filter(c => !managerDecisions[c.id]);
  const displayPendingCount = pendingApprovals.length || pendingFeedback.length;

  return (
    <div style={{ maxWidth:1100 }}>
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontSize:22, fontWeight:800, color:"#1e1b4b", margin:0 }}>Manager Dashboard</h1>
        <p style={{ fontSize:13, color:"#9ca3af", marginTop:4 }}>Your hiring pipeline at a glance</p>
      </div>

      {/* ── Refresh / error bar ── */}
      {rolesError && (
        <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 16px",
          background:"rgba(245,158,11,0.06)", border:"1px solid rgba(245,158,11,0.2)",
          borderRadius:10, fontSize:12, color:"#92400e", marginBottom:16 }}>
          <AlertCircle size={14}/>
          Could not refresh jobs — showing cached data.
          <button onClick={fetchJobs} style={{ marginLeft:"auto", background:"none", border:"none",
            cursor:"pointer", color:"#b45309", fontWeight:600, fontSize:12, fontFamily:"inherit" }}>
            Retry
          </button>
        </div>
      )}

      {/* ── Salesforce section ── */}
      <SourceGroup
        source="salesforce"
        roles={sfRoles}
        onViewDesc={setSelectedRole}
        loading={rolesLoading}
      />

      {/* ── LinkedIn section ── */}
      <SourceGroup
        source="linkedin"
        roles={liRoles}
        onViewDesc={setSelectedRole}
        loading={rolesLoading}
      />

      {/* ── Waiting for Your Approval ── */}
      <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:14,
        padding:"20px 22px", marginBottom:24 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, fontSize:15, fontWeight:700, color:"#1e1b4b" }}>
            <div style={{ width:32, height:32, borderRadius:8, background:"rgba(245,158,11,0.1)",
              color:"#f59e0b", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <MessageSquare size={16}/>
            </div>
            Waiting for Your Approval
            {displayPendingCount > 0 && (
              <span style={{ padding:"2px 9px", borderRadius:20, fontSize:11, fontWeight:700,
                background:"rgba(239,68,68,0.1)", color:"#dc2626" }}>
                {displayPendingCount}
              </span>
            )}
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={fetchPendingApprovals} disabled={pendingLoading}
              style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"5px 11px",
                background:"transparent", border:"1px solid #e5e7eb", borderRadius:8,
                fontSize:12, fontWeight:600, color:"#9ca3af", cursor:"pointer", fontFamily:"inherit" }}>
              <RefreshCw size={11} style={{ animation: pendingLoading ? "spin 1s linear infinite" : "none" }}/>
              {pendingLoading ? "Loading…" : "Refresh"}
            </button>
            <button onClick={() => router.push("/Manager_Portal/interviews")}
              style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"6px 14px",
                background:"rgba(99,102,241,0.08)", border:"1px solid rgba(99,102,241,0.25)",
                borderRadius:8, fontSize:12, fontWeight:600, color:"#4f46e5",
                cursor:"pointer", fontFamily:"inherit" }}>
              View All <ArrowRight size={12}/>
            </button>
          </div>
        </div>

        {pendingError && (
          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 14px",
            background:"rgba(245,158,11,0.06)", border:"1px solid rgba(245,158,11,0.2)",
            borderRadius:9, fontSize:12, color:"#92400e", marginBottom:12 }}>
            <AlertCircle size={14} style={{ flexShrink:0 }}/> {pendingError}
          </div>
        )}

        {!pendingLoading && !pendingError && pendingApprovals.length === 0 && (
          <p style={{ fontSize:13, color:"#9ca3af", padding:"8px 0", margin:0 }}>
            No candidates pending approval. When HR approves a candidate, they'll appear here.
          </p>
        )}

        {pendingApprovals.length > 0 && (
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", minWidth:860 }}>
              <thead>
                <tr style={{ background:"#f8f7ff" }}>
                  {["Candidate","Role","Rounds","HR Rating","HR Approved","Actions"].map(h => (
                    <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontSize:11,
                      fontWeight:700, color:"#9ca3af", textTransform:"uppercase",
                      letterSpacing:"0.05em", borderBottom:"1px solid #e5e7eb" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pendingApprovals.map(ac => {
                  const dec = localDecisions[ac.candidate_id] ?? ac.status;
                  return (
                    <tr key={ac.candidate_id} style={{
                      borderBottom:"1px solid #f3f4f6",
                      background: dec === "approved" ? "rgba(240,253,244,0.5)"
                                : dec === "rejected"  ? "rgba(254,242,242,0.4)" : "#fff",
                    }}>
                      <td style={{ padding:"12px 14px" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:9 }}>
                          <div style={{ width:32, height:32, borderRadius:"50%",
                            background: ac.color || "#6366f1", color:"#fff",
                            display:"flex", alignItems:"center", justifyContent:"center",
                            fontSize:11, fontWeight:700, flexShrink:0 }}>{ac.initials}</div>
                          <div>
                            <div style={{ fontSize:13, fontWeight:700, color:"#1e1b4b" }}>{ac.candidate_name}</div>
                            <div style={{ fontSize:11, color:"#9ca3af" }}>{ac.candidate_email}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding:"12px 14px", fontSize:13, color:"#6b7280" }}>{ac.role}</td>
                      <td style={{ padding:"12px 14px" }}>
                        <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                          {(ac.rounds || []).map((r, i) => (
                            <span key={i} style={{ padding:"2px 8px", borderRadius:20, fontSize:10,
                              fontWeight:700, background:"rgba(52,199,89,0.12)", color:"#1a7a3a",
                              border:"1px solid rgba(52,199,89,0.25)" }}>R{r.roundNo} ✓</span>
                          ))}
                          {(!ac.rounds || ac.rounds.length === 0) && <span style={{ fontSize:11, color:"#9ca3af" }}>—</span>}
                        </div>
                      </td>
                      <td style={{ padding:"12px 14px" }}>
                        {ac.overall_rating != null ? (
                          <div>
                            <div style={{ fontSize:13, fontWeight:700, color:"#1e1b4b" }}>⭐ {ac.overall_rating}/5</div>
                            {ac.recommendation && (
                              <span style={{ fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:20,
                                background:"rgba(168,152,216,0.15)", color:"#5A4878",
                                display:"inline-block", marginTop:3 }}>{ac.recommendation}</span>
                            )}
                          </div>
                        ) : <span style={{ fontSize:12, color:"#9ca3af" }}>—</span>}
                      </td>
                      <td style={{ padding:"12px 14px", fontSize:12, color:"#6b7280" }}>
                        {ac.hr_approved_at
                          ? new Date(ac.hr_approved_at).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" })
                          : "—"}
                      </td>
                      <td style={{ padding:"12px 14px" }}>
                        {dec === "approved" ? (
                          <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:12, fontWeight:700, color:"#065f46" }}>
                            <CheckCircle size={13}/> Approved
                          </span>
                        ) : dec === "rejected" ? (
                          <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:12, fontWeight:700, color:"#dc2626" }}>
                            <XCircle size={13}/> Rejected
                          </span>
                        ) : (
                          <div style={{ display:"flex", gap:7 }}>
                            <button onClick={() => submitDecision(ac.candidate_id, "approved")}
                              style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"6px 12px",
                                background:"rgba(16,185,129,0.1)", border:"1px solid rgba(16,185,129,0.3)",
                                borderRadius:8, fontSize:12, fontWeight:600, color:"#065f46",
                                cursor:"pointer", fontFamily:"inherit" }}>
                              <ThumbsUp size={11}/> Approve
                            </button>
                            <button onClick={() => submitDecision(ac.candidate_id, "rejected")}
                              style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"6px 12px",
                                background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)",
                                borderRadius:8, fontSize:12, fontWeight:600, color:"#dc2626",
                                cursor:"pointer", fontFamily:"inherit" }}>
                              <ThumbsDown size={11}/> Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {summaryCandidate && (
        <ManagerSummaryModal candidate={summaryCandidate} onClose={() => setSummaryCandidate(null)} />
      )}

      {/* ── Job Description Modal ── */}
      {selectedRole && (
        <div onClick={() => setSelectedRole(null)} style={{
          position:"fixed", inset:0, zIndex:1000,
          background:"rgba(30,27,75,0.45)", backdropFilter:"blur(4px)",
          display:"flex", alignItems:"center", justifyContent:"center", padding:"20px",
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background:"#fff", borderRadius:16, width:"100%", maxWidth:660,
            maxHeight:"88vh", display:"flex", flexDirection:"column",
            boxShadow:"0 24px 60px rgba(30,27,75,0.18)", overflow:"hidden",
          }}>
            {/* Header */}
            <div style={{
              background: selectedRole.source === "linkedin"
                ? "linear-gradient(135deg,#0a66c2,#3b8fd4)"
                : "linear-gradient(135deg,#0066b3,#00a1e0)",
              padding:"22px 26px", flexShrink:0,
            }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ marginBottom:8 }}>
                    {selectedRole.source === "linkedin"
                      ? <span style={{ display:"inline-flex", alignItems:"center", gap:5,
                          padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700,
                          background:"rgba(255,255,255,0.2)", color:"#fff" }}>
                          <Linkedin size={10}/> LinkedIn Job
                        </span>
                      : <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700,
                          background:"rgba(255,255,255,0.2)", color:"#fff" }}>
                          ☁ Salesforce Job
                        </span>
                    }
                  </div>
                  <div style={{ fontSize:18, fontWeight:800, color:"#fff", marginBottom:6 }}>{selectedRole.title}</div>
                  <div style={{ fontSize:12, color:"rgba(255,255,255,0.82)", display:"flex", gap:14, flexWrap:"wrap" }}>
                    <span><Briefcase size={11} style={{ display:"inline", marginRight:4 }}/>{selectedRole.dept}</span>
                    <span><MapPin size={11} style={{ display:"inline", marginRight:4 }}/>{selectedRole.location}</span>
                    <span><Users size={11} style={{ display:"inline", marginRight:4 }}/>{selectedRole.candidates} applicants</span>
                    <span><Clock size={11} style={{ display:"inline", marginRight:4 }}/>Posted {selectedRole.posted}</span>
                  </div>
                </div>
                <button onClick={() => setSelectedRole(null)} style={{
                  background:"rgba(255,255,255,0.15)", border:"none", borderRadius:8,
                  color:"#fff", cursor:"pointer", padding:"6px 10px", fontSize:16,
                  lineHeight:1, flexShrink:0, marginLeft:12 }}>✕</button>
              </div>
              <div style={{ display:"flex", gap:8, marginTop:12, flexWrap:"wrap" }}>
                <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700,
                  background:"rgba(255,255,255,0.2)", color:"#fff" }}>
                  {selectedRole.openings} opening{selectedRole.openings > 1 ? "s" : ""}
                </span>
                {selectedRole.urgent && (
                  <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700,
                    background:"rgba(239,68,68,0.3)", color:"#fff" }}>🔴 Urgent</span>
                )}
                {selectedRole.experience && (
                  <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700,
                    background:"rgba(255,255,255,0.15)", color:"#fff" }}>{selectedRole.experience}</span>
                )}
              </div>
            </div>
            {/* Body */}
            <div style={{ overflowY:"auto", padding:"24px 26px", flex:1 }}>
              {selectedRole.description ? (
                <>
                  <div style={{ fontSize:12, fontWeight:700, color:"#1e1b4b", marginBottom:12,
                    textTransform:"uppercase", letterSpacing:"0.06em" }}>Job Description</div>
                  <div style={{ fontSize:13, color:"#374151", lineHeight:1.8,
                    whiteSpace:"pre-wrap", wordBreak:"break-word" }}>{selectedRole.description}</div>
                </>
              ) : (
                <div style={{ textAlign:"center", padding:"40px 20px", color:"#9ca3af", fontSize:13 }}>
                  <Briefcase size={32} style={{ marginBottom:12, opacity:0.4 }}/>
                  <p style={{ margin:0 }}>No job description available for this role.</p>
                </div>
              )}
            </div>
            {/* Footer */}
            <div style={{ padding:"14px 26px", borderTop:"1px solid #e5e7eb",
              display:"flex", justifyContent:"flex-end", background:"#fafafe" }}>
              <button onClick={() => setSelectedRole(null)} style={{
                padding:"8px 22px", borderRadius:9, fontSize:13, fontWeight:600,
                background:"rgba(99,102,241,0.08)", border:"1px solid rgba(99,102,241,0.25)",
                color:"#4f46e5", cursor:"pointer", fontFamily:"inherit" }}>Close</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin    { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
      `}</style>
    </div>
  );
}
