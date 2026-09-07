"use client";
import { useState, useEffect, useCallback } from "react";
import {
  FileText, RefreshCw, ChevronDown, ChevronUp,
  Eye, Download, Loader2,
  Calendar, Briefcase, User, Building2, UserCheck,
  ClipboardList, X, ExternalLink,
} from "lucide-react";

const HR_API    = process.env.NEXT_PUBLIC_API_BASE_URL          || "http://localhost:8000";
const MGR_API   = process.env.NEXT_PUBLIC_MANAGER_API_BASE_URL  || "http://localhost:8001";

// ── Types ─────────────────────────────────────────────────────────────────────

type AcceptedCandidate = {
  candidate_id: string;
  name:         string;
  email:        string;
  role:         string;
  dept:         string;
  joining_date: string;
  band:         string;
  manager:      string;
  team_lead:    string;
  status:       string;
  initials:     string;
  color:        string;
};

type UploadedDoc = {
  id:           string;
  doc_key:      string;
  degree_label: string | null;
  filename:     string;
  size_bytes:   number;
  uploaded_at:  string;
  submitted_at?: string;
};

type SubmittedCandidate = {
  candidate_id: string;
  name:         string;
  role:         string;
  email:        string;
  doj:          string;
  initials:     string;
  color:        string;
  doc_count:    number;
  submitted_at: string;
  fully_submitted?: boolean;   // true = clicked "Submit Documents to HR"; false/undefined = still uploading
  documents:    UploadedDoc[];
};

// ── Dummy data (shown when backend returns empty / is unreachable) ────────────

const DUMMY_ACCEPTED: AcceptedCandidate[] = [
  {
    candidate_id: "demo-1",
    name: "Laxman Kosana",
    email: "laxman.k@candidate.app",
    role: "Salesforce Developer",
    dept: "Engineering",
    joining_date: "2026-07-21",
    band: "L4",
    manager: "Akhila G.",
    team_lead: "Ravi Kumar",
    status: "Accepted",
    initials: "LK",
    color: "#8b5cf6",
  },
  {
    candidate_id: "demo-2",
    name: "Naresh Punagani",
    email: "naresh.p@candidate.app",
    role: "Full Stack Developer",
    dept: "Product Engineering",
    joining_date: "2026-08-01",
    band: "L3",
    manager: "Akhila G.",
    team_lead: "Suresh M.",
    status: "Accepted",
    initials: "NP",
    color: "#f59e0b",
  },
  {
    candidate_id: "demo-3",
    name: "Edurupaka Bhavana",
    email: "edurupaka.b@candidate.app",
    role: "AI Engineer",
    dept: "AI & ML",
    joining_date: "2026-08-15",
    band: "L5",
    manager: "Priya R.",
    team_lead: "Anand K.",
    status: "Accepted",
    initials: "EB",
    color: "#10b981",
  },
  {
    candidate_id: "demo-4",
    name: "Sai Teja Reddy",
    email: "saiteja.r@candidate.app",
    role: "DevOps Engineer",
    dept: "Infrastructure",
    joining_date: "2026-07-28",
    band: "L3",
    manager: "Akhila G.",
    team_lead: "Vikram S.",
    status: "Accepted",
    initials: "SR",
    color: "#0891b2",
  },
];


// ── Doc label map (matches STATIC_DOCS keys in candidate portal) ──────────────
const DOC_LABELS: Record<string, { label: string; icon: string }> = {
  grad_marksheets:   { label: "Graduation Marksheets",          icon: "📚" },
  pc:                { label: "Provisional Certificate (PC)",   icon: "📜" },
  cmm:               { label: "CMM",                           icon: "🏛️" },
  pgrad_certs:       { label: "PG / Other Certificates",       icon: "🎓" },
  exp_letters:       { label: "Experience Letters",            icon: "💼" },
  relieving_letter:  { label: "Relieving Letter",              icon: "📩" },
  payslip_1:         { label: "Pay Slip — Month 1",            icon: "💰" },
  payslip_2:         { label: "Pay Slip — Month 2",            icon: "💰" },
  payslip_3:         { label: "Pay Slip — Month 3",            icon: "💰" },
  degree_certificate:{ label: "Degree Certificate",            icon: "🎓" },
};

