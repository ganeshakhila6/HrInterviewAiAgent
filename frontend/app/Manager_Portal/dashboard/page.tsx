"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import ManagerSummaryModal from "@/components/ManagerSummaryModal";
import { useInterviewStore } from "@/lib/interviewStore";
import type { Candidate } from "@/lib/interviewStore";
import { getCandidatesAwaitingApproval } from "@/lib/managerFeedback";
import {
  Briefcase, Users, Clock, MapPin, ChevronRight,
  MessageSquare, ThumbsUp, ThumbsDown, CheckCircle,
  ArrowRight, XCircle, RefreshCw, AlertCircle, Linkedin,
} from "lucide-react";

const MANAGER_API     = process.env.NEXT_PUBLIC_MANAGER_API_BASE_URL || "http://localhost:8001";
const HR_API          = process.env.NEXT_PUBLIC_API_BASE_URL         || "http://localhost:8000";
const JOBS_REFRESH_MS = 30_000;

/* Shape returned by GET /manager/approved-candidates */
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

/* Shape normalised from /jobs-page */
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
  }));
}

const pill  = (bg: string, color: string) =>
  ({ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:bg, color } as React.CSSProperties);
const card: React.CSSProperties = {
  background:"#fff", border:"1px solid rgba(221,208,232,0.4)",
  borderRadius:14, padding:"20px 22px", marginBottom:24,
};

/* ── Source badge colours ── */
const SF_BG    = "rgba(0,161,224,0.1)";
const SF_COLOR = "#0066b3";
const LI_BG    = "rgba(10,102,194,0.1)";
const LI_COLOR = "#0a66c2";

function SourceBadge({ source }: { source: string }) {
  if (source === "linkedin") {
    return (
      <span style={{ display:"inline-flex", alignItems:"center", gap:4,
        padding:"2px 8px", borderRadius:20, fontSize:10, fontWeight:700,
        background:LI_BG, color:LI_COLOR }}>
        <Linkedin size={9}/> LinkedIn
      </span>
    );
  }
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4,
      padding:"2px 8px", borderRadius:20, fontSize:10, fontWeight:700,
      background:SF_BG, color:SF_COLOR }}>
      ☁ Salesforce
    </span>
  );
}

/* ── Single job card ── */
function JobCard({ r, onView }: { r: HiringRole; onView: (r: HiringRole) => void }) {
  return (
    <div style={{
      border:"1px solid rgba(221,208,232,0.5)", borderRadius:10,
      padding:"14px 16px", opacity: r.status !== "Active" ? 0.65 : 1,
      display:"flex", flexDirection:"column", justifyContent:"space-between",
    }}>
      <div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#1e1b4b",
              whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
              {r.title}
            </div>
            <div style={{ fontSize:11, color:"#9ca3af", marginTop:2 }}>{r.dept}</div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4, flexShrink:0, marginLeft:6 }}>
            {r.urgent && <span style={pill("rgba(239,68,68,0.1)","#dc2626")}>Urgent</span>}
            {r.status !== "Active" && <span style={pill("rgba(156,163,175,0.15)","#6b7280")}>{r.status}</span>}
          </div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:4, fontSize:12, color:"#6b7280" }}>
          <span><MapPin size={10} style={{ display:"inline", marginRight:4 }}/>{r.location}</span>
          <span><Users size={10} style={{ display:"inline", marginRight:4 }}/>{r.candidates} applicants</span>
          <span><Clock size={10} style={{ display:"inline", marginRight:4 }}/>Posted {r.posted}</span>
        </div>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:10 }}>
        <span style={pill("rgba(99,102,241,0.1)","#4f46e5")}>
          {r.openings} opening{r.openings > 1 ? "s" : ""}
        </span>
        <span
          onClick={() => onView(r)}
          style={{ fontSize:12, color:"#6366F1", fontWeight:600, cursor:"pointer",
            display:"flex", alignItems:"center", gap:2 }}
        >
          View <ChevronRight size={12}/>
        </span>
      </div>
    </div>
  );
}

