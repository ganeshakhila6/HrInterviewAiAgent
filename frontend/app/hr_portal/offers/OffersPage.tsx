"use client";
import "./OffersPage.css";
import { FileText, Send, Pencil, Check, X, RefreshCw, AlertCircle, CalendarDays, Eye } from "lucide-react";
import { useState, useEffect } from "react";
import { useInterviewStore, API_BASE_URL, apiHeaders } from "@/lib/interviewStore";

type Offer = {
  candidate_id?: string;
  email?:       string;
  initials:     string;
  color:        string;
  name:         string;
  role:         string;
  band:         string;
  joiningDate:  string;
  status:       string;
  sentDate:     string;
  bonus?:       string;
  dept?:        string;
};

const MANAGER_API = process.env.NEXT_PUBLIC_MANAGER_API_BASE_URL || "http://localhost:8001";

const statusStyle: Record<string, { bg: string; text: string }> = {
  Sent:     { bg: "rgba(128,178,255,0.2)",  text: "#1a6080" },
  Draft:    { bg: "rgba(253,255,200,0.6)",  text: "#806020" },
  Accepted: { bg: "rgba(200,247,220,0.6)",  text: "#2a7a50" },
  Declined: { bg: "rgba(255,200,216,0.5)",  text: "#c0506a" },
};

function formatJoiningDate(value: string): string {
  if (!value) return "TBD";
  const isoMatch = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!isoMatch) return value;
  const d = new Date(`${value}T00:00:00`);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/* ── Editable Offer Letter Modal ────────────────────────────────────────────── */
