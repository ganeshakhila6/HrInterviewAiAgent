"use client";
import "./InterviewsPage.css";
import React, { useState, useMemo } from "react";
import {
  Calendar, Video, Monitor, Plus, Bell, Send,
  X, ChevronRight, ChevronLeft, CheckCircle, Mail, Lock,
  Search, User, Pencil, Trash2, Clock, Briefcase, RefreshCw,
} from "lucide-react";
import {
  useInterviewStore,
  type Candidate,
  type Round,
  type RoundStatus,
  API_BASE_URL,
  apiHeaders,
} from "@/lib/interviewStore";

import { isValidEmail } from "@/lib/emailValidation";

/* ── Status config ──────────────────────────────────────── */
const SC: Record<RoundStatus, { bg: string; color: string; label: string }> = {
  active:    { bg: "rgba(253,200,56,0.2)",  color: "#7A5A00", label: "Ongoing"     },
  passed:    { bg: "rgba(52,199,89,0.15)",  color: "#1a7a3a", label: "Completed"   },
  failed:    { bg: "rgba(220,53,69,0.13)",  color: "#b02030", label: "Didn't Pass" },
  "on-hold": { bg: "rgba(238,208,90,0.22)", color: "#7A5A10", label: "On Hold"     },
  pending:   { bg: "rgba(221,208,232,0.3)", color: "#9090B0", label: "Locked"      },
};

/* ── Email templates ────────────────────────────────────── */
function makeCandidateEmail(c: Candidate, r: Round) {
  return {
    subject: `Round ${r.roundNo} Interview — ${c.role} | ${r.date} at ${r.time}`,
    body: `Hi ${c.name.split(" ")[0]},\n\nYou are scheduled for Round ${r.roundNo} (${r.type}) interview.\n\nDetails:\n- Role        : ${c.role}\n- Round       : ${r.roundNo} — ${r.type}\n- Date        : ${r.date}\n- Time        : ${r.time}\n- Interviewer : ${r.interviewer}\n- Mode        : ${r.mode}\n- Duration    : ${r.duration}\n\n${r.mode === "Video Call" ? "A Google Meet link will be shared 15 minutes before." : "Please arrive 10 minutes early at our office."}\n\nBest regards,\nPriya R. | RecruitAI`,
  };
}

// CHANGE 1 — Dynamic feedback form base URL (replaces hardcoded FEEDBACK_FORM_URL)
const FEEDBACK_FORM_PATH = "/public-feedback";

function getFeedbackFormBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL) {
    return process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL;
  }

  if (typeof window !== "undefined") {
    return `${window.location.origin}${FEEDBACK_FORM_PATH}`;
  }

  return FEEDBACK_FORM_PATH;
}

/**
 * Builds the full feedback form link for a specific candidate + round.
 * Mirrors what the backend's build_feedback_form_link() does so the preview
 * in the email modal is consistent with what gets sent.
 */
function buildFeedbackFormLink(candidateId: string, roundNo: number): string {
  const params = new URLSearchParams({
    candidate_id: candidateId,
    round_no: String(roundNo),
  });
  return `${getFeedbackFormBaseUrl()}?${params.toString()}`;
}

// CHANGE 2 — makeInterviewerEmail accepts optional backendId for dynamic feedback link
function makeInterviewerEmail(c: Candidate, r: Round, backendId?: string) {
  const feedbackLink = backendId
    ? buildFeedbackFormLink(backendId, r.roundNo)
    : getFeedbackFormBaseUrl();

  return {
    subject: `Round ${r.roundNo} Interview — ${c.name} | ${r.date}`,
    body: `Hi ${r.interviewer.split(" ")[0]},\n\nYou are conducting Round ${r.roundNo} (${r.type}) for ${c.name}.\n\nDetails:\n- Candidate   : ${c.name}\n- Role        : ${c.role}\n- Date        : ${r.date}\n- Time        : ${r.time}\n- Mode        : ${r.mode}\n- Duration    : ${r.duration}\n\n${r.mode === "Video Call" ? "Please share the Teams meeting link 15 min before." : "Please be present 5 min early."}\n\n📝 After the interview, please submit your feedback using the link below:\n${feedbackLink}\n\nBest regards,\nPriya R. | RecruitAI`,
  };
}

/* ── Types ──────────────────────────────────────────────── */
type WizardState = {
  candidate: Candidate;
  round:     Round;
  step:      1 | 2;
  cTo:       string;
  cSub:      string;
  cBody:     string;
  iTo:       string;
  iSub:      string;
  iBody:     string;
};

type ResultTarget = { candidateId: number; roundNo: number } | null;

// All fields editable inline on a round card
type RoundTextField =
  | "type"
  | "date"
  | "time"
  | "interviewer"
  | "interviewerEmail"
  | "duration";

type EditTarget =
  | { kind: "round-text"; candidateId: number; roundNo: number; field: RoundTextField }
  | { kind: "candidate-role"; candidateId: number };