/* ── Sub-section: one source group ── */
function RoleGroup({
  label, icon, accentBg, accentColor, roles, onView,
}: {
  label:        string;
  icon:         React.ReactNode;
  accentBg:     string;
  accentColor:  string;
  roles:        HiringRole[];
  onView:       (r: HiringRole) => void;
}) {
  if (roles.length === 0) return null;
  return (
    <div style={{ marginBottom:20 }}>
      {/* Sub-header */}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
        <div style={{ width:24, height:24, borderRadius:6, background:accentBg,
          color:accentColor, display:"flex", alignItems:"center", justifyContent:"center" }}>
          {icon}
        </div>
        <span style={{ fontSize:13, fontWeight:700, color:"#374151" }}>{label}</span>
        <span style={{ fontSize:11, fontWeight:600, color:"#9ca3af" }}>
          {roles.filter(r => r.status === "Active").length} active
        </span>
      </div>
      {/* Cards grid */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(230px,1fr))", gap:12 }}>
        {roles.map(r => <JobCard key={r.id} r={r} onView={onView} />)}
      </div>
    </div>
  );
}

export default function ManagerDashboard() {
  const { candidates, managerDecisions, approveManagerFeedback, rejectManagerFeedback } = useInterviewStore();
  const router = useRouter();
  const [summaryCandidate, setSummaryCandidate] = useState<Candidate | null>(null);
  const [selectedRole,     setSelectedRole]     = useState<HiringRole | null>(null);

  /* ── Live job roles from HR backend ── */
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

  /* split by source */
  const sfRoles = hiringRoles.filter(r => r.source !== "linkedin");
  const liRoles = hiringRoles.filter(r => r.source === "linkedin");

  /* ── Pending approvals from manager backend ── */
  const [pendingApprovals, setPendingApprovals] = useState<PendingCandidate[]>([]);
  const [pendingLoading,   setPendingLoading]   = useState(false);
  const [pendingError,     setPendingError]     = useState<string | null>(null);

  async function fetchPendingApprovals() {
    setPendingLoading(true);
    setPendingError(null);
    try {
      const res = await fetch(`${MANAGER_API}/manager/approved-candidates?status=pending_manager`);
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

  /* local decision override */
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

      {/* ── Actively Hiring Roles ─────────────────────────────────────── */}
      <div style={card}>
        {/* Card header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, fontSize:15, fontWeight:700, color:"#1e1b4b" }}>
            <div style={{ width:32, height:32, borderRadius:8, background:"rgba(99,102,241,0.1)",
              color:"#6366F1", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <Briefcase size={16}/>
            </div>
            Actively Hiring Roles
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {rolesError && (
              <span style={{ fontSize:11, color:"#f59e0b", display:"flex", alignItems:"center", gap:4 }}>
                <AlertCircle size={11}/> Showing cached data
              </span>
            )}
            <span style={{ fontSize:12, color:"#9ca3af", fontWeight:600 }}>
              {rolesLoading ? "Loading…" : `${hiringRoles.filter(r => r.status === "Active").length} open`}
            </span>
            <button
              onClick={fetchJobs}
              disabled={rolesLoading}
              style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"4px 10px",
                background:"transparent", border:"1px solid rgba(221,208,232,0.5)", borderRadius:7,
                fontSize:11, fontWeight:600, color:"#9ca3af", cursor:"pointer",
                fontFamily:"inherit", opacity: rolesLoading ? 0.6 : 1 }}
            >
              <RefreshCw size={10} style={{ animation: rolesLoading ? "spin 1s linear infinite" : "none" }}/>
              {rolesLoading ? "…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Loading skeleton */}
        {rolesLoading && hiringRoles.length === 0 && (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(230px,1fr))", gap:12 }}>
            {[1,2,3,4,5,6].map(n => (
              <div key={n} style={{ border:"1px solid rgba(221,208,232,0.4)", borderRadius:10,
                padding:"14px 16px", height:120,
                background:"linear-gradient(90deg,#f8f7ff 25%,#f0eef8 50%,#f8f7ff 75%)",
                backgroundSize:"200% 100%", animation:"shimmer 1.4s infinite" }}/>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!rolesLoading && hiringRoles.length === 0 && (
          <p style={{ fontSize:13, color:"#9ca3af", padding:"8px 0" }}>
            No active job roles found. Add jobs in the HR Jobs page.
          </p>
        )}

        {/* ── Salesforce jobs ── */}
        {!rolesLoading && sfRoles.length > 0 && (
          <>
            {/* divider only when both sources exist */}
            <RoleGroup
              label="Salesforce Jobs"
              icon={<span style={{ fontSize:12 }}>☁</span>}
              accentBg={SF_BG}
              accentColor={SF_COLOR}
              roles={sfRoles}
              onView={setSelectedRole}
            />
            {liRoles.length > 0 && (
              <div style={{ borderTop:"1px solid rgba(221,208,232,0.4)", margin:"4px 0 20px" }}/>
            )}
          </>
        )}

        {/* ── LinkedIn jobs ── */}
        {!rolesLoading && liRoles.length > 0 && (
          <RoleGroup
            label="LinkedIn Jobs"
            icon={<Linkedin size={12}/>}
            accentBg={LI_BG}
            accentColor={LI_COLOR}
            roles={liRoles}
            onView={setSelectedRole}
          />
        )}
      </div>

      {/* ── Waiting for Your Approval ─────────────────────────────────── */}
      <div style={card}>
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
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <button
              onClick={fetchPendingApprovals}
              disabled={pendingLoading}
              style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"5px 11px",
                background:"transparent", border:"1px solid rgba(221,208,232,0.5)", borderRadius:8,
                fontSize:12, fontWeight:600, color:"#9ca3af", cursor:"pointer", fontFamily:"inherit" }}
            >
              <RefreshCw size={11} style={{ animation: pendingLoading ? "spin 1s linear infinite" : "none" }}/>
              {pendingLoading ? "Loading…" : "Refresh"}
            </button>
            <button
              onClick={() => router.push("/Manager_Portal/interviews")}
              style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"6px 14px",
                background:"rgba(99,102,241,0.08)", border:"1px solid rgba(99,102,241,0.25)",
                borderRadius:8, fontSize:12, fontWeight:600, color:"#4f46e5",
                cursor:"pointer", fontFamily:"inherit" }}
            >
              View All <ArrowRight size={12}/>
            </button>
          </div>
        </div>

        {pendingError && (
          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 14px",
            background:"rgba(245,158,11,0.06)", border:"1px solid rgba(245,158,11,0.2)",
            borderRadius:9, fontSize:12, color:"#92400e", marginBottom:12 }}>
            <AlertCircle size={14} style={{ flexShrink:0 }}/>
            {pendingError}
          </div>
        )}

        {!pendingLoading && !pendingError && pendingApprovals.length === 0 && (
          <p style={{ fontSize:13, color:"#9ca3af", padding:"8px 0" }}>
            No candidates are pending your approval. When HR approves a candidate, they will appear here.
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
                      letterSpacing:"0.05em", borderBottom:"1px solid rgba(221,208,232,0.3)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pendingApprovals.map(ac => {
                  const dec = localDecisions[ac.candidate_id] ?? ac.status;
                  return (
                    <tr key={ac.candidate_id} style={{
                      borderBottom:"1px solid rgba(221,208,232,0.2)",
                      background: dec === "approved" ? "rgba(240,253,244,0.5)"
                                : dec === "rejected" ? "rgba(254,242,242,0.4)" : "#fff",
                    }}>
                      <td style={{ padding:"12px 14px" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:9 }}>
                          <div style={{ width:32, height:32, borderRadius:"50%",
                            background: ac.color || "#6366f1", color:"#fff",
                            display:"flex", alignItems:"center", justifyContent:"center",
                            fontSize:11, fontWeight:700, flexShrink:0 }}>
                            {ac.initials}
                          </div>
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
                              border:"1px solid rgba(52,199,89,0.25)" }}>
                              R{r.roundNo} ✓
                            </span>
                          ))}
                          {(!ac.rounds || ac.rounds.length === 0) && (
                            <span style={{ fontSize:11, color:"#9ca3af" }}>—</span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding:"12px 14px" }}>
                        {ac.overall_rating != null ? (
                          <div>
                            <div style={{ fontSize:13, fontWeight:700, color:"#1e1b4b" }}>⭐ {ac.overall_rating}/5</div>
                            {ac.recommendation && (
                              <span style={{ fontSize:10, fontWeight:700, padding:"2px 7px",
                                borderRadius:20, background:"rgba(168,152,216,0.15)",
                                color:"#5A4878", display:"inline-block", marginTop:3 }}>
                                {ac.recommendation}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span style={{ fontSize:12, color:"#9ca3af" }}>—</span>
                        )}
                      </td>
                      <td style={{ padding:"12px 14px", fontSize:12, color:"#6b7280" }}>
                        {ac.hr_approved_at
                          ? new Date(ac.hr_approved_at).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" })
                          : "—"}
                      </td>
                      <td style={{ padding:"12px 14px" }}>
                        {dec === "approved" ? (
                          <span style={{ display:"inline-flex", alignItems:"center", gap:5,
                            fontSize:12, fontWeight:700, color:"#065f46" }}>
                            <CheckCircle size={13}/> Approved
                          </span>
                        ) : dec === "rejected" ? (
                          <span style={{ display:"inline-flex", alignItems:"center", gap:5,
                            fontSize:12, fontWeight:700, color:"#dc2626" }}>
                            <XCircle size={13}/> Rejected
                          </span>
                        ) : (
                          <div style={{ display:"flex", gap:7, flexWrap:"wrap" }}>
                            <button
                              onClick={() => submitDecision(ac.candidate_id, "approved")}
                              style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"6px 12px",
                                background:"rgba(16,185,129,0.1)", border:"1px solid rgba(16,185,129,0.3)",
                                borderRadius:8, fontSize:12, fontWeight:600, color:"#065f46",
                                cursor:"pointer", fontFamily:"inherit" }}
                            >
                              <ThumbsUp size={11}/> Approve
                            </button>
                            <button
                              onClick={() => submitDecision(ac.candidate_id, "rejected")}
                              style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"6px 12px",
                                background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)",
                                borderRadius:8, fontSize:12, fontWeight:600, color:"#dc2626",
                                cursor:"pointer", fontFamily:"inherit" }}
                            >
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

      {/* ── Job Description Modal ────────────────────────────────────────── */}
      {selectedRole && (
        <div
          onClick={() => setSelectedRole(null)}
          style={{
            position:"fixed", inset:0, zIndex:1000,
            background:"rgba(30,27,75,0.45)", backdropFilter:"blur(4px)",
            display:"flex", alignItems:"center", justifyContent:"center",
            padding:"20px",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background:"#fff", borderRadius:16, width:"100%", maxWidth:660,
              maxHeight:"88vh", display:"flex", flexDirection:"column",
              boxShadow:"0 24px 60px rgba(30,27,75,0.18)", overflow:"hidden",
            }}
          >
            {/* Modal header */}
            <div style={{
              background: selectedRole.source === "linkedin"
                ? "linear-gradient(135deg,#0a66c2,#3b8fd4)"
                : "linear-gradient(135deg,#0066b3,#00a1e0)",
              padding:"22px 26px", flexShrink:0,
            }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                <div style={{ flex:1, minWidth:0 }}>
                  {/* Source label */}
                  <div style={{ marginBottom:8 }}>
                    {selectedRole.source === "linkedin" ? (
                      <span style={{ display:"inline-flex", alignItems:"center", gap:5,
                        padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700,
                        background:"rgba(255,255,255,0.2)", color:"#fff" }}>
                        <Linkedin size={10}/> LinkedIn Job
                      </span>
                    ) : (
                      <span style={{ display:"inline-flex", alignItems:"center", gap:5,
                        padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700,
                        background:"rgba(255,255,255,0.2)", color:"#fff" }}>
                        ☁ Salesforce Job
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize:18, fontWeight:800, color:"#fff", marginBottom:6 }}>
                    {selectedRole.title}
                  </div>
                  <div style={{ fontSize:12, color:"rgba(255,255,255,0.82)",
                    display:"flex", gap:14, flexWrap:"wrap" }}>
                    <span><Briefcase size={11} style={{ display:"inline", marginRight:4 }}/>{selectedRole.dept}</span>
                    <span><MapPin size={11} style={{ display:"inline", marginRight:4 }}/>{selectedRole.location}</span>
                    <span><Users size={11} style={{ display:"inline", marginRight:4 }}/>{selectedRole.candidates} applicants</span>
                    <span><Clock size={11} style={{ display:"inline", marginRight:4 }}/>Posted {selectedRole.posted}</span>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedRole(null)}
                  style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:8,
                    color:"#fff", cursor:"pointer", padding:"6px 10px", fontSize:16,
                    lineHeight:1, flexShrink:0, marginLeft:12 }}
                >✕</button>
              </div>
              {/* Pills */}
              <div style={{ display:"flex", gap:8, marginTop:12, flexWrap:"wrap" }}>
                <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700,
                  background:"rgba(255,255,255,0.2)", color:"#fff" }}>
                  {selectedRole.openings} opening{selectedRole.openings > 1 ? "s" : ""}
                </span>
                {selectedRole.urgent && (
                  <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700,
                    background:"rgba(239,68,68,0.3)", color:"#fff" }}>
                    🔴 Urgent
                  </span>
                )}
                <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700,
                  background:"rgba(255,255,255,0.15)", color:"#fff" }}>
                  {selectedRole.status}
                </span>
                {selectedRole.experience && (
                  <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700,
                    background:"rgba(255,255,255,0.15)", color:"#fff" }}>
                    {selectedRole.experience}
                  </span>
                )}
              </div>
            </div>

            {/* Modal body — scrollable */}
            <div style={{ overflowY:"auto", padding:"24px 26px", flex:1 }}>
              {selectedRole.description ? (
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color:"#1e1b4b", marginBottom:12,
                    textTransform:"uppercase", letterSpacing:"0.06em" }}>
                    Job Description
                  </div>
                  <div style={{ fontSize:13, color:"#374151", lineHeight:1.8,
                    whiteSpace:"pre-wrap", wordBreak:"break-word" }}>
                    {selectedRole.description}
                  </div>
                </div>
              ) : (
                <div style={{ textAlign:"center", padding:"40px 20px", color:"#9ca3af", fontSize:13 }}>
                  <Briefcase size={32} style={{ marginBottom:12, opacity:0.4 }}/>
                  <p style={{ margin:0 }}>No job description available for this role.</p>
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div style={{ padding:"14px 26px", borderTop:"1px solid rgba(221,208,232,0.4)",
              display:"flex", justifyContent:"flex-end", flexShrink:0, background:"#fafafe" }}>
              <button
                onClick={() => setSelectedRole(null)}
                style={{ padding:"8px 22px", borderRadius:9, fontSize:13, fontWeight:600,
                  background:"rgba(99,102,241,0.08)", border:"1px solid rgba(99,102,241,0.25)",
                  color:"#4f46e5", cursor:"pointer", fontFamily:"inherit" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin     { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
        @keyframes shimmer  { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
      `}</style>
    </div>
  );
}
