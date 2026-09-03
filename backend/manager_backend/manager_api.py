"""
Manager Backend API
═══════════════════════════════════════════════════════════════════════════════
Handles the HR → Manager approval flow.

When HR clicks "Review & Approve" on the Feedback page, the frontend calls:
  POST /manager/hr-approve

Lookup strategy for candidate data (tried in order):
  1. interview_details  WHERE candidate_id = <id>        (most common)
  2. interview_details  WHERE _id = ObjectId(<id>)       (if id is a doc _id)
  3. candidates         WHERE _id = ObjectId(<id>)       (raw candidate record)
  4. Frontend-supplied fields in the request body        (offline / fallback)

MongoDB collections used (all in db: hr_recruitment):
  - interview_details   (shared with HR backend — read only here)
  - candidates          (shared with HR backend — read only here)
  - manager_approvals   (owned by manager backend)
  - manager_offers       (owned by manager backend)

Endpoints:
  POST  /manager/hr-approve                              → HR submits approval
  GET   /manager/approved-candidates                     → Manager portal list
  PATCH /manager/approved-candidates/{id}/decision       → Manager approve/reject
  GET   /manager/approved-candidates/{id}                → Single candidate detail
  GET   /manager/health                                  → Health check
  POST  /manager/offers                                  → Save approved candidate as offer
  GET   /manager/offers                                  → List offers
  PATCH /manager/offers/{id}                              → Update band / bonus / doj / status
  POST  /manager/send-offer                               → Generate PDF offer letter + email it
  POST  /manager/send-round-email                         → Send round-scheduling email + Teams link
"""

import os
import logging
import re
import base64
import httpx
from datetime import datetime, timezone, timedelta
from typing import Optional

from bson import ObjectId
from bson.errors import InvalidId
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from database import db, ping_db
from offer_letter_generator import generate_offer_letter_pdf

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("manager_api")

# ── Collections ────────────────────────────────────────────────────────────────
interview_col  = db["interview_details"]   # HR backend writes here
candidates_col = db["candidates"]          # raw candidate profiles — also used for offer-letter enrichment
approvals_col  = db["manager_approvals"]   # owned by manager backend
offers_col     = db["manager_offers"]      # owned by manager backend

# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Manager Backend API",
    description="HR → Manager approval pipeline for the RecruitAI portal",
    version="1.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await ping_db()


# ── Debug: test email endpoint ─────────────────────────────────────────────────
@app.get("/manager/test-email", summary="Test MS Graph email — sends a test mail to SENDER_EMAIL")
async def test_email():
    """
    Quick smoke-test. Tries to get an Azure token and send a test email
    to SENDER_EMAIL itself. Check the manager backend terminal for error details.
    """
    sender = os.getenv("SENDER_EMAIL", SENDER_EMAIL)
    env_check = {
        "AZURE_TENANT_ID":     bool(os.getenv("AZURE_TENANT_ID")),
        "AZURE_CLIENT_ID":     bool(os.getenv("AZURE_CLIENT_ID")),
        "AZURE_CLIENT_SECRET": bool(os.getenv("AZURE_CLIENT_SECRET")),
        "SENDER_EMAIL":        sender or "(not set)",
    }
    try:
        async with httpx.AsyncClient() as http:
            token = await _get_graph_token(http)
            await _send_graph_email(
                http, token, sender,
                "✅ RecruitAI — Manager Email Test",
                "<h2>Email test successful!</h2><p>MS Graph is configured correctly.</p>",
            )
        return {"success": True, "sent_to": sender, "env": env_check}
    except Exception as exc:
        logger.error("test-email failed: %s", exc)
        return {"success": False, "error": str(exc), "env": env_check}


# ══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _safe_id(doc: dict) -> dict:
    """Convert ObjectId / datetime fields to JSON-safe strings recursively."""
    out = {}
    for k, v in doc.items():
        if isinstance(v, ObjectId):
            out[k] = str(v)
        elif isinstance(v, datetime):
            out[k] = v.isoformat()
        elif isinstance(v, dict):
            out[k] = _safe_id(v)
        elif isinstance(v, list):
            out[k] = [_safe_id(i) if isinstance(i, dict) else i for i in v]
        else:
            out[k] = v
    return out


def _try_object_id(value: str) -> Optional[ObjectId]:
    """Return an ObjectId if value is a valid 24-hex string, else None."""
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        return None


async def _resolve_candidate(candidate_id: str) -> Optional[dict]:
    """
    Try multiple strategies to find the candidate record.

    Strategy 1 — interview_details.candidate_id == candidate_id  (string match)
    Strategy 2 — interview_details._id == ObjectId(candidate_id) (doc _id match)
    Strategy 3 — candidates._id == ObjectId(candidate_id)        (raw profile)

    Returns a normalised dict with at minimum:
        name, email, initials, color, role, rounds
    or None if nothing found.
    """
    cid = candidate_id.strip()

    # ── Strategy 1: interview_details keyed by candidate_id field ─────────────
    doc = await interview_col.find_one({"candidate_id": cid})
    if doc:
        logger.info("Resolved via interview_details.candidate_id=%s", cid)
        return doc

    # ── Strategy 2: interview_details keyed by its own _id ────────────────────
    oid = _try_object_id(cid)
    if oid:
        doc = await interview_col.find_one({"_id": oid})
        if doc:
            logger.info("Resolved via interview_details._id=%s", cid)
            return doc

    # ── Strategy 3: raw candidates collection ─────────────────────────────────
    if oid:
        doc = await candidates_col.find_one({"_id": oid})
        if doc:
            logger.info("Resolved via candidates._id=%s", cid)
            # Normalise to the same shape as interview_details
            name = doc.get("name", "")
            return {
                "candidate_id": cid,
                "name":         name,
                "email":        doc.get("email", ""),
                "initials":     doc.get("initials", (name[:1] + name.split()[-1][:1]).upper() if name else "??"),
                "color":        doc.get("color", "#6366f1"),
                "role":         doc.get("role", doc.get("job_title", "")),
                "rounds":       [],
            }

    logger.warning("Could not resolve candidate_id=%s in any collection", cid)
    return None


async def _get_candidate_profile(candidate_id: str) -> dict:
    """
    Best-effort fetch of the full `candidates` collection document for a
    candidate — used to enrich the offer letter with extra fields (skills,
    yoe, position_name, ai_score, etc.) beyond what's stored on the offer
    record itself. Returns {} if nothing is found (never raises).
    """
    cid = candidate_id.strip()

    doc = await candidates_col.find_one({"candidate_id": cid})
    if doc:
        return doc

    oid = _try_object_id(cid)
    if oid:
        doc = await candidates_col.find_one({"_id": oid})
        if doc:
            return doc

    return {}