/* ── Lifted out of InterviewsPage to avoid remount-on-every-render bug ─────── */
function EditText({
  candidateId, roundNo, field, value, placeholder, wide = false,
  editTarget, editValue, setEditValue,
  onCommit, onKeyDown, onStart,
}: {
  candidateId: number; roundNo: number; field: RoundTextField;
  value: string; placeholder?: string; wide?: boolean;
  editTarget: EditTarget | null;
  editValue: string;
  setEditValue: (v: string) => void;
  onCommit: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onStart: (candidateId: number, roundNo: number, field: RoundTextField, current: string, e: React.MouseEvent) => void;
}) {
  const active =
    editTarget?.kind === "round-text" &&
    editTarget.candidateId === candidateId &&
    editTarget.roundNo     === roundNo &&
    editTarget.field       === field;

  if (active) {
    if (field === "date") {
      const toISO = (v: string) => {
        try { const d = new Date(v); return isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0]; }
        catch { return ""; }
      };
      const fromISO = (v: string) => {
        if (!v) return "";
        const d = new Date(v);
        return isNaN(d.getTime()) ? v : d.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
      };
      return (
        <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
          <input type="date" className="exp-field-input" value={toISO(editValue)} autoFocus
            onChange={e => setEditValue(fromISO(e.target.value))}
            onBlur={onCommit} onKeyDown={onKeyDown} onClick={e => e.stopPropagation()} />
          {editValue && <span style={{ fontSize:10, color:"#6366f1" }}>{editValue}</span>}
        </div>
      );
    }
    if (field === "time") {
      const toHHMM = (v: string) => {
        try { const clean = (v||"").replace(/\s?(AM|PM)/i,"").trim(); const [h,m]=clean.split(":"); return `${h.padStart(2,"0")}:${(m||"00").padStart(2,"0")}`; }
        catch { return ""; }
      };
      const from24 = (v: string) => {
        if (!v) return "";
        const [h,m] = v.split(":"); const hour = parseInt(h);
        return `${hour%12||12}:${m} ${hour>=12?"PM":"AM"}`;
      };
      return (
        <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
          <input type="time" className="exp-field-input" value={toHHMM(editValue)} autoFocus
            onChange={e => setEditValue(from24(e.target.value))}
            onBlur={onCommit} onKeyDown={onKeyDown} onClick={e => e.stopPropagation()} />
          {editValue && <span style={{ fontSize:10, color:"#6366f1" }}>{editValue}</span>}
        </div>
      );
    }
    return (
      <input
        className={`exp-field-input ${wide ? "exp-field-input-wide" : ""}`}
        value={editValue} placeholder={placeholder} autoFocus
        onChange={e => setEditValue(e.target.value)}
        onBlur={onCommit} onKeyDown={onKeyDown} onClick={e => e.stopPropagation()}
      />
    );
  }

  return (
    <button className="exp-field-btn"
      onClick={e => onStart(candidateId, roundNo, field, value, e)}
      title={`Edit ${field}`}>
      <span>{value || <span className="placeholder-text">{placeholder}</span>}</span>
      <Pencil size={9} className="edit-pencil" />
    </button>
  );
}

function EditRole({
  candidateId, value,
  editTarget, editValue, setEditValue, onCommit, onKeyDown, onStart,
}: {
  candidateId: number; value: string;
  editTarget: EditTarget | null;
  editValue: string;
  setEditValue: (v: string) => void;
  onCommit: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onStart: (candidateId: number, current: string, e: React.MouseEvent) => void;
}) {
  const active = editTarget?.kind === "candidate-role" && editTarget.candidateId === candidateId;
  if (active) {
    return (
      <input className="exp-field-input exp-field-input-wide" value={editValue} autoFocus
        onChange={e => setEditValue(e.target.value)}
        onBlur={onCommit} onKeyDown={onKeyDown} onClick={e => e.stopPropagation()} />
    );
  }
  return (
    <button className="exp-field-btn exp-field-btn-wide"
      onClick={e => onStart(candidateId, value, e)} title="Edit role">
      <span>{value || <span className="placeholder-text">Role</span>}</span>
      <Pencil size={9} className="edit-pencil" />
    </button>
  );
}

