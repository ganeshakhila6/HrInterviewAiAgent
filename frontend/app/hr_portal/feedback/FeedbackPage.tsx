"use client";
import "./FeedbackPage.css";
import { useState, useMemo, useEffect } from "react";
import { Star, X, MessageSquare, CheckCircle, Circle, Clock, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { useInterviewStore, type Candidate, type Round, type RoundStatus as InterviewRoundStatus, API_BASE_URL, apiHeaders } from "@/lib/interviewStore";
import { isValidEmail } from "@/lib/emailValidation";

/* ── Types ──────────────────────────────────────────────── */
type FeedbackStatus = "completed" | "pending" | "scheduled" | "na";
type Rec = "Strong Hire" | "Hire" | "Hold" | "No Hire" | "—";

type SkillRating = { skill: string; score: number };

type RoundFeedback = {
  status: FeedbackStatus;
  interviewer: string;
  interviewerInitials: string;
  date: string;
  rating: number;
  recommendation: Rec;
  summary: string;
  skills: SkillRating[];
  strengths: string[];
  improvements: string[];
};

/* ── AI Report shape returned by /interviews/{id}/feedback-report ── */
type AIFeedbackReport = {
  candidate_id: string;
  candidate_name: string;
  role: string;
  rounds_reviewed: number;
  generated_at: string;
  overall_rating: number;
  recommendation: Rec;
  executive_summary: string;
  top_strengths: string[];
  growth_areas: string[];
  aggregated_skills: { skill: string; avg_score: number }[];
  round_highlights: {
    round_no: number;
    type: string;
    rating: number;
    key_insight: string;
    interviewer: string;
    date: string;
  }[];
  hiring_confidence: "High" | "Medium" | "Low";
  culture_fit_score: number;
  communication_score: number;
};

/* Map interview round status → feedback status */
function toFbStatus(s: InterviewRoundStatus): FeedbackStatus {
  if (s === "passed") return "completed";
  if (s === "active") return "scheduled";
  if (s === "failed") return "completed";
  return "pending";
}

/* Build a default RoundFeedback from an interview Round */
function defaultFeedback(r: Round): RoundFeedback {
  return {
    status: toFbStatus(r.status),
    interviewer: r.interviewer,
    interviewerInitials: r.interviewer.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase(),
    date: r.date,
    rating: 0,
    recommendation: "—",
    summary:
      r.status === "active"
        ? `Scheduled — pending feedback.`
        : r.status === "pending"
        ? "Pending scheduling."
        : "",
    skills: [],
    strengths: [],
    improvements: [],
  };
}

/* Build per-candidate round-feedback list from live interview data (no static richFeedback) */
function buildCandidateFeedback(c: Candidate): {
  rounds: RoundFeedback[];
  overallRating: number;
  overallRec: Rec;
} {
  const rounds = c.rounds.map((r) => defaultFeedback(r));

  const completed = rounds.filter((r) => r.status === "completed" && r.rating > 0);
  const overallRating = completed.length
    ? Math.round((completed.reduce((s, r) => s + r.rating, 0) / completed.length) * 10) / 10
    : 0;

  const recOrder: Rec[] = ["Strong Hire", "Hire", "Hold", "No Hire", "—"];
  const recs = completed
    .map((r) => r.recommendation)
    .filter((r): r is Exclude<Rec, "—"> => r !== "—");
  const overallRec: Rec = recs.length
    ? (recOrder.find((r) => recs.includes(r as Exclude<Rec, "—">)) ?? "—")
    : "—";

  return { rounds, overallRating, overallRec };
}

/* ── Style maps ─────────────────────────────────────────── */
const recStyle: Record<string, { bg: string; color: string; dot: string }> = {
  "Strong Hire": { bg: "rgba(122,184,216,0.15)", color: "#3A70A0", dot: "#7AB8D8" },
  Hire: { bg: "rgba(168,152,216,0.15)", color: "#5A4878", dot: "#A898D8" },
  Hold: { bg: "rgba(238,208,90,0.2)", color: "#7A5A10", dot: "#EED860" },
  "No Hire": { bg: "rgba(184,117,160,0.15)", color: "#8A4A78", dot: "#B875A0" },
  "—": { bg: "rgba(200,190,220,0.2)", color: "#888", dot: "#C8B8D8" },
};

const statusMeta: Record<FeedbackStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  completed: { label: "Completed", cls: "st-done", icon: <CheckCircle size={12} /> },
  scheduled: { label: "Scheduled", cls: "st-scheduled", icon: <Clock size={12} /> },
  pending: { label: "Pending", cls: "st-pending", icon: <Circle size={12} /> },
  na: { label: "N/A", cls: "st-na", icon: <Circle size={12} /> },
};