# ══════════════════════════════════════════════════════════════════════════════
# REQUEST / RESPONSE MODELS
# ══════════════════════════════════════════════════════════════════════════════

class HRApproveRequest(BaseModel):
    """
    Sent by the HR portal when clicking "Review & Approve".

    candidate_id    — backendId from the frontend (= candidate _id string
                      stored as candidate_id in interview_details)
    hr_note         — Optional HR note attached to the approval
    overall_rating  — Computed rating shown on the feedback page
    recommendation  — HR recommendation label  (e.g. "Strong Hire")

    # Fallback fields — used when the candidate cannot be found in MongoDB
    # (e.g. seed data that was never persisted to the DB)
    candidate_name  — Candidate's display name
    candidate_email — Candidate's email address
    initials        — Avatar initials
    color           — Avatar background colour
    role            — Job role / title
    rounds          — Interview rounds array
    """
    candidate_id:     str
    hr_note:          Optional[str]   = ""
    overall_rating:   Optional[float] = None
    recommendation:   Optional[str]   = ""
    manager_email:    Optional[str]   = None   # manager's email — used to send notification

    # Fallback / override fields supplied by the frontend
    candidate_name:   Optional[str]   = None
    candidate_email:  Optional[str]   = None
    initials:         Optional[str]   = None
    color:            Optional[str]   = None
    role:             Optional[str]   = None
    rounds:           Optional[list]  = None