function OfferLetterModal({ offer, onClose, onSend }: {
  offer: Offer;
  onClose: () => void;
  onSend: (updated: Offer) => void;
}) {
  const [band,        setBand]        = useState(offer.band !== "TBD" ? offer.band : "");
  const [joiningDate, setJoiningDate] = useState(offer.joiningDate || "");
  const [hrName,      setHrName]      = useState("Yerni G.");
  const [hrDate,      setHrDate]      = useState("");
  const [pdfKey,      setPdfKey]      = useState(0);

  const previewUrl = `${MANAGER_API}/manager/preview-offer`
    + `?candidate_id=${encodeURIComponent(offer.candidate_id || "")}`
    + `&band=${encodeURIComponent(band)}`
    + `&doj=${encodeURIComponent(joiningDate)}`
    + `&hr_signatory_name=${encodeURIComponent(hrName)}`
    + `&acceptance_date=${encodeURIComponent(hrDate)}`
    + `&_k=${pdfKey}`;

  function refreshPreview() { setPdfKey(k => k + 1); }

  return (
    <div style={{ position:"fixed", inset:0, zIndex:300, background:"rgba(15,10,30,0.6)", backdropFilter:"blur(4px)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}>
      <div style={{ width:"100%", maxWidth:1020, height:"90vh", display:"flex", background:"#fff", borderRadius:16, overflow:"hidden", boxShadow:"0 24px 64px rgba(0,0,0,0.3)" }}
        onClick={e => e.stopPropagation()}>

        {/* ── Left: editable fields ── */}
        <div style={{ width:280, flexShrink:0, borderRight:"1px solid rgba(221,208,232,0.4)", overflowY:"auto", padding:"22px 18px", background:"#faf9ff", display:"flex", flexDirection:"column", gap:0 }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#1e1b4b", marginBottom:18, display:"flex", alignItems:"center", gap:6 }}>
            <Pencil size={14} color="#6366f1" /> Edit Offer Details
          </div>

          {/* Read-only info */}
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", letterSpacing:".05em", marginBottom:3 }}>Candidate</div>
            <div style={{ fontSize:13, fontWeight:700, color:"#1e1b4b" }}>{offer.name}</div>
          </div>
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", letterSpacing:".05em", marginBottom:3 }}>Designation</div>
            <div style={{ fontSize:13, color:"#374151" }}>{offer.role || "—"}</div>
          </div>

          <hr style={{ border:"none", borderTop:"1px solid rgba(221,208,232,0.4)", margin:"6px 0 16px" }}/>

          {/* Editable fields */}
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:10, fontWeight:700, color:"#6366f1", textTransform:"uppercase", letterSpacing:".05em", display:"block", marginBottom:5 }}>Compensation Band (LPA)</label>
            <input
              value={band}
              onChange={e => setBand(e.target.value)}
              placeholder="e.g. 20 or 20.5"
              style={{ width:"100%", padding:"7px 10px", border:"1.5px solid rgba(99,102,241,0.35)", borderRadius:7, fontSize:13, fontFamily:"inherit", outline:"none", boxSizing:"border-box" }}
            />
            <div style={{ fontSize:10, color:"#9ca3af", marginTop:3 }}>Enter as a number in LPA — e.g. 20 for 20 LPA</div>
          </div>

          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:10, fontWeight:700, color:"#6366f1", textTransform:"uppercase", letterSpacing:".05em", display:"block", marginBottom:5 }}>Date of Joining</label>
            <input
              type="date"
              value={/^\d{4}-\d{2}-\d{2}$/.test(joiningDate) ? joiningDate : ""}
              onChange={e => setJoiningDate(e.target.value)}
              style={{ width:"100%", padding:"7px 10px", border:"1.5px solid rgba(99,102,241,0.35)", borderRadius:7, fontSize:13, fontFamily:"inherit", outline:"none", boxSizing:"border-box" }}
            />
          </div>

          <button
            onClick={refreshPreview}
            style={{ width:"100%", padding:"8px 0", background:"rgba(99,102,241,0.08)", border:"1px solid rgba(99,102,241,0.25)", borderRadius:8, fontSize:12, fontWeight:700, color:"#4f46e5", cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:5, marginTop:4 }}>
            <RefreshCw size={12} /> Refresh Preview
          </button>

          <hr style={{ border:"none", borderTop:"1px solid rgba(221,208,232,0.4)", margin:"18px 0 14px" }}/>

          {/* HR Signature section */}
          <div style={{ fontSize:12, fontWeight:700, color:"#6366f1", marginBottom:12 }}>HR Signature (Page 3)</div>
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:10, fontWeight:700, color:"#6366f1", textTransform:"uppercase", letterSpacing:".05em", display:"block", marginBottom:5 }}>HR Signatory Name</label>
            <input
              value={hrName}
              onChange={e => setHrName(e.target.value)}
              placeholder="e.g. Yerni G."
              style={{ width:"100%", padding:"7px 10px", border:"1.5px solid rgba(99,102,241,0.35)", borderRadius:7, fontSize:13, fontFamily:"inherit", outline:"none", boxSizing:"border-box" }}
            />
            <div style={{ fontSize:10, color:"#9ca3af", marginTop:3 }}>Printed below the HR signature line</div>
          </div>
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:10, fontWeight:700, color:"#6366f1", textTransform:"uppercase", letterSpacing:".05em", display:"block", marginBottom:5 }}>HR Signature Date</label>
            <input
              type="date"
              value={hrDate}
              onChange={e => setHrDate(e.target.value)}
              style={{ width:"100%", padding:"7px 10px", border:"1.5px solid rgba(99,102,241,0.35)", borderRadius:7, fontSize:13, fontFamily:"inherit", outline:"none", boxSizing:"border-box" }}
            />
            <div style={{ fontSize:10, color:"#9ca3af", marginTop:3 }}>Date printed next to HR signature</div>
          </div>

          <hr style={{ border:"none", borderTop:"1px solid rgba(221,208,232,0.4)", margin:"6px 0 14px" }}/>

          {/* Salary note */}
          <div style={{ padding:"10px 12px", background:"rgba(99,102,241,0.05)", borderRadius:8, border:"1px solid rgba(99,102,241,0.15)", fontSize:11, color:"#6b7280", lineHeight:1.6 }}>
            <strong style={{ color:"#4f46e5" }}>Salary table</strong> is automatically calculated from the compensation band and filled in the SprintPark offer letter template.
          </div>
        </div>

        {/* ── Right: PDF preview iframe ── */}
        <div style={{ flex:1, display:"flex", flexDirection:"column" }}>
          {/* Toolbar */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"13px 20px", borderBottom:"1px solid rgba(221,208,232,0.4)", background:"#fff", flexShrink:0 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <Eye size={15} color="#6366f1" />
              <span style={{ fontSize:14, fontWeight:700, color:"#1e1b4b" }}>SprintPark Offer Letter</span>
              <span style={{ fontSize:11, padding:"2px 8px", borderRadius:12, background:"rgba(99,102,241,0.1)", color:"#4f46e5", fontWeight:600 }}>Template Preview</span>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              {offer.candidate_id && (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ padding:"7px 14px", background:"rgba(99,102,241,0.08)", border:"1px solid rgba(99,102,241,0.2)", borderRadius:8, fontSize:12, fontWeight:600, color:"#4f46e5", textDecoration:"none", display:"inline-flex", alignItems:"center", gap:5 }}>
                  <FileText size={12} /> Open in Tab
                </a>
              )}
              <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af", display:"flex" }}><X size={18}/></button>
            </div>
          </div>

          {/* PDF iframe */}
          <div style={{ flex:1, overflow:"hidden", background:"#f3f4f6" }}>
            {offer.candidate_id ? (
              <iframe
                key={pdfKey}
                src={`${previewUrl}#toolbar=1`}
                style={{ width:"100%", height:"100%", border:"none" }}
                title="Offer Letter Preview"
              />
            ) : (
              <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100%", color:"#9ca3af", fontSize:13 }}>
                No candidate ID — cannot generate preview.
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{ display:"flex", justifyContent:"flex-end", gap:10, padding:"13px 22px", borderTop:"1px solid rgba(221,208,232,0.4)", background:"#fff", flexShrink:0 }}>
            <button onClick={onClose} style={{ padding:"8px 18px", border:"1px solid rgba(221,208,232,0.6)", borderRadius:8, fontSize:13, fontWeight:600, color:"#6b7280", background:"#fff", cursor:"pointer", fontFamily:"inherit" }}>Close</button>
            {offer.status === "Draft" && (
              <button
                onClick={() => { onSend({ ...offer, band: band || offer.band, joiningDate: joiningDate || offer.joiningDate }); onClose(); }}
                style={{ padding:"8px 20px", background:"linear-gradient(135deg,#6366f1,#818cf8)", border:"none", borderRadius:8, fontSize:13, fontWeight:700, color:"#fff", cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", gap:6, boxShadow:"0 4px 12px rgba(99,102,241,0.3)" }}>
                <Send size={13}/> Send Offer Letter
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
export default function OffersPage() {
  const { refreshKey, refreshAll } = useInterviewStore();

  const [offers,       setOffers]       = useState<Offer[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [fetchError,   setFetchError]   = useState(false);

  const [editingBand,        setEditingBand]        = useState<number | null>(null);
  const [bandDraft,          setBandDraft]          = useState("");
  const [editingJoiningDate, setEditingJoiningDate] = useState<number | null>(null);
  const [joiningDateDraft,   setJoiningDateDraft]   = useState("");

  async function fetchOffers() {
    setLoading(true);
    setFetchError(false);
    /* Clear stale offers immediately for visual feedback */
    setOffers([]);
    try {
      const res = await fetch(`${MANAGER_API}/manager/offers`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const live: Offer[] = (data.offers || []).map((o: any) => ({
        candidate_id: o.candidate_id,
        email:       o.candidate_email || o.email || "",
        initials:    o.initials || (o.candidate_name?.split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase() || "?"),
        color:       o.color           || "#6366f1",
        name:        o.candidate_name  || "",
        role:        o.role            || "",
        band:        o.band            || "TBD",
        joiningDate: o.joining_date    || o.date_of_joining || o.doj || "",
        status:      o.status          || "Draft",
        sentDate:    o.sent_date       || "—",
        bonus:       o.bonus           || "",
        dept:        o.dept            || o.department || "",
      }));
      setOffers(live);
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }

  /* Auto-fetch on mount */
  useEffect(() => { fetchOffers(); }, []);

  /* Re-fetch offers whenever global refresh fires (refreshAll re-pulls interview data) */
  useEffect(() => {
    if (refreshKey === 0) return;   /* skip initial mount, fetchOffers() already runs there */
    fetchOffers();
    setEditingBand(null);
    setEditingJoiningDate(null);
    setSendError(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const [sending,  setSending]  = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [viewOffer, setViewOffer] = useState<Offer | null>(null);

  /* Build the offer letter email body sent to the candidate */
  function buildOfferEmail(o: Offer) {
    return {
      subject: `Offer Letter — ${o.role}`,
      body: `
        <h2>Dear ${o.name},</h2>
        <p>Congratulations! We are pleased to offer you the position of <b>${o.role}</b>.</p>
        <table border="1" cellpadding="8">
          <tr><td><b>Role</b></td><td>${o.role}</td></tr>
          <tr><td><b>Compensation Band</b></td><td>${o.band}</td></tr>
          <tr><td><b>Date of Joining</b></td><td>${formatJoiningDate(o.joiningDate)}</td></tr>
        </table>
        <p>Please reach out to HR with any questions. We look forward to having you on the team!</p>
        <br><p>Best regards,<br><b>HR Team</b></p>
      `,
    };
  }

  async function handleSend(o: Offer) {
    if (!o.candidate_id) { setSendError("No candidate ID — cannot send."); return; }
    setSending(o.candidate_id);
    setSendError(null);

    try {
      /* 1 ── Tell the manager backend this offer was sent (manager-side tracking) */
      const res = await fetch(
        `${MANAGER_API}/manager/send-offer?candidate_id=${encodeURIComponent(o.candidate_id)}`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || `Error ${res.status}`);

      /* 2 ── Actually send the offer-letter email + persist on the HR backend
              so HR's dashboard (offer_letter_sent / offer_letter_sent_at) reflects it */
      if (o.email) {
        const { subject, body } = buildOfferEmail(o);
        try {
          const hrRes = await fetch(
            `${API_BASE_URL}/interviews/${encodeURIComponent(o.candidate_id)}/offer-letter/send`,
            {
              method: "POST",
              headers: apiHeaders(),
              body: JSON.stringify({
                candidateEmail: o.email,
                subject,
                body,
              }),
            }
          );
          if (!hrRes.ok) {
            const hrData = await hrRes.json().catch(() => ({}));
            console.warn("HR offer-letter email failed:", hrData?.detail || hrRes.status);
            setSendError(
              "Offer marked as sent, but the HR-side email/record update failed. " +
              "It may not show as sent on the HR dashboard yet."
            );
          }
        } catch (hrErr) {
          console.warn("HR backend unreachable for offer-letter send:", hrErr);
          setSendError(
            "Offer marked as sent, but couldn't reach the HR backend to record it there."
          );
        }
      } else {
        console.warn("No candidate email available — skipped HR offer-letter send.");
      }

      /* Update status locally so UI reflects Sent immediately */
      const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      setOffers(prev => prev.map(x =>
        x.candidate_id === o.candidate_id ? { ...x, status: "Sent", sentDate: today } : x
      ));
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send offer.");
    } finally {
      setSending(null);
    }
  }

  function commitBandEdit(i: number) {
    const v = bandDraft.trim();
    if (v) {
      const updated = offers.map((o, idx) => idx === i ? { ...o, band: v } : o);
      setOffers(updated);
      const id = updated[i].candidate_id;
      if (id) fetch(`${MANAGER_API}/manager/offers/${encodeURIComponent(id)}?band=${encodeURIComponent(v)}`, { method: "PATCH" }).catch(() => {});
    }
    setEditingBand(null);
  }

  /* ── Joining date edit ── */
  function commitJoiningDateEdit(i: number) {
    const v = joiningDateDraft.trim();
    if (!v) { setEditingJoiningDate(null); return; }

    const id = offers[i].candidate_id;
    if (!id) { setEditingJoiningDate(null); return; }

    fetch(`${MANAGER_API}/manager/offers/${encodeURIComponent(id)}?joining_date=${encodeURIComponent(v)}`, { method: "PATCH" })
      .then(res => {
        if (!res.ok) throw new Error(`Save failed (${res.status})`);
        setOffers(prev => prev.map((o, idx) => idx === i ? { ...o, joiningDate: v } : o));
      })
      .catch(() => setSendError("Couldn't save the joining date. Please try again."));

    setEditingJoiningDate(null);
  }

  /* ── Shared inline text edit input (used for Compensation Band) ── */
  const editInput = (
    value: string,
    onChange: (v: string) => void,
    onCommit: () => void,
    onCancel: () => void,
  ) => (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <input
        value={value} autoFocus
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") onCommit(); if (e.key === "Escape") onCancel(); }}
        style={{ width: 130, padding: "4px 8px", border: "1.5px solid #9E74D0", borderRadius: 6, fontSize: 13, fontWeight: 600, outline: "none", boxShadow: "0 0 0 3px rgba(158,116,208,0.2)", fontFamily: "inherit" }}
      />
      <button onClick={onCommit} style={{ width: 26, height: 26, border: "none", borderRadius: 6, background: "rgba(16,185,129,0.15)", color: "#10b981", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Check size={13} /></button>
      <button onClick={onCancel} style={{ width: 26, height: 26, border: "none", borderRadius: 6, background: "rgba(239,68,68,0.12)", color: "#ef4444", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={13} /></button>
    </div>
  );

  /* ── Date-specific inline edit input: native <input type="date"> gives a
     calendar picker on click AND lets the user type the day/month/year
     segments directly, so both entry methods work out of the box. ── */
  const dateEditInput = (
    value: string,
    onChange: (v: string) => void,
    onCommit: () => void,
    onCancel: () => void,
  ) => (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <input
        type="date"
        value={/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ""}
        autoFocus
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") onCommit(); if (e.key === "Escape") onCancel(); }}
        style={{ width: 150, padding: "4px 8px", border: "1.5px solid #9E74D0", borderRadius: 6, fontSize: 13, fontWeight: 600, outline: "none", boxShadow: "0 0 0 3px rgba(158,116,208,0.2)", fontFamily: "inherit" }}
      />
      <button onClick={onCommit} style={{ width: 26, height: 26, border: "none", borderRadius: 6, background: "rgba(16,185,129,0.15)", color: "#10b981", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Check size={13} /></button>
      <button onClick={onCancel} style={{ width: 26, height: 26, border: "none", borderRadius: 6, background: "rgba(239,68,68,0.12)", color: "#ef4444", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={13} /></button>
    </div>
  );

  const editableCell = (value: string, onEdit: () => void) => (
    <div onClick={onEdit} title="Click to edit" style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "4px 10px", borderRadius: 6, border: "1.5px dashed #9E74D0", background: "rgba(158,116,208,0.07)" }}>
      <span style={{ fontWeight: 600, color: "var(--text)" }}>{value}</span>
      <Pencil size={12} style={{ color: "#9E74D0", flexShrink: 0 }} />
    </div>
  );

  const editableDateCell = (value: string, onEdit: () => void) => (
    <div onClick={onEdit} title="Click to edit" style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "4px 10px", borderRadius: 6, border: "1.5px dashed #9E74D0", background: "rgba(158,116,208,0.07)" }}>
      <CalendarDays size={12} style={{ color: "#9E74D0", flexShrink: 0 }} />
      <span style={{ fontWeight: 600, color: "var(--text)" }}>{formatJoiningDate(value)}</span>
      <Pencil size={12} style={{ color: "#9E74D0", flexShrink: 0 }} />
    </div>
  );

  return (
    <div className="offers">
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Offers</h1>
          <p className="page-sub">
            {loading ? "Loading…" : `${offers.length} offer${offers.length !== 1 ? "s" : ""} · populated when manager approves`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => { refreshAll(); }}
            disabled={loading}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.22)", borderRadius: 9, fontSize: 12, fontWeight: 600, color: "#4f46e5", cursor: "pointer", fontFamily: "inherit", opacity: loading ? 0.6 : 1 }}
          >
            <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* ── Send error banner ── */}
      {sendError && (
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 16px", background:"rgba(220,53,69,0.07)", border:"1px solid rgba(220,53,69,0.2)", borderRadius:10, fontSize:13, color:"#b02030", marginBottom:8 }}>
          <AlertCircle size={15} style={{ flexShrink:0 }} />
          {sendError}
          <button onClick={() => setSendError(null)} style={{ marginLeft:"auto", background:"none", border:"none", cursor:"pointer", color:"#b02030" }}><X size={14}/></button>
        </div>
      )}
      {fetchError && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 10, fontSize: 13, color: "#92400e", marginBottom: 8 }}>
          <AlertCircle size={15} style={{ flexShrink: 0 }} />
          Could not reach Manager Backend (localhost:8001). Start it to see offers.
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && !fetchError && offers.length === 0 && (
        <div style={{ padding: 48, textAlign: "center", color: "#9ca3af", fontSize: 13, background: "#fff", border: "1px solid rgba(221,208,232,0.4)", borderRadius: 14 }}>
          No offers yet. When the manager approves a candidate in the Interviews page, their offer will appear here.
        </div>
      )}

      {/* ── Offers table ── */}
      {offers.length > 0 && (
        <div className="card">
          <div className="table-scroll">
            <table className="offers-table">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Role</th>
                  <th>Compensation Band</th>
                  <th>Joining Date</th>
                  <th>Status</th>
                  <th>Sent</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {offers.map((o, i) => (
                  <tr key={`${o.name}-${i}`}>
                    <td>
                      <div className="cand-cell">
                        <div className="avatar" style={{ background: o.color }}>{o.initials}</div>
                        <div>
                          <span className="cand-name">{o.name}</span>
                          {o.candidate_id && (
                            <div style={{ fontSize: 10, color: "#6366f1", fontWeight: 600, marginTop: 2 }}>✓ Manager Approved</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="role-cell">{o.role}</td>

                    {/* Editable band */}
                    <td>
                      {editingBand === i
                        ? editInput(bandDraft, setBandDraft, () => commitBandEdit(i), () => setEditingBand(null))
                        : editableCell(o.band, () => { setEditingBand(i); setBandDraft(o.band); })}
                    </td>

                    {/* Editable joining date — calendar picker + manual typing via <input type="date"> */}
                    <td>
                      {editingJoiningDate === i
                        ? dateEditInput(joiningDateDraft, setJoiningDateDraft, () => commitJoiningDateEdit(i), () => setEditingJoiningDate(null))
                        : editableDateCell(o.joiningDate, () => { setEditingJoiningDate(i); setJoiningDateDraft(o.joiningDate); })}
                    </td>

                    <td>
                      <span className="status-badge" style={{ background: statusStyle[o.status]?.bg || "rgba(221,208,232,0.3)", color: statusStyle[o.status]?.text || "#9090b0" }}>
                        {o.status}
                      </span>
                    </td>
                    <td className="date-cell">{o.sentDate}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn-outline-sm" onClick={() => setViewOffer(o)}><Eye size={12} /> View</button>
                        {o.status === "Draft" && (
                          <button
                            className="btn-primary-sm"
                            disabled={sending === o.candidate_id}
                            onClick={() => handleSend(o)}
                            style={{ opacity: sending === o.candidate_id ? 0.7 : 1 }}
                          >
                            {sending === o.candidate_id
                              ? <><RefreshCw size={11} style={{ animation:"spin 1s linear infinite" }}/> Sending…</>
                              : <><Send size={12} /> Send</>
                            }
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }`}</style>

      {/* ── Offer Letter Modal ── */}
      {viewOffer && (
        <OfferLetterModal
          offer={viewOffer}
          onClose={() => setViewOffer(null)}
          onSend={(updatedOffer) => {
            handleSend(updatedOffer);
          }}
        />
      )}
    </div>
  );
}