const confidenceMeta: Record<"High" | "Medium" | "Low", { bg: string; color: string }> = {
  High: { bg: "rgba(122,184,216,0.15)", color: "#3A70A0" },
  Medium: { bg: "rgba(238,208,90,0.2)", color: "#7A5A10" },
  Low: { bg: "rgba(184,117,160,0.15)", color: "#8A4A78" },
};

/* ── Small components ───────────────────────────────────── */
function MiniStars({ score, size = 11 }: { score: number; size?: number }) {
  if (!score) return <span className="no-score">—</span>;
  return (
    <span className="mini-stars">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          size={size}
          style={{
            color: s <= Math.round(score) ? "#B875A0" : "#E0D0E8",
            fill: s <= Math.round(score) ? "#B875A0" : "none",
          }}
        />
      ))}
      <span className="mini-score">{score}</span>
    </span>
  );
}

function RecBadge({ rec }: { rec: string }) {
  const s = recStyle[rec] ?? recStyle["—"];
  return (
    <span className="rec-badge" style={{ background: s.bg, color: s.color }}>
      <span className="rec-dot" style={{ background: s.dot }} />
      {rec}
    </span>
  );
}

function SkillBar({ score }: { score: number }) {
  const pct = (score / 5) * 100;
  const color =
    score >= 4.5
      ? "#7AB8D8"
      : score >= 3.5
      ? "#A898D8"
      : score >= 2.5
      ? "#B875A0"
      : "#E0D0E8";
  return (
    <div className="skill-bar-track">
      <div className="skill-bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/* ── Round cell in table ────────────────────────────────── */
function RoundCell({
  round,
  label,
  onView,
}: {
  round: RoundFeedback;
  label: string;
  onView: () => void;
}) {
  const sm = statusMeta[round.status];
  if (round.status === "na") return <div className="rc-na">—</div>;
  return (
    <div className="rc-cell">
      <span className={`rc-status ${sm.cls}`}>
        {sm.icon}
        {sm.label}
      </span>
      {round.status === "completed" ? (
        <button className="btn-view" onClick={onView}>
          <MessageSquare size={11} /> View Feedback
        </button>
      ) : (
        <span className="rc-note">
          {round.status === "scheduled" ? `Sched. · ${round.date}` : "Awaiting"}
        </span>
      )}
    </div>
  );
}

/* ── AI Feedback Detail Modal (replaces old static FeedbackModal) ── */
function AIFeedbackModal({
  candidateId,
  colLabel,
  candidate,
  onClose,
}: {
  candidateId: string;
  colLabel: string;
  candidate: Candidate;
  onClose: () => void;
}) {
  const [report, setReport] = useState<AIFeedbackReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* Fetch on mount — useEffect so it actually runs */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/interviews/${candidateId}/feedback-report`, { headers: apiHeaders() });
        const body = await res.json().catch(() => ({}));

        if (res.status === 404) {
          throw new Error(
            `Interview record not found (candidate id: ${candidateId}). ` +
            `Ensure GET /interviews has been called at least once to initialise this record.`
          );
        }
        if (res.status === 422) {
          throw new Error(
            body?.detail ??
            "No completed feedback yet. Feedback must be submitted before a report can be generated."
          );
        }
        if (!res.ok) {
          throw new Error(body?.detail ?? `Server error ${res.status}`);
        }

        /* MongoResponse wraps payload in { content: … } — unwrap if present */
        if (!cancelled) setReport(body?.content ?? body);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load feedback report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="fb-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="fb-modal-hd">
          <div className="fb-modal-hd-left">
            <div className="fb-avatar" style={{ background: candidate.color }}>
              {candidate.initials}
            </div>
            <div>
              <div className="fb-modal-title">
                {candidate.name} — {colLabel}
              </div>
              <div className="fb-modal-sub">
                {candidate.role} · AI-generated feedback report
              </div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        <div className="fb-modal-body">
          {/* Loading */}
          {loading && (
            <div className="fb-ai-loading">
              <Loader2 size={28} className="spin" style={{ color: "#A898D8" }} />
              <p>Generating AI feedback report…</p>
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="fb-ai-error">
              <AlertCircle size={22} style={{ color: "#B875A0" }} />
              <p>{error}</p>
            </div>
          )}

          {/* Report */}
          {!loading && report && (
            <>
              {/* Overview row */}
              <div className="fm-overview">
                <div className="fm-ov-block">
                  <div className="fm-ov-label">Overall Rating</div>
                  <div className="fm-ov-big">{report.overall_rating || "—"}</div>
                  <MiniStars score={report.overall_rating} size={15} />
                </div>
                <div className="fm-ov-block">
                  <div className="fm-ov-label">Recommendation</div>
                  <RecBadge rec={report.recommendation} />
                </div>
                <div className="fm-ov-block">
                  <div className="fm-ov-label">Hiring Confidence</div>
                  <span
                    className="rec-badge"
                    style={{
                      background: confidenceMeta[report.hiring_confidence]?.bg,
                      color: confidenceMeta[report.hiring_confidence]?.color,
                    }}
                  >
                    {report.hiring_confidence}
                  </span>
                </div>
                <div className="fm-ov-block">
                  <div className="fm-ov-label">Rounds Reviewed</div>
                  <div className="fm-ov-big">{report.rounds_reviewed}</div>
                </div>
              </div>

              {/* Soft scores */}
              <div className="fm-two-col" style={{ marginBottom: 0 }}>
                <div className="fm-ov-block">
                  <div className="fm-ov-label">Culture Fit</div>
                  <MiniStars score={report.culture_fit_score} size={13} />
                </div>
                <div className="fm-ov-block">
                  <div className="fm-ov-label">Communication</div>
                  <MiniStars score={report.communication_score} size={13} />
                </div>
              </div>

              {/* Executive summary */}
              <div className="fm-section">
                <div className="fm-section-title">Executive Summary</div>
                <p className="fm-summary">{report.executive_summary}</p>
              </div>

              {/* Aggregated skills */}
              {report.aggregated_skills?.length > 0 && (
                <div className="fm-section">
                  <div className="fm-section-title">Skill Ratings (avg across rounds)</div>
                  <div className="fm-skills">
                    {report.aggregated_skills.map((sk) => (
                      <div key={sk.skill} className="fm-skill-row">
                        <div className="fm-skill-top">
                          <span className="fm-skill-name">{sk.skill}</span>
                          <span className="fm-skill-score">{sk.avg_score}/5</span>
                        </div>
                        <SkillBar score={sk.avg_score} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Strengths & growth areas */}
              {(report.top_strengths?.length > 0 || report.growth_areas?.length > 0) && (
                <div className="fm-two-col">
                  {report.top_strengths?.length > 0 && (
                    <div className="fm-section">
                      <div className="fm-section-title">Top Strengths</div>
                      <ul className="fm-list">
                        {report.top_strengths.map((s) => (
                          <li key={s} className="fm-good">
                            {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {report.growth_areas?.length > 0 && (
                    <div className="fm-section">
                      <div className="fm-section-title">Growth Areas</div>
                      <ul className="fm-list">
                        {report.growth_areas.map((s) => (
                          <li key={s} className="fm-improve">
                            {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Round highlights */}
              {report.round_highlights?.length > 0 && (
                <div className="fm-section">
                  <div className="fm-section-title">Round Highlights</div>
                  {report.round_highlights.map((h) => (
                    <div key={h.round_no} className="fm-round-block">
                      <div className="fm-round-head">
                        <span className="rc-status st-done" style={{ cursor: "default" }}>
                          <CheckCircle size={12} /> Round {h.round_no}
                          {h.type ? ` — ${h.type}` : ""}
                        </span>
                        <div className="fm-round-meta">
                          {h.interviewer && (
                            <span className="fm-round-int">
                              {h.interviewer}
                              {h.date ? ` · ${h.date}` : ""}
                            </span>
                          )}
                          {h.rating > 0 && <MiniStars score={h.rating} />}
                        </div>
                      </div>
                      <p className="fm-round-summary">{h.key_insight}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="fb-ai-generated-note">
                AI report generated {new Date(report.generated_at).toLocaleString()}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Approval Summary Modal ─────────────────────────────── */
function ApprovalModal({
  candidate,
  rounds,
  overallRating,
  overallRec,
  onClose,
  onSend,
  sending,
  sent,
}: {
  candidate: Candidate;
  rounds: RoundFeedback[];
  overallRating: number;
  overallRec: Rec;
  onClose: () => void;
  onSend: (managerEmail: string) => void;
  sending: boolean;
  sent: boolean;
}) {
  const [managerEmail, setManagerEmail] = useState("");
  const emailValid = isValidEmail(managerEmail.trim());

  const allSkills: Record<string, number[]> = {};
  rounds
    .filter((r) => r.status === "completed")
    .forEach((r) => {
      r.skills.forEach((sk) => {
        if (!allSkills[sk.skill]) allSkills[sk.skill] = [];
        allSkills[sk.skill].push(sk.score);
      });
    });
  const aggSkills = Object.entries(allSkills)
    .map(([skill, scores]) => ({
      skill,
      avg: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10,
    }))
    .sort((a, b) => b.avg - a.avg);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="fb-modal fb-modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="fb-modal-hd">
          <div className="fb-modal-hd-left">
            <div className="fb-avatar" style={{ background: candidate.color }}>
              {candidate.initials}
            </div>
            <div>
              <div className="fb-modal-title">
                {candidate.name} — Full Interview Summary
              </div>
              <div className="fb-modal-sub">
                {candidate.role} · For Manager Approval
              </div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="fb-modal-body">
          <div className="fm-overview">
            <div className="fm-ov-block">
              <div className="fm-ov-label">Overall Rating</div>
              <div className="fm-ov-big">{overallRating || "—"}</div>
              <MiniStars score={overallRating} size={14} />
            </div>
            <div className="fm-ov-block">
              <div className="fm-ov-label">Recommendation</div>
              <RecBadge rec={overallRec} />
            </div>
          </div>
          {aggSkills.length > 0 && (
            <div className="fm-section">
              <div className="fm-section-title">
                Overall Skill Ratings (avg across all rounds)
              </div>
              <div className="fm-skills">
                {aggSkills.map((sk) => (
                  <div key={sk.skill} className="fm-skill-row">
                    <div className="fm-skill-top">
                      <span className="fm-skill-name">{sk.skill}</span>
                      <span className="fm-skill-score">{sk.avg}/5</span>
                    </div>
                    <SkillBar score={sk.avg} />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="fm-section">
            <div className="fm-section-title">Round-by-Round Summary</div>
            {rounds.map((r, i) => {
              if (r.status === "pending") return null;
              const sm = statusMeta[r.status];
              return (
                <div key={i} className="fm-round-block">
                  <div className="fm-round-head">
                    <span
                      className={`rc-status ${sm.cls}`}
                      style={{ cursor: "default" }}
                    >
                      {sm.icon} Round {i + 1}
                    </span>
                    <div className="fm-round-meta">
                      <span className="fm-round-int">
                        {r.interviewer} · {r.date}
                      </span>
                      {r.status === "completed" && <MiniStars score={r.rating} />}
                      {r.recommendation !== "—" && (
                        <RecBadge rec={r.recommendation} />
                      )}
                    </div>
                  </div>
                  {r.status === "completed" && (
                    <>
                      <p className="fm-round-summary">{r.summary}</p>
                      {r.skills.length > 0 && (
                        <div className="fm-skill-chips">
                          {r.skills.map((sk) => (
                            <span
                              key={sk.skill}
                              className="fm-skill-chip"
                              style={{
                                background:
                                  sk.score >= 4
                                    ? "rgba(122,184,216,0.15)"
                                    : sk.score >= 3
                                    ? "rgba(168,152,216,0.15)"
                                    : "rgba(184,117,160,0.12)",
                                color:
                                  sk.score >= 4
                                    ? "#3A70A0"
                                    : sk.score >= 3
                                    ? "#5A4878"
                                    : "#8A4A78",
                              }}
                            >
                              {sk.skill} <strong>{sk.score}/5</strong>
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {r.status === "scheduled" && (
                    <p className="fm-round-pending">
                      Scheduled for {r.date} — feedback pending.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="fb-modal-ft">
          <div className="fm-manager-email-wrap">
            <label className="fm-manager-email-label">Manager Email</label>
            <input
              className={`fm-manager-email-input ${managerEmail && !emailValid ? "input-error" : ""}`}
              type="email"
              placeholder="manager@company.com"
              value={managerEmail}
              onChange={(e) => setManagerEmail(e.target.value)}
              disabled={sending || sent}
            />
            {managerEmail && !emailValid && (
              <span className="fm-email-error">Enter a valid email (e.g. name@gmail.com or name@company.com)</span>
            )}
          </div>
          <div className="fm-footer-actions">
            <button className="btn-cancel" onClick={onClose}>
              Cancel
            </button>
            <button
              className={`btn-send ${sent ? "sent" : ""}`}
              onClick={() => onSend(managerEmail.trim())}
              disabled={sending || sent || !emailValid}
              title={!emailValid ? "Enter a valid manager email to send" : ""}
            >
              {sent ? (
                <>
                  <CheckCircle size={13} /> Approved &amp; Sent!
                </>
              ) : sending ? (
                <>
                  <span className="spin" /> Sending...
                </>
              ) : (
                <>
                  <MessageSquare size={13} /> Approve &amp; Send Summary
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────── */
export default function FeedbackPage() {
  const { candidates, refreshKey } = useInterviewStore();
  const [approvalFilter, setApprovalFilter] = useState("All");
  const [jobFilter, setJobFilter] = useState("All Roles");
  const [dateFilter, setDateFilter] = useState("Any Date");

  /* modal state: stores candidateId + round label (fetches AI report on open) */
  const [modal, setModal] = useState<{
    candidateId: string;
    candidate: Candidate;
    label: string;
  } | null>(null);

  const [approval, setApproval] = useState<Candidate | null>(null);
  const [approvalState, setApprovalState] = useState<
    Record<number, "pending" | "approved">
  >(() =>
    Object.fromEntries(candidates.map((c) => [c.id, "pending" as const]))
  );
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [sentId,    setSentId]    = useState<number | null>(null);
  const [managerStatus, setManagerStatus] = useState<Record<number, "approved" | "rejected" | "pending" | "new_round">>({});

  const MANAGER_API = process.env.NEXT_PUBLIC_MANAGER_API_BASE_URL || "http://localhost:8001";

  /* ── Poll manager backend for real decision statuses ── */
  async function refreshManagerStatuses() {
    // Collect all backendIds for candidates that HR has already sent for approval
    const ids = candidates
      .map(c => c.backendId)
      .filter(Boolean) as string[];
    if (ids.length === 0) return;

    try {
      const res = await fetch(
        `${MANAGER_API}/manager/candidates-status?ids=${ids.join(",")}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      const statuses: Record<number, "approved" | "rejected" | "pending"> = {};
      const approvedIds = new Set<number>();

      for (const s of data.statuses || []) {
        const candidate = candidates.find(c => c.backendId === s.candidate_id);
        if (!candidate) continue;

        if (s.manager_decision === "approved") {
          statuses[candidate.id] = "approved";
          approvedIds.add(candidate.id);
        } else if (s.manager_decision === "rejected") {
          statuses[candidate.id] = "rejected";
        } else if (s.manager_decision === "new_round") {
          statuses[candidate.id] = "new_round" as any;
        } else {
          statuses[candidate.id] = "pending";
        }
      }

      setManagerStatus(prev => ({ ...prev, ...statuses }));

      // Also mark approvalState as "approved" for any candidate the manager approved
      // so the "Review & Approve" button shows "Summary Sent"
      if (approvedIds.size > 0) {
        setApprovalState(prev => {
          const next = { ...prev };
          approvedIds.forEach(id => { next[id] = "approved"; });
          return next;
        });
      }
    } catch {
      // Manager backend offline — leave status as-is
    }
  }

  /* ── Demo refresh: resets all approval states so HR can re-send ── */
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function handleRefresh() {
  setIsRefreshing(true);
  await refreshManagerStatuses();   // real fetch from MANAGER_API, derives correct state
  setIsRefreshing(false);
}

  /* ── Sync with global refresh from HR Interviews page ── */
  useEffect(() => {
  if (refreshKey === 0) return;   // skip initial mount
  refreshManagerStatuses();       // re-pull real statuses, don't fabricate "pending"
}, [refreshKey]);
  // Poll manager statuses on mount only (not on every candidates change)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    refreshManagerStatuses();
    const interval = setInterval(refreshManagerStatuses, 30_000);
    return () => clearInterval(interval);
  }, []); // empty deps — only on mount

  /* Build derived feedback for all candidates from live store (no static data) */
  const allFeedback = useMemo(
    () => candidates.map((c) => ({ candidate: c, ...buildCandidateFeedback(c) })),
    [candidates]
  );

  const maxRounds = useMemo(
    () => Math.max(...candidates.map((c) => c.rounds.length), 1),
    [candidates]
  );

  const allRoles = [
    "All Roles",
    ...Array.from(new Set(candidates.map((c) => c.role))).sort(),
  ];
  const dateBuckets = ["Any Date", "Last 7 days", "Last 14 days", "Last 30 days"];
  const today = new Date(2026, 5, 9);

  function parseDate(d: string) {
    const months: Record<string, number> = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
    };
    const parts = d.split(" ");
    if (parts.length < 3) return null;
    const m = months[parts[1]];
    if (m === undefined) return null;
    return new Date(parseInt(parts[2]), m, parseInt(parts[0]));
  }

  const filtered = allFeedback.filter(({ candidate, rounds }) => {
    const appr = approvalState[candidate.id] ?? "pending";
    if (approvalFilter === "Pending" && appr !== "pending") return false;
    if (approvalFilter === "Sent" && appr !== "approved") return false;
    if (jobFilter !== "All Roles" && candidate.role !== jobFilter) return false;
    if (dateFilter !== "Any Date") {
      const completedDates = rounds
        .filter((r) => r.status === "completed" && r.date !== "TBD")
        .map((r) => parseDate(r.date))
        .filter(Boolean) as Date[];
      if (!completedDates.length) return false;
      const earliest = new Date(
        Math.min(...completedDates.map((d) => d.getTime()))
      );
      const diff = Math.floor(
        (today.getTime() - earliest.getTime()) / 86400000
      );
      if (dateFilter === "Last 7 days" && diff > 7) return false;
      if (dateFilter === "Last 14 days" && diff > 14) return false;
      if (dateFilter === "Last 30 days" && diff > 30) return false;
    }
    return true;
  });

  const anyFilter =
    approvalFilter !== "All" ||
    jobFilter !== "All Roles" ||
    dateFilter !== "Any Date";

  async function handleSend(candidateId: number, managerEmail: string) {
    setSendingId(candidateId);
    
    const candidate = allFeedback.find(f => f.candidate.id === candidateId)?.candidate;
    if (!candidate) {
      alert("Candidate not found");
      setSendingId(null);
      return;
    }

    const candidateBackendId = candidate.backendId ?? String(candidateId);
    const feedback = allFeedback.find(f => f.candidate.id === candidateId);

    try {
      const response = await fetch(`${MANAGER_API}/manager/hr-approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidate_id:     candidateBackendId,
          manager_email:    managerEmail,
          hr_note:          `Candidate approved by HR for manager review. Manager email: ${managerEmail}`,
          overall_rating:   feedback?.overallRating ?? null,
          recommendation:   feedback?.overallRec ?? "",
          // Fallback fields — used when candidate is not yet in MongoDB
          candidate_name:   candidate.name,
          candidate_email:  candidate.email,
          initials:         candidate.initials,
          color:            candidate.color,
          role:             candidate.role,
          rounds:           candidate.rounds,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: "Failed to send approval" }));
        throw new Error(error.detail || "Failed to send approval to manager");
      }

      // Success - update state
      setApprovalState((p) => ({ ...p, [candidateId]: "approved" }));
      setManagerStatus((p) => ({ ...p, [candidateId]: "pending" }));
      setSendingId(null);
      setSentId(candidateId);
      // Immediately refresh manager statuses so the Status column is current
      refreshManagerStatuses();
      
      setTimeout(() => {
        setSentId(null);
        setApproval(null);
      }, 1800);
    } catch (error) {
      console.error("Failed to send approval:", error);
      alert(error instanceof Error ? error.message : "Failed to send approval to manager. Please try again.");
      setSendingId(null);
    }
  }

  const strongHires = allFeedback.filter(
    ({ overallRec }) => overallRec === "Strong Hire"
  ).length;
  const avgRating = allFeedback.length
    ? (
        allFeedback.reduce((s, { overallRating }) => s + overallRating, 0) /
        allFeedback.length
      ).toFixed(1)
    : "—";

  return (
    <div className="feedback-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Interview Feedback</h1>
          <p className="page-sub">
            {candidates.length} candidates · {strongHires} strong hires · avg{" "}
            {avgRating}/5
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "7px 16px", borderRadius: 9, fontSize: 12, fontWeight: 600,
            background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.22)",
            color: "#4f46e5", cursor: "pointer", fontFamily: "inherit",
            opacity: isRefreshing ? 0.6 : 1,
          }}
        >
          <RefreshCw size={12} style={{ animation: isRefreshing ? "spin 1s linear infinite" : "none" }}/>
          {isRefreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <style>{`@keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }`}</style>

      {/* Filters */}
      <div className="fb-filters">
        <select
          className="fb-select"
          value={jobFilter}
          onChange={(e) => setJobFilter(e.target.value)}
        >
          {allRoles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select
          className="fb-select"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
        >
          {dateBuckets.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          className="fb-select"
          value={approvalFilter}
          onChange={(e) => setApprovalFilter(e.target.value)}
        >
          <option value="All">All Approvals</option>
          <option value="Pending">Pending</option>
          <option value="Sent">Sent</option>
        </select>
        <span className="fb-count">
          {filtered.length} of {allFeedback.length}
        </span>
        {anyFilter && (
          <button
            className="fb-clear"
            onClick={() => {
              setApprovalFilter("All");
              setJobFilter("All Roles");
              setDateFilter("Any Date");
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="fb-table-wrap">
        <div className="fb-scroll">
          {/* Dynamic header */}
          <div
            className="fb-head"
            style={{
              gridTemplateColumns: `180px 150px repeat(${maxRounds}, minmax(140px, 1fr)) 150px 120px`,
            }}
          >
            <div className="fbc fbc-cand">Candidate</div>
            <div className="fbc fbc-int">Primary Interviewer</div>
            {Array.from({ length: maxRounds }, (_, i) => (
              <div key={i} className="fbc fbc-round">
                Round {i + 1}
              </div>
            ))}
            <div className="fbc fbc-appr">Manager Approval</div>
            <div className="fbc fbc-appr">Status</div>
          </div>

          {filtered.length === 0 && (
            <div className="fb-empty">
              No candidates match the selected filters.
            </div>
          )}

          {filtered.map(({ candidate: c, rounds, overallRating, overallRec }) => {
            const appr = approvalState[c.id] ?? "pending";
            return (
              <div
                key={c.id}
                className="fb-row"
                style={{
                  gridTemplateColumns: `180px 150px repeat(${maxRounds}, minmax(140px, 1fr)) 150px 120px`,
                }}
              >
                {/* Candidate */}
                <div className="fbc fbc-cand">
                  <div className="cand-av" style={{ background: c.color }}>
                    {c.initials}
                  </div>
                  <div>
                    <div className="cand-name">{c.name}</div>
                    <div className="cand-role">{c.role}</div>
                  </div>
                </div>

                {/* Primary interviewer (round 1) */}
                <div className="fbc fbc-int">
                  {rounds[0] && (
                    <div className="int-row">
                      <div className="int-av">{rounds[0].interviewerInitials}</div>
                      <div>
                        <div className="int-name">{rounds[0].interviewer}</div>
                        <div className="int-date">{rounds[0].date}</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* One column per round slot up to maxRounds */}
                {Array.from({ length: maxRounds }, (_, i) => {
                  const r = rounds[i];
                  if (!r) {
                    return (
                      <div key={i} className="fbc fbc-round">
                        <div className="rc-na">—</div>
                      </div>
                    );
                  }
                  return (
                    <div key={i} className="fbc fbc-round">
                      <RoundCell
                        round={r}
                        label={`Round ${i + 1} — ${c.rounds[i]?.type ?? ""}`}
                        onView={() =>
                          setModal({
                            // c.backendId = str(cand["_id"]) from normalizeCandidate
                            // This matches candidate_id stored in interview_details
                            candidateId: c.backendId ?? String(c.id),
                            candidate: c,
                            label: `Round ${i + 1} — ${c.rounds[i]?.type ?? ""}`,
                          })
                        }
                      />
                    </div>
                  );
                })}

                {/* Approval */}
                <div className="fbc fbc-appr">
                  {appr === "approved" ? (
                    <div className="appr-sent">
                      <CheckCircle size={14} color="#3A70A0" />
                      <span>Summary Sent</span>
                    </div>
                  ) : (
                    <button
                      className="btn-approve"
                      onClick={() => setApproval(c)}
                    >
                      <MessageSquare size={11} /> Review &amp; Approve
                    </button>
                  )}
                </div>

                {/* Status */}
                <div className="fbc fbc-appr">
                  {(() => {
                    const dec = managerStatus[c.id] ?? "pending";
                    if (dec === "approved") return (
                      <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"4px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:"rgba(16,185,129,0.12)", color:"#065f46" }}>
                        <CheckCircle size={12} /> Approved
                      </span>
                    );
                    if (dec === "rejected") return (
                      <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"4px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:"rgba(220,53,69,0.1)", color:"#b02030" }}>
                        <Circle size={12} /> Rejected
                      </span>
                    );
                    if (dec === "new_round") return (
                      <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"4px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:"rgba(99,102,241,0.1)", color:"#4f46e5" }}>
                        <Clock size={12} /> Manager: New Round Added
                      </span>
                    );
                    return (
                      <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"4px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:"rgba(221,208,232,0.35)", color:"#9090B0" }}>
                        <Clock size={12} /> Pending
                      </span>
                    );
                  })()}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* AI Feedback detail modal — fetches live from backend */}
      {modal && (
        <AIFeedbackModal
          candidateId={modal.candidateId}
          colLabel={modal.label}
          candidate={modal.candidate}
          onClose={() => setModal(null)}
        />
      )}

      {/* Approval summary modal */}
      {approval &&
        (() => {
          const fb = allFeedback.find((f) => f.candidate.id === approval.id);
          if (!fb) return null;
          return (
            <ApprovalModal
              candidate={approval}
              rounds={fb.rounds}
              overallRating={fb.overallRating}
              overallRec={fb.overallRec}
              onClose={() => setApproval(null)}
              onSend={(managerEmail) => handleSend(approval.id, managerEmail)}
              sending={sendingId === approval.id}
              sent={sentId === approval.id}
            />
          );
        })()}
    </div>
  );
}