class ManagerDecisionRequest(BaseModel):
    decision: str          # "approved" | "rejected"
    note:     Optional[str] = ""


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINT 1 — HR submits approval
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/manager/hr-approve", summary="HR approves candidate for manager review")
async def hr_approve(body: HRApproveRequest):
    """
    Called when HR clicks "Review & Approve" on the Feedback page.

    Lookup order:
      1. interview_details  WHERE candidate_id = body.candidate_id
      2. interview_details  WHERE _id = ObjectId(body.candidate_id)
      3. candidates         WHERE _id = ObjectId(body.candidate_id)
      4. Use fallback fields from the request body itself

    Creates / updates a manager_approvals document with status = "pending_manager".
    """
    candidate_id = body.candidate_id.strip()
    now = datetime.now(timezone.utc)

    # ── Try to find the candidate in MongoDB ──────────────────────────────────
    iv_doc = await _resolve_candidate(candidate_id)

    if iv_doc:
        # Found in DB — use DB values, allow body overrides for missing fields
        name     = iv_doc.get("name",     "") or body.candidate_name or ""
        email    = iv_doc.get("email",    "") or body.candidate_email or ""
        initials = iv_doc.get("initials", "") or body.initials or ""
        color    = iv_doc.get("color",    "#6366f1") or body.color or "#6366f1"
        role     = iv_doc.get("role",     "") or body.role or ""
        rounds   = iv_doc.get("rounds",   []) or body.rounds or []
    else:
        # ── Strategy 4: fallback — use whatever the frontend sent ─────────────
        logger.warning(
            "Candidate %s not found in MongoDB — using frontend-supplied data",
            candidate_id,
        )

        name     = body.candidate_name  or ""
        email    = body.candidate_email or ""
        initials = body.initials        or (name[:1] + name.split()[-1][:1]).upper() if name else "??"
        color    = body.color           or "#6366f1"
        role     = body.role            or ""
        rounds   = body.rounds          or []

        # If we have absolutely nothing useful, reject the request
        if not name and not email:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"Candidate '{candidate_id}' not found in interview_details or candidates "
                    f"collections. Make sure the HR backend (port 8000) has loaded candidates "
                    f"from MongoDB before approving, or ensure the candidate data has been "
                    f"saved to the database."
                ),
            )

    approval_doc = {
        "candidate_id":       candidate_id,
        "candidate_name":     name,
        "candidate_email":    email,
        "initials":           initials,
        "color":              color,
        "role":               role,
        "rounds":             rounds,
        "overall_rating":     body.overall_rating,
        "recommendation":     body.recommendation,
        "hr_note":            body.hr_note,
        "manager_email":      body.manager_email or "",
        "hr_approved_at":     now,
        "status":             "pending_manager",
        "manager_decision":   None,
        "manager_note":       None,
        "manager_decided_at": None,
        "updated_at":         now,
    }

    # Upsert — one record per candidate
    await approvals_col.update_one(
        {"candidate_id": candidate_id},
        {"$set": approval_doc},
        upsert=True,
    )

    # Stamp manager_approval back onto interview_details so HR can poll status
    if iv_doc:
        await interview_col.update_one(
            {"candidate_id": candidate_id},
            {"$set": {
                "manager_approval": {
                    "status":         "pending_manager",
                    "hr_approved_at": now,
                },
                "updated_at": now,
            }},
        )

    # ── Send email notification to manager ────────────────────────────────────
    manager_email = body.manager_email or ""
    # Also try to extract from hr_note as fallback (legacy: "... Manager email: foo@bar.com")
    if not manager_email and body.hr_note:
        import re as _re
        _m = _re.search(r"Manager email:\s*(\S+)", body.hr_note or "")
        if _m:
            manager_email = _m.group(1).strip()

    email_sent = False
    email_error_msg = ""
    if manager_email:
        try:
            # ── Compute avg interviewer rating across all completed rounds ────
            rated_rounds = [
                r for r in (rounds or [])
                if r.get("rating") and str(r.get("status", "")).lower() in ("passed", "completed", "failed", "active")
            ]
            if rated_rounds:
                avg_rating = sum(float(r["rating"]) for r in rated_rounds) / len(rated_rounds)
                avg_rating_str = f"{round(avg_rating, 1)} / 5"
            else:
                avg_rating_str = "—"

            # ── AI resume score (sent from frontend as overall_rating when no feedback exists,
            #    or stored as score/ai_score on the candidate doc via iv_doc) ──
            ai_score = None
            if iv_doc:
                ai_score = iv_doc.get("score") or iv_doc.get("ai_score")
            if not ai_score and body.overall_rating:
                # Only use body.overall_rating as ai_score if it looks like a 0-100 value
                if body.overall_rating > 5:
                    ai_score = body.overall_rating
            ai_score_str = f"{int(ai_score)} / 100" if ai_score else "—"

            # ── Build round rows ──────────────────────────────────────────────
            rounds_rows = ""
            for i, r in enumerate(rounds or [], start=1):
                status_raw   = str(r.get("status", "pending"))
                status_label = {
                    "passed":    "✅ Passed",
                    "completed": "✅ Completed",
                    "failed":    "❌ Failed",
                    "active":    "🔵 Active",
                    "scheduled": "📅 Scheduled",
                    "pending":   "⏳ Pending",
                }.get(status_raw.lower(), status_raw.title())

                interviewer = (
                    r.get("interviewer")
                    or r.get("interviewerName")
                    or r.get("interviewer_name")
                    or r.get("interviewerEmail", "")
                    or "TBD"
                )
                date_val     = r.get("date") or r.get("interview_date") or "TBD"
                round_rating = r.get("rating", "")
                rating_str   = f"{round_rating} / 5" if round_rating else "—"

                rounds_rows += f"""
<tr>
  <td style="padding:8px 12px;border-bottom:1px solid #e9edf2;color:#374151;font-weight:600;">Round {i}</td>
  <td style="padding:8px 12px;border-bottom:1px solid #e9edf2;color:#374151;">{interviewer}</td>
  <td style="padding:8px 12px;border-bottom:1px solid #e9edf2;color:#374151;">{date_val}</td>
  <td style="padding:8px 12px;border-bottom:1px solid #e9edf2;">{rating_str}</td>
  <td style="padding:8px 12px;border-bottom:1px solid #e9edf2;">{status_label}</td>
</tr>"""

            body_html = f"""
<div style="font-family:sans-serif;max-width:640px;color:#1e1b4b;">
  <div style="background:linear-gradient(135deg,#6366f1,#818cf8);padding:24px 28px;border-radius:12px 12px 0 0;">
    <h2 style="color:#fff;margin:0;font-size:20px;">👤 Candidate Forwarded for Your Review</h2>
    <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:14px;">
      HR has approved a candidate and requires your managerial decision.
    </p>
  </div>

  <div style="background:#fff;border:1px solid #e9edf2;border-top:none;border-radius:0 0 12px 12px;padding:24px 28px;">

    <!-- Candidate Summary -->
    <div style="background:#f8f7ff;border-left:4px solid #6366f1;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
      <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#4f46e5;">📋 Candidate Summary</p>
      <table style="border-collapse:collapse;font-size:13px;color:#374151;width:100%;">
        <tr>
          <td style="padding:6px 0;width:180px;color:#6b7280;">Name</td>
          <td style="padding:6px 0;"><b>{name}</b></td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#6b7280;">Role</td>
          <td style="padding:6px 0;">{role}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#6b7280;">AI Resume Score</td>
          <td style="padding:6px 0;"><b>{ai_score_str}</b></td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#6b7280;">Avg Interviewer Rating</td>
          <td style="padding:6px 0;"><b>{avg_rating_str}</b></td>
        </tr>
      </table>
    </div>

    <!-- Interview Details -->
    {"" if not rounds_rows else f'''
    <p style="font-size:13px;font-weight:700;color:#374151;margin:0 0 10px;">🗓️ Interview Details</p>
    <table style="border-collapse:collapse;font-size:13px;color:#374151;width:100%;border:1px solid #e9edf2;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#f8faff;">
          <th style="padding:9px 12px;text-align:left;color:#6b7280;font-weight:700;border-bottom:1px solid #e9edf2;">Round</th>
          <th style="padding:9px 12px;text-align:left;color:#6b7280;font-weight:700;border-bottom:1px solid #e9edf2;">Interviewer Name</th>
          <th style="padding:9px 12px;text-align:left;color:#6b7280;font-weight:700;border-bottom:1px solid #e9edf2;">Interview Date</th>
          <th style="padding:9px 12px;text-align:left;color:#6b7280;font-weight:700;border-bottom:1px solid #e9edf2;">Rating by Interviewer</th>
          <th style="padding:9px 12px;text-align:left;color:#6b7280;font-weight:700;border-bottom:1px solid #e9edf2;">Status</th>
        </tr>
      </thead>
      <tbody>{rounds_rows}</tbody>
    </table>
    '''}

    <p style="font-size:13px;color:#374151;margin:24px 0 10px;">
      Please log in to the <b>Manager Portal</b> to approve or reject this candidate.
    </p>
    <a href="http://localhost:3000/manager-portal/interviews"
       style="display:inline-block;padding:11px 24px;background:#6366f1;color:#fff;
              text-decoration:none;border-radius:8px;font-weight:600;font-size:13px;">
      Open Manager Portal →
    </a>

    <p style="font-size:11px;color:#9ca3af;margin-top:20px;">
      This notification was sent from the RecruitAI HR Portal.
    </p>
  </div>
</div>
"""
            async with httpx.AsyncClient() as http_client:
                token = await _get_graph_token(http_client)
                await _send_graph_email(
                    http_client,
                    token,
                    manager_email,
                    f"[Action Required] Candidate Review: {name} — {role}",
                    body_html,
                )
            email_sent = True
            logger.info("✅ Manager notification email sent to %s for candidate '%s'", manager_email, name)
        except Exception as exc:
            email_error_msg = str(exc)
            logger.warning("⚠️  Manager email failed (non-fatal): %s", exc)
    else:
        logger.info("No manager_email provided — skipping notification email for '%s'", name)

    logger.info("HR approved candidate '%s' (%s) for manager review", name, candidate_id)
    logger.debug("rounds sample: %s", (rounds or [{}])[:1])
    return {
        "success":        True,
        "candidate_id":   candidate_id,
        "status":         "pending_manager",
        "email_sent":     email_sent,
        "email_error":    email_error_msg if not email_sent and email_error_msg else None,
        "message":        f"{name or candidate_id} sent to Manager Portal interviews."
                          + (f" Email sent to {manager_email}." if email_sent else
                             f" (Email not sent: {email_error_msg})" if email_error_msg else
                             " (No manager email provided.)"),
    }


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINT 2 — Manager fetches approved candidates
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/manager/approved-candidates", summary="Get all candidates pending manager review")
async def get_approved_candidates(status: Optional[str] = None):
    """
    Returns candidates that HR has approved for manager review.
    Rounds are enriched from live interview_details so the manager
    always sees the current round status, not the stale snapshot.
    """
    query: dict = {}
    if status:
        query["status"] = status
    else:
        query["status"] = {"$in": ["pending_manager", "approved", "rejected"]}

    results = []
    async for doc in approvals_col.find(query).sort("hr_approved_at", -1):
        safe = _safe_id(doc)

        # ── Enrich rounds from live interview_details ──────────────────────────
        candidate_id = safe.get("candidate_id", "")
        if candidate_id:
            iv_doc = await interview_col.find_one({"candidate_id": candidate_id})
            if iv_doc and iv_doc.get("rounds"):
                # Use live rounds from HR backend — these reflect markResult updates
                safe["rounds"] = [
                    {k: (str(v) if hasattr(v, "hex") else v.isoformat() if hasattr(v, "isoformat") else v)
                     for k, v in r.items()}
                    for r in iv_doc["rounds"]
                ]

        results.append(safe)

    return {"candidates": results, "total": len(results)}


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINT 3 — Single candidate detail
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/manager/approved-candidates/{candidate_id}", summary="Get single approved candidate")
async def get_approved_candidate(candidate_id: str):
    doc = await approvals_col.find_one({"candidate_id": candidate_id})
    if not doc:
        raise HTTPException(
            status_code=404,
            detail=f"No approval record found for candidate_id={candidate_id!r}",
        )
    return _safe_id(doc)


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINT 4 — Manager approve / reject
# ══════════════════════════════════════════════════════════════════════════════