function docLabel(doc: UploadedDoc): string {
  if (doc.doc_key === "degree_certificate" && doc.degree_label)
    return `${doc.degree_label} Certificate`;
  return DOC_LABELS[doc.doc_key]?.label ?? doc.doc_key;
}
function docIcon(doc: UploadedDoc): string {
  return DOC_LABELS[doc.doc_key]?.icon ?? "📄";
}
function fmtDate(iso: string): string {
  if (!iso) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const d = new Date(`${iso}T00:00:00`);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtSize(bytes: number): string {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1024*1024)  return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/(1024*1024)).toFixed(1)} MB`;
}

// ── PDF Viewer Modal ──────────────────────────────────────────────────────────
// Uses the default `disposition=inline` behavior of the download endpoint —
// the browser renders the PDF in place rather than downloading it.
function PdfModal({ candidateId, doc, onClose }: {
  candidateId: string;
  doc: UploadedDoc;
  onClose: () => void;
}) {
  const url = `${HR_API}/candidates/${candidateId}/documents/${doc.id}/download`;
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(15,10,30,0.72)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }} onClick={onClose}>
      <div style={{
        background: "#fff", borderRadius: 16, width: "100%", maxWidth: 900,
        height: "90vh", display: "flex", flexDirection: "column",
        boxShadow: "0 24px 64px rgba(0,0,0,0.35)", overflow: "hidden",
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "14px 20px", borderBottom: "1px solid rgba(221,208,232,0.4)",
          background: "linear-gradient(135deg,#6366f1,#818cf8)", color: "#fff",
          flexShrink: 0,
        }}>
          <FileText size={18} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{docIcon(doc)} {docLabel(doc)}</div>
            <div style={{ fontSize: 11, opacity: 0.85 }}>{doc.filename} · {fmtSize(doc.size_bytes)}</div>
          </div>
          <a href={url} target="_blank" rel="noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px",
              background: "rgba(255,255,255,0.18)", borderRadius: 7, fontSize: 12,
              fontWeight: 600, color: "#fff", textDecoration: "none", border: "1px solid rgba(255,255,255,0.3)" }}>
            <ExternalLink size={12} /> Open in tab
          </a>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.18)", border: "none", borderRadius: 7,
            padding: "6px 8px", cursor: "pointer", color: "#fff", display: "flex",
          }}><X size={16} /></button>
        </div>
        {/* PDF embed */}
        <iframe
          src={`${url}#toolbar=1&navpanes=0`}
          style={{ flex: 1, border: "none", width: "100%" }}
          title={doc.filename}
        />
      </div>
    </div>
  );
}

