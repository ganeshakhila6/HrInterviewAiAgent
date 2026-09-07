"use client";
import "./ManagerInterviewsPage.css";
import { useState, useEffect } from "react";
import {
  Calendar, Clock, Video, Monitor, Send, X,
  ChevronRight, ChevronLeft, CheckCircle, Mail,
  Eye, Loader2, Plus, ThumbsUp, ThumbsDown, RefreshCw,
  AlertCircle, Star, MessageSquare,
} from "lucide-react";
import { isValidEmail } from "@/lib/emailValidation";
import {
  useInterviewStore,
  type Candidate,
  type Round,
  type RoundStatus,
  API_BASE_URL,
  apiHeaders,
  normalizeCandidate,
} from "@/lib/interviewStore";

const MANAGER_API  = process.env.NEXT_PUBLIC_MANAGER_API_BASE_URL || "http://localhost:8001";
const MANAGER_NAME = "You";
const HR_EMAIL     = process.env.NEXT_PUBLIC_HR_EMAIL || "sneha.m@recruitai.app";
const HR_NAME      = "Sneha M.";

const SC: Record<RoundStatus, { bg: string; color: string; label: string; dot: string }> = {
  active:    { bg: "rgba(253,200,56,0.18)",  color: "#7A5A00", label: "Ongoing",     dot: "#F5C518" },
  passed:    { bg: "rgba(52,199,89,0.15)",   color: "#1a7a3a", label: "Completed",   dot: "#34C759" },
  failed:    { bg: "rgba(220,53,69,0.13)",   color: "#b02030", label: "Didn't Pass", dot: "#DC3545" },
  "on-hold": { bg: "rgba(238,208,90,0.22)",  color: "#7A5A10", label: "On Hold",     dot: "#F0A500" },
  pending:   { bg: "rgba(221,208,232,0.35)", color: "#9090B0", label: "Locked",      dot: "#9090B0" },
};

/* ── AI Feedback Modal (same as HR portal feedback page) ──────────────────── */
type AIFeedbackReport = {
  candidate_id: string; candidate_name: string; role: string;
  rounds_reviewed: number; generated_at: string;
  overall_rating: number; recommendation: string;
  executive_summary: string; top_strengths: string[]; growth_areas: string[];
  aggregated_skills: { skill: string; avg_score: number }[];
  round_highlights: { round_no: number; type: string; rating: number; key_insight: string; interviewer: string; date: string }[];
  hiring_confidence: "High" | "Medium" | "Low"; culture_fit_score: number; communication_score: number;
};

function MiniStars({ score, size = 11 }: { score: number; size?: number }) {
  if (!score) return <span style={{ color: "#9ca3af" }}>—</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
      {[1,2,3,4,5].map(s => (
        <Star key={s} size={size} style={{ color: s <= Math.round(score) ? "#B875A0" : "#E0D0E8", fill: s <= Math.round(score) ? "#B875A0" : "none" }} />
      ))}
      <span style={{ fontSize: size, fontWeight: 600, color: "#6b7280", marginLeft: 3 }}>{score}</span>
    </span>
  );
}