@app.patch(
    "/manager/approved-candidates/{candidate_id}/decision",
    summary="Manager approves or rejects a candidate",
)
async def manager_decision(candidate_id: str, body: ManagerDecisionRequest):
    if body.decision not in ("approved", "rejected", "new_round"):
        raise HTTPException(status_code=400, detail="decision must be 'approved', 'rejected', or 'new_round'")

    doc = await approvals_col.find_one({"candidate_id": candidate_id})
    if not doc:
        raise HTTPException(
            status_code=404,
            detail=f"No approval record found for candidate_id={candidate_id!r}",
        )

    now = datetime.now(timezone.utc)

    await approvals_col.update_one(
        {"candidate_id": candidate_id},
        {"$set": {
            "status":             body.decision,
            "manager_decision":   body.decision,
            "manager_note":       body.note,
            "manager_decided_at": now,
            "updated_at":         now,
        }},
    )

    # Reflect decision back to interview_details so HR portal can read it
    await interview_col.update_one(
        {"candidate_id": candidate_id},
        {"$set": {
            "manager_approval.status":             body.decision,
            "manager_approval.manager_decided_at": now,
            "updated_at": now,
        }},
    )

    logger.info("Manager %s candidate %s", body.decision, candidate_id)
    return {
        "success":      True,
        "candidate_id": candidate_id,
        "decision":     body.decision,
        "message":      f"Candidate {doc.get('candidate_name', candidate_id)} has been {body.decision} by manager.",
    }


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINT 5 — Lightweight status poll (used by HR Feedback page)
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/manager/candidate-status/{candidate_id}", summary="Get manager decision status for a candidate")
async def candidate_status(candidate_id: str):
    """
    Lightweight endpoint polled by the HR Feedback page to check
    whether the manager has approved or rejected a candidate.

    Returns:
      candidate_id, status ("pending_manager" | "approved" | "rejected"),
      manager_decision, manager_decided_at
    """
    doc = await approvals_col.find_one(
        {"candidate_id": candidate_id},
        {"candidate_id": 1, "status": 1, "manager_decision": 1, "manager_decided_at": 1},
    )
    if not doc:
        raise HTTPException(
            status_code=404,
            detail=f"No approval record for candidate_id={candidate_id!r}",
        )
    return _safe_id(doc)