// ── Section 2 row — expanded document list for one candidate ─────────────────
function DocRow({ cand }: { cand: SubmittedCandidate }) {
  const [open,     setOpen]     = useState(false);
  const [viewing,  setViewing]  = useState<UploadedDoc | null>(null);

  return (
    <>
      {viewing && (
        <PdfModal candidateId={cand.candidate_id} doc={viewing} onClose={() => setViewing(null)} />
      )}
      {/* Candidate summary row */}
      <div style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "14px 20px", cursor: "pointer",
        background: open ? "rgba(99,102,241,0.04)" : "#fff",
        borderBottom: "1px solid rgba(221,208,232,0.25)",
        transition: "background .15s",
      }} onClick={() => setOpen(v => !v)}>
        {/* Avatar */}
        <div style={{
          width: 38, height: 38, borderRadius: "50%", flexShrink: 0,
          background: cand.color, color: "#fff", fontWeight: 700, fontSize: 13,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
        }}>{cand.initials}</div>
        {/* Name + role */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#1e1b4b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cand.name}</div>
          <div style={{ fontSize: 11, color: "#9ca3af" }}>{cand.role || "—"} · {cand.email}</div>
        </div>
        {/* Doc count badge */}
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
          background: "rgba(99,102,241,0.1)", color: "#4f46e5",
        }}>
          <FileText size={11} /> {cand.doc_count} doc{cand.doc_count !== 1 ? "s" : ""}
        </div>
        {/* Submission status — distinguishes still-uploading candidates
            (fully_submitted false/undefined) from ones who clicked the
            final "Submit Documents to HR" button. */}
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
          background: cand.fully_submitted ? "rgba(16,185,129,0.1)" : "rgba(245,158,11,0.1)",
          color: cand.fully_submitted ? "#065f46" : "#92400e",
        }}>
          {cand.fully_submitted ? "Submitted" : "In progress"}
        </div>
        {/* Submitted date */}
        <div style={{ fontSize: 11, color: "#9ca3af", minWidth: 90, textAlign: "right" }}>
          {cand.fully_submitted ? "Submitted" : "Last upload"}<br />{fmtDate(cand.submitted_at)}
        </div>
        {/* Expand toggle */}
        <div style={{ color: "#9ca3af", flexShrink: 0 }}>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {/* Expanded documents grid */}
      {open && (
        <div style={{
          padding: "16px 20px 20px 72px",
          background: "rgba(248,247,255,0.6)",
          borderBottom: "1px solid rgba(221,208,232,0.25)",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
            Uploaded Documents
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 10 }}>
            {cand.documents.map(doc => (
              <div key={doc.id} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 13px", borderRadius: 10,
                background: "#fff", border: "1px solid rgba(221,208,232,0.5)",
                boxShadow: "0 1px 4px rgba(99,102,241,0.06)",
              }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>{docIcon(doc)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#1e1b4b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {docLabel(doc)}
                  </div>
                  <div style={{ fontSize: 10, color: "#9ca3af" }}>{fmtSize(doc.size_bytes)} · {fmtDate(doc.uploaded_at)}</div>
                </div>
                <button
                  onClick={() => setViewing(doc)}
                  title="View PDF"
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "5px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600,
                    background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)",
                    color: "#4f46e5", cursor: "pointer",
                  }}>
                  <Eye size={11} /> View
                </button>
                <a
                  href={`${HR_API}/candidates/${cand.candidate_id}/documents/${doc.id}/download?disposition=attachment`}
                  download={doc.filename}
                  title="Download PDF"
                  style={{
                    display: "flex", alignItems: "center", padding: "5px 7px",
                    borderRadius: 7, background: "rgba(16,185,129,0.08)",
                    border: "1px solid rgba(16,185,129,0.2)", color: "#059669",
                  }}>
                  <Download size={11} />
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function OnboardingPage() {
  const [accepted,      setAccepted]      = useState<AcceptedCandidate[]>([]);
  const [submitted,     setSubmitted]     = useState<SubmittedCandidate[]>([]);
  const [loadingAcc,    setLoadingAcc]    = useState(true);
  const [loadingSub,    setLoadingSub]    = useState(true);
  const [searchAcc,     setSearchAcc]     = useState("");
  const [searchSub,     setSearchSub]     = useState("");
  const [lastRefresh,   setLastRefresh]   = useState<Date | null>(null);

  const fetchAccepted = useCallback(async () => {
    setLoadingAcc(true);
    try {
      // ── Replicate the dashboard's 3-call merge pattern ──────────────────
      // 1. HR backend → authoritative candidate data (name, email, role, rounds)
      const hrRes  = await fetch(`${HR_API}/interviews/`);
      const hrData = hrRes.ok ? await hrRes.json() : { candidates: [] };
      const hrCandidates: any[] = hrData.candidates || [];

      if (hrCandidates.length === 0) { setAccepted(DUMMY_ACCEPTED); return; }

      // 2. Manager backend → offers-status (joining date + candidate_accepted)
      const ids = hrCandidates.map((c: any) => c.id).join(",");
      let offerMap: Map<string, any> = new Map();
      try {
        const offRes  = await fetch(`${MGR_API}/manager/offers-status?ids=${encodeURIComponent(ids)}`);
        const offData = offRes.ok ? await offRes.json() : { offers: [] };
        offerMap = new Map((offData.offers || []).map((o: any) => [o.candidate_id, o]));
      } catch { /* manager backend unreachable — keep empty map */ }

      // 3. Manager backend → full offers (for band, dept, manager_name)
      let fullOfferMap: Map<string, any> = new Map();
      try {
        const foRes  = await fetch(`${MGR_API}/manager/offers`);
        const foData = foRes.ok ? await foRes.json() : { offers: [] };
        fullOfferMap = new Map((foData.offers || []).map((o: any) => [o.candidate_id, o]));
      } catch { /* ok */ }

      // 4. Filter to only candidate_accepted === true and merge fields
      const accepted: AcceptedCandidate[] = hrCandidates
        .filter((c: any) => {
          const offer = offerMap.get(c.id);
          return offer?.candidate_accepted === true;
        })
        .map((c: any) => {
          const offer     = offerMap.get(c.id)     || {};
          const fullOffer = fullOfferMap.get(c.id) || {};
          // Team lead = round-1 interviewer from HR backend rounds
          const rounds: any[] = c.rounds || [];
          const sortedRounds  = [...rounds].sort((a, b) => (a.roundNo || 0) - (b.roundNo || 0));
          const r1       = sortedRounds.find((r: any) => r.interviewer && r.interviewer !== "TBD");
          return {
            candidate_id: c.id,
            name:         c.name         || "—",
            email:        c.email        || fullOffer.candidate_email || "—",  // HR backend email is authoritative
            role:         c.role         || fullOffer.role            || "—",
            dept:         fullOffer.dept || fullOffer.department      || "—",
            joining_date: offer.doj      || fullOffer.doj             || "TBD",
            band:         fullOffer.band                              || "—",
            manager:      fullOffer.manager_name || fullOffer.manager || "—",
            team_lead:    r1?.interviewer                             || "—",
            status:       "Accepted",
            initials:     c.initials     || (c.name || "?").split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase(),
            color:        c.color        || "#6366f1",
          };
        });

      setAccepted(accepted.length > 0 ? accepted : DUMMY_ACCEPTED);
    } catch {
      setAccepted(DUMMY_ACCEPTED);
    } finally { setLoadingAcc(false); }
  }, []);

  const fetchSubmitted = useCallback(async () => {
    setLoadingSub(true);
    try {
      const res = await fetch(`${HR_API}/candidates/all-submitted`);
      if (!res.ok) throw new Error(`HR backend returned ${res.status}`);
      const data = await res.json();
      setSubmitted(data.candidates || []);
    } catch (e: any) {
      console.error("Failed to load submitted documents:", e);
      setSubmitted([]);
    } finally { setLoadingSub(false); }
  }, []);

  useEffect(() => {
    fetchAccepted();
    fetchSubmitted();
    setLastRefresh(new Date());   // client-only — safe here, this effect never runs during SSR
  }, [fetchAccepted, fetchSubmitted]);

  function handleRefresh() {
    fetchAccepted();
    fetchSubmitted();
    setLastRefresh(new Date());
  }

  const filteredAcc = accepted.filter(c => {
    const q = searchAcc.toLowerCase();
    return !q || c.name.toLowerCase().includes(q) || c.role.toLowerCase().includes(q) || c.dept.toLowerCase().includes(q);
  });

  const filteredSub = submitted.filter(c => {
    const q = searchSub.toLowerCase();
    return !q || c.name.toLowerCase().includes(q) || c.role.toLowerCase().includes(q);
  });

  // ── Stat cards ──
  const totalJoining = accepted.filter(c => c.joining_date && c.joining_date !== "TBD").length;

  return (
    <div style={{ minHeight: "100vh", background: "#f4f3ff", fontFamily: "inherit" }}>
      {/* Page header */}
      <div style={{
        background: "linear-gradient(135deg,#6366f1,#818cf8,#a78bfa)",
        padding: "28px 32px 24px", color: "#fff",
        boxShadow: "0 4px 20px rgba(99,102,241,0.2)",
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: "rgba(255,255,255,0.2)", display: "flex",
                alignItems: "center", justifyContent: "center",
              }}>
                <ClipboardList size={22} />
              </div>
              <div>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Onboarding</h1>
                <p style={{ margin: 0, fontSize: 13, opacity: 0.85 }}>Track accepted candidates and review submitted documents</p>
              </div>
            </div>
            <button onClick={handleRefresh} style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "9px 18px", background: "rgba(255,255,255,0.18)",
              border: "1px solid rgba(255,255,255,0.3)", borderRadius: 9,
              fontSize: 13, fontWeight: 600, color: "#fff", cursor: "pointer",
            }}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
          {/* Stat cards */}
          <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
            {[
              { label: "Accepted Offers",    value: accepted.length,  icon: <UserCheck size={16} />,  bg: "rgba(255,255,255,0.15)" },
              { label: "Joining Confirmed",  value: totalJoining,     icon: <Calendar size={16} />,   bg: "rgba(255,255,255,0.12)" },
              { label: "Docs Submitted",     value: submitted.length, icon: <FileText size={16} />,   bg: "rgba(255,255,255,0.12)" },
            ].map(s => (
              <div key={s.label} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 18px", borderRadius: 10, background: s.bg,
                border: "1px solid rgba(255,255,255,0.2)",
              }}>
                {s.icon}
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1 }}>{s.value}</div>
                  <div style={{ fontSize: 11, opacity: 0.85 }}>{s.label}</div>
                </div>
              </div>
            ))}
            <div style={{ marginLeft: "auto", fontSize: 11, opacity: 0.7, alignSelf: "flex-end" }}>
              {lastRefresh ? `Last refreshed: ${lastRefresh.toLocaleTimeString("en-GB")}` : "Loading…"}
            </div>
          </div>
        </div>
      </div>

      {/* ── Page body ── */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 24px 56px", display: "flex", flexDirection: "column", gap: 32 }}>

        {/* ══════════════════════════════════════════════════════════════════
            SECTION 1 — Candidates who accepted the offer letter
        ══════════════════════════════════════════════════════════════════ */}
        <section>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            <div style={{ width: 4, height: 24, borderRadius: 2, background: "linear-gradient(135deg,#6366f1,#818cf8)", flexShrink: 0 }} />
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "#1e1b4b" }}>
              Accepted Offer Letters
            </h2>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
              background: "rgba(99,102,241,0.1)", color: "#4f46e5",
            }}>{accepted.length} candidate{accepted.length !== 1 ? "s" : ""}</span>
            <div style={{ marginLeft: "auto" }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "7px 12px", background: "#fff",
                border: "1px solid rgba(221,208,232,0.5)", borderRadius: 9,
              }}>
                <User size={13} style={{ color: "#9ca3af" }} />
                <input
                  value={searchAcc} onChange={e => setSearchAcc(e.target.value)}
                  placeholder="Search by name, role, dept…"
                  style={{ border: "none", outline: "none", fontSize: 12, width: 200, color: "#374151", background: "transparent" }}
                />
                {searchAcc && <button onClick={() => setSearchAcc("")} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", padding: 0 }}><X size={12} /></button>}
              </div>
            </div>
          </div>

          {loadingAcc ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "32px 0", color: "#9ca3af", fontSize: 13 }}>
              <Loader2 size={16} className="animate-spin" /> Loading accepted candidates…
            </div>
          ) : filteredAcc.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af" }}>
              <UserCheck size={32} style={{ margin: "0 auto 10px", display: "block", opacity: 0.4 }} />
              <p style={{ margin: 0, fontSize: 13 }}>{searchAcc ? "No matches found." : "No candidates have accepted an offer yet."}</p>
            </div>
          ) : (
            <div style={{ background: "#fff", border: "1px solid rgba(221,208,232,0.4)", borderRadius: 14, overflow: "hidden", boxShadow: "0 2px 12px rgba(99,102,241,0.06)" }}>
              {/* Table header */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "2fr 1.4fr 1.2fr 1.2fr 1.3fr 1.3fr",
                padding: "11px 20px", background: "rgba(248,247,255,0.9)",
                borderBottom: "1px solid rgba(221,208,232,0.4)",
                fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em",
              }}>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}><User size={11} /> Candidate</span>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Briefcase size={11} /> Role</span>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Building2 size={11} /> Dept</span>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Calendar size={11} /> Joining Date</span>
                <span>Manager</span>
                <span>Team Lead</span>
              </div>
              {/* Rows */}
              {filteredAcc.map((c, i) => (
                <div key={c.candidate_id} style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1.4fr 1.2fr 1.2fr 1.3fr 1.3fr",
                  padding: "13px 20px", alignItems: "center",
                  background: i % 2 === 0 ? "#fff" : "rgba(248,247,255,0.5)",
                  borderBottom: i < filteredAcc.length - 1 ? "1px solid rgba(221,208,232,0.2)" : "none",
                  transition: "background .12s",
                }}>
                  {/* Candidate */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{
                      width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
                      background: c.color, color: "#fff", fontWeight: 700, fontSize: 12,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
                    }}>{c.initials}</div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: "#1e1b4b" }}>{c.name}</div>
                      <div style={{ fontSize: 10, color: "#9ca3af" }}>{c.email}</div>
                    </div>
                  </div>
                  {/* Role */}
                  <div style={{ fontSize: 12, color: "#374151", fontWeight: 600 }}>{c.role || "—"}</div>
                  {/* Dept */}
                  <div style={{ fontSize: 12, color: "#6b7280" }}>{c.dept || "—"}</div>
                  {/* Joining date */}
                  <div>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                      background: c.joining_date && c.joining_date !== "TBD"
                        ? "rgba(16,185,129,0.1)" : "rgba(245,158,11,0.1)",
                      color: c.joining_date && c.joining_date !== "TBD" ? "#065f46" : "#92400e",
                    }}>
                      <Calendar size={10} />
                      {fmtDate(c.joining_date) || "TBD"}
                    </span>
                  </div>
                  {/* Manager */}
                  <div style={{ fontSize: 12, color: "#374151" }}>{c.manager || "—"}</div>
                  {/* Team Lead */}
                  <div style={{ fontSize: 12, color: "#374151" }}>{c.team_lead || "—"}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            SECTION 2 — Candidates who submitted their documents
        ══════════════════════════════════════════════════════════════════ */}
        <section>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            <div style={{ width: 4, height: 24, borderRadius: 2, background: "linear-gradient(135deg,#f59e0b,#ef4444)", flexShrink: 0 }} />
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "#1e1b4b" }}>
              Submitted Documents
            </h2>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
              background: "rgba(245,158,11,0.1)", color: "#92400e",
            }}>{submitted.length} candidate{submitted.length !== 1 ? "s" : ""}</span>
            <div style={{ marginLeft: "auto" }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "7px 12px", background: "#fff",
                border: "1px solid rgba(221,208,232,0.5)", borderRadius: 9,
              }}>
                <User size={13} style={{ color: "#9ca3af" }} />
                <input
                  value={searchSub} onChange={e => setSearchSub(e.target.value)}
                  placeholder="Search by name or role…"
                  style={{ border: "none", outline: "none", fontSize: 12, width: 200, color: "#374151", background: "transparent" }}
                />
                {searchSub && <button onClick={() => setSearchSub("")} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", padding: 0 }}><X size={12} /></button>}
              </div>
            </div>
          </div>

          {/* Legend */}
          <div style={{
            display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap",
          }}>
            {[
              { icon: "👁️", label: "View — opens PDF in a modal" },
              { icon: "⬇️", label: "Download — saves the PDF locally" },
            ].map(l => (
              <div key={l.label} style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "4px 10px", borderRadius: 8, fontSize: 11,
                background: "#fff", border: "1px solid rgba(221,208,232,0.4)", color: "#6b7280",
              }}>{l.icon} {l.label}</div>
            ))}
          </div>

          {loadingSub ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "32px 0", color: "#9ca3af", fontSize: 13 }}>
              <Loader2 size={16} className="animate-spin" /> Loading submitted documents…
            </div>
          ) : filteredSub.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af" }}>
              <FileText size={32} style={{ margin: "0 auto 10px", display: "block", opacity: 0.4 }} />
              <p style={{ margin: 0, fontSize: 13 }}>{searchSub ? "No matches found." : "No candidates have submitted documents yet."}</p>
              <p style={{ margin: "6px 0 0", fontSize: 11, color: "#c4bdd0" }}>Documents submitted in the Candidate Portal will appear here.</p>
            </div>
          ) : (
            <div style={{
              background: "#fff", border: "1px solid rgba(221,208,232,0.4)",
              borderRadius: 14, overflow: "hidden",
              boxShadow: "0 2px 12px rgba(99,102,241,0.06)",
            }}>
              {/* Table sub-header */}
              <div style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "11px 20px", background: "rgba(248,247,255,0.9)",
                borderBottom: "1px solid rgba(221,208,232,0.4)",
                fontSize: 11, fontWeight: 700, color: "#9ca3af",
                textTransform: "uppercase", letterSpacing: "0.05em",
              }}>
                <span style={{ flex: 1 }}>Candidate</span>
                <span style={{ minWidth: 80, textAlign: "center" }}>Documents</span>
                <span style={{ minWidth: 90, textAlign: "right" }}>Submitted / Last Upload</span>
                <span style={{ minWidth: 16 }} />
              </div>
              {filteredSub.map(c => (
                <DocRow key={c.candidate_id} cand={c} />
              ))}
            </div>
          )}
        </section>

        <p style={{ fontSize: 11, color: "#c4bdd0", textAlign: "center", margin: 0 }}>
          RecruitAI HR Portal · Onboarding · {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}