function AIFeedbackModal({ candidateId, candidateName, candidateRole, candidateColor, candidateInitials, onClose }: {
  candidateId: string; candidateName: string; candidateRole: string;
  candidateColor: string; candidateInitials: string; onClose: () => void;
}) {
  const [report,  setReport]  = useState<AIFeedbackReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res  = await fetch(`${API_BASE_URL}/interviews/${candidateId}/feedback-report`, { headers: apiHeaders() });
        const body = await res.json().catch(() => ({}));
        if (res.status === 422 || res.status === 404) throw new Error(body?.detail ?? "No completed feedback yet. Feedback must be submitted before a report can be generated.");
        if (!res.ok) throw new Error(body?.detail ?? `Server error ${res.status}`);
        if (!cancelled) setReport(body?.content ?? body);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load feedback report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [candidateId]);

  const recColors: Record<string, { bg: string; color: string; dot: string }> = {
    "Strong Hire": { bg: "rgba(122,184,216,0.15)", color: "#3A70A0", dot: "#7AB8D8" },
    "Hire":        { bg: "rgba(168,152,216,0.15)", color: "#5A4878", dot: "#A898D8" },
    "Hold":        { bg: "rgba(238,208,90,0.2)",   color: "#7A5A10", dot: "#EED860" },
    "No Hire":     { bg: "rgba(184,117,160,0.15)", color: "#8A4A78", dot: "#B875A0" },
  };
  const confColors: Record<string, { bg: string; color: string }> = {
    High:   { bg: "rgba(122,184,216,0.15)", color: "#3A70A0" },
    Medium: { bg: "rgba(238,208,90,0.2)",   color: "#7A5A10" },
    Low:    { bg: "rgba(184,117,160,0.15)", color: "#8A4A78" },
  };

  return (
    <div className="mi-overlay" onClick={onClose}>
      <div className="mi-modal mi-modal--wide" style={{ maxWidth: 680, maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="mi-modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: "50%", background: candidateColor, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{candidateInitials}</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#1e1b4b" }}>{candidateName} — Feedback Report</div>
              <div style={{ fontSize: 12, color: "#9ca3af" }}>{candidateRole} · AI-generated</div>
            </div>
          </div>
          <button className="mi-close" onClick={onClose}><X size={17}/></button>
        </div>

        <div style={{ padding: "18px 22px" }}>
          {loading && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "40px 0", color: "#9ca3af" }}>
              <Loader2 size={28} style={{ color: "#A898D8", animation: "mi-spin 1s linear infinite" }} />
              <p style={{ margin: 0, fontSize: 13 }}>Generating AI feedback report…</p>
            </div>
          )}

          {!loading && error && (
            <div style={{ display: "flex", gap: 10, padding: "14px 16px", background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.18)", borderRadius: 10 }}>
              <AlertCircle size={16} style={{ color: "#dc2626", flexShrink: 0 }} />
              <p style={{ margin: 0, fontSize: 13, color: "#b02030" }}>{error}</p>
            </div>
          )}

          {!loading && report && (
            <>
              {/* Overview */}
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16, padding: "14px 16px", background: "#f8f7ff", borderRadius: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>Overall Rating</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "#1e1b4b", lineHeight: 1.2 }}>{report.overall_rating || "—"}</div>
                  <MiniStars score={report.overall_rating} size={13} />
                </div>
                {report.recommendation && (
                  <div>
                    <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>Recommendation</div>
                    <span style={{ display: "inline-block", marginTop: 4, padding: "3px 12px", borderRadius: 20, fontSize: 13, fontWeight: 700, background: recColors[report.recommendation]?.bg ?? "#f3f4f6", color: recColors[report.recommendation]?.color ?? "#374151" }}>
                      <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: recColors[report.recommendation]?.dot ?? "#9ca3af", marginRight: 6 }}/>
                      {report.recommendation}
                    </span>
                  </div>
                )}
                {report.hiring_confidence && (
                  <div>
                    <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>Hiring Confidence</div>
                    <span style={{ display: "inline-block", marginTop: 4, padding: "3px 12px", borderRadius: 20, fontSize: 13, fontWeight: 700, background: confColors[report.hiring_confidence]?.bg ?? "#f3f4f6", color: confColors[report.hiring_confidence]?.color ?? "#374151" }}>{report.hiring_confidence}</span>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>Rounds Reviewed</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "#1e1b4b", lineHeight: 1.2 }}>{report.rounds_reviewed}</div>
                </div>
              </div>

              {/* Culture Fit + Communication */}
              <div style={{ display: "flex", gap: 20, marginBottom: 16 }}>
                <div><div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase" }}>Culture Fit</div><MiniStars score={report.culture_fit_score} size={13} /></div>
                <div><div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase" }}>Communication</div><MiniStars score={report.communication_score} size={13} /></div>
              </div>

              {/* Executive summary */}
              {report.executive_summary && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#B875A0", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>Executive Summary</div>
                  <p style={{ margin: 0, fontSize: 13, color: "#374151", lineHeight: 1.65 }}>{report.executive_summary}</p>
                </div>
              )}

              {/* Skill ratings */}
              {report.aggregated_skills?.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#B875A0", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>Skill Ratings (avg across rounds)</div>
                  {report.aggregated_skills.map(sk => {
                    const pct = (sk.avg_score / 5) * 100;
                    const c = sk.avg_score >= 4.5 ? "#7AB8D8" : sk.avg_score >= 3.5 ? "#A898D8" : sk.avg_score >= 2.5 ? "#B875A0" : "#E0D0E8";
                    return (
                      <div key={sk.skill} style={{ marginBottom: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                          <span style={{ color: "#374151" }}>{sk.skill}</span>
                          <span style={{ fontWeight: 700, color: "#6b7280" }}>{sk.avg_score}/5</span>
                        </div>
                        <div style={{ height: 6, borderRadius: 4, background: "#e5e7eb", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${pct}%`, background: c, borderRadius: 4, transition: "width .4s" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Strengths + Growth areas */}
              {(report.top_strengths?.length > 0 || report.growth_areas?.length > 0) && (
                <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
                  {report.top_strengths?.length > 0 && (
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#B875A0", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Top Strengths</div>
                      {report.top_strengths.map(s => <div key={s} style={{ fontSize: 13, color: "#374151", padding: "3px 0" }}>✓ {s}</div>)}
                    </div>
                  )}
                  {report.growth_areas?.length > 0 && (
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#d97706", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Growth Areas</div>
                      {report.growth_areas.map(s => <div key={s} style={{ fontSize: 13, color: "#374151", padding: "3px 0" }}>— {s}</div>)}
                    </div>
                  )}
                </div>
              )}

              {/* Round highlights */}
              {report.round_highlights?.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#B875A0", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>Round Highlights</div>
                  {report.round_highlights.map(h => (
                    <div key={h.round_no} style={{ padding: "12px 14px", borderRadius: 9, border: "1px solid rgba(221,208,232,0.4)", background: "#f8f7ff", marginBottom: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 6 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700, background: "rgba(52,199,89,0.15)", color: "#1a7a3a" }}>
                          <CheckCircle size={11} /> Round {h.round_no}{h.type ? ` — ${h.type}` : ""}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {h.interviewer && <span style={{ fontSize: 11, color: "#9ca3af" }}>{h.interviewer}{h.date ? ` · ${h.date}` : ""}</span>}
                          {h.rating > 0 && <MiniStars score={h.rating} />}
                        </div>
                      </div>
                      <p style={{ margin: 0, fontSize: 13, color: "#374151", lineHeight: 1.55 }}>{h.key_insight}</p>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ fontSize: 11, color: "#c4bdd0", textAlign: "center", marginTop: 14 }}>
                AI report generated {new Date(report.generated_at).toLocaleString()}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Email body builders ──────────────────────────────── */
function makeCandidateApprovalEmail(c: ApprovedCandidate) {
  return {
    subject: `Interview Update — ${c.role} at RecruitAI`,
    body: `Hi ${c.candidate_name.split(" ")[0]},\n\nThank you for your time through the interview process for the ${c.role} position.\n\nWe are pleased to inform you that you have been reviewed and approved by the Hiring Manager.\n\nOur team will be in touch shortly with the next steps.\n\nBest regards,\n${MANAGER_NAME}\nRecruitAI Hiring Team`,
  };
}

function makeHrApprovalEmail(c: ApprovedCandidate, decision: string) {
  const verb = decision === "approved" ? "approved" : "rejected";
  return {
    subject: `Manager ${verb === "approved" ? "Approved" : "Rejected"} — ${c.candidate_name}`,
    body: `Hi ${HR_NAME.split(" ")[0]},\n\nThis is to inform you that ${c.candidate_name} (${c.role}) has been ${verb} by the Hiring Manager.\n\nCandidate: ${c.candidate_name}\nRole: ${c.role}\nEmail: ${c.candidate_email}\nDecision: ${verb.toUpperCase()}\n\nPlease proceed with the next steps accordingly.\n\nBest regards,\n${MANAGER_NAME}\nRecruitAI Manager Portal`,
  };
}

function makeRoundCandidateEmail(c: Candidate, r: Round) {
  return {
    subject: `Interview Invitation — ${r.type} Round | ${c.role} | ${r.date}`,
    body: `Dear ${c.name.split(" ")[0]},

We hope this message finds you well.

We are pleased to invite you to the next stage of the interview process for the ${c.role} position at RecruitAI.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  INTERVIEW DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📋 Position       : ${c.role}
  🔁 Round          : R${r.roundNo} — ${r.type}
  📅 Date           : ${r.date}
  🕐 Time           : ${r.time}
  ⏱  Duration       : ${r.duration}
  🖥  Mode           : ${r.mode}
  👤 Interviewer    : ${MANAGER_NAME}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[The Microsoft Teams meeting link will be included below]

Please confirm your availability by replying to this email at your earliest convenience.

If you have any questions or need to reschedule, feel free to reach out to us.

We look forward to speaking with you!

Warm regards,
${MANAGER_NAME}
Hiring Manager — RecruitAI
📧 ${HR_EMAIL}`,
  };
}

function makeRoundHrEmail(c: Candidate, r: Round) {
  return {
    subject: `[Action Required] New Round Scheduled — ${c.name} | ${r.type} | ${r.date}`,
    body: `Hi ${HR_NAME.split(" ")[0]},

This is to inform you that a new interview round has been scheduled by the Hiring Manager.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ROUND SCHEDULE DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  👤 Candidate      : ${c.name}
  📧 Email          : ${c.email}
  💼 Role           : ${c.role}
  🔁 Round          : R${r.roundNo} — ${r.type}
  📅 Date           : ${r.date}
  🕐 Time           : ${r.time}
  ⏱  Duration       : ${r.duration}
  🖥  Mode           : ${r.mode}
  👤 Interviewer    : ${MANAGER_NAME}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Action Items:
  ✅ Please update the candidate's status in the HR Portal
  ✅ Ensure the interview slot is blocked in the calendar
  ✅ Send any required documents / assessments to the candidate

Please coordinate accordingly and confirm once done.

Best regards,
${MANAGER_NAME}
Hiring Manager — RecruitAI`,
  };
}

/* ── Types ───────────────────────────────────────────────── */
type ApprovedCandidate = {
  candidate_id:    string;
  candidate_name:  string;
  candidate_email: string;
  initials:        string;
  color:           string;
  role:            string;
  rounds:          Round[];
  overall_rating:  number | null;
  recommendation:  string;
  hr_note:         string;
  hr_approved_at:  string;
  status:          "pending_manager" | "approved" | "rejected";
  manager_decision: string | null;
  manager_note:     string | null;
};

/* 2-step email wizard — works for both row-level AND round-level */
type EmailWizard = {
  /* context */
  candidate: ApprovedCandidate;
  round?: Round;
  step: 1 | 2;
  /* step 1 — candidate */
  cTo: string; cSub: string; cBody: string;
  /* step 2 — HR */
  hTo: string; hSub: string; hBody: string;
};

type ScheduleModal = {
  candidate: Candidate;
  date: string; time: string; duration: string; mode: "Video Call" | "In-person";
};

/* ── Round cell ──────────────────────────────────────────── */
function RoundCell({ round, isLoading, onViewFeedback }: {
  round: Round; isLoading: boolean; onViewFeedback: () => void;
}) {
  const s     = SC["passed"];
  const hasFb = Boolean(round.feedback?.summary);
  return (
    <div className="mi-round-cell">
      <span className="mi-status-pill" style={{ background: s.bg, color: s.color }}>
        <span className="mi-status-dot" style={{ background: s.dot }} />
        {s.label}
      </span>
      <div className="mi-round-date">
        <Calendar size={10} />
        {round.date !== "TBD" ? `${round.date} · ${round.time}` : "TBD"}
      </div>
      <button
        className={`mi-view-btn ${hasFb ? "mi-view-btn--active" : ""}`}
        disabled={isLoading}
        onClick={onViewFeedback}
      >
        {isLoading
          ? <><Loader2 size={10} className="mi-spin" /> Loading</>
          : <><Eye size={10} /> {hasFb ? "View Feedback" : "No Feedback"}</>}
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   PAGE COMPONENT
══════════════════════════════════════════════════════════ */
export default function ManagerInterviewsPage() {
  const { candidates, setCandidates, refreshKey } = useInterviewStore();

  /* ── approved list ── */
  const [hrApproved,      setHrApproved]      = useState<ApprovedCandidate[]>([]);
  const [approvedLoading, setApprovedLoading] = useState(false);
  const [fetchError,      setFetchError]      = useState<string | null>(null);
  /* localDecisions drives the UI — cleared on every refresh for demo mode */
  const [localDecisions,  setLocalDecisions]  = useState<Record<string, "approved" | "rejected" | "pending">>({});

  /* ── Refresh resets ALL local decisions so manager must re-decide ── */
  /* ── Demo mode: manual refresh wipes MongoDB + clears UI ─────────────────
     On manual refresh: DELETE /manager/reset clears all approvals from DB
     so the page goes empty. Candidates only reappear when HR sends them. ── */
  async function fetchApproved() {
  setApprovedLoading(true);
  setFetchError(null);

  try {
    const res = await fetch(`${MANAGER_API}/manager/approved-candidates`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    const list: ApprovedCandidate[] = data.candidates || [];
    setHrApproved(list);
    const seed: Record<string, "approved" | "rejected" | "pending"> = {};
    list.forEach(ac => {
      seed[ac.candidate_id] = (ac.manager_decision as any) || "pending";
    });
    setLocalDecisions(seed);
  } catch {
    setFetchError(
      "Could not reach the Manager Backend (localhost:8001). " +
      "Make sure it is running: python backend/manager_backend/manager_api.py"
    );
  } finally {
    setApprovedLoading(false);
  }
}
  /* ── decision error toast ── */
  const [decisionError, setDecisionError] = useState<string | null>(null);

  async function submitDecision(candidateId: string, decision: "approved" | "rejected") {
    setLocalDecisions(p => ({ ...p, [candidateId]: decision }));
    setDecisionError(null);
    const ac = hrApproved.find(c => c.candidate_id === candidateId);
    try {
      const url = `${MANAGER_API}/manager/approved-candidates/${encodeURIComponent(candidateId)}/decision`;
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (res.status === 404 && ac) {
        /* Record was reset — re-create it first */
        await fetch(`${MANAGER_API}/manager/hr-approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidate_id:    ac.candidate_id,
            candidate_name:  ac.candidate_name,
            candidate_email: ac.candidate_email,
            initials:        ac.initials,
            color:           ac.color,
            role:            ac.role,
            rounds:          ac.rounds || [],
            overall_rating:  ac.overall_rating,
            recommendation:  ac.recommendation,
            hr_note:         ac.hr_note || "",
          }),
        });
        const res2 = await fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        });
        if (!res2.ok) throw new Error(`Server error ${res2.status}`);
      } else if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail || `Server error ${res.status}`);
      }
      /* Update the row status in hrApproved so it stays visible with decision */
      setHrApproved(prev => prev.map(c =>
        c.candidate_id === candidateId
          ? { ...c, status: decision, manager_decision: decision }
          : c
      ));

      /* When approved: push to HR Offers page via offers endpoint */
      if (decision === "approved") {
        fetch(`${MANAGER_API}/manager/offers?candidate_id=${encodeURIComponent(candidateId)}`, {
          method: "POST",
        }).catch(err => console.warn("Offers push failed:", err));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Decision save failed";
      setDecisionError(msg);
      console.warn("Decision submit error:", msg);
    }
  }

  useEffect(() => { fetchApproved(); }, []);

  /* ── modals ── */
  const [summaryCandidate,  setSummaryCandidate]  = useState<{ id: string; name: string; role: string; color: string; initials: string } | null>(null);
  const [feedbackLoadingId, setFeedbackLoadingId] = useState<string | null>(null);
  const [wizard,            setWizard]            = useState<EmailWizard | null>(null);
  const [wizLoading,        setWizLoading]        = useState(false);
  const [wizSent,           setWizSent]           = useState(false);
  const [wizError,          setWizError]          = useState<string | null>(null);
  const [cToTouched,        setCToTouched]        = useState(false);
  const [hToTouched,        setHToTouched]        = useState(false);
  const [scheduleModal,     setScheduleModal]     = useState<ScheduleModal | null>(null);
  const [rejectId,          setRejectId]          = useState<string | null>(null);
  /* Track which candidates have had email sent this session — persists after wizard closes */
  const [mailSentIds,       setMailSentIds]       = useState<Set<string>>(new Set());

  /* ── TASK 2: open row-level send email wizard ── */
  function openRowEmail(ac: ApprovedCandidate) {
    const dec = localDecisions[ac.candidate_id] ?? ac.status;
    const ce  = makeCandidateApprovalEmail(ac);
    const he  = makeHrApprovalEmail(ac, dec);
    setWizard({ candidate: ac, step: 1, cTo: ac.candidate_email, cSub: ce.subject, cBody: ce.body, hTo: HR_EMAIL, hSub: he.subject, hBody: he.body });
    setWizLoading(false); setWizSent(false); setWizError(null);
    setCToTouched(false); setHToTouched(false);
  }

  /* open round-level wizard */
  function openRoundEmail(ac: ApprovedCandidate, r: Round) {
    const asC: Candidate = {
      id: 0, backendId: ac.candidate_id, name: ac.candidate_name,
      initials: ac.initials, color: ac.color, email: ac.candidate_email,
      role: ac.role, rounds: ac.rounds || [],
    };
    const ce = makeRoundCandidateEmail(asC, r);
    const he = makeRoundHrEmail(asC, r);
    setWizard({ candidate: ac, round: r, step: 1, cTo: ac.candidate_email, cSub: ce.subject, cBody: ce.body, hTo: HR_EMAIL, hSub: he.subject, hBody: he.body });
    setWizLoading(false); setWizSent(false); setWizError(null);
    setCToTouched(false); setHToTouched(false);
  }

  /* send both emails via manager backend (MS Graph) */
  function sendBoth() {
    if (!wizard) return;
    setCToTouched(true); setHToTouched(true);
    if (!isValidEmail(wizard.cTo)) { setWizard({ ...wizard, step: 1 }); return; }
    if (!isValidEmail(wizard.hTo)) return;
    setWizLoading(true); setWizError(null);

    const round = wizard.round;

    /* Always use the manager backend's send-round-email endpoint which
       uses the same Azure MS Graph credentials as the HR backend */
    fetch(`${MANAGER_API}/manager/send-round-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateEmail:   wizard.cTo,
        candidateSubject: wizard.cSub,
        candidateBody:    wizard.cBody,
        hrEmail:          wizard.hTo,
        hrSubject:        wizard.hSub,
        hrBody:           wizard.hBody,
        candidateName:    wizard.candidate.candidate_name,
        role:             wizard.candidate.role,
        roundNo:          round?.roundNo ?? 1,
        date:             round?.date    ?? "TBD",
        time:             round?.time    ?? "TBD",
        duration:         round?.duration ?? "60 min",
        mode:             round?.mode    ?? "Video Call",
        candidateId:      wizard.candidate.candidate_id,
      }),
    })
      .then(async r => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.detail || "Mail failed");
        return d;
      })
      .then((data: { teamsLink?: string }) => {
        setWizSent(true);
        /* Mark email as sent for this candidate */
        setMailSentIds(prev => new Set([...prev, wizard.candidate.candidate_id]));

        /* Store Teams link on the new round so Join Meeting button activates */
        const teamsLink = data?.teamsLink || "";
        if (teamsLink && round) {
          setHrApproved(prev => prev.map(ac =>
            ac.candidate_id === wizard.candidate.candidate_id
              ? {
                  ...ac,
                  rounds: (ac.rounds || []).map(r =>
                    r.roundNo === round.roundNo
                      ? { ...r, teamsLink } as any
                      : r
                  ),
                }
              : ac
          ));
        }

        setTimeout(() => setWizard(null), 1600);
      })
      .catch(err => setWizError(err instanceof Error ? err.message : "Failed to send emails."))
      .finally(() => setWizLoading(false));
  }

  function confirmSchedule() {
    if (!scheduleModal) return;
    const { candidate, date, time, duration, mode } = scheduleModal;
    const nextNo  = (candidate.rounds.length || 0) + 1;
    const newRound: Round = { roundNo: nextNo, type: "New Round", date, time, interviewer: MANAGER_NAME, interviewerEmail: HR_EMAIL, mode, duration, status: "pending", mailSent: false };
    setHrApproved(prev => prev.map(ac =>
      ac.candidate_id === candidate.backendId ? { ...ac, rounds: [...(ac.rounds || []), newRound] } : ac
    ));
    /* Persist "new round added" status to backend so HR Feedback page can show it */
    const candidateId = candidate.backendId ?? "";
    if (candidateId) {
      fetch(`${MANAGER_API}/manager/approved-candidates/${encodeURIComponent(candidateId)}/decision`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "new_round", note: `Manager added new round: R${nextNo} on ${date} at ${time}` }),
      }).catch(() => {/* non-blocking */});
    }
    setScheduleModal(null);
  }

  async function fetchFeedback(ac: ApprovedCandidate) {
    setSummaryCandidate({
      id:       ac.candidate_id,
      name:     ac.candidate_name,
      role:     ac.role,
      color:    ac.color || "#6366f1",
      initials: ac.initials,
    });
  }

  const maxRounds = Math.max(...hrApproved.map(ac => (ac.rounds || []).length), 1);

  return (
    <div className="mi-page">
      {/* Header */}
      <div className="mi-header">
        <div>
          <h1 className="mi-title">Interviews</h1>
          <p className="mi-subtitle">
          {hrApproved.length} candidate{hrApproved.length !== 1 ? "s" : ""} pending your review
        </p>
        </div>
        <button className="mi-refresh-btn" onClick={() => fetchApproved()} disabled={approvedLoading}>
          <RefreshCw size={13} className={approvedLoading ? "mi-spin" : ""} />
          {approvedLoading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* ── TASK 1 FIX: inline error banner instead of alert() ── */}
      {fetchError && (
        <div className="mi-fetch-error">
          <AlertCircle size={15} style={{ flexShrink: 0 }} />
          <div>
            <strong>Backend not reachable</strong>
            <p>{fetchError}</p>
          </div>
          <button className="mi-btn mi-btn--outline mi-retry-btn" onClick={fetchApproved}>
            <RefreshCw size={11} /> Retry
          </button>
        </div>
      )}

      {/* Decision error toast */}
      {decisionError && (
        <div className="mi-fetch-error" style={{ background: "rgba(220,53,69,0.07)", borderColor: "rgba(220,53,69,0.2)" }}>
          <AlertCircle size={15} style={{ flexShrink: 0, color: "#b02030" }} />
          <div>
            <strong style={{ color: "#b02030" }}>Decision failed</strong>
            <p style={{ color: "#b02030" }}>{decisionError}</p>
          </div>
          <button className="mi-btn mi-btn--outline mi-retry-btn" onClick={() => setDecisionError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* Legend */}
      <div className="mi-legend">
        {(["active","passed","failed","pending"] as RoundStatus[]).map(s => (
          <span key={s} className="mi-legend-item">
            <span className="mi-legend-dot" style={{ background: SC[s].dot }} />
            {SC[s].label}
          </span>
        ))}
      </div>

      {/* Empty state */}
      {!approvedLoading && !fetchError && hrApproved.length === 0 && (
        <div className="mi-empty">
          No candidates sent for review yet. When HR approves a candidate in the Feedback page, they will appear here.
        </div>
      )}

      {/* ── Main Table ── */}
      {hrApproved.length > 0 && (
        <div className="mi-table-wrap">
          <div className="mi-table-scroll">
            <div className="mi-thead" style={{ gridTemplateColumns: `240px repeat(${maxRounds}, minmax(160px,1fr)) 220px` }}>
              <div className="mi-th">Candidate</div>
              {Array.from({ length: maxRounds }, (_, i) => <div key={i} className="mi-th">Round {i + 1}</div>)}
              <div className="mi-th">Actions</div>
            </div>

            {hrApproved.map(ac => {
              /* Demo mode: always use localDecision — starts as "pending" after refresh */
              const dec = localDecisions[ac.candidate_id] ?? "pending";
              const asCandidate: Candidate = { id: 0, backendId: ac.candidate_id, name: ac.candidate_name, initials: ac.initials, color: ac.color || "#6366f1", email: ac.candidate_email, role: ac.role, rounds: ac.rounds || [] };
              const rowBg = dec === "approved" ? "rgba(240,253,244,0.6)" : dec === "rejected" ? "rgba(254,242,242,0.5)" : "#fff";

              return (
                <div key={ac.candidate_id} className="mi-row"
                  style={{ gridTemplateColumns: `240px repeat(${maxRounds}, minmax(160px,1fr)) 220px`, background: rowBg }}>

                  {/* Candidate cell */}
                  <div className="mi-td mi-td-cand">
                    <div className="mi-avatar" style={{ background: ac.color || "#6366f1" }}>{ac.initials}</div>
                    <div>
                      <div className="mi-cand-name">{ac.candidate_name}</div>
                      <div className="mi-cand-role">{ac.role}</div>
                      <div className="mi-cand-email">{ac.candidate_email}</div>
                      <span className="mi-hr-badge">✓ HR Approved</span>
                      {ac.overall_rating != null && <div className="mi-rating">⭐ {ac.overall_rating}/5 · {ac.recommendation}</div>}
                    </div>
                  </div>

                  {/* Round columns */}
                  {Array.from({ length: maxRounds }, (_, i) => {
                    const r = (ac.rounds || [])[i];
                    if (!r) return <div key={i} className="mi-td mi-td-round mi-td-empty">—</div>;
                    return (
                      <div key={i} className="mi-td mi-td-round">
                        <div className="mi-round-label">
                          <span className="mi-round-badge">R{r.roundNo}</span>
                          <span className="mi-round-type">{r.type}</span>
                        </div>
                        <RoundCell round={r} isLoading={feedbackLoadingId === ac.candidate_id} onViewFeedback={() => fetchFeedback(ac)} />
                      </div>
                    );
                  })}

                  {/* ── Actions column ── */}
                  <div className="mi-td mi-td-actions">
                    {/* Approve / Reject */}
                    {dec === "approved" ? (
                      <span className="mi-decision mi-decision--approved"><CheckCircle size={12} /> Approved</span>
                    ) : dec === "rejected" ? (
                      <span className="mi-decision mi-decision--rejected"><ThumbsDown size={12} /> Rejected</span>
                    ) : (
                      <div className="mi-decision-row">
                        <button className="mi-btn mi-btn--approve" onClick={() => submitDecision(ac.candidate_id, "approved")}><ThumbsUp size={11} /> Approve</button>
                        <button className="mi-btn mi-btn--reject"  onClick={() => setRejectId(ac.candidate_id)}><ThumbsDown size={11} /> Reject</button>
                      </div>
                    )}

                    {/* Add Another Round — disabled after decision */}
                    <button
                      className="mi-btn mi-btn--add"
                      disabled={dec === "approved" || dec === "rejected"}
                      title={dec === "approved" || dec === "rejected" ? "Cannot add rounds after a decision" : undefined}
                      onClick={() => setScheduleModal({ candidate: asCandidate, date: "", time: "", duration: "60 min", mode: "Video Call" })}
                    >
                      <Plus size={11} /> Add Another Round
                    </button>

                    {/* Join Meeting — shown below Add Another Round */}
                    {(() => {
                      const newRound  = (ac.rounds || []).find(r => r.type === "New Round");
                      const teamsLink = (newRound as any)?.teamsLink || "";
                      const canJoin   = !!newRound && dec !== "approved" && dec !== "rejected";

                      return teamsLink ? (
                        <a href={teamsLink} target="_blank" rel="noopener noreferrer" className="mi-btn mi-btn--primary" style={{ textDecoration:"none", justifyContent:"center" }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink:0 }}><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/></svg>
                          Join Meeting
                        </a>
                      ) : (
                        <button className="mi-btn mi-btn--primary" disabled={!canJoin} style={{ opacity: canJoin ? 0.55 : 0.3 }} title={!newRound ? "Add a new round first" : "Send email to generate meeting link"}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink:0 }}><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/></svg>
                          Join Meeting
                        </button>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Reject confirm modal */}
      {rejectId && (
        <div className="mi-overlay" onClick={() => setRejectId(null)}>
          <div className="mi-modal" onClick={e => e.stopPropagation()}>
            <div className="mi-modal-header">
              <span style={{ fontWeight:700, color:"#b02030" }}>Reject Candidate</span>
              <button className="mi-close" onClick={() => setRejectId(null)}><X size={16}/></button>
            </div>
            <div className="mi-modal-body">
              <p style={{ fontSize:13, color:"#6b7280", margin:"0 0 14px" }}>Are you sure you want to reject this candidate?</p>
              <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                <button className="mi-btn mi-btn--outline" onClick={() => setRejectId(null)}>Cancel</button>
                <button style={{ padding:"7px 16px", background:"#DC3545", border:"none", borderRadius:9, fontSize:13, fontWeight:700, color:"#fff", cursor:"pointer", fontFamily:"inherit" }}
                  onClick={() => { submitDecision(rejectId, "rejected"); setRejectId(null); }}>Confirm Reject</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Round modal */}
      {scheduleModal && (
        <div className="mi-overlay" onClick={() => setScheduleModal(null)}>
          <div className="mi-modal" onClick={e => e.stopPropagation()}>
            <div className="mi-modal-header">
              <span style={{ fontWeight:700, color:"#1e1b4b" }}><Plus size={14} color="#6366f1" style={{ verticalAlign:"middle", marginRight:5 }}/>Add Round — {scheduleModal.candidate.name}</span>
              <button className="mi-close" onClick={() => setScheduleModal(null)}><X size={16}/></button>
            </div>
            <div className="mi-modal-body">
              {/* Date picker */}
              <div className="mi-form-group">
                <label className="mi-form-label">Date</label>
                <input
                  className="mi-input"
                  type="date"
                  value={scheduleModal.date ? (() => {
                    try {
                      const d = new Date(scheduleModal.date);
                      return isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0];
                    } catch { return ""; }
                  })() : ""}
                  onChange={e => {
                    const d = e.target.value ? new Date(e.target.value) : null;
                    const fmt = d ? d.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" }) : "";
                    setScheduleModal({ ...scheduleModal, date: fmt });
                  }}
                />
                {scheduleModal.date && <span style={{ fontSize:11, color:"#6366f1", marginTop:2 }}>{scheduleModal.date}</span>}
              </div>

              {/* Time picker */}
              <div className="mi-form-group">
                <label className="mi-form-label">Time</label>
                <input
                  className="mi-input"
                  type="time"
                  value={scheduleModal.time ? (() => {
                    try {
                      const t = scheduleModal.time.replace(/\s?(AM|PM)/i, "");
                      const [h, m] = t.split(":");
                      return `${h.padStart(2,"0")}:${(m||"00").padStart(2,"0")}`;
                    } catch { return ""; }
                  })() : ""}
                  onChange={e => {
                    if (!e.target.value) return;
                    const [h, m] = e.target.value.split(":");
                    const hour = parseInt(h);
                    const ampm = hour >= 12 ? "PM" : "AM";
                    const h12  = hour % 12 || 12;
                    setScheduleModal({ ...scheduleModal, time: `${h12}:${m} ${ampm}` });
                  }}
                />
                {scheduleModal.time && <span style={{ fontSize:11, color:"#6366f1", marginTop:2 }}>{scheduleModal.time}</span>}
              </div>

              {/* Duration */}
              <div className="mi-form-group">
                <label className="mi-form-label">Duration</label>
                <input className="mi-input" placeholder="e.g. 60 min" value={scheduleModal.duration} onChange={e => setScheduleModal({ ...scheduleModal, duration: e.target.value })}/>
              </div>
              <div className="mi-form-group">
                <label className="mi-form-label">Mode</label>
                <div style={{ display:"flex", gap:8 }}>
                  {(["Video Call","In-person"] as const).map(m => (
                    <button key={m} onClick={() => setScheduleModal({ ...scheduleModal, mode:m })} className={`mi-mode-btn ${scheduleModal.mode===m?"mi-mode-btn--active":""}`}>
                      {m==="Video Call"?<Video size={12}/>:<Monitor size={12}/>} {m}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:14 }}>
                <button className="mi-btn mi-btn--outline" onClick={() => setScheduleModal(null)}>Cancel</button>
                <button
                  className="mi-btn mi-btn--mail"
                  disabled={!scheduleModal.date || !scheduleModal.time}
                  onClick={() => {
                    /* 1. Save the new round */
                    confirmSchedule();
                    /* 2. Find the candidate approval and open email wizard for the new round */
                    const ac = hrApproved.find(a => a.candidate_id === scheduleModal.candidate.backendId);
                    if (ac) {
                      const nextNo = (scheduleModal.candidate.rounds.length || 0) + 1;
                      const newRound = {
                        roundNo: nextNo, type: "New Round",
                        date: scheduleModal.date, time: scheduleModal.time,
                        interviewer: MANAGER_NAME, interviewerEmail: HR_EMAIL,
                        mode: scheduleModal.mode, duration: scheduleModal.duration,
                        status: "pending" as const, mailSent: false,
                      };
                      setTimeout(() => openRoundEmail(ac, newRound), 50);
                    }
                  }}
                >
                  <Mail size={13} /> Send Email
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Email Wizard with live preview ── */}
      {wizard && (
        <div className="mi-overlay" onClick={() => { if (!wizLoading) setWizard(null); }}>
          <div className="mi-modal mi-modal--wide" onClick={e => e.stopPropagation()} style={{ maxWidth: 780 }}>
            <div className="mi-modal-header">
              <span style={{ fontWeight:700, color:"#1e1b4b", display:"flex", alignItems:"center", gap:6 }}>
                <Mail size={15} color="#6366f1"/>
                {wizard.candidate.candidate_name} — Send Interview Email
              </span>
              <button className="mi-close" onClick={() => { if (!wizLoading) setWizard(null); }} disabled={wizLoading}><X size={17}/></button>
            </div>

            {/* step bar */}
            <div className="mi-stepbar">
              {([1,2] as const).map(n => (
                <span key={n} className={`mi-step ${wizard.step===n?"mi-step--active":wizard.step>n?"mi-step--done":""}`}>
                  <span className="mi-step-circle">{wizard.step>n?<CheckCircle size={12}/>:n}</span>
                  <span className="mi-step-label">{n===1?"📧 Candidate Email":"👤 HR Notification"}</span>
                </span>
              ))}
            </div>

            {/* two-column: form + live preview */}
            <div style={{ display:"flex", gap:0, flex:1, overflow:"hidden", minHeight:420 }}>

              {/* ── Left: editable form ── */}
              <div className="mi-modal-body" style={{ flex:"0 0 52%", borderRight:"1px solid rgba(221,208,232,0.3)", overflowY:"auto" }}>

                {wizSent && (
                  <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 14px", background:"rgba(16,185,129,0.1)", border:"1px solid rgba(16,185,129,0.3)", borderRadius:9, fontSize:13, color:"#065f46", fontWeight:600 }}>
                    <CheckCircle size={15}/> Emails sent successfully!
                  </div>
                )}
                {wizError && (
                  <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 14px", background:"rgba(220,53,69,0.08)", border:"1px solid rgba(220,53,69,0.2)", borderRadius:9, fontSize:12, color:"#b02030" }}>
                    <AlertCircle size={13}/> {wizError}
                  </div>
                )}

                {wizard.step === 1 && (
                  <>
                    <div style={{ fontSize:11, fontWeight:700, color:"#6366f1", textTransform:"uppercase", letterSpacing:".06em", marginBottom:10 }}>
                      ✏️ Edit Candidate Email
                    </div>
                    <div className="mi-form-group">
                      <label className="mi-form-label">To (Candidate)</label>
                      <input className={`mi-input ${cToTouched && !isValidEmail(wizard.cTo) ? "mi-input--error" : ""}`}
                        value={wizard.cTo} onChange={e => { setWizard({...wizard, cTo:e.target.value}); setCToTouched(true); }}/>
                      {cToTouched && !isValidEmail(wizard.cTo) && <span className="mi-err">Enter a valid email (e.g. name@gmail.com)</span>}
                    </div>
                    <div className="mi-form-group">
                      <label className="mi-form-label">Subject</label>
                      <input className="mi-input" value={wizard.cSub} onChange={e => setWizard({...wizard, cSub:e.target.value})}/>
                    </div>
                    <div className="mi-form-group">
                      <label className="mi-form-label">Message</label>
                      <textarea className="mi-textarea" rows={12} value={wizard.cBody} onChange={e => setWizard({...wizard, cBody:e.target.value})}/>
                    </div>
                  </>
                )}

                {wizard.step === 2 && (
                  <>
                    <div style={{ fontSize:11, fontWeight:700, color:"#6366f1", textTransform:"uppercase", letterSpacing:".06em", marginBottom:10 }}>
                      ✏️ Edit HR Notification Email
                    </div>
                    <div className="mi-form-group">
                      <label className="mi-form-label">To (HR)</label>
                      <input className={`mi-input ${hToTouched && !isValidEmail(wizard.hTo) ? "mi-input--error" : ""}`}
                        value={wizard.hTo} onChange={e => { setWizard({...wizard, hTo:e.target.value}); setHToTouched(true); }}/>
                      {hToTouched && !isValidEmail(wizard.hTo) && <span className="mi-err">Enter a valid email (e.g. name@outlook.com)</span>}
                    </div>
                    <div className="mi-form-group">
                      <label className="mi-form-label">Subject</label>
                      <input className="mi-input" value={wizard.hSub} onChange={e => setWizard({...wizard, hSub:e.target.value})}/>
                    </div>
                    <div className="mi-form-group">
                      <label className="mi-form-label">Message</label>
                      <textarea className="mi-textarea" rows={12} value={wizard.hBody} onChange={e => setWizard({...wizard, hBody:e.target.value})}/>
                    </div>
                  </>
                )}
              </div>

              {/* ── Right: live email preview ── */}
              <div style={{ flex:"0 0 48%", background:"#f8f7ff", overflowY:"auto", padding:"18px 20px" }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", letterSpacing:".06em", marginBottom:12, display:"flex", alignItems:"center", gap:5 }}>
                  <Eye size={11}/> Live Preview
                </div>

                {/* email card */}
                <div style={{ background:"#fff", border:"1px solid rgba(221,208,232,0.4)", borderRadius:12, overflow:"hidden", fontSize:12 }}>
                  {/* email header */}
                  <div style={{ background:"linear-gradient(135deg,#6366f1,#818cf8)", padding:"14px 18px" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <div style={{ width:32, height:32, borderRadius:"50%", background:"rgba(255,255,255,0.25)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                        <Mail size={15} color="#fff"/>
                      </div>
                      <div>
                        <div style={{ color:"#fff", fontWeight:700, fontSize:13 }}>RecruitAI</div>
                        <div style={{ color:"rgba(255,255,255,0.75)", fontSize:11 }}>noreply@recruitai.app</div>
                      </div>
                    </div>
                  </div>

                  {/* to / subject */}
                  <div style={{ padding:"12px 18px", borderBottom:"1px solid rgba(221,208,232,0.3)", background:"#fdf9ff" }}>
                    <div style={{ display:"flex", gap:6, marginBottom:4, alignItems:"flex-start" }}>
                      <span style={{ fontSize:10, fontWeight:700, color:"#9ca3af", minWidth:44, paddingTop:1 }}>TO</span>
                      <span style={{ fontSize:12, color:"#4f46e5", fontWeight:600 }}>{wizard.step===1 ? wizard.cTo : wizard.hTo}</span>
                    </div>
                    <div style={{ display:"flex", gap:6, alignItems:"flex-start" }}>
                      <span style={{ fontSize:10, fontWeight:700, color:"#9ca3af", minWidth:44, paddingTop:1 }}>SUBJECT</span>
                      <span style={{ fontSize:12, color:"#1e1b4b", fontWeight:600, lineHeight:1.4 }}>{wizard.step===1 ? wizard.cSub : wizard.hSub}</span>
                    </div>
                  </div>

                  {/* body */}
                  <div style={{ padding:"14px 18px" }}>
                    <pre style={{ fontFamily:"inherit", fontSize:12, color:"#374151", whiteSpace:"pre-wrap", wordBreak:"break-word", margin:0, lineHeight:1.7 }}>
                      {wizard.step===1 ? wizard.cBody : wizard.hBody}
                    </pre>
                  </div>

                  {/* footer */}
                  <div style={{ padding:"10px 18px", borderTop:"1px solid rgba(221,208,232,0.2)", background:"#fdf9ff", fontSize:10, color:"#9ca3af" }}>
                    This email was sent from RecruitAI Manager Portal · {new Date().toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" })}
                  </div>
                </div>
              </div>
            </div>

            <div className="mi-modal-footer">
              {wizard.step === 1 ? (
                <>
                  <button className="mi-btn mi-btn--outline" onClick={() => setWizard(null)} disabled={wizLoading}>Cancel</button>
                  <button className="mi-btn mi-btn--primary" onClick={() => { setCToTouched(true); if (!isValidEmail(wizard.cTo)) return; setWizard({...wizard,step:2}); }}>
                    Next — HR Notification <ChevronRight size={13}/>
                  </button>
                </>
              ) : (
                <>
                  <button className="mi-btn mi-btn--outline" onClick={() => setWizard({...wizard,step:1})} disabled={wizLoading}>
                    <ChevronLeft size={13}/> Back
                  </button>
                  <button className="mi-btn mi-btn--primary" onClick={sendBoth} disabled={wizLoading || wizSent}>
                    {wizLoading ? <><Loader2 size={13} className="mi-spin"/> Sending…</>
                     : wizSent  ? <><CheckCircle size={13}/> Sent!</>
                     :            <><Send size={13}/> Send to Both</>}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {summaryCandidate && (
        <AIFeedbackModal
          candidateId={summaryCandidate.id}
          candidateName={summaryCandidate.name}
          candidateRole={summaryCandidate.role}
          candidateColor={summaryCandidate.color}
          candidateInitials={summaryCandidate.initials}
          onClose={() => setSummaryCandidate(null)}
        />
      )}
    </div>
  );
}