@app.get("/manager/candidates-status", summary="Bulk status for multiple candidates")
async def candidates_status_bulk(ids: str):
    """
    Comma-separated candidate_ids, e.g. ?ids=abc123,def456
    Returns a list of { candidate_id, status, manager_decision, manager_decided_at }.
    HR Feedback page calls this once on mount to populate the Status column.
    """
    id_list = [i.strip() for i in ids.split(",") if i.strip()]
    if not id_list:
        return {"statuses": []}

    results = []
    async for doc in approvals_col.find(
        {"candidate_id": {"$in": id_list}},
        {"candidate_id": 1, "status": 1, "manager_decision": 1, "manager_decided_at": 1},
    ):
        results.append(_safe_id(doc))

    return {"statuses": results}


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINT 6 — Health check
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/manager/health", summary="Health check")
async def health():
    return {
        "status":    "ok",
        "service":   "manager-backend",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINT 7 — Demo reset: delete all approvals from MongoDB
# ══════════════════════════════════════════════════════════════════════════════

@app.delete("/manager/offers/reset", summary="Demo reset — clears all manager_offers from MongoDB")
async def reset_offers():
    result = await offers_col.delete_many({})
    logger.info("Demo reset: deleted %d offer records", result.deleted_count)
    return {"success": True, "deleted": result.deleted_count}


@app.delete("/manager/reset", summary="Demo reset — clears all manager_approvals from MongoDB")
async def reset_approvals():
    """
    Called when manager or HR clicks Refresh for demo purposes.
    Deletes ALL documents from manager_approvals collection so the
    next fetch returns empty, giving a clean slate.
    """
    result = await approvals_col.delete_many({})
    logger.info("Demo reset: deleted %d approval records", result.deleted_count)
    return {
        "success": True,
        "deleted": result.deleted_count,
        "message": f"Cleared {result.deleted_count} approval record(s). Ready for fresh demo.",
    }


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINT 8 — Offers: save approved candidate as offer
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/manager/offers", summary="Save approved candidate as offer for HR Offers page")
async def create_offer(candidate_id: str):
    """
    Called automatically when manager clicks Approve.
    Creates / upserts an offer record in manager_offers collection.
    """
    doc = await approvals_col.find_one({"candidate_id": candidate_id})
    if not doc:
        raise HTTPException(status_code=404, detail=f"No approval record for {candidate_id!r}")

    now = datetime.now(timezone.utc)
    offer = {
        "candidate_id":    candidate_id,
        "candidate_name":  doc.get("candidate_name", ""),
        "candidate_email": doc.get("candidate_email", ""),
        "initials":        doc.get("initials", ""),
        "color":           doc.get("color", "#6366f1"),
        "role":            doc.get("role", ""),
        "band":            "TBD",
        "bonus":           "TBD",
        "doj":             "TBD",
        "candidate_accepted": None,   # None = pending decision, True = accepted, False = declined
        "status":          "Draft",
        "sent_date":       "—",
        "approved_at":     now,
        "updated_at":      now,
    }
    await offers_col.update_one(
        {"candidate_id": candidate_id},
        {"$set": offer},
        upsert=True,
    )
    logger.info("Offer created for candidate %s", candidate_id)
    return {"success": True, "candidate_id": candidate_id, "message": f"Offer created for {doc.get('candidate_name')}"}


@app.get("/manager/offers", summary="Get all offers for HR Offers page")
async def get_offers():
    """Returns all candidates that were approved by manager, as offer records."""
    results = []
    async for doc in offers_col.find({}).sort("approved_at", -1):
        results.append(_safe_id(doc))
    return {"offers": results, "total": len(results)}


@app.patch("/manager/offers/{candidate_id}", summary="Update offer band, bonus, DOJ, status, or candidate acceptance")
async def update_offer(
    candidate_id: str,
    band: Optional[str] = None,
    bonus: Optional[str] = None,
    status: Optional[str] = None,
    doj: Optional[str] = None,
    joining_date: Optional[str] = None,
    accepted: Optional[str] = None,   # "true" | "false" — whether the candidate accepted the offer
):
    """
    Accepts BOTH `doj` and `joining_date` as the query param name for the
    joining-date value — see the docstring history for why. `accepted`
    is new: pass "true" or "false" (string, since query params are always
    strings) to record whether the candidate has accepted the offer. This
    is what gates candidate-portal login — see /candidates/login and
    /candidates/portal-eligible in candidate_documents_backend.py, which
    now require candidate_accepted == True (not just offer_letter_sent)
    before letting someone log in.
    """
    update: dict = {"updated_at": datetime.now(timezone.utc)}
    if band:                  update["band"]   = band
    if bonus:                 update["bonus"]  = bonus
    if status:                update["status"] = status
    if doj:                   update["doj"]    = doj
    if joining_date:          update["doj"]    = joining_date
    if accepted is not None:
        update["candidate_accepted"] = accepted.strip().lower() == "true"
    result = await offers_col.update_one({"candidate_id": candidate_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=f"No offer for {candidate_id!r}")
    return {"success": True}


@app.get("/manager/offers-status", summary="Bulk offer status (joining date + acceptance) for multiple candidates")
async def offers_status_bulk(ids: str):
    """
    Comma-separated candidate_ids, e.g. ?ids=abc123,def456

    Lightweight companion to /manager/candidates-status, used by the
    Candidate Pipeline page to populate the Joining Date and Candidate
    Acceptance columns without pulling every field from /manager/offers.
    Returns candidate_id, doj, candidate_accepted, status, band per match —
    candidates with no offer record yet simply aren't in the response.
    """
    id_list = [i.strip() for i in ids.split(",") if i.strip()]
    if not id_list:
        return {"offers": []}

    results = []
    async for doc in offers_col.find(
        {"candidate_id": {"$in": id_list}},
        {"candidate_id": 1, "doj": 1, "candidate_accepted": 1, "status": 1, "band": 1},
    ):
        results.append(_safe_id(doc))

    return {"offers": results}


@app.get("/hr/onboarding/accepted-candidates", summary="Candidates who accepted their offer — for HR Onboarding page")
async def get_accepted_candidates():
    """
    Every offer with candidate_accepted == True, shaped for the HR
    Onboarding page's "Accepted Offer Letters" section (the
    AcceptedCandidate type in OnboardingPage.tsx).

    NOTE: `manager` and `team_lead` aren't tracked anywhere in the current
    schema (manager_offers / candidates / interview_details both lack a
    field for "who is this person's future manager/team lead"). Both are
    returned as "" until that data exists somewhere — e.g. by adding a
    `manager`/`team_lead` param to the existing PATCH /manager/offers/{id}
    endpoint, the same way `accepted` was added, and having HR fill it in
    from the Offers page. Flagging this rather than inventing placeholder
    names, since fake data here would be actively misleading on an
    onboarding tracker.
    """
    results = []
    async for offer in offers_col.find({"candidate_accepted": True}).sort("updated_at", -1):
        candidate_id = offer.get("candidate_id", "")
        name = offer.get("candidate_name", "")

        # Dept isn't stored on the offer itself — enrich from the fuller
        # candidates profile where available.
        profile = await _get_candidate_profile(candidate_id)
        dept = profile.get("position_name") or profile.get("dept") or ""

        results.append({
            "candidate_id": candidate_id,
            "name":         name,
            "email":        offer.get("candidate_email", ""),
            "role":         offer.get("role", ""),
            "dept":         dept,
            "joining_date": offer.get("doj") or "TBD",
            "band":         offer.get("band", "TBD"),
            "manager":      offer.get("manager", ""),      # not yet tracked — see docstring
            "team_lead":    offer.get("team_lead", ""),    # not yet tracked — see docstring
            "status":       "Accepted",
            "initials":     offer.get("initials", ""),
            "color":        offer.get("color", "#6366f1"),
        })
    return {"candidates": results}


# ══════════════════════════════════════════════════════════════════════════════
# MS GRAPH HELPERS  (same credentials as HR backend via shared .env)
# ══════════════════════════════════════════════════════════════════════════════

AZURE_TENANT_ID     = os.getenv("AZURE_TENANT_ID", "")
AZURE_CLIENT_ID     = os.getenv("AZURE_CLIENT_ID", "")
AZURE_CLIENT_SECRET = os.getenv("AZURE_CLIENT_SECRET", "")
SENDER_EMAIL        = os.getenv("SENDER_EMAIL", "")


def _graph_token_url() -> str:
    tenant = os.getenv("AZURE_TENANT_ID", AZURE_TENANT_ID)
    if not tenant:
        raise RuntimeError("AZURE_TENANT_ID is not set in .env")
    return f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"


def _graph_send_url() -> str:
    sender = os.getenv("SENDER_EMAIL", SENDER_EMAIL)
    if not sender:
        raise RuntimeError("SENDER_EMAIL is not set in .env")
    return f"https://graph.microsoft.com/v1.0/users/{sender}/sendMail"


async def _get_graph_token(http: httpx.AsyncClient) -> str:
    client_id     = os.getenv("AZURE_CLIENT_ID",     AZURE_CLIENT_ID)
    client_secret = os.getenv("AZURE_CLIENT_SECRET", AZURE_CLIENT_SECRET)
    if not client_id or not client_secret:
        raise RuntimeError("AZURE_CLIENT_ID or AZURE_CLIENT_SECRET is not set in .env")
    resp = await http.post(
        _graph_token_url(),
        data={
            "grant_type":    "client_credentials",
            "client_id":     client_id,
            "client_secret": client_secret,
            "scope":         "https://graph.microsoft.com/.default",
        },
        timeout=15,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Azure token failed [{resp.status_code}]: {resp.text}")
    data = resp.json()
    if "access_token" not in data:
        raise RuntimeError(f"No access_token in Azure response: {data}")
    logger.info("✅ Manager: Azure token obtained")
    return data["access_token"]


async def _send_graph_email(
    http: httpx.AsyncClient,
    token: str,
    to_email: str,
    subject: str,
    body_html: str,
    attachments: Optional[list] = None,
) -> None:
    """
    Send an email via MS Graph. `attachments`, if provided, must be a list
    of Graph fileAttachment dicts, e.g.:
        {
          "@odata.type": "#microsoft.graph.fileAttachment",
          "name": "Offer_Letter.pdf",
          "contentType": "application/pdf",
          "contentBytes": "<base64 string>",
        }
    """
    message: dict = {
        "subject": subject,
        "body": {"contentType": "HTML", "content": body_html},
        "toRecipients": [{"emailAddress": {"address": to_email}}],
    }
    if attachments:
        message["attachments"] = attachments

    resp = await http.post(
        _graph_send_url(),
        json={"message": message, "saveToSentItems": True},
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        timeout=30,
    )
    if resp.status_code not in (200, 202):
        raise RuntimeError(f"sendMail failed [{resp.status_code}] → {to_email}: {resp.text}")
    logger.info("✅ Manager: email sent to %s%s", to_email, " (with attachment)" if attachments else "")


async def _create_teams_meeting(
    http: httpx.AsyncClient,
    token: str,
    candidate_name: str,
    candidate_email: str,
    hr_email: str,
    role: str,
    date_str: str,
    time_str: str,
    duration_min: int,
    round_no: int,
) -> str:
    """Creates a Teams calendar event and returns the joinUrl."""
    # Try multiple date/time formats to be robust
    start_dt = None
    date_clean = (date_str or "").strip()
    time_clean = (time_str or "").strip().upper().replace(".", "").replace(" ", "")

    formats = [
        ("%d %b %Y %I:%M%p",  f"{date_clean} {time_clean}"),
        ("%d %B %Y %I:%M%p",  f"{date_clean} {time_clean}"),
        ("%d-%m-%Y %H:%M",    f"{date_clean} {time_clean}"),
        ("%d %b %Y %H:%M",    f"{date_clean} {time_clean}"),
        ("%d %B %Y %H:%M",    f"{date_clean} {time_clean}"),
        ("%d %b %Y %I:%M %p", f"{date_clean} {time_clean}"),
        ("%d %B %Y %I:%M %p", f"{date_clean} {time_clean}"),
    ]
    for fmt, val in formats:
        try:
            start_dt = datetime.strptime(val, fmt)
            break
        except Exception:
            continue

    if start_dt is None:
        # fallback: 1 hour from now
        start_dt = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1)
        logger.warning("Could not parse date='%s' time='%s', using fallback", date_str, time_str)

    end_dt = start_dt + timedelta(minutes=duration_min)

    try:
        resp = await http.post(
            f"https://graph.microsoft.com/v1.0/users/{SENDER_EMAIL}/events",
            json={
                "subject": f"Managerial Round {round_no} — {role} | {candidate_name}",
                "body": {
                    "contentType": "HTML",
                    "content": f"<p>Managerial round interview for <b>{candidate_name}</b> ({role}).</p>",
                },
                "start": {"dateTime": start_dt.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "Asia/Kolkata"},
                "end":   {"dateTime": end_dt.strftime("%Y-%m-%dT%H:%M:%S"),   "timeZone": "Asia/Kolkata"},
                "attendees": [
                    {"emailAddress": {"address": candidate_email, "name": candidate_name}, "type": "required"},
                    {"emailAddress": {"address": hr_email,        "name": "HR"},            "type": "required"},
                ],
                "isOnlineMeeting": True,
                "onlineMeetingProvider": "teamsForBusiness",
            },
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            timeout=30,
        )
        if resp.status_code >= 400:
            logger.warning("Teams meeting creation failed [%d]: %s", resp.status_code, resp.text[:300])
            return ""
        return resp.json().get("onlineMeeting", {}).get("joinUrl", "")
    except Exception as e:
        logger.warning("Teams meeting exception: %s", e)
        return ""


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINT 9 — Send round email + create Teams meeting
# ══════════════════════════════════════════════════════════════════════════════

class SendRoundEmailRequest(BaseModel):
    candidateEmail:     str
    candidateSubject:   str
    candidateBody:      str
    hrEmail:            str
    hrSubject:          str
    hrBody:             str
    candidateName:      Optional[str] = "Candidate"
    role:               Optional[str] = "Position"
    roundNo:            Optional[int] = 1
    date:               Optional[str] = "TBD"
    time:               Optional[str] = "TBD"
    duration:           Optional[str] = "60 min"
    mode:               Optional[str] = "Video Call"
    candidateId:        Optional[str] = None


@app.post("/manager/send-round-email", summary="Send email to candidate + HR and create Teams meeting")
async def send_round_email(body: SendRoundEmailRequest):
    """
    Called from Manager Interviews → Add Another Round → Send Email.
    1. Creates a Teams meeting via MS Graph
    2. Appends the Teams link to both email bodies
    3. Sends emails to candidate and HR via MS Graph
    4. Returns teamsLink so the frontend can activate the Join Meeting button
    """
    dur_match    = re.search(r"\d+", body.duration or "60")
    duration_min = int(dur_match.group()) if dur_match else 60

    async with httpx.AsyncClient() as http:
        # ── Get Azure token ──────────────────────────────────────────────────
        try:
            token = await _get_graph_token(http)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Azure token failed: {e}")

        # ── Create Teams meeting ─────────────────────────────────────────────
        teams_link = ""
        try:
            teams_link = await _create_teams_meeting(
                http=http, token=token,
                candidate_name=body.candidateName or "Candidate",
                candidate_email=body.candidateEmail,
                hr_email=body.hrEmail,
                role=body.role or "Position",
                date_str=body.date or "TBD",
                time_str=body.time or "TBD",
                duration_min=duration_min,
                round_no=body.roundNo or 1,
            )
        except Exception as e:
            logger.warning("Teams meeting failed (non-fatal): %s", e)

        # ── Build meeting block — ALWAYS inject prominently ─────────────────
        # Strip the frontend placeholder line first
        c_body_clean = body.candidateBody.replace(
            "[The Microsoft Teams meeting link will be included below]", ""
        ).strip()
        h_body_clean = body.hrBody.strip()

        if teams_link:
            meeting_block = f"""
<br><br>
<div style="background:#f0f4ff;border-left:4px solid #6366f1;padding:16px 18px;border-radius:8px;font-family:sans-serif;">
  <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:#4f46e5;">📅 Interview Scheduled</p>
  <table style="border-collapse:collapse;font-size:13px;color:#374151;width:100%;">
    <tr><td style="padding:3px 0;width:110px;color:#6b7280;">Position</td><td style="padding:3px 0;"><b>{body.role}</b></td></tr>
    <tr><td style="padding:3px 0;color:#6b7280;">Round</td><td style="padding:3px 0;">R{body.roundNo} — {body.mode}</td></tr>
    <tr><td style="padding:3px 0;color:#6b7280;">Date</td><td style="padding:3px 0;">{body.date}</td></tr>
    <tr><td style="padding:3px 0;color:#6b7280;">Time</td><td style="padding:3px 0;">{body.time}</td></tr>
    <tr><td style="padding:3px 0;color:#6b7280;">Duration</td><td style="padding:3px 0;">{duration_min} min</td></tr>
    <tr><td style="padding:3px 0;color:#6b7280;">Mode</td><td style="padding:3px 0;">{body.mode}</td></tr>
  </table>
  <br>
  <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#374151;">🔗 Microsoft Teams Meeting Link:</p>
  <a href="{teams_link}" style="display:inline-block;padding:10px 20px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:13px;">Join Meeting on Teams</a>
  <br><br>
  <p style="margin:0;font-size:11px;color:#9ca3af;">Or copy this link: <a href="{teams_link}" style="color:#6366f1;">{teams_link}</a></p>
</div>
"""
        else:
            # Teams creation failed — still show interview details clearly
            meeting_block = f"""
<br><br>
<div style="background:#f9fafb;border-left:4px solid #e5e7eb;padding:16px 18px;border-radius:8px;font-family:sans-serif;">
  <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:#374151;">📅 Interview Details</p>
  <table style="border-collapse:collapse;font-size:13px;color:#374151;width:100%;">
    <tr><td style="padding:3px 0;width:110px;color:#6b7280;">Position</td><td style="padding:3px 0;"><b>{body.role}</b></td></tr>
    <tr><td style="padding:3px 0;color:#6b7280;">Round</td><td style="padding:3px 0;">R{body.roundNo}</td></tr>
    <tr><td style="padding:3px 0;color:#6b7280;">Date</td><td style="padding:3px 0;">{body.date}</td></tr>
    <tr><td style="padding:3px 0;color:#6b7280;">Time</td><td style="padding:3px 0;">{body.time}</td></tr>
    <tr><td style="padding:3px 0;color:#6b7280;">Duration</td><td style="padding:3px 0;">{duration_min} min</td></tr>
    <tr><td style="padding:3px 0;color:#6b7280;">Mode</td><td style="padding:3px 0;">{body.mode}</td></tr>
  </table>
  <p style="margin:10px 0 0;font-size:12px;color:#f59e0b;">⚠️ Meeting link will be shared separately before the interview.</p>
</div>
"""

        candidate_body_html = c_body_clean.replace("\n", "<br>") + meeting_block
        hr_body_html        = h_body_clean.replace("\n", "<br>") + meeting_block

        # ── Send to candidate ────────────────────────────────────────────────
        try:
            await _send_graph_email(http, token, body.candidateEmail, body.candidateSubject, candidate_body_html)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Candidate email failed: {e}")

        # ── Send to HR ───────────────────────────────────────────────────────
        try:
            await _send_graph_email(http, token, body.hrEmail, body.hrSubject, hr_body_html)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"HR email failed: {e}")

    # ── Persist teamsLink on approval record ─────────────────────────────────
    if body.candidateId and teams_link:
        await approvals_col.update_one(
            {"candidate_id": body.candidateId},
            {"$set": {
                "new_round_teams_link": teams_link,
                "updated_at": datetime.now(timezone.utc),
            }},
        )

    logger.info("✅ Round email sent: candidate=%s hr=%s teamsLink=%s",
                body.candidateEmail, body.hrEmail, teams_link or "none")
    return {
        "success":    True,
        "mailSent":   True,
        "teamsLink":  teams_link,
        "message":    f"Emails sent to {body.candidateEmail} and {body.hrEmail}",
    }


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINT 10 — Send offer letter (PDF attachment) to candidate via MS Graph
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/manager/send-offer", summary="Send offer letter (with PDF attachment) to candidate via MS Graph")
async def send_offer(candidate_id: str):
    """
    Called when HR clicks Send on the Offers page.

    1. Fetches offer details (name, email, role, band, bonus, doj) from
       manager_offers, enriched with the fuller MongoDB `candidates` profile
       where useful.
    2. Generates a filled SprintPark offer letter PDF (candidate name, role,
       DOJ, compensation summary) via offer_letter_generator.
    3. Sends the offer email to the candidate via MS Graph with the PDF
       attached.
    4. Updates status to Sent + records sent date and reference number.
    """
    offer = await offers_col.find_one({"candidate_id": candidate_id})
    if not offer:
        raise HTTPException(status_code=404, detail=f"No offer found for {candidate_id!r}")

    name  = offer.get("candidate_name", "Candidate")
    email = offer.get("candidate_email", "")
    role  = offer.get("role", "")
    band  = offer.get("band", "TBD")
    bonus = offer.get("bonus", "TBD")
    doj   = offer.get("doj") or "To be communicated"

    if not email:
        raise HTTPException(status_code=400, detail="Candidate email is missing from offer record")

    # ── Enrich from the fuller candidates collection profile if useful ────────
    candidate_profile = await _get_candidate_profile(candidate_id)
    if not role:
        role = candidate_profile.get("role") or candidate_profile.get("position_name", "")

    now = datetime.now(timezone.utc)
    ref_no = f"SPK/OFR/{now.year}/{candidate_id[-6:].upper()}"
    date_str = now.strftime("%d-%b-%Y")

    # ── Generate the filled offer letter PDF ──────────────────────────────────
    try:
        pdf_bytes = generate_offer_letter_pdf(
            candidate_name=name,
            designation=role,
            doj_str=doj,
            ref_no=ref_no,
            date_str=date_str,
            band=band,
            bonus=bonus,
        )
    except Exception as e:
        logger.exception("Offer letter PDF generation failed")
        raise HTTPException(status_code=500, detail=f"Offer letter PDF generation failed: {e}")

    pdf_b64 = base64.b64encode(pdf_bytes).decode("utf-8")
    attachment = {
        "@odata.type": "#microsoft.graph.fileAttachment",
        "name": f"Offer_Letter_{name.replace(' ', '_')}.pdf",
        "contentType": "application/pdf",
        "contentBytes": pdf_b64,
    }

    subject = f"Offer Letter — {role} at SprintPark Solutions"
    body_html = f"""
<div style="font-family:sans-serif;max-width:600px;color:#1e1b4b;">
  <div style="background:linear-gradient(135deg,#6366f1,#818cf8);padding:24px 28px;border-radius:12px 12px 0 0;">
    <h2 style="color:#fff;margin:0;font-size:20px;">🎉 Congratulations, {name.split()[0]}!</h2>
    <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:14px;">You have received an offer from SprintPark Solutions</p>
  </div>
  <div style="background:#fff;border:1px solid rgba(221,208,232,0.4);border-top:none;border-radius:0 0 12px 12px;padding:24px 28px;">
    <p style="font-size:14px;line-height:1.7;color:#374151;">
      Dear <b>{name}</b>,<br><br>
      We are delighted to extend an offer of employment for the position of <b>{role}</b> at
      <b>SprintPark Solutions Pvt Ltd</b>. Please find your formal offer letter attached as a PDF.
    </p>

    <div style="background:#f8f7ff;border-left:4px solid #6366f1;border-radius:8px;padding:16px 20px;margin:20px 0;">
      <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#4f46e5;">📋 Offer Details</p>
      <table style="border-collapse:collapse;font-size:13px;color:#374151;width:100%;">
        <tr><td style="padding:5px 0;width:150px;color:#6b7280;">Position</td><td style="padding:5px 0;"><b>{role}</b></td></tr>
        <tr><td style="padding:5px 0;color:#6b7280;">Date of Joining</td><td style="padding:5px 0;"><b>{doj}</b></td></tr>
        <tr><td style="padding:5px 0;color:#6b7280;">Compensation Band</td><td style="padding:5px 0;"><b>{band}</b></td></tr>
        <tr><td style="padding:5px 0;color:#6b7280;">Joining Bonus</td><td style="padding:5px 0;"><b>{bonus}</b></td></tr>
        <tr><td style="padding:5px 0;color:#6b7280;">Reference No.</td><td style="padding:5px 0;">{ref_no}</td></tr>
        <tr><td style="padding:5px 0;color:#6b7280;">Company</td><td style="padding:5px 0;">SprintPark Solutions Pvt Ltd</td></tr>
      </table>
    </div>

    <p style="font-size:13px;color:#6b7280;line-height:1.7;">
      Please review the attached offer letter carefully. To accept this offer, kindly sign and return it
      within <b>3 business days</b>. If you have any questions, feel free to reach out to our HR team.
    </p>

    <p style="font-size:13px;color:#374151;">
      We look forward to welcoming you to the team!<br><br>
      Warm regards,<br>
      <b>HR Team — SprintPark Solutions</b>
    </p>
  </div>
  <p style="font-size:11px;color:#9ca3af;text-align:center;margin-top:12px;">
    This offer was sent from the RecruitAI HR Portal
  </p>
</div>
"""

    async with httpx.AsyncClient() as http:
        try:
            token = await _get_graph_token(http)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Azure token failed: {e}")
        try:
            await _send_graph_email(http, token, email, subject, body_html, attachments=[attachment])
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Email send failed: {e}")

    # Update status to Sent + record sent date + reference number
    await offers_col.update_one(
        {"candidate_id": candidate_id},
        {"$set": {
            "status":     "Sent",
            "sent_date":  now.strftime("%d %b %Y"),
            "ref_no":     ref_no,
            "updated_at": now,
        }},
    )
    logger.info("Offer letter PDF sent to %s (%s), ref=%s", name, email, ref_no)
    return {
        "success": True,
        "sent_to": email,
        "ref_no":  ref_no,
        "message": f"Offer letter sent to {name}",
    }


# ── Run ────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("MANAGER_API_PORT", "8001"))
    uvicorn.run("manager_api:app", host="0.0.0.0", port=port, reload=True)


# ══════════════════════════════════════════════════════════════════════════════
# HR ONBOARDING PAGE — accepted candidates
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/hr/onboarding/accepted-candidates", summary="HR Onboarding — candidates who accepted their offer")
async def hr_onboarding_accepted_candidates():
    """
    Returns every candidate whose candidate_accepted flag is True in
    manager_offers, enriched with interview_details (team lead = round-1 interviewer).
    Used by HR Portal Onboarding page Section 1.
    """
    results = []
    async for offer in offers_col.find({"candidate_accepted": True}).sort("updated_at", -1):
        candidate_id = offer.get("candidate_id", "")

        # Enrich with interview_details for team lead
        interview  = await interviews_col.find_one({"candidate_id": candidate_id})
        team_lead  = ""
        if interview:
            rounds = sorted(interview.get("rounds", []), key=lambda r: r.get("roundNo", 99))
            r1 = next((r for r in rounds if r.get("interviewer")), None)
            if r1:
                team_lead = r1.get("interviewer", "")

        name = offer.get("candidate_name", "")
        initials = "".join(p[0] for p in (name or "?").split()[:2]).upper()

        results.append({
            "candidate_id": candidate_id,
            "name":         name,
            "email":        offer.get("candidate_email", ""),
            "role":         offer.get("role", "—"),
            "dept":         offer.get("dept", offer.get("department", "Engineering")),
            "joining_date": offer.get("doj", "TBD"),
            "band":         offer.get("band", "—"),
            "manager":      offer.get("manager_name", "—"),
            "team_lead":    team_lead or "—",
            "status":       offer.get("status", "Accepted"),
            "initials":     initials,
            "color":        offer.get("color", "#6366f1"),
        })

    return {"candidates": results, "total": len(results)}