/* ════════════════════════════════════════════════════════ */
export default function InterviewsPage() {
  const { candidates, setCandidates, addRound, removeRound, refreshAll, refreshKey } = useInterviewStore();

  const [search,       setSearch]       = useState("");
  const [roleFilter,   setRoleFilter]   = useState("All");
  const [stageFilter,  setStageFilter]  = useState("All");
  const [expandedId,   setExpandedId]   = useState<number | null>(null);
  const [selectedCand, setSelectedCand] = useState<Candidate | null>(null);
  const [wizard,       setWizard]       = useState<WizardState | null>(null);
  const [wizLoading,   setWizLoading]   = useState(false);
  const [resultTarget, setResultTarget] = useState<ResultTarget>(null);
  const [cToTouched,   setCToTouched]   = useState(false);
  const [iToTouched,   setIToTouched]   = useState(false);
  const [editTarget,   setEditTarget]   = useState<EditTarget | null>(null);
  const [editValue,    setEditValue]    = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  /* Reset all local state when global refresh fires */
  React.useEffect(() => {
    setSearch(""); setRoleFilter("All"); setStageFilter("All");
    setExpandedId(null); setSelectedCand(null); setWizard(null);
    setResultTarget(null); setEditTarget(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  async function handleRefresh() {
    setIsRefreshing(true);
    refreshAll();   /* resets candidates + signals all dependent pages */
    await new Promise(r => setTimeout(r, 600));
    setIsRefreshing(false);
  }

  /* ── Edit helpers ─────────────────────────────────────── */
  function startRoundEdit(
    candidateId: number, roundNo: number,
    field: RoundTextField, current: string,
    e: React.MouseEvent,
  ) {
    e.stopPropagation();
    setEditTarget({ kind: "round-text", candidateId, roundNo, field });
    setEditValue(current);
  }

  function startRoleEdit(candidateId: number, current: string, e: React.MouseEvent) {
    e.stopPropagation();
    setEditTarget({ kind: "candidate-role", candidateId });
    setEditValue(current);
  }

  function commitEdit() {
    if (!editTarget) return;
    const v = editValue.trim();
    if (!v) { setEditTarget(null); return; }

    if (editTarget.kind === "candidate-role") {
      setCandidates(prev =>
        prev.map(c => c.id === editTarget.candidateId ? { ...c, role: v } : c)
      );
    } else {
      const { candidateId, roundNo, field } = editTarget;
      setCandidates(prev =>
        prev.map(c => c.id !== candidateId ? c : {
          ...c,
          rounds: c.rounds.map(r => r.roundNo === roundNo ? { ...r, [field]: v } : r),
        })
      );

      // Auto-save interviewer name to backend so it persists across page refreshes
      if (field === "interviewer") {
        const candidate = candidates.find(c => c.id === candidateId);
        if (candidate?.backendId) {
          fetch(`${API_BASE_URL}/interviews/${candidate.backendId}/round/${roundNo}`, {
            method:  "PATCH",
            headers: apiHeaders(),
            body:    JSON.stringify({ interviewer: v }),
          }).catch(err => console.warn("Failed to save interviewer name:", err));
        }
      }
    }
    setEditTarget(null);
  }

  function toggleMode(candidateId: number, roundNo: number, e: React.MouseEvent) {
    e.stopPropagation();
    setCandidates(prev =>
      prev.map(c => c.id !== candidateId ? c : {
        ...c,
        rounds: c.rounds.map(r =>
          r.roundNo === roundNo
            ? { ...r, mode: r.mode === "Video Call" ? "In-person" : "Video Call" }
            : r
        ),
      })
    );
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter")  commitEdit();
    if (e.key === "Escape") setEditTarget(null);
  }

  /* ── Props bundle passed to lifted EditText / EditRole ── */
  const editProps = {
    editTarget, editValue, setEditValue,
    onCommit:  commitEdit,
    onKeyDown: handleKeyDown,
    onStart:   startRoundEdit,
  };
  const editRoleProps = {
    editTarget, editValue, setEditValue,
    onCommit:  commitEdit,
    onKeyDown: handleKeyDown,
    onStart:   startRoleEdit,
  };
  /* ── Filters ──────────────────────────────────────────── */
  const roles = useMemo(
    () => ["All", ...Array.from(new Set(candidates.map(c => c.role))).sort()],
    [candidates],
  );

  const filtered = useMemo(() => candidates.filter(c => {
    const q = search.toLowerCase();
    if (q && !c.name.toLowerCase().includes(q) && !c.role.toLowerCase().includes(q)) return false;
    if (roleFilter !== "All" && c.role !== roleFilter) return false;
    if (stageFilter === "Active")       return c.rounds.some(r => r.status === "active");
    if (stageFilter === "Pending Mail") return c.rounds.some(r => r.status === "active" && !r.mailSent);
    if (stageFilter === "Completed")    return c.rounds.some(r => r.status === "passed");
    return true;
  }), [candidates, search, roleFilter, stageFilter]);

  /* ── Wizard helpers ───────────────────────────────────── */
  // CHANGE 3 — Pass backendId into makeInterviewerEmail for dynamic feedback link
  function openWizard(c: Candidate, r: Round) {
    const ce = makeCandidateEmail(c, r);
    const ie = makeInterviewerEmail(c, r, c.backendId);  // ← pass backendId here
    setWizard({
      candidate: c, round: r, step: 1,
      cTo:  c.email,
      cSub: ce.subject, cBody: ce.body,
      iTo:  r.interviewerEmail,
      iSub: ie.subject, iBody: ie.body,
    });
    setWizLoading(false);
    setCToTouched(false);
    setIToTouched(false);
  }

  function handleNext() {
    if (!wizard) return;
    setCToTouched(true);
    if (!isValidEmail(wizard.cTo)) return;
    setWizard({ ...wizard, step: 2 });
  }

  /* ── Send emails — real API call ──────────────────────── */
  function sendBoth() {
    if (!wizard) return;

    // Validate interviewer email before proceeding
    setIToTouched(true);
    if (!isValidEmail(wizard.iTo)) return;

    // Validate candidate email too (in case user went back and changed it)
    setCToTouched(true);
    if (!isValidEmail(wizard.cTo)) {
      setWizard({ ...wizard, step: 1 });
      return;
    }

    const backendId = wizard.candidate.backendId;
    if (!backendId) {
      alert(
        "This candidate is not linked to the backend yet.\n" +
        "Please refresh the page to load data from the API."
      );
      return;
    }

    setWizLoading(true);

    // ── Step 1: PATCH round to save interviewerEmail + details ──
    fetch(
      `${API_BASE_URL}/interviews/${backendId}/round/${wizard.round.roundNo}`,
      {
        method:  "PATCH",
        headers: apiHeaders(),
        body: JSON.stringify({
          type:             wizard.round.type,
          date:             wizard.round.date,
          time:             wizard.round.time,
          interviewer:      wizard.round.interviewer,
          interviewerEmail: wizard.iTo,          // ← always use the editable value
          duration:         wizard.round.duration,
          mode:             wizard.round.mode,
        }),
      }
    )
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.detail || "Failed to save round details.");
        return data;
      })

      // ── Step 2: POST send-mail ──
      .then(() =>
        fetch(
          `${API_BASE_URL}/interviews/${backendId}/round/${wizard.round.roundNo}/send-mail`,
          {
            method:  "POST",
            headers: apiHeaders(),
            body: JSON.stringify({
              candidateEmail:     wizard.cTo,
              candidateSubject:   wizard.cSub,
              candidateBody:      wizard.cBody,
              interviewerEmail:   wizard.iTo,
              interviewerSubject: wizard.iSub,
              interviewerBody:    wizard.iBody,
            }),
          }
        )
      )
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.detail || data?.error || "Mail sending failed.");
        return data;
      })

      // ── Step 3: Update local store ──
      .then(() => {
        setCandidates(prev =>
          prev.map(c =>
            c.id !== wizard.candidate.id ? c : {
              ...c,
              rounds: c.rounds.map(r =>
                r.roundNo === wizard.round.roundNo
                  ? { ...r, mailSent: true, interviewerEmail: wizard.iTo }
                  : r
              ),
            }
          )
        );
        setWizard(null);
      })

      .catch(err => {
        console.error("Send mail error:", err);
        alert(
          err instanceof Error
            ? err.message
            : "Failed to send emails. Check the browser console for details."
        );
      })

      .finally(() => {
        setWizLoading(false);
      });
  }

  /* ── Mark result — persists to backend AND updates local store ── */
  function markResult(
    candidateId: number,
    roundNo: number,
    result: "passed" | "failed" | "on-hold",
  ) {
    /* Optimistic local update */
    setCandidates(prev =>
      prev.map(c => c.id !== candidateId ? c : {
        ...c,
        rounds: c.rounds.map(r => {
          if (r.roundNo === roundNo)                       return { ...r, status: result };
          if (r.roundNo === roundNo + 1 && result === "passed")
            return { ...r, status: "active" as RoundStatus };
          return r;
        }),
      })
    );
    setResultTarget(null);

    /* Persist to backend so Manager Candidates page reflects live status */
    const candidate = candidates.find(c => c.id === candidateId);
    const backendId = candidate?.backendId;
    if (!backendId) return; /* seed data only — skip */

    fetch(`${API_BASE_URL}/interviews/${backendId}/round/${roundNo}`, {
      method: "PATCH",
      headers: apiHeaders(),
      body: JSON.stringify({ status: result }),
    }).catch(err => console.warn("markResult persist failed:", err));

    /* If passed, unlock the next round in the backend too */
    if (result === "passed") {
      fetch(`${API_BASE_URL}/interviews/${backendId}/round/${roundNo + 1}`, {
        method: "PATCH",
        headers: apiHeaders(),
        body: JSON.stringify({ status: "active" }),
      }).catch(() => { /* next round may not exist — ok */ });
    }
  }

  const activeCount = candidates.flatMap(c => c.rounds).filter(r => r.status === "active").length;

  /* ════════════════════════════════════════════════════════ */
  return (
    <div className="interviews">

      {/* ── Page header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Interviews</h1>
          <p className="page-sub">
            {candidates.length} candidates · {activeCount} active rounds today
          </p>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"7px 14px", background:"rgba(99,102,241,0.08)", border:"1px solid rgba(99,102,241,0.22)", borderRadius:9, fontSize:12, fontWeight:600, color:"#4f46e5", cursor:"pointer", fontFamily:"inherit", opacity: isRefreshing ? 0.6 : 1 }}
          >
            <RefreshCw size={12} style={{ animation: isRefreshing ? "spin 1s linear infinite" : "none" }}/>
            {isRefreshing ? "Resetting…" : "Refresh"}
          </button>
        </div>
        <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      </div>

      {/* ── Filter bar ── */}
      <div className="int-filterbar">
        <div className="int-search">
          <Search size={14} color="#9090B0" />
          <input
            placeholder="Search candidate or role…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="int-select"
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
        >
          {roles.map(r => <option key={r}>{r}</option>)}
        </select>
        <div className="int-stage-tabs">
          {[
            { key: "All",          label: "All",          count: candidates.length },
            { key: "Active",       label: "Active",       count: candidates.filter(c => c.rounds.some(r => r.status === "active")).length },
            { key: "Pending Mail", label: "Pending Mail", count: candidates.filter(c => c.rounds.some(r => r.status === "active" && !r.mailSent)).length },
            { key: "Completed",    label: "Completed",    count: candidates.filter(c => c.rounds.some(r => r.status === "passed")).length },
          ].map(s => (
            <button
              key={s.key}
              className={`stage-tab ${stageFilter === s.key ? "active" : ""}`}
              onClick={() => setStageFilter(s.key)}
            >
              {s.label} <span className="stage-count">{s.count}</span>
            </button>
          ))}
        </div>
        <span className="int-count">{filtered.length} candidates</span>
      </div>

      {/* ── Legend ── */}
      <div className="status-legend">
        <span className="legend-title">Round Status:</span>
        <span className="legend-item"><span className="legend-dot dot-ongoing"   />Ongoing</span>
        <span className="legend-item"><span className="legend-dot dot-completed" />Completed</span>
        <span className="legend-item"><span className="legend-dot dot-didntpass" />Didn&apos;t Pass</span>
        <span className="legend-item"><span className="legend-dot dot-onhold"    />On Hold</span>
        <span className="legend-item"><span className="legend-dot dot-locked"    />Locked</span>
      </div>

      {/* ── Table ── */}
      <div className="int-table-wrap">
        <div className="int-table-scroll">
          <div className="int-thead">
            <div className="th th-cand">Candidate</div>
            <div className="th th-role">Role</div>
            <div className="th th-rounds">Round Progress</div>
            <div className="th th-interviewer">Interviewer</div>
            <div className="th th-current">Current Round</div>
            <div className="th th-action">Action</div>
          </div>

          {filtered.length === 0 && (
            <div className="int-empty">No candidates match your filters.</div>
          )}

          {filtered.map(c => {
            const activeRound = c.rounds.find(r => r.status === "active");
            const passedCount = c.rounds.filter(r => r.status === "passed").length;
            const isExpanded  = expandedId === c.id;

            return (
              <div key={c.id} className="int-row-wrap">

                {/* ── Main row ── */}
                <div
                  className={`int-row ${isExpanded ? "row-open" : ""}`}
                  onClick={() => setExpandedId(isExpanded ? null : c.id)}
                >
                  {/* Candidate */}
                  <div className="td td-cand">
                    <div className="cand-av" style={{ background: c.color }}>{c.initials}</div>
                    <div>
                      <span className="cand-name">{c.name}</span>
                      <div className="cand-email">{c.email}</div>
                    </div>
                  </div>

                  {/* Role */}
                  <div className="td td-role">{c.role}</div>

                  {/* Round progress pills */}
                  <div className="td td-rounds">
                    <div className="round-dots">
                      {c.rounds.map(r => (
                        <span
                          key={r.roundNo}
                          className={`rdot rdot-${r.status}`}
                          title={`R${r.roundNo} ${r.type}: ${SC[r.status].label}`}
                        >
                          R{r.roundNo}
                        </span>
                      ))}
                    </div>
                    <span className="progress-text">{passedCount}/{c.rounds.length} passed</span>
                  </div>

                  {/* Interviewer (active round) */}
                  <div className="td td-interviewer" onClick={e => e.stopPropagation()}>
                    {activeRound ? (
                      <EditText
                        candidateId={c.id} roundNo={activeRound.roundNo}
                        field="interviewer" value={activeRound.interviewer}
                        placeholder="Add interviewer"
                        {...editProps}
                      />
                    ) : (
                      <span className="no-active">—</span>
                    )}
                  </div>

                  {/* Current round */}
                  <div className="td td-current">
                    {activeRound ? (
                      <div className="curr-round">
                        <span className="curr-badge">R{activeRound.roundNo} — {activeRound.type}</span>
                        <span className="curr-meta"><Calendar size={10} /> {activeRound.date}</span>
                      </div>
                    ) : (
                      <span className="no-active">
                        {c.rounds.every(r => r.status === "passed") ? "✓ All rounds passed" :
                         c.rounds.some(r  => r.status === "failed")  ? "Did not pass"        : "—"}
                      </span>
                    )}
                  </div>

                  {/* Action */}
                  <div className="td td-action" onClick={e => e.stopPropagation()}>
                    {activeRound && (
                      activeRound.mailSent ? (
                        <div className="action-stack">
                          <span className="mail-sent-tag"><CheckCircle size={12} /> Mail Sent</span>
                          <button
                            className="btn-mark"
                            onClick={() => setResultTarget({ candidateId: c.id, roundNo: activeRound.roundNo })}
                          >
                            Mark Result
                          </button>
                        </div>
                      ) : (
                        <button className="btn-send-mail" onClick={() => openWizard(c, activeRound)}>
                          <Bell size={12} /> Send Mail
                        </button>
                      )
                    )}
                  </div>
                </div>

                {/* ── Expanded round detail ── */}
                {isExpanded && (
                  <div className="int-expanded">
                    <div className="expanded-rounds">
                      {c.rounds.map(r => {
                        const sm        = SC[r.status];
                        const canDelete = (r.status === "pending" || r.status === "active") && c.rounds.length > 1;
                        return (
                          <div
                            key={r.roundNo}
                            className={`exp-round exp-${r.status}`}
                            onClick={e => e.stopPropagation()}
                          >
                            {/* Round header */}
                            <div className="exp-round-head">
                              <span className="exp-round-num">R{r.roundNo}</span>
                              <span className="exp-round-type">
                                <EditText
                                  candidateId={c.id} roundNo={r.roundNo}
                                  field="type" value={r.type} placeholder="Round type"
                                  {...editProps}
                                />
                              </span>
                              <span
                                className="exp-status"
                                style={{ background: sm.bg, color: sm.color }}
                              >
                                {sm.label}
                              </span>
                              {canDelete && (
                                <button
                                  className="btn-delete-round"
                                  title="Remove round"
                                  onClick={e => { e.stopPropagation(); removeRound(c.id, r.roundNo); }}
                                >
                                  <Trash2 size={11} />
                                </button>
                              )}
                            </div>

                            {/* Editable fields grid */}
                            <div className="exp-fields-grid">

                              {/* Role */}
                              <div className="exp-field-row">
                                <span className="exp-field-label"><Briefcase size={10} /> Role</span>
                                {r.status === "passed" || r.status === "failed" ? (
                                  <span className="exp-field-locked">{c.role}</span>
                                ) : (
                                  <EditRole candidateId={c.id} value={c.role} {...editRoleProps} />
                                )}
                              </div>

                              {/* Date */}
                              <div className="exp-field-row">
                                <span className="exp-field-label"><Calendar size={10} /> Date</span>
                                {r.status === "passed" || r.status === "failed" ? (
                                  <span className="exp-field-locked">{r.date}</span>
                                ) : (
                                  <EditText
                                    candidateId={c.id} roundNo={r.roundNo}
                                    field="date" value={r.date} placeholder="e.g. 10 Jun 2026"
                                    {...editProps}
                                  />
                                )}
                              </div>

                              {/* Time */}
                              <div className="exp-field-row">
                                <span className="exp-field-label"><Clock size={10} /> Time</span>
                                {r.status === "passed" || r.status === "failed" ? (
                                  <span className="exp-field-locked">{r.time}</span>
                                ) : (
                                  <EditText
                                    candidateId={c.id} roundNo={r.roundNo}
                                    field="time" value={r.time} placeholder="e.g. 10:00 AM"
                                    {...editProps}
                                  />
                                )}
                              </div>

                              {/* Interviewer name */}
                              <div className="exp-field-row">
                                <span className="exp-field-label"><User size={10} /> Interviewer</span>
                                {r.status === "passed" || r.status === "failed" ? (
                                  <span className="exp-field-locked">{r.interviewer}</span>
                                ) : (
                                  <EditText
                                    candidateId={c.id} roundNo={r.roundNo}
                                    field="interviewer" value={r.interviewer} placeholder="Full name"
                                    {...editProps}
                                  />
                                )}
                              </div>

                              {/* Interviewer email */}
                              <div className="exp-field-row">
                                <span className="exp-field-label"><Mail size={10} /> Int. Email</span>
                                {r.status === "passed" || r.status === "failed" ? (
                                  <span className="exp-field-locked">{r.interviewerEmail || "—"}</span>
                                ) : (
                                  <EditText
                                    candidateId={c.id} roundNo={r.roundNo}
                                    field="interviewerEmail"
                                    value={r.interviewerEmail}
                                    placeholder="interviewer@company.com"
                                    wide={true}
                                    {...editProps}
                                  />
                                )}
                              </div>

                              {/* Mode toggle */}
                              <div className="exp-field-row">
                                <span className="exp-field-label">
                                  {r.mode === "Video Call" ? <Video size={10} /> : <Monitor size={10} />} Mode
                                </span>
                                {r.status === "passed" || r.status === "failed" ? (
                                  <span className="exp-field-locked">
                                    {r.mode === "Video Call" ? <Video size={10}/> : <Monitor size={10}/>} {r.mode}
                                  </span>
                                ) : (
                                  <button
                                    className={`exp-mode-toggle ${r.mode === "Video Call" ? "mode-video" : "mode-person"}`}
                                    onClick={e => toggleMode(c.id, r.roundNo, e)}
                                    title="Click to toggle mode"
                                  >
                                    {r.mode === "Video Call" ? <Video size={10} /> : <Monitor size={10} />}
                                    {r.mode}
                                    <Pencil size={9} className="edit-pencil" />
                                  </button>
                                )}
                              </div>

                              {/* Duration */}
                              <div className="exp-field-row">
                                <span className="exp-field-label"><Clock size={10} /> Duration</span>
                                {r.status === "passed" || r.status === "failed" ? (
                                  <span className="exp-field-locked">{r.duration}</span>
                                ) : (
                                  <EditText
                                    candidateId={c.id} roundNo={r.roundNo}
                                    field="duration" value={r.duration} placeholder="e.g. 60 min"
                                    {...editProps}
                                  />
                                )}
                              </div>

                            </div>{/* end exp-fields-grid */}

                            {/* Actions */}
                            {r.status === "active" && (
                              <div className="exp-actions">
                                {r.mailSent ? (
                                  <>
                                    <span className="mail-sent-tag">
                                      <CheckCircle size={12} /> Mail Sent
                                    </span>
                                    <button
                                      className="btn-mark"
                                      onClick={() => setResultTarget({ candidateId: c.id, roundNo: r.roundNo })}
                                    >
                                      Mark Result
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    className="btn-send-mail"
                                    onClick={() => openWizard(c, r)}
                                  >
                                    <Bell size={12} /> Send Mail
                                  </button>
                                )}
                              </div>
                            )}

                            {/* CHANGE 4 — Feedback preview block */}
                            {r.feedback && (
                              <div className="exp-feedback-preview">
                                <div className="feedback-preview-head">
                                  <span>📋 Feedback submitted</span>
                                  <span className="feedback-rating">
                                    {"★".repeat(r.feedback.rating || 0)}{"☆".repeat(5 - (r.feedback.rating || 0))}
                                    {" "}{r.feedback.rating}/5
                                  </span>
                                </div>
                                <div className="feedback-preview-meta">
                                  <span>By: {r.feedback.interviewer_name || r.feedback.interviewer_email || "—"}</span>
                                  <span>{r.feedback.submitted_at ? new Date(r.feedback.submitted_at).toLocaleDateString() : ""}</span>
                                </div>
                                {r.feedback.summary && (
                                  <p className="feedback-preview-summary">{r.feedback.summary}</p>
                                )}
                                <div className="feedback-preview-scores">
                                  {r.feedback.communication && <span>💬 Communication: {r.feedback.communication}</span>}
                                  {r.feedback.cultural_fit  && <span>🤝 Culture Fit: {r.feedback.cultural_fit}</span>}
                                  {r.feedback.adaptability  && <span>🔄 Adaptability: {r.feedback.adaptability}</span>}
                                </div>
                              </div>
                            )}

                            {r.status === "pending" && (
                              <div className="exp-locked">
                                <Lock size={11} /> Awaiting previous round
                              </div>
                            )}

                          </div>
                        );
                      })}

                      {/* Add Round card */}
                      <button
                        className="exp-add-round"
                        onClick={e => { e.stopPropagation(); addRound(c.id); }}
                      >
                        <Plus size={14} />
                        <span>Add Round</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>{/* end int-table-scroll */}
      </div>{/* end int-table-wrap */}

      {/* ════════════════════════════════════════════════════ */}
      {/* ── Email Wizard Modal ── */}
      {/* ════════════════════════════════════════════════════ */}
      {wizard && (
        <div className="modal-overlay" onClick={() => { if (!wizLoading) setWizard(null); }}>
          <div className="reminder-modal" onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="reminder-header">
              <div className="reminder-title">
                <Mail size={16} color="#B875A0" />
                <span>Round {wizard.round.roundNo} — {wizard.round.type} · {wizard.candidate.name}</span>
              </div>
              <button
                className="close-btn"
                onClick={() => { if (!wizLoading) setWizard(null); }}
                disabled={wizLoading}
              >
                <X size={18} />
              </button>
            </div>

            {/* Step indicator */}
            <div className="step-bar">
              <div className={`step-item ${wizard.step === 1 ? "step-active" : "step-done"}`}>
                <div className="step-circle">
                  {wizard.step > 1 ? <CheckCircle size={14} /> : "1"}
                </div>
                <div>
                  <div className="step-label">Candidate</div>
                  <div className="step-sub">{wizard.cTo || wizard.candidate.email || "—"}</div>
                </div>
              </div>
              <div className="step-line" />
              <div className={`step-item ${wizard.step === 2 ? "step-active" : "step-idle"}`}>
                <div className="step-circle">2</div>
                <div>
                  <div className="step-label">Interviewer</div>
                  <div className="step-sub">{wizard.iTo || "—"}</div>
                </div>
              </div>
            </div>

            {/* ── Step 1: Candidate email ── */}
            {wizard.step === 1 && (
              <div className="reminder-body">
                <div className="email-recipient-banner candidate-banner">
                  <div className="erb-left">
                    <div className="erb-avatar" style={{ background: wizard.candidate.color }}>
                      {wizard.candidate.initials}
                    </div>
                    <div>
                      <div className="erb-name">{wizard.candidate.name}</div>
                      <div className="erb-email">{wizard.candidate.email}</div>
                    </div>
                  </div>
                  <span className="erb-tag">Candidate</span>
                </div>

                <div className="email-form-group">
                  <label className="reminder-section-label">To</label>
                  <input
                    className={`email-input ${cToTouched && !isValidEmail(wizard.cTo) ? "input-error" : ""}`}
                    value={wizard.cTo}
                    placeholder="candidate@gmail.com"
                    onChange={e => { setWizard({ ...wizard, cTo: e.target.value }); setCToTouched(true); }}
                    onBlur={() => setCToTouched(true)}
                  />
                  {cToTouched && !isValidEmail(wizard.cTo) && (
                    <span className="email-error-msg">Enter a valid email (e.g. name@gmail.com)</span>
                  )}
                </div>

                <div className="email-form-group">
                  <label className="reminder-section-label">Subject</label>
                  <input
                    className="email-input"
                    value={wizard.cSub}
                    onChange={e => setWizard({ ...wizard, cSub: e.target.value })}
                  />
                </div>

                <div className="email-form-group">
                  <label className="reminder-section-label">Message</label>
                  <textarea
                    className="email-textarea"
                    rows={10}
                    value={wizard.cBody}
                    onChange={e => setWizard({ ...wizard, cBody: e.target.value })}
                  />
                </div>
              </div>
            )}

            {/* ── Step 2: Interviewer email ── */}
            {wizard.step === 2 && (
              <div className="reminder-body">
                <div className="email-recipient-banner interviewer-banner">
                  <div className="erb-left">
                    <div className="erb-avatar erb-avatar-int">
                      {wizard.round.interviewer.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="erb-name">{wizard.round.interviewer}</div>
                      <div className="erb-email">{wizard.iTo || "No email set"}</div>
                    </div>
                  </div>
                  <span className="erb-tag erb-tag-int">Interviewer</span>
                </div>

                <div className="email-form-group">
                  <label className="reminder-section-label">To</label>
                  <input
                    className={`email-input ${iToTouched && !isValidEmail(wizard.iTo) ? "input-error" : ""}`}
                    value={wizard.iTo}
                    placeholder="interviewer@company.com"
                    onChange={e => { setWizard({ ...wizard, iTo: e.target.value }); setIToTouched(true); }}
                    onBlur={() => setIToTouched(true)}
                  />
                  {iToTouched && !isValidEmail(wizard.iTo) && (
                    <span className="email-error-msg">Enter a valid email (e.g. name@outlook.com)</span>
                  )}
                </div>

                <div className="email-form-group">
                  <label className="reminder-section-label">Subject</label>
                  <input
                    className="email-input"
                    value={wizard.iSub}
                    onChange={e => setWizard({ ...wizard, iSub: e.target.value })}
                  />
                </div>

                <div className="email-form-group">
                  <label className="reminder-section-label">Message</label>
                  <textarea
                    className="email-textarea"
                    rows={10}
                    value={wizard.iBody}
                    onChange={e => setWizard({ ...wizard, iBody: e.target.value })}
                  />
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="reminder-footer">
              {wizard.step === 1 ? (
                <>
                  <button
                    className="btn-outline"
                    onClick={() => setWizard(null)}
                    disabled={wizLoading}
                  >
                    Cancel
                  </button>
                  <button className="btn-next" onClick={handleNext}>
                    Next — Interviewer <ChevronRight size={14} />
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn-back"
                    onClick={() => setWizard({ ...wizard, step: 1 })}
                    disabled={wizLoading}
                  >
                    <ChevronLeft size={14} /> Back
                  </button>
                  <button
                    className={`btn-send ${wizLoading ? "sent" : ""}`}
                    onClick={sendBoth}
                    disabled={wizLoading}
                  >
                    {wizLoading
                      ? <><CheckCircle size={14} /> Sending…</>
                      : <><Send size={14} /> Send to Both</>
                    }
                  </button>
                </>
              )}
            </div>

          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════ */}
      {/* ── Mark Result Modal ── */}
      {/* ════════════════════════════════════════════════════ */}
      {resultTarget && (
        <div className="modal-overlay" onClick={() => setResultTarget(null)}>
          <div className="result-modal" onClick={e => e.stopPropagation()}>
            <div className="reminder-header">
              <div className="reminder-title">
                <Bell size={16} color="#B875A0" />
                <span>Mark Round {resultTarget.roundNo} Result</span>
              </div>
              <button className="close-btn" onClick={() => setResultTarget(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="result-body">
              <p className="result-hint">
                Marking &quot;Passed&quot; will unlock the next round automatically.
              </p>
              <div className="result-options">
                <button
                  className="result-opt passed"
                  onClick={() => markResult(resultTarget.candidateId, resultTarget.roundNo, "passed")}
                >
                  <CheckCircle size={17} /> Completed &amp; Passed
                </button>
                <button
                  className="result-opt failed"
                  onClick={() => markResult(resultTarget.candidateId, resultTarget.roundNo, "failed")}
                >
                  <X size={17} /> Did Not Pass
                </button>
                <button
                  className="result-opt hold"
                  onClick={() => markResult(resultTarget.candidateId, resultTarget.roundNo, "on-hold")}
                >
                  <Mail size={17} /> On Hold
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════ */}
      {/* ── Candidate Detail Modal — removed (name click no longer shows popup) ── */}
      {/* ════════════════════════════════════════════════════ */}

    </div>
  );
}