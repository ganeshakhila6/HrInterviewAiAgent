"""
HR Recruitment AI Agent - Salesforce + LinkedIn + Interviews Edition
────────────────────────────────────────────────────────────────────
Integrates:
  - Salesforce resume-scoring pipeline
  - LinkedIn candidate sourcing pipeline
  - Interviews management (rounds, mail, results, feedback)

MongoDB collections:
  - job_descriptions    (all jobs — Salesforce + LinkedIn sourced)
  - candidates          (resume-scored candidates; also used by interviews)
  - linkedin_profiles   (profiles fetched from LinkedIn search)
  - interview_details   (dedicated interview rounds collection)

    interview_details document shape (ENRICHED):
    {
        candidate_id:   str,
        name:           str,        ← candidate name (from candidates col)
        email:          str,        ← candidate email
        initials:       str,
        color:          str,
        role:           str,        ← role for THIS interview (editable)
        stage:          str,
        rounds: [
            {
                roundNo:          int,
                type:             str,
                date:             str,
                time:             str,
                interviewer:      str,
                interviewerEmail: str,
                duration:         str,
                mode:             str,
                status:           str,
                mailSent:         bool,
                teamsLink:        str,
                feedback: {       ← filled in by POST /interviews/feedback
                    candidate_name, role, round_type, rating, summary,
                    skills, strengths, communication, cultural_fit,
                    adaptability, interviewer_name, interviewer_email,
                    submitted_at
                }
            }
        ],
        created_at:     datetime,
        updated_at:     datetime,
    }

Interview APIs (all prefixed /interviews):
  GET    /interviews                              → list all candidates with rounds
  PATCH  /interviews/{id}/role                   → update role name
  PATCH  /interviews/{id}/round/{roundNo}        → edit/mark result for a round
  POST   /interviews/{id}/round                  → add a new round
  DELETE /interviews/{id}/round/{roundNo}        → delete a pending round
  POST   /interviews/{id}/round/{roundNo}/send-mail → send emails + Teams meeting via MS Graph
  POST   /interviews/feedback                    → save interviewer feedback (from MS Forms via Power Automate)
  POST   /interviews/test-mail                   → smoke-test mail config
"""

import http
import os
import re
import os as _os
from email_validation import is_valid_email
import json
import time
import hashlib
import logging
import requests
import tempfile
from typing import TypedDict, Optional, List, Dict, Any
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from PyPDF2 import PdfReader
from openai import OpenAI
from langgraph.graph import StateGraph, END
from simple_salesforce import Salesforce
from fastapi import APIRouter, FastAPI, HTTPException, Request, Depends
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient, UpdateOne
from pydantic import BaseModel, EmailStr   # ← add EmailStr
from bson import ObjectId
import motor.motor_asyncio
import httpx

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("hr_agent")


# ══════════════════════════════════════════════════════════════════════════════
# SHARED UTILITIES
# ══════════════════════════════════════════════════════════════════════════════

def mongo_to_json(obj: Any) -> Any:
    """Recursively convert MongoDB objects to JSON-safe types."""
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, ObjectId):
        return str(obj)
    if isinstance(obj, dict):
        return {k: mongo_to_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [mongo_to_json(i) for i in obj]
    return obj


def MongoResponse(status_code: int = 200, content: Any = None) -> JSONResponse:
    """JSONResponse that safely serialises datetime and ObjectId from MongoDB."""
    return JSONResponse(status_code=status_code, content=mongo_to_json(content))


# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════

# ── OpenAI / OpenRouter ───────────────────────────────────────────────────────
openai_client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    base_url=os.getenv("OPENAI_BASE_URL", "https://openrouter.ai/api/v1"),
)

# ── Salesforce ────────────────────────────────────────────────────────────────
SF_CLIENT_ID     = os.getenv("SF_CLIENT_ID")
SF_CLIENT_SECRET = os.getenv("SF_CLIENT_SECRET")
SF_INSTANCE_URL  = os.getenv("SF_INSTANCE_URL")

JOB_OFFER = "Quokka__JobOffer__c"
JOB_APP   = "Quokka__JobApplication__c"
POSITION  = "Quokka__Position__c"

# ── MongoDB ────────────────────────────────────────────────────────────────────
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")

mongo_client   = MongoClient(MONGO_URI)
db             = mongo_client["hr_recruitment"]

jd_col              = db["job_descriptions"]
candidates_col      = db["candidates"]
li_col              = db["linkedin_profiles"]
interview_details_col = db["interview_details"]   # ← sync handle (for indexes)

# Async client — used by the interviews router (motor)
async_motor_client = motor.motor_asyncio.AsyncIOMotorClient(MONGO_URI)
async_db           = async_motor_client["hr_recruitment"]
interviews_col     = async_db["interview_details"]  # ← dedicated interview_details collection
async_candidates   = async_db["candidates"]          # ← read-only reference for candidate profile

# Create indexes
jd_col.create_index("job_offer_id",              unique=True, sparse=True)
candidates_col.create_index([("email", 1), ("job_offer_id", 1)])
li_col.create_index("profile_url",               sparse=True)
li_col.create_index([("job_title", 1), ("name", 1)])
interview_details_col.create_index("candidate_id", unique=True, sparse=True)

print("✅ MongoDB connected and indexes created")

# ── Azure / Microsoft Graph ────────────────────────────────────────────────────
AZURE_TENANT_ID     = os.getenv("AZURE_TENANT_ID")
AZURE_CLIENT_ID     = os.getenv("AZURE_CLIENT_ID")
AZURE_CLIENT_SECRET = os.getenv("AZURE_CLIENT_SECRET")
SENDER_EMAIL        = os.getenv("SENDER_EMAIL")
HR_APPROVER_EMAIL   = os.getenv("HR_APPROVER_EMAIL")

required_env_vars = {
    "AZURE_TENANT_ID": AZURE_TENANT_ID,
    "AZURE_CLIENT_ID": AZURE_CLIENT_ID,
    "AZURE_CLIENT_SECRET": AZURE_CLIENT_SECRET,
    "SENDER_EMAIL": SENDER_EMAIL,
    "SF_CLIENT_ID": SF_CLIENT_ID,
    "SF_CLIENT_SECRET": SF_CLIENT_SECRET,
    "SF_INSTANCE_URL": SF_INSTANCE_URL,
}
missing_env_vars = [name for name, value in required_env_vars.items() if not value]
if missing_env_vars:
    logger.warning(
        "Missing environment variables (will be needed for mail/Salesforce flows): %s",
        ", ".join(missing_env_vars),
    )

# ── LinkedIn settings ─────────────────────────────────────────────────────────
LI_MIN_SCORE         = 50
LI_RESULTS_PER_QUERY = 10
LI_JD_MODEL          = "stealth/ox-alpha"
LI_RANKING_MODEL     = "stealth/ox-alpha"
LI_VERBOSE           = True

# ── In-memory fallback ────────────────────────────────────────────────────────
API_KEY = os.getenv("API_KEY")
candidates_store: List[dict] = []


def require_api_key(request: Request):
    """Optional API-key guard."""
    if not API_KEY:
        return True
    provided = (
        request.headers.get("x-api-key")
        or request.headers.get("authorization", "").replace("Bearer ", "", 1)
    )
    if provided != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
    return True


# ══════════════════════════════════════════════════════════════════════════════
# AVATAR HELPERS
# ══════════════════════════════════════════════════════════════════════════════

AVATAR_COLORS = [
    "#8b5cf6", "#2563eb", "#0891b2", "#10b981",
    "#f59e0b", "#ef4444", "#6366f1", "#ec4899",
]

def get_initials(name: str) -> str:
    parts = (name or "").strip().split()
    if len(parts) >= 2:
        return (parts[0][0] + parts[-1][0]).upper()
    if parts:
        return parts[0][:2].upper()
    return "??"

def get_avatar_color(name: str) -> str:
    idx = int(hashlib.md5(name.encode()).hexdigest(), 16) % len(AVATAR_COLORS)
    return AVATAR_COLORS[idx]


# ══════════════════════════════════════════════════════════════════════════════
# FEEDBACK FORM HELPERS
# ══════════════════════════════════════════════════════════════════════════════

FEEDBACK_FORM_BASE_URL = os.getenv(
    "FEEDBACK_FORM_BASE_URL",
    "http://localhost:3000/public-feedback",  # ← update for production
)
FEEDBACK_FORM_CANDIDATE_ID_FIELD = os.getenv("FEEDBACK_FORM_CANDIDATE_ID_FIELD", "")
FEEDBACK_FORM_ROUND_NO_FIELD     = os.getenv("FEEDBACK_FORM_ROUND_NO_FIELD",     "")


def build_feedback_form_link(candidate_id: str, round_no: int) -> str:
    """
    Returns the full URL the interviewer uses to open the custom HTML
    feedback form pre-filled for their candidate + round.
 
    The HTML page reads ?candidate_id=…&round_no=… via URLSearchParams,
    calls GET /interviews/{candidate_id} to pre-fill name/role, then
    POSTs to POST /interviews/feedback on submit.
    """
    return (
        f"{FEEDBACK_FORM_BASE_URL}"
        f"?candidate_id={candidate_id}"
        f"&round_no={round_no}"
    )

# ══════════════════════════════════════════════════════════════════════════════
# MICROSOFT GRAPH HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _graph_token_url() -> str:
    tenant = os.getenv("AZURE_TENANT_ID", AZURE_TENANT_ID)
    if not tenant:
        raise RuntimeError("AZURE_TENANT_ID is not set")
    return f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"


def _graph_send_url() -> str:
    sender = os.getenv("SENDER_EMAIL", SENDER_EMAIL)
    if not sender:
        raise RuntimeError("SENDER_EMAIL is not set")
    return f"https://graph.microsoft.com/v1.0/users/{sender}/sendMail"


# ── Async helpers ─────────────────────────────────────────────────────────────

async def get_graph_token_async(http: httpx.AsyncClient) -> str:
    client_id     = os.getenv("AZURE_CLIENT_ID",     AZURE_CLIENT_ID)
    client_secret = os.getenv("AZURE_CLIENT_SECRET", AZURE_CLIENT_SECRET)

    if not client_id or not client_secret:
        raise RuntimeError("AZURE_CLIENT_ID or AZURE_CLIENT_SECRET is not set")

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
        raise RuntimeError(
            f"Azure token request failed [{resp.status_code}]: {resp.text}"
        )

    data = resp.json()
    if "access_token" not in data:
        raise RuntimeError(f"No access_token in Azure response: {data}")

    logger.info("✅ Azure Graph token obtained")
    return data["access_token"]


async def send_graph_email_async(
    http: httpx.AsyncClient,
    token: str,
    to_email: str,
    subject: str,
    body: str,
) -> None:
    payload = {
        "message": {
            "subject": subject,
            "body": {"contentType": "HTML", "content": body},
            "toRecipients": [{"emailAddress": {"address": to_email}}],
        },
        "saveToSentItems": True,
    }

    resp = await http.post(
        _graph_send_url(),
        json=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type":  "application/json",
        },
        timeout=15,
    )

    if resp.status_code not in (200, 202):
        raise RuntimeError(
            f"Graph sendMail failed [{resp.status_code}] → {to_email!r}: {resp.text}"
        )

    logger.info(f"✅ Email sent to {to_email}")


# ── Teams meeting helper ──────────────────────────────────────────────────────

async def create_teams_meeting_async(
    http: httpx.AsyncClient,
    token: str,
    candidate_name: str,
    candidate_email: str,
    interviewer_email: str,
    role: str,
    interview_date: str,
    interview_time: str,
    duration_minutes: int = 60,
    round_no: int = 1,
) -> dict:
    try:
        start_dt = datetime.strptime(
            f"{interview_date} {interview_time}", "%d-%m-%Y %H:%M"
        )
    except Exception:
        start_dt = datetime.now() + timedelta(hours=1)

    end_dt  = start_dt + timedelta(minutes=duration_minutes)
    subject = f"Round {round_no} — {role} Interview | {candidate_name}"

    event_payload = {
        "subject": subject,
        "body": {
            "contentType": "HTML",
            "content": f"""
            <h2>Interview Invitation — Round {round_no}</h2>
            <p>Dear {candidate_name},</p>
            <p>Your <b>Round {round_no}</b> interview for <b>{role}</b> has been scheduled.</p>
            <table border='1' cellpadding='5'>
                <tr><td><b>Candidate</b></td><td>{candidate_name}</td></tr>
                <tr><td><b>Position</b></td><td>{role}</td></tr>
                <tr><td><b>Date</b></td><td>{interview_date}</td></tr>
                <tr><td><b>Time</b></td><td>{interview_time}</td></tr>
                <tr><td><b>Duration</b></td><td>{duration_minutes} minutes</td></tr>
                <tr><td><b>Round</b></td><td>{round_no}</td></tr>
            </table>
            <p>The Microsoft Teams meeting link is attached to this invitation.</p>
            <p>Regards,<br>HR Team</p>
            """,
        },
        "start": {
            "dateTime": start_dt.strftime("%Y-%m-%dT%H:%M:%S"),
            "timeZone": "Asia/Kolkata",
        },
        "end": {
            "dateTime": end_dt.strftime("%Y-%m-%dT%H:%M:%S"),
            "timeZone": "Asia/Kolkata",
        },
        "attendees": [
            {
                "emailAddress": {"address": candidate_email, "name": candidate_name},
                "type": "required",
            },
            {
                "emailAddress": {"address": interviewer_email, "name": "Interviewer"},
                "type": "required",
            },
        ],
        "isOnlineMeeting": True,
        "onlineMeetingProvider": "teamsForBusiness",
    }

    sender = os.getenv("SENDER_EMAIL", SENDER_EMAIL)
    resp = await http.post(
        f"https://graph.microsoft.com/v1.0/users/{sender}/events",
        json=event_payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type":  "application/json",
        },
        timeout=30,
    )

    if resp.status_code >= 400:
        raise RuntimeError(
            f"Teams event creation failed [{resp.status_code}]: {resp.text}"
        )

    event = resp.json()
    return {
        "event_id":   event["id"],
        "subject":    event["subject"],
        "teams_link": event.get("onlineMeeting", {}).get("joinUrl", ""),
        "event_link": event.get("webLink", ""),
    }


# ── Sync helper ───────────────────────────────────────────────────────────────

def get_ms_graph_token() -> str:
    client_id     = os.getenv("AZURE_CLIENT_ID",     AZURE_CLIENT_ID)
    client_secret = os.getenv("AZURE_CLIENT_SECRET", AZURE_CLIENT_SECRET)

    resp = requests.post(
        _graph_token_url(),
        data={
            "client_id":     client_id,
            "scope":         "https://graph.microsoft.com/.default",
            "client_secret": client_secret,
            "grant_type":    "client_credentials",
        },
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    if "access_token" not in data:
        raise RuntimeError(f"No access_token in sync Azure response: {data}")
    return data["access_token"]


def send_ms_graph_email(subject: str, body: str, recipient: str) -> bool:
    try:
        token   = get_ms_graph_token()
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        payload = {
            "message": {
                "subject": subject,
                "body":    {"contentType": "HTML", "content": body},
                "toRecipients": [{"emailAddress": {"address": recipient}}],
            }
        }
        r = requests.post(_graph_send_url(), headers=headers, json=payload, timeout=15)
        if r.status_code not in (200, 202):
            logger.error(f"Sync sendMail failed [{r.status_code}]: {r.text}")
            return False
        return True
    except Exception as e:
        logger.error(f"Sync email error: {e}")
        return False


# ══════════════════════════════════════════════════════════════════════════════
# INTERVIEWS ROUTER
# ══════════════════════════════════════════════════════════════════════════════

interviews_router = APIRouter(prefix="/interviews", tags=["Interviews"])


# ── Interviews helpers ────────────────────────────────────────────────────────

def to_object_id(id_str: str) -> ObjectId:
    try:
        return ObjectId(id_str)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid id: {id_str!r}")


def serialize(doc: dict) -> dict:
    """Convert MongoDB docs to the frontend shape and ensure avatar metadata exists."""
    doc = dict(doc)
    doc["id"] = str(doc.pop("_id"))

    name = doc.get("name", "")
    if not doc.get("initials"):
        doc["initials"] = get_initials(name)
    if not doc.get("color"):
        doc["color"] = get_avatar_color(name)

    return doc


def next_round_no(rounds: list) -> int:
    return max((r.get("roundNo", 0) for r in rounds), default=0) + 1


def make_default_round(round_no: int = 1, status: str = "active") -> dict:
    return {
        "roundNo":          round_no,
        "type":             "Technical",
        "date":             "",
        "time":             "",
        "interviewer":      "",
        "interviewerEmail": "",
        "duration":         "60 min",
        "mode":             "Video Call",
        "status":           status,
        "mailSent":         False,
        "teamsLink":        "",
        "feedback":         None,   # ← placeholder; filled by POST /interviews/feedback
    }


# ── Helper: fetch interview_details doc by candidate_id, raise 404 if missing ─

async def _get_iv_doc(candidate_id: str) -> dict:
    doc = await interviews_col.find_one({"candidate_id": candidate_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Interview record not found")
    return doc


# ── Helper: build enriched interview_details fields from candidate doc ─────────

def _candidate_profile_fields(cand: dict) -> dict:
    """
    Extract and return the candidate profile fields to be stored
    (or kept up-to-date) inside interview_details.
    """
    name = cand.get("name", "")
    return {
        "name":     name,
        "email":    cand.get("email", ""),
        "initials": cand.get("initials") or get_initials(name),
        "color":    cand.get("color")    or get_avatar_color(name),
        "score":    cand.get("ai_score", cand.get("score", 0)),
        "skills":   cand.get("skills", ""),
        "tags":     cand.get("tags", [s.strip() for s in cand.get("skills", "").split(",") if s.strip()]),
        "yoe":      cand.get("yoe", "N/A"),
        "summary":  cand.get("summary", ""),
        "source":   cand.get("source", "salesforce"),
        "job_offer_id":   cand.get("job_offer_id", ""),
        "job_offer_name": cand.get("job_offer_name", ""),
        "position_name":  cand.get("position_name", ""),
    }


# ── Interviews request bodies ─────────────────────────────────────────────────

class RoleUpdate(BaseModel):
    role: str

class RoundPatch(BaseModel):
    type:             Optional[str]  = None
    date:             Optional[str]  = None
    time:             Optional[str]  = None
    interviewer:      Optional[str]  = None
    interviewerEmail: Optional[str]  = None
    duration:         Optional[str]  = None
    mode:             Optional[str]  = None
    status:           Optional[str]  = None
    mailSent:         Optional[bool] = None
class OfferLetterMailBody(BaseModel):
    candidateEmail: str
    subject:        str
    body:            str   # HTML body — you build this on the frontend or here
class SendMailBody(BaseModel):
    # ── email content ──────────────────────────────────────────────────────────
    candidateEmail:     str
    candidateSubject:   str
    candidateBody:      str
    interviewerEmail:   str
    interviewerSubject: str
    interviewerBody:    str
    # ── round details for Teams meeting ───────────────────────────────────────
    candidateName:    Optional[str] = "Candidate"
    role:             Optional[str] = "Position"
    interviewDate:    Optional[str] = "TBD"
    interviewTime:    Optional[str] = "TBD"
    duration:         Optional[str] = "60 min"
    mode:             Optional[str] = "Video Call"
    interviewer:      Optional[str] = ""


class FeedbackBody(BaseModel):
    """
    Payload posted by the custom HTML feedback form.
    Required: candidate_id, round_no.
    Everything else is filled by the interviewer in the form.
    """
    # --- routing ---
    candidate_id:       str           # MongoDB _id of the candidate
    round_no:           int           # 1-based round number
 
    # --- form fields ---
    candidate_name:     Optional[str] = ""
    role:               Optional[str] = ""
    round_type:         Optional[str] = ""   # "Round 1" | "Round 2" | "Managerial" | "HR"
    rating:             Optional[int] = None  # 1-5
 
    summary:            Optional[str] = ""
    skills:             Optional[str] = ""   # "Skill: N/5, Skill: N/5, …"
    strengths:          Optional[str] = ""
 
    # Star-rated fields stored as "N/5" strings
    communication:      Optional[str] = ""
    cultural_fit:       Optional[str] = ""
    adaptability:       Optional[str] = ""
 
    # Interviewer identity
    interviewer_name:   Optional[str] = ""
    interviewer_email:  Optional[str] = ""
 

# ── API 1: GET /interviews ────────────────────────────────────────────────────

@interviews_router.get("/")
async def get_all_interviews():
    """
    Returns Salesforce candidates enriched with their interview rounds.
    Rounds + full candidate profile are stored in `interview_details`.
    On first access, auto-creates an interview_details doc for each candidate,
    embedding name, email, role, initials, color, score, skills, yoe, summary.
    """
    result = []

    async for cand in async_candidates.find({"source": "salesforce"}):
        cand_id = str(cand["_id"])

        # Build profile fields to embed / keep fresh inside interview_details
        profile_fields = _candidate_profile_fields(cand)
        candidate_role = cand.get("role", "")

        iv_doc = await interviews_col.find_one({"candidate_id": cand_id})

        if iv_doc is None:
            # First time — create a fresh, fully-enriched interview_details record
            default_round = make_default_round(round_no=1, status="active")
            iv_doc = {
                "candidate_id": cand_id,
                # ── enriched candidate profile fields ──────────────────────────
                **profile_fields,
                "role":         candidate_role,
                # ── interview data ─────────────────────────────────────────────
                "rounds":       [default_round],
                "stage":        "Interview",
                "created_at":   datetime.now(timezone.utc),
                "updated_at":   datetime.now(timezone.utc),
            }
            await interviews_col.insert_one(iv_doc)

        else:
            # Doc exists — refresh profile fields + ensure rounds is non-empty
            update_set: dict = {
                **profile_fields,            # keep candidate profile in sync
                "updated_at": datetime.now(timezone.utc),
            }

            if not iv_doc.get("rounds"):
                default_round = make_default_round(round_no=1, status="active")
                update_set["rounds"] = [default_round]
                update_set["stage"]  = "Interview"

            await interviews_col.update_one(
                {"candidate_id": cand_id},
                {"$set": update_set},
            )
            # Re-fetch so iv_doc reflects what's actually in DB
            iv_doc = await interviews_col.find_one({"candidate_id": cand_id})

        # Merge candidate profile + interview details into one response doc
        merged = {
            **serialize(cand),                          # base candidate fields
            "interview_id": str(iv_doc["_id"]),
            "rounds":       iv_doc.get("rounds", []),
            "stage":        iv_doc.get("stage", "Interview"),
            # role: prefer override stored in interview_details, fall back to candidate
            "role":         iv_doc.get("role") or cand.get("role", ""),
            # extra enriched fields stored in interview_details
            "score":        iv_doc.get("score",   cand.get("ai_score", cand.get("score", 0))),
            "skills":       iv_doc.get("skills",  cand.get("skills", "")),
            "tags":         iv_doc.get("tags",    []),
            "yoe":          iv_doc.get("yoe",     cand.get("yoe", "N/A")),
            "summary":      iv_doc.get("summary", cand.get("summary", "")),
            "offer_letter_sent":    iv_doc.get("offer_letter_sent", False),
            "offer_letter_sent_at": iv_doc.get("offer_letter_sent_at"),
        }
        result.append(merged)

    return {"candidates": result}


# ── API 2: PATCH /interviews/{id}/role ───────────────────────────────────────

@interviews_router.patch("/{id}/role")
async def update_role(id: str, body: RoleUpdate):
    """
    Updates the role on the interview_details doc (keyed by candidate_id).
    Upserts in case the doc doesn't exist yet.
    """
    result = await interviews_col.update_one(
        {"candidate_id": id},
        {"$set": {
            "role":       body.role.strip(),
            "updated_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    if result.matched_count == 0 and result.upserted_id is None:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return {"success": True, "role": body.role.strip()}


# ── API 3: PATCH /interviews/{id}/round/{roundNo} ────────────────────────────

@interviews_router.patch("/{id}/round/{round_no}")
async def patch_round(id: str, round_no: int, body: RoundPatch):
    """
    Edit or mark result for a round in interview_details (keyed by candidate_id).
    Interviewer name + email are persisted directly on the round subdocument.
    """
    patch_data = body.model_dump(exclude_none=True)
    if not patch_data:
        raise HTTPException(status_code=400, detail="Nothing to update")

    if "status" in patch_data and patch_data["status"] not in (
        "active", "passed", "failed", "on-hold", "pending"
    ):
        raise HTTPException(status_code=400, detail=f"Invalid status: {patch_data['status']!r}")

    set_doc = {f"rounds.$[r].{key}": val for key, val in patch_data.items()}
    set_doc["updated_at"] = datetime.now(timezone.utc)

    result = await interviews_col.update_one(
        {"candidate_id": id},
        {"$set": set_doc},
        array_filters=[{"r.roundNo": round_no}],
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Interview record not found")

    # Auto-unlock next round when current round is passed
    if body.status == "passed":
        next_no = round_no + 1
        await interviews_col.update_one(
            {"candidate_id": id, "rounds.roundNo": next_no},
            {"$set": {"rounds.$[r].status": "active"}},
            array_filters=[{"r.roundNo": next_no}],
        )

    # Return merged candidate + interview doc
    iv_doc   = await interviews_col.find_one({"candidate_id": id})
    cand_doc = await async_candidates.find_one({"_id": to_object_id(id)})
    if not cand_doc:
        raise HTTPException(status_code=404, detail="Candidate not found")

    return {
        **serialize(cand_doc),
        "interview_id": str(iv_doc["_id"]),
        "rounds":       iv_doc.get("rounds", []),
        "stage":        iv_doc.get("stage", "Interview"),
        "role":         iv_doc.get("role") or cand_doc.get("role", ""),
        "score":        iv_doc.get("score",   cand_doc.get("ai_score", 0)),
        "skills":       iv_doc.get("skills",  cand_doc.get("skills", "")),
        "tags":         iv_doc.get("tags",    []),
        "yoe":          iv_doc.get("yoe",     cand_doc.get("yoe", "N/A")),
        "summary":      iv_doc.get("summary", cand_doc.get("summary", "")),
    }


# ── API 4: POST /interviews/{id}/round ───────────────────────────────────────

@interviews_router.post("/{id}/round")
async def add_round(id: str):
    """Add a new pending round to interview_details (keyed by candidate_id)."""
    iv_doc = await _get_iv_doc(id)

    new_round = make_default_round(
        round_no=next_round_no(iv_doc.get("rounds", [])),
        status="pending",
    )

    await interviews_col.update_one(
        {"candidate_id": id},
        {
            "$push": {"rounds": new_round},
            "$set":  {"updated_at": datetime.now(timezone.utc)},
        },
    )
    return {"success": True, "newRound": new_round}


# ── API 5: DELETE /interviews/{id}/round/{roundNo} ───────────────────────────

@interviews_router.delete("/{id}/round/{round_no}")
async def delete_round(id: str, round_no: int):
    """Delete a pending round from interview_details (keyed by candidate_id)."""
    iv_doc = await _get_iv_doc(id)

    rounds = iv_doc.get("rounds", [])
    target = next((r for r in rounds if r["roundNo"] == round_no), None)
    if not target:
        raise HTTPException(status_code=404, detail=f"Round {round_no} not found")

    if target["status"] != "pending":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete a round with status '{target['status']}'. Only pending rounds can be removed.",
        )

    if len(rounds) <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the only round")

    await interviews_col.update_one(
        {"candidate_id": id},
        {
            "$pull": {"rounds": {"roundNo": round_no}},
            "$set":  {"updated_at": datetime.now(timezone.utc)},
        },
    )

    # Re-number remaining rounds sequentially
    updated = await interviews_col.find_one({"candidate_id": id})
    renumbered = [
        {**r, "roundNo": idx + 1}
        for idx, r in enumerate(sorted(updated["rounds"], key=lambda x: x["roundNo"]))
    ]
    await interviews_col.update_one(
        {"candidate_id": id},
        {"$set": {
            "rounds":     renumbered,
            "updated_at": datetime.now(timezone.utc),
        }},
    )

    return {"success": True, "deletedRoundNo": round_no}


# ── API 6: POST /interviews/{id}/round/{roundNo}/send-mail ───────────────────

@interviews_router.post("/{id}/round/{round_no}/send-mail")
async def send_mail(id: str, round_no: int, body: SendMailBody):
    """
    1. Validate candidate + round exist.
    2. Obtain Azure access token.
    3. Create Microsoft Teams meeting.
    4. Append Teams meeting link to both email bodies.
    5. Append the interviewer feedback form link to the interviewer's email.
    6. Send email to candidate via Microsoft Graph.
    7. Send email to interviewer via Microsoft Graph.
    8. Mark mailSent = True, save teamsLink, and persist interviewer
       name + email back onto the round in interview_details.
    """
    candidate_email   = (body.candidateEmail   or "").strip()
    interviewer_email = (body.interviewerEmail or "").strip()

    if not is_valid_email(candidate_email):
        raise HTTPException(
            status_code=400,
            detail="Candidate email is required and must be a valid email address.",
        )
    if not is_valid_email(interviewer_email):
        raise HTTPException(
            status_code=400,
            detail="Interviewer email is required and must be a valid email address.",
        )

    cand_doc = await async_candidates.find_one({"_id": to_object_id(id)})
    if not cand_doc:
        raise HTTPException(status_code=404, detail="Candidate not found")

    iv_doc = await interviews_col.find_one({"candidate_id": id})
    if not iv_doc:
        raise HTTPException(status_code=404, detail="Interview record not found")

    rounds       = iv_doc.get("rounds", [])
    target_round = next((r for r in rounds if r["roundNo"] == round_no), None)
    if not target_round:
        raise HTTPException(status_code=404, detail=f"Round {round_no} not found")

    candidate_name = (body.candidateName or cand_doc.get("name", "Candidate")).strip()
    role           = (body.role          or iv_doc.get("role") or cand_doc.get("role", "Position")).strip()
    interview_date = (body.interviewDate or target_round.get("date", "TBD")).strip()
    interview_time = (body.interviewTime or target_round.get("time", "TBD")).strip()
    duration_str   = (body.duration      or target_round.get("duration", "60 min")).strip()
    mode           = (body.mode          or target_round.get("mode", "Video Call")).strip()
    interviewer    = (body.interviewer   or target_round.get("interviewer", "")).strip()

    dur_match    = re.search(r"\d+", duration_str)
    duration_min = int(dur_match.group()) if dur_match else 60
    if "hr" in duration_str.lower() and duration_min <= 8:
        duration_min *= 60

    logger.info(
        f"send-mail → candidate={id} round={round_no} | "
        f"role={role!r} date={interview_date} time={interview_time} "
        f"duration={duration_min}min mode={mode!r} | "
        f"to_candidate={candidate_email!r} to_interviewer={interviewer_email!r}"
    )

    async with httpx.AsyncClient() as http:

        try:
            token = await get_graph_token_async(http)
        except Exception as e:
            logger.error(f"Token error: {e}")
            raise HTTPException(status_code=502, detail=f"Azure token failed: {e}")

        teams_info = {}
        teams_link = ""
        try:
            teams_info = await create_teams_meeting_async(
                http=http,
                token=token,
                candidate_name=candidate_name,
                candidate_email=candidate_email,
                interviewer_email=interviewer_email,
                role=role,
                interview_date=interview_date,
                interview_time=interview_time,
                duration_minutes=duration_min,
                round_no=round_no,
            )
            teams_link = teams_info.get("teams_link", "")
            logger.info(f"✅ Teams meeting created: {teams_link}")
        except Exception as e:
            logger.warning(f"⚠️  Teams meeting creation failed (non-fatal): {e}")

        teams_block = ""
        if teams_link:
            teams_block = f"""
<br>
<p><b>🔗 Microsoft Teams Meeting Link:</b><br>
<a href="{teams_link}">{teams_link}</a></p>
<p><b>Meeting Details:</b></p>
<table border='1' cellpadding='5'>
    <tr><td><b>Candidate</b></td><td>{candidate_name}</td></tr>
    <tr><td><b>Role</b></td><td>{role}</td></tr>
    <tr><td><b>Date</b></td><td>{interview_date}</td></tr>
    <tr><td><b>Time</b></td><td>{interview_time}</td></tr>
    <tr><td><b>Duration</b></td><td>{duration_min} minutes</td></tr>
    <tr><td><b>Round</b></td><td>{round_no}</td></tr>
    <tr><td><b>Interviewer</b></td><td>{interviewer}</td></tr>
    <tr><td><b>Mode</b></td><td>{mode}</td></tr>
    <tr><td><b>Candidate ID</b></td><td>{id}</td></tr>
</table>
"""

        feedback_link  = build_feedback_form_link(id, round_no)
        feedback_block = f"""
<br>
<p><b>📝 After the interview, please submit your feedback here:</b><br>

<a href="{feedback_link}">Submit Feedback Form</a></p>
"""

        candidate_body_final   = body.candidateBody   + teams_block
        interviewer_body_final = body.interviewerBody + teams_block + feedback_block

        try:
            await send_graph_email_async(
                http, token,
                to_email=candidate_email,
                subject=body.candidateSubject,
                body=candidate_body_final,
            )
        except Exception as e:
            logger.error(f"Candidate email error: {e}")
            raise HTTPException(status_code=502, detail=f"Candidate email failed: {e}")

        try:
            await send_graph_email_async(
                http, token,
                to_email=interviewer_email,
                subject=body.interviewerSubject,
                body=interviewer_body_final,
            )
        except Exception as e:
            logger.error(f"Interviewer email error: {e}")
            raise HTTPException(status_code=502, detail=f"Interviewer email failed: {e}")

    # ── Persist mailSent + teamsLink + interviewer details on the round ─────────
    await interviews_col.update_one(
        {"candidate_id": id},
        {"$set": {
            "rounds.$[r].mailSent":         True,
            "rounds.$[r].teamsLink":        teams_link,
            # also persist interviewer info so it's readable from interview_details
            "rounds.$[r].interviewer":      interviewer,
            "rounds.$[r].interviewerEmail": interviewer_email,
            "rounds.$[r].date":             interview_date,
            "rounds.$[r].time":             interview_time,
            "rounds.$[r].duration":         f"{duration_min} min",
            "rounds.$[r].mode":             mode,
            "updated_at":                   datetime.now(timezone.utc),
        }},
        array_filters=[{"r.roundNo": round_no}],
    )

    logger.info(f"✅ mailSent=True + teamsLink + interviewer saved for candidate={id} round={round_no}")

    return {
        "success":   True,
        "mailSent":  True,
        "teamsLink": teams_link,
        "feedbackFormLink": feedback_link,
        "eventId":   teams_info.get("event_id", ""),
        "eventLink": teams_info.get("event_link", ""),
        "meetingDetails": {
            "candidate":   candidate_name,
            "role":        role,
            "date":        interview_date,
            "time":        interview_time,
            "duration":    f"{duration_min} min",
            "mode":        mode,
            "interviewer": interviewer,
            "round":       round_no,
        },
    }



@interviews_router.post("/{id}/offer-letter/send")
async def send_offer_letter(id: str, body: OfferLetterMailBody):
    candidate_email = (body.candidateEmail or "").strip()
    if not is_valid_email(candidate_email):
        raise HTTPException(status_code=400, detail="A valid candidate email is required.")
 
    iv_doc = await interviews_col.find_one({"candidate_id": id})
    if not iv_doc:
        raise HTTPException(status_code=404, detail="Interview record not found")
 
    async with httpx.AsyncClient() as http:
        try:
            token = await get_graph_token_async(http)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Azure token failed: {e}")
        try:
            await send_graph_email_async(
                http, token,
                to_email=candidate_email,
                subject=body.subject,
                body=body.body,
            )
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Offer letter email failed: {e}")
 
    now = datetime.now(timezone.utc)
    await interviews_col.update_one(
        {"candidate_id": id},
        {"$set": {
            "offer_letter_sent": True,
            "offer_letter_sent_at": now,
            "updated_at": now,
        }},
    )
 
    logger.info(f"Offer letter sent + persisted for candidate={id}")
    return {"success": True, "offer_letter_sent": True, "offer_letter_sent_at": now.isoformat()}
# ── API 7: POST /interviews/feedback ──────────────────────────────────────────

@interviews_router.post("/feedback")

async def submit_feedback(body: FeedbackBody):
    """
    Saves interviewer feedback from the custom HTML form into:
        interview_details.rounds[roundNo - 1].feedback
 
    Also keeps interviewer name / email on the round in sync.
 
    Called by:
        POST /interviews/feedback
    """
    # ── Validate inputs ───────────────────────────────────────────────────────
    if not body.candidate_id.strip():
        raise HTTPException(status_code=400, detail="candidate_id must not be empty")
 
    if body.round_no < 1:
        raise HTTPException(status_code=400, detail="round_no must be >= 1")
 
    if body.rating is not None and not (1 <= body.rating <= 5):
        raise HTTPException(status_code=400, detail="rating must be 1–5")
 
    # ── Build feedback document ───────────────────────────────────────────────
    feedback_doc = {
        "candidate_name":    body.candidate_name,
        "role":              body.role,
        "round_type":        body.round_type,
        "rating":            body.rating,
        "summary":           body.summary,
        "skills":            body.skills,          # "Python: 4/5, SQL: 3/5, …"
        "strengths":         body.strengths,
        "communication":     body.communication,   # "4/5"
        "cultural_fit":      body.cultural_fit,    # "3/5"
        "adaptability":      body.adaptability,    # "5/5"
        "interviewer_name":  body.interviewer_name,
        "interviewer_email": body.interviewer_email,
        "submitted_at":      datetime.now(timezone.utc),
    }
 
    # ── Build $set payload ────────────────────────────────────────────────────
    # Save feedback on the round AND keep the interviewer fields fresh
    set_payload: dict = {
        "rounds.$[r].feedback": feedback_doc,
        "updated_at":           datetime.now(timezone.utc),
    }
 
    if body.interviewer_name:
        set_payload["rounds.$[r].interviewer"]      = body.interviewer_name
    if body.interviewer_email:
        set_payload["rounds.$[r].interviewerEmail"] = body.interviewer_email
 
    # ── Persist ───────────────────────────────────────────────────────────────
    result = await interviews_col.update_one(      # interviews_col defined in main file
        {"candidate_id": body.candidate_id},
        {"$set": set_payload},
        array_filters=[{"r.roundNo": body.round_no}],
    )
 
    if result.matched_count == 0:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No interview_details record found for "
                f"candidate_id={body.candidate_id!r}. "
                "Make sure the candidate exists and has been loaded via GET /interviews."
            ),
        )
 
    logger.info(
        "✅ Feedback saved | candidate=%s round=%d rating=%s by=%s",
        body.candidate_id,
        body.round_no,
        body.rating,
        body.interviewer_name or body.interviewer_email or "anonymous",
    )
 
    return {"success": True, "feedback": mongo_to_json(feedback_doc)}  # mongo_to_json defined in main file
 

# ── API 8: POST /interviews/test-mail ────────────────────────────────────────

@interviews_router.post("/test-mail")
async def test_mail_config(to_email: str):
    """
    Smoke-test the mail config without needing a real candidate.
    Call:  POST /interviews/test-mail?to_email=you@example.com
    """
    async with httpx.AsyncClient() as http:
        try:
            token = await get_graph_token_async(http)
        except Exception as e:
            return {"step": "token", "ok": False, "error": str(e)}

        try:
            await send_graph_email_async(
                http, token,
                to_email=to_email,
                subject="HR Agent — Mail Config Test",
                body="<p>If you received this, your MS Graph mail config is working correctly.</p>",
            )
        except Exception as e:
            return {"step": "send", "ok": False, "error": str(e)}

    return {"step": "done", "ok": True, "sent_to": to_email}


# Path to the HTML file.  Place interviewer_feedback_form.html next to hr_agent.py,
# or override via FEEDBACK_FORM_HTML_PATH in your .env.
_FORM_HTML_PATH = _os.getenv(
    "FEEDBACK_FORM_HTML_PATH",
    _os.path.join(_os.path.dirname(__file__), "interviewer_feedback_form.html"),
)
 
 
async def serve_feedback_form(
    candidate_id: str = "",
    round_no: int = 1,
):
    """
    GET /interviews/feedback-form?candidate_id=<id>&round_no=<n>
 
    Serves the custom HTML feedback form. Query params are passed through
    to the browser where the page reads them via URLSearchParams.
    """
    if not _os.path.exists(_FORM_HTML_PATH):
        raise HTTPException(
            status_code=404,
            detail=(
                f"Feedback form HTML not found at {_FORM_HTML_PATH}. "
                "Set FEEDBACK_FORM_HTML_PATH in your .env."
            ),
        )
 
    # Inject the API base URL into the HTML so the form posts to the right place
    api_base = _os.getenv("API_BASE_URL_FOR_FORM", "http://localhost:8000")
 
    with open(_FORM_HTML_PATH, "r", encoding="utf-8") as f:
        html = f.read()
 
    # Inject a small config script before </head> so the HTML page picks up
    # the correct API base URL and optional API key at runtime.
    config_script = f"""
  <script>
    window.FEEDBACK_API_BASE_URL = {repr(api_base)};
    window.FEEDBACK_API_KEY      = {repr(_os.getenv("API_KEY", ""))};
  </script>"""
 
    html = html.replace("</head>", config_script + "\n</head>", 1)
    return HTMLResponse(content=html)
 
 
# ── API 9: GET /interviews/{id} ── fetch single candidate's full interview doc ─

@interviews_router.get("/{id}")
async def get_interview_by_id(id: str):
    """
    Returns the full interview_details document for a single candidate,
    including all rounds with interviewer info + feedback.
    """
    iv_doc = await interviews_col.find_one({"candidate_id": id})
    if not iv_doc:
        raise HTTPException(status_code=404, detail="Interview record not found")

    cand_doc = await async_candidates.find_one({"_id": to_object_id(id)})
    if not cand_doc:
        raise HTTPException(status_code=404, detail="Candidate not found")

    return mongo_to_json({
        **serialize(cand_doc),
        "interview_id":   str(iv_doc["_id"]),
        "rounds":         iv_doc.get("rounds", []),
        "stage":          iv_doc.get("stage", "Interview"),
        "role":           iv_doc.get("role") or cand_doc.get("role", ""),
        "score":          iv_doc.get("score",   cand_doc.get("ai_score", 0)),
        "skills":         iv_doc.get("skills",  cand_doc.get("skills", "")),
        "tags":           iv_doc.get("tags",    []),
        "yoe":            iv_doc.get("yoe",     cand_doc.get("yoe", "N/A")),
        "summary":        iv_doc.get("summary", cand_doc.get("summary", "")),
        "offer_letter_sent":    iv_doc.get("offer_letter_sent", False),
        "offer_letter_sent_at": iv_doc.get("offer_letter_sent_at"),
        "job_offer_id":   iv_doc.get("job_offer_id",   cand_doc.get("job_offer_id", "")),
        "job_offer_name": iv_doc.get("job_offer_name", cand_doc.get("job_offer_name", "")),
        "position_name":  iv_doc.get("position_name",  cand_doc.get("position_name", "")),
        "created_at":     iv_doc.get("created_at"),
        "updated_at":     iv_doc.get("updated_at"),
    })


@interviews_router.get("/{id}/feedback-report")
async def get_feedback_report(id: str):
    """
    Fetches all rounds with feedback from interview_details, sends them
    to GPT-4o for analysis, and returns a structured AI-generated report.
 
    Called by the frontend when the user clicks "View Feedback" on a
    candidate who has at least one completed round with feedback.
    """
    # ── 1. Load interview + candidate docs ────────────────────────────────────
    iv_doc = await interviews_col.find_one({"candidate_id": id})
    if not iv_doc:
        raise HTTPException(status_code=404, detail="Interview record not found")
 
    cand_doc = await async_candidates.find_one({"_id": to_object_id(id)})
    if not cand_doc:
        raise HTTPException(status_code=404, detail="Candidate not found")
 
    candidate_name = iv_doc.get("name") or cand_doc.get("name", "Candidate")
    role           = iv_doc.get("role") or cand_doc.get("role", "Position")
 
    # ── 2. Collect rounds that have feedback ──────────────────────────────────
    rounds_with_feedback = [
        r for r in iv_doc.get("rounds", [])
        if r.get("feedback") and r["feedback"].get("rating")
    ]
 
    if not rounds_with_feedback:
        raise HTTPException(
            status_code=422,
            detail="No completed feedback found for this candidate yet.",
        )
 
    # ── 3. Build the GPT-4o prompt ────────────────────────────────────────────
    feedback_blocks = []
    for r in rounds_with_feedback:
        f = r["feedback"]
        feedback_blocks.append(f"""
Round {r['roundNo']} ({r.get('type', 'Interview')}):
- Rating: {f.get('rating')}/5
- Summary: {f.get('summary', '')}
- Skills assessed: {f.get('skills', '')}
- Strengths: {f.get('strengths', '')}
- Communication: {f.get('communication', 'N/A')}
- Cultural Fit: {f.get('cultural_fit', 'N/A')}
- Adaptability: {f.get('adaptability', 'N/A')}
- Interviewer: {f.get('interviewer_name', r.get('interviewer', 'Unknown'))}
""".strip())
 
    feedback_text = "\n\n".join(feedback_blocks)
 
    prompt = f"""You are an expert HR analyst. Analyze the following interview feedback for {candidate_name} applying for the role of {role}.
 
{feedback_text}
 
Generate a structured JSON report with:
1. "overall_rating": number with 1 decimal (weighted average across rounds)
2. "recommendation": one of "Strong Hire", "Hire", "Hold", "No Hire"
3. "executive_summary": 2-3 sentence overall assessment of fit for the role
4. "top_strengths": array of 3-4 specific strengths as concise phrases
5. "growth_areas": array of 2-3 specific development areas as concise phrases
6. "aggregated_skills": array of {{"skill": str, "avg_score": float}} sorted by avg_score descending, combining all rounds
7. "round_highlights": array of {{"round_no": int, "type": str, "rating": float, "key_insight": str}} — one sentence insight per completed round
8. "hiring_confidence": "High", "Medium", or "Low"
9. "culture_fit_score": float 1-5 (average of all cultural fit ratings)
10. "communication_score": float 1-5 (average of all communication ratings)
 
Return ONLY valid JSON. No markdown fences. No explanation."""
 
    # ── 4. Call AI model ─────────────────────────────────────────────────────
    try:
        response = openai_client.chat.completions.create(
            model="openai/gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert HR analyst that outputs structured JSON reports. Return only valid JSON, no markdown.",
                },
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
            max_tokens=2000,
        )
        report = json.loads(response.choices[0].message.content)
    except Exception as e:
        logger.error(f"GPT-4o feedback analysis failed: {e}")
        raise HTTPException(
            status_code=502,
            detail=f"AI analysis failed: {str(e)}",
        )
 
    # ── 5. Enrich report with live round metadata ─────────────────────────────
    report["candidate_id"]   = id
    report["candidate_name"] = candidate_name
    report["role"]           = role
    report["rounds_reviewed"] = len(rounds_with_feedback)
    report["generated_at"]   = datetime.now(timezone.utc).isoformat()
 
    # Attach per-round interviewer info from live store
    interviewer_map = {
        r["roundNo"]: {
            "interviewer":      r.get("interviewer", ""),
            "interviewer_email": r.get("interviewerEmail", ""),
            "date":             r.get("date", ""),
        }
        for r in rounds_with_feedback
    }
    for h in report.get("round_highlights", []):
        meta = interviewer_map.get(h.get("round_no", 0), {})
        h["interviewer"]  = meta.get("interviewer", "")
        h["date"]         = meta.get("date", "")
 
    logger.info(
        "✅ AI feedback report generated | candidate=%s rounds=%d rec=%s",
        id, len(rounds_with_feedback), report.get("recommendation"),
    )
 
    return MongoResponse(200, content=report)
# ── ADD 1: Helper functions (after existing get_feedback_report) ──────────────

async def build_ai_feedback_report(id: str) -> dict:
    """Shared report builder used by both GET and POST email endpoints."""
    iv_doc = await interviews_col.find_one({"candidate_id": id})
    if not iv_doc:
        raise HTTPException(status_code=404, detail="Interview record not found")

    cand_doc = await async_candidates.find_one({"_id": to_object_id(id)})
    if not cand_doc:
        raise HTTPException(status_code=404, detail="Candidate not found")

    candidate_name = iv_doc.get("name") or cand_doc.get("name", "Candidate")
    role           = iv_doc.get("role") or cand_doc.get("role", "Position")

    rounds_with_feedback = [
        r for r in iv_doc.get("rounds", [])
        if r.get("feedback") and r["feedback"].get("rating")
    ]
    if not rounds_with_feedback:
        raise HTTPException(status_code=422, detail="No completed feedback found for this candidate yet.")

    feedback_blocks = []
    for r in rounds_with_feedback:
        f = r["feedback"]
        feedback_blocks.append(f"""
Round {r['roundNo']} ({r.get('type', 'Interview')}):
- Rating: {f.get('rating')}/5
- Summary: {f.get('summary', '')}
- Skills assessed: {f.get('skills', '')}
- Strengths: {f.get('strengths', '')}
- Communication: {f.get('communication', 'N/A')}
- Cultural Fit: {f.get('cultural_fit', 'N/A')}
- Adaptability: {f.get('adaptability', 'N/A')}
- Interviewer: {f.get('interviewer_name', r.get('interviewer', 'Unknown'))}
""".strip())

    feedback_text = "\n\n".join(feedback_blocks)
    prompt = f"""You are an expert HR analyst. Analyze the following interview feedback for {candidate_name} applying for the role of {role}.

{feedback_text}

Generate a structured JSON report with:
1. "overall_rating": number with 1 decimal (weighted average across rounds)
2. "recommendation": one of "Strong Hire", "Hire", "Hold", "No Hire"
3. "executive_summary": 2-3 sentence overall assessment of fit for the role
4. "top_strengths": array of 3-4 specific strengths as concise phrases
5. "growth_areas": array of 2-3 specific development areas as concise phrases
6. "aggregated_skills": array of {{"skill": str, "avg_score": float}} sorted by avg_score descending
7. "round_highlights": array of {{"round_no": int, "type": str, "rating": float, "key_insight": str}}
8. "hiring_confidence": "High", "Medium", or "Low"
9. "culture_fit_score": float 1-5
10. "communication_score": float 1-5

Return ONLY valid JSON. No markdown fences. No explanation."""

    try:
        response = openai_client.chat.completions.create(
            model="openai/gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are an expert HR analyst that outputs structured JSON reports. Return only valid JSON, no markdown."},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
            max_tokens=2000,
        )
        report = json.loads(response.choices[0].message.content)
    except Exception as e:
        logger.error(f"GPT-4o feedback analysis failed: {e}")
        raise HTTPException(status_code=502, detail=f"AI analysis failed: {str(e)}")

    report["candidate_id"]    = id
    report["candidate_name"]  = candidate_name
    report["role"]            = role
    report["rounds_reviewed"] = len(rounds_with_feedback)
    report["generated_at"]    = datetime.now(timezone.utc).isoformat()

    interviewer_map = {
        r["roundNo"]: {
            "interviewer":       r.get("interviewer", ""),
            "interviewer_email": r.get("interviewerEmail", ""),
            "date":              r.get("date", ""),
        }
        for r in rounds_with_feedback
    }
    for h in report.get("round_highlights", []):
        meta = interviewer_map.get(h.get("round_no", 0), {})
        h["interviewer"] = meta.get("interviewer", "")
        h["date"]        = meta.get("date", "")

    report["_rounds_with_feedback"] = rounds_with_feedback
    return report


# ── ADD 2: Email rendering helpers ────────────────────────────────────────────

class SendFeedbackMailRequest(BaseModel):
    manager_email: EmailStr   # EmailStr already imported via pydantic


def _rating_color(rating) -> str:
    try:
        r = float(rating)
    except (TypeError, ValueError):
        return "#6b7280"
    if r >= 4: return "#16a34a"
    if r >= 3: return "#d97706"
    return "#dc2626"


def _recommendation_color(rec: str) -> str:
    return {
        "Strong Hire": "#16a34a",
        "Hire":        "#2563eb",
        "Hold":        "#d97706",
        "No Hire":     "#dc2626",
    }.get(rec, "#6b7280")


def render_feedback_email_html(report: dict) -> str:
    candidate_name = report.get("candidate_name", "Candidate")
    role           = report.get("role", "")
    rec            = report.get("recommendation", "N/A")
    rec_color      = _recommendation_color(rec)
    confidence     = report.get("hiring_confidence", "N/A")
    exec_summary   = report.get("executive_summary", "")
    strengths      = report.get("top_strengths", [])
    growth_areas   = report.get("growth_areas", [])
    culture_score  = report.get("culture_fit_score", "N/A")
    comm_score     = report.get("communication_score", "N/A")
    rounds         = report.get("_rounds_with_feedback", [])

    # ── Compute avg interviewer rating arithmetically from round feedback ──
    raw_ratings = [
        r["feedback"].get("rating")
        for r in rounds
        if r.get("feedback") and r["feedback"].get("rating") not in (None, 0, "")
    ]
    numeric_ratings = []
    for rv in raw_ratings:
        try:
            numeric_ratings.append(float(rv))
        except (TypeError, ValueError):
            pass
    if numeric_ratings:
        avg_interviewer_rating = round(sum(numeric_ratings) / len(numeric_ratings), 1)
    else:
        avg_interviewer_rating = None

    # Use arithmetic avg as authoritative; fall back to AI overall_rating
    ai_overall = report.get("overall_rating")
    if avg_interviewer_rating is not None:
        overall = avg_interviewer_rating
    elif ai_overall not in (None, 0, "N/A", ""):
        overall = ai_overall
    else:
        overall = "N/A"

    strengths_html = "".join(f"<li style='margin-bottom:4px;'>{s}</li>" for s in strengths)
    growth_html    = "".join(f"<li style='margin-bottom:4px;'>{g}</li>" for g in growth_areas)

    # ── Round-wise interviewer rating summary table ─────────────────────────
    round_summary_rows = ""
    for r in rounds:
        f = r.get("feedback", {})
        r_rating = f.get("rating", "")
        interviewer = f.get("interviewer_name", r.get("interviewer", "Unknown"))
        r_date = r.get("date", "TBD")
        r_type = r.get("type", "Interview")
        r_no   = r.get("roundNo", "")
        try:
            r_float = float(r_rating)
            rating_display = f"{r_float}/5"
            badge_color = _rating_color(r_float)
        except (TypeError, ValueError):
            rating_display = "N/A"
            badge_color = "#6b7280"
        round_summary_rows += f"""
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;">Round {r_no}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;">{r_type}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;">{interviewer}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;">{r_date}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;text-align:center;">
        <span style="background:{badge_color};color:#fff;padding:2px 9px;border-radius:10px;font-size:12px;font-weight:700;">{rating_display}</span>
      </td>
    </tr>"""

    round_summary_table = f"""
<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:22px;">
  <thead>
    <tr style="background:#f3f4f6;">
      <th style="padding:8px 10px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;">Round</th>
      <th style="padding:8px 10px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;">Type</th>
      <th style="padding:8px 10px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;">Interviewer</th>
      <th style="padding:8px 10px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;">Date</th>
      <th style="padding:8px 10px;text-align:center;font-size:12px;color:#6b7280;font-weight:600;">Rating</th>
    </tr>
  </thead>
  <tbody>
    {round_summary_rows}
  </tbody>
</table>"""

    # ── Detailed round blocks ───────────────────────────────────────────────
    rounds_html = ""
    for r in rounds:
        f = r.get("feedback", {})
        rating = f.get("rating", "N/A")
        rounds_html += f"""
<div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:14px;">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
    <span style="font-weight:600;font-size:15px;color:#111827;">Round {r.get('roundNo')} &middot; {r.get('type','Interview')}</span>
    <span style="background:{_rating_color(rating)};color:#fff;padding:2px 10px;border-radius:12px;font-size:13px;font-weight:600;">{rating}/5</span>
  </div>
  <table style="font-size:13px;color:#374151;width:100%;border-collapse:collapse;">
    <tr><td style="padding:3px 0;width:140px;color:#6b7280;">Interviewer</td><td>{f.get('interviewer_name', r.get('interviewer','Unknown'))}</td></tr>
    <tr><td style="padding:3px 0;color:#6b7280;">Date</td><td>{r.get('date','TBD')}</td></tr>
    <tr><td style="padding:3px 0;color:#6b7280;">Summary</td><td>{f.get('summary','')}</td></tr>
    <tr><td style="padding:3px 0;color:#6b7280;">Skills Assessed</td><td>{f.get('skills','')}</td></tr>
    <tr><td style="padding:3px 0;color:#6b7280;">Strengths</td><td>{f.get('strengths','')}</td></tr>
    <tr><td style="padding:3px 0;color:#6b7280;">Communication</td><td>{f.get('communication','N/A')}</td></tr>
    <tr><td style="padding:3px 0;color:#6b7280;">Cultural Fit</td><td>{f.get('cultural_fit','N/A')}</td></tr>
    <tr><td style="padding:3px 0;color:#6b7280;">Adaptability</td><td>{f.get('adaptability','N/A')}</td></tr>
  </table>
</div>"""

    return f"""
<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:680px;margin:0 auto;color:#111827;">
  <h2 style="margin-bottom:2px;">Interview Feedback Report</h2>
  <p style="color:#6b7280;margin-top:0;">{candidate_name} &middot; {role}</p>
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin:18px 0;">
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
      <span style="background:{rec_color};color:#fff;padding:4px 14px;border-radius:14px;font-weight:600;font-size:14px;">{rec}</span>
      <span style="background:#e5e7eb;color:#111827;padding:4px 14px;border-radius:14px;font-size:14px;">Avg Interviewer Rating: {overall}/5</span>
      <span style="background:#e5e7eb;color:#111827;padding:4px 14px;border-radius:14px;font-size:14px;">Confidence: {confidence}</span>
    </div>
    <p style="font-size:14px;line-height:1.6;margin:10px 0;">{exec_summary}</p>
    <table style="width:100%;margin:14px 0;">
      <tr>
        <td style="vertical-align:top;width:50%;padding-right:10px;">
          <strong style="font-size:13px;color:#374151;">Top Strengths</strong>
          <ul style="font-size:13px;padding-left:18px;margin:6px 0;">{strengths_html}</ul>
        </td>
        <td style="vertical-align:top;width:50%;padding-left:10px;">
          <strong style="font-size:13px;color:#374151;">Growth Areas</strong>
          <ul style="font-size:13px;padding-left:18px;margin:6px 0;">{growth_html}</ul>
        </td>
      </tr>
    </table>
    <div style="font-size:13px;color:#374151;">
      Culture Fit Score: <strong>{culture_score}/5</strong> &nbsp;&middot;&nbsp;
      Communication Score: <strong>{comm_score}/5</strong>
    </div>
  </div>
  <h3 style="margin-top:28px;margin-bottom:10px;">Round-wise Interviewer Ratings</h3>
  {round_summary_table}
  <h3 style="margin-top:28px;margin-bottom:10px;">Round-by-Round Feedback</h3>
  {rounds_html}
  <p style="font-size:12px;color:#9ca3af;margin-top:24px;">
    This report was generated automatically based on interviewer feedback submitted for {candidate_name}.
  </p>
</div>"""


# ── ADD 3: New routes (BEFORE app = FastAPI(...)) ─────────────────────────────

# Replace the existing get_feedback_report route with this refactored version:
@interviews_router.get("/{id}/feedback-report")
async def get_feedback_report(id: str):
    report = await build_ai_feedback_report(id)
    report_to_save = {k: v for k, v in report.items() if k != "_rounds_with_feedback"}

    # ── Persist the generated report snapshot into interview_details ──────────
    await interviews_col.update_one(
        {"candidate_id": id},
        {"$set": {
            "last_ai_report": report_to_save,
            "updated_at":     datetime.now(timezone.utc),
        }},
    )

    report.pop("_rounds_with_feedback", None)
    return MongoResponse(200, content=report)


@interviews_router.post("/{id}/send-feedback-mail")
async def send_feedback_mail(id: str, body: SendFeedbackMailRequest):
    report    = await build_ai_feedback_report(id)
    subject   = f"Interview Feedback Report — {report.get('candidate_name')} ({report.get('role')})"
    html_body = render_feedback_email_html(report)

    async with httpx.AsyncClient() as http:
        try:
            token = await get_graph_token_async(http)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Azure token failed: {e}")
        try:
            await send_graph_email_async(http, token, body.manager_email, subject, html_body)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Email send failed: {e}")

    # ── Save report + approval action into interview_details ──────────────────
    report_to_save = {k: v for k, v in report.items() if k != "_rounds_with_feedback"}

    await interviews_col.update_one(
        {"candidate_id": id},
        {"$set": {
            "manager_approval": {
                "approved_at":    datetime.now(timezone.utc).isoformat(),
                "manager_email":  body.manager_email,
                "status":         "approved",
                "rounds_included": report.get("rounds_reviewed"),
            },
            "last_ai_report":  report_to_save,   # ← full AI report snapshot
            "updated_at":      datetime.now(timezone.utc),
        }},
    )

    logger.info("📧 Feedback report emailed + saved | candidate=%s -> %s", id, body.manager_email)

    return MongoResponse(200, content={
        "message":         "Feedback report sent successfully",
        "candidate_id":    id,
        "sent_to":         body.manager_email,
        "rounds_included": report.get("rounds_reviewed"),
    })
# ══════════════════════════════════════════════════════════════════════════════
# LINKEDIN SOURCING PIPELINE
# ══════════════════════════════════════════════════════════════════════════════

def li_analyze_jd(jd_text: str, model: str = LI_JD_MODEL) -> Dict[str, Any]:
    prompt = f"""
You are an expert recruiter and talent researcher.

Analyze this Job Description and return a JSON object with:
1. "keywords"  : 8-10 important job titles or skills for search (comma-separated string)
2. "role"      : short role label (e.g. "ML Engineer")
3. "role_alt"  : 2-3 alternative role titles people might use (comma-separated string)
4. "seniority" : seniority level inferred from JD (e.g. "senior", "mid", "junior", "lead")
5. "exp_min"   : minimum years of experience required (integer, 0 if not mentioned)
6. "exp_max"   : maximum years of experience required (integer, 10 if not mentioned)

Return ONLY valid JSON. No explanation. No markdown.

Job Description:
{jd_text}
"""
    response = openai_client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "You are a helpful assistant that outputs JSON."},
            {"role": "user",   "content": prompt},
        ],
        response_format={"type": "json_object"},
        max_tokens=1500,
    )
    return json.loads(response.choices[0].message.content)


def li_rank_candidates(
    jd_text:         str,
    candidates_list: List[Dict],
    exp_min:         int,
    exp_max:         int,
    location:        str,
    min_score:       int = LI_MIN_SCORE,
    model:           str = LI_RANKING_MODEL,
) -> List[Dict[str, Any]]:
    if not candidates_list:
        return []

    prompt = f"""
You are an expert recruiter.

Score and shortlist these LinkedIn candidates for the Job Description below.

STRICT DISQUALIFICATION RULES:
1. Must be located in {location}.
2. Must be Open to Work (check "Open to Work", "#OpenToWork", "opentowork" in title/snippet).
3. Experience must be between {exp_min} and {exp_max} years.

SCORING:
- Score out of 100 based on JD match.
- Set "Shortlisted": true ONLY if score >= {min_score} AND all 3 rules pass.
- Set "Shortlisted": false otherwise.

Return ONLY valid JSON:
{{
    "ranked_candidates": [
        {{
            "Name": "...",
            "Score": 90,
            "Reasoning": "Brief reason",
            "Shortlisted": true
        }}
    ]
}}

JOB DESCRIPTION:
{jd_text}

CANDIDATES:
{json.dumps(candidates_list, indent=2)}
"""
    response = openai_client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "You are a helpful assistant that outputs JSON."},
            {"role": "user",   "content": prompt},
        ],
        response_format={"type": "json_object"},
        max_tokens=1500,
    )
    result = json.loads(response.choices[0].message.content)
    return result.get("ranked_candidates", [])


def li_search_linkedin_candidates(
    keywords:              str,
    role:                  str,
    role_alt:              str = "",
    seniority:             str = "senior",
    location:              str = "",
    serper_api_key:        str = "",
    num_results_per_query: int = LI_RESULTS_PER_QUERY,
    timeout:               int = 10,
) -> List[Dict[str, str]]:
    candidates = []
    seen_urls  = set()

    kw_list      = [k.strip() for k in keywords.split(",") if k.strip()]
    kw_primary   = " ".join(kw_list[:4])
    kw_secondary = " ".join(kw_list[4:8])

    alt_titles   = [t.strip() for t in role_alt.split(",") if t.strip()]
    alt_role_str = (
        " OR ".join(f'"{t}"' for t in alt_titles[:3])
        if alt_titles else f'"{role}"'
    )

    open_to_work = '("Open to Work" OR "#OpenToWork" OR "opentowork")'

    queries = [
        f'site:linkedin.com/in/ "{role}" "{location}" {open_to_work}',
        f'site:linkedin.com/in/ ({alt_role_str}) "{location}" {open_to_work}',
        f'site:linkedin.com/in/ {kw_primary} "{location}" {open_to_work}',
        f'site:linkedin.com/in/ {kw_secondary} "{location}" {open_to_work}' if kw_secondary else None,
        f'site:linkedin.com/in/ ("{seniority}") "{role}" "{location}" {open_to_work}',
        f'site:linkedin.com/in/ ("senior" OR "lead" OR "staff" OR "principal") {kw_primary} "{location}" {open_to_work}',
    ]
    queries = [q for q in queries if q]

    if LI_VERBOSE:
        print(f"\n🔵 LinkedIn: Running {len(queries)} queries for '{role}' in {location}...")

    for i, query in enumerate(queries, 1):
        try:
            resp = requests.post(
                "https://google.serper.dev/search",
                headers={"X-API-KEY": serper_api_key, "Content-Type": "application/json"},
                json={"q": query, "num": num_results_per_query},
                timeout=timeout,
            )
            new_count = 0
            if resp.status_code == 200:
                for item in resp.json().get("organic", []):
                    link = item.get("link", "")
                    if "linkedin.com/in/" not in link or link in seen_urls:
                        continue
                    name = item.get("title", "").split("-")[0].split("|")[0].strip()
                    candidates.append({
                        "Name":    name,
                        "Source":  "LinkedIn",
                        "Company": "",
                        "Title":   item.get("title", ""),
                        "Snippet": item.get("snippet", ""),
                        "URL":     link,
                    })
                    seen_urls.add(link)
                    new_count += 1

            if LI_VERBOSE:
                print(f"  [Query {i}/{len(queries)}] +{new_count} new | {len(candidates)} total")
            time.sleep(0.8)

        except requests.RequestException as e:
            if LI_VERBOSE:
                print(f"  ⚠️  Query {i} failed: {e}")

    if LI_VERBOSE:
        print(f"✅ LinkedIn: {len(candidates)} unique profiles found")

    return candidates


def li_source_candidates(
    jd_text:               str,
    location:              str  = "",
    min_score:             int  = LI_MIN_SCORE,
    num_results_per_query: int  = LI_RESULTS_PER_QUERY,
    jd_model:              str  = LI_JD_MODEL,
    ranking_model:         str  = LI_RANKING_MODEL,
    verbose:               bool = LI_VERBOSE,
) -> Dict[str, Any]:
    serper_key = os.getenv("SERPER_API_KEY", "")
    if not serper_key:
        raise ValueError("SERPER_API_KEY not configured on server.")

    if verbose:
        print("⚙️  Step 1: Analyzing Job Description...")

    jd_info   = li_analyze_jd(jd_text, model=jd_model)
    keywords  = jd_info.get("keywords", "")
    role      = jd_info.get("role", "Unknown Role")
    role_alt  = jd_info.get("role_alt", "")
    seniority = jd_info.get("seniority", "senior")
    exp_min   = jd_info.get("exp_min", 0)
    exp_max   = jd_info.get("exp_max", 10)

    if verbose:
        print(f"✅ Role: {role} | Seniority: {seniority} | Exp: {exp_min}–{exp_max} yrs")
        print(f"\n⚙️  Step 2: Searching LinkedIn...")

    all_candidates = li_search_linkedin_candidates(
        keywords=keywords, role=role, role_alt=role_alt,
        seniority=seniority, location=location,
        serper_api_key=serper_key,
        num_results_per_query=num_results_per_query,
    )

    if verbose:
        print(f"\n⚙️  Step 3: Scoring {len(all_candidates)} candidates with AI...")

    ranked = li_rank_candidates(
        jd_text=jd_text, candidates_list=all_candidates,
        exp_min=exp_min, exp_max=exp_max, location=location,
        min_score=min_score, model=ranking_model,
    )

    url_map     = {c["Name"]: c["URL"] for c in all_candidates}
    shortlisted = [
        {**c, "Profile URL": url_map.get(c.get("Name", ""), "")}
        for c in ranked
        if c.get("Score", 0) >= min_score and c.get("Shortlisted") is True
    ]
    shortlisted.sort(key=lambda x: x.get("Score", 0), reverse=True)

    if verbose:
        print(f"\n✅ Shortlisted: {len(shortlisted)} candidates (score ≥ {min_score})")

    return {
        "jd_info": {
            "role": role, "role_alt": role_alt, "seniority": seniority,
            "keywords": keywords, "exp_min": exp_min, "exp_max": exp_max, "location": location,
        },
        "linkedin": {
            "all_candidates": all_candidates, "ranked_candidates": ranked,
            "shortlisted":    shortlisted,
            "stats": {
                "profiles_found":       len(all_candidates),
                "profiles_ranked":      len(ranked),
                "profiles_shortlisted": len(shortlisted),
                "queries_run":          6,
            },
        },
    }


# ══════════════════════════════════════════════════════════════════════════════
# SALESFORCE HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def sf_connect():
    resp = requests.post(
        f"{SF_INSTANCE_URL}/services/oauth2/token",
        data={
            "grant_type":    "client_credentials",
            "client_id":     SF_CLIENT_ID,
            "client_secret": SF_CLIENT_SECRET,
        },
    )
    data = resp.json()
    if "access_token" not in data:
        raise Exception(f"Salesforce auth failed: {data}")
    sf = Salesforce(instance_url=data["instance_url"], session_id=data["access_token"])
    return sf, data["access_token"]


def strip_html(html: str) -> str:
    if not html:
        return ""
    html = re.sub(r"<br\s*/?>",  "\n",   html, flags=re.IGNORECASE)
    html = re.sub(r"</p>",       "\n",   html, flags=re.IGNORECASE)
    html = re.sub(r"</li>",      "\n",   html, flags=re.IGNORECASE)
    html = re.sub(r"<li[^>]*>",  "  • ", html, flags=re.IGNORECASE)
    html = re.sub(r"<[^>]+>",    "",     html)
    html = re.sub(r"\n{3,}",     "\n\n", html)
    return html.strip()


def download_resume_bytes(sf, access_token: str, record_id: str):
    links = sf.query(
        f"SELECT ContentDocumentId FROM ContentDocumentLink "
        f"WHERE LinkedEntityId = '{record_id}'"
    )["records"]

    files = []
    for link in links:
        doc_id   = link["ContentDocumentId"]
        versions = sf.query(
            f"SELECT Id, Title, FileExtension, ContentSize "
            f"FROM ContentVersion WHERE ContentDocumentId = '{doc_id}' AND IsLatest = true"
        )["records"]
        if not versions:
            continue
        v   = versions[0]
        vid = v["Id"]
        url = f"{SF_INSTANCE_URL}/services/data/v59.0/sobjects/ContentVersion/{vid}/VersionData"
        r   = requests.get(url, headers={"Authorization": f"Bearer {access_token}"})
        files.append({
            "title":         v["Title"],
            "ext":           v.get("FileExtension", "bin"),
            "content_bytes": r.content,
            "size":          v.get("ContentSize", 0),
        })
    return files


def fetch_salesforce_data():
    sf, token = sf_connect()

    pos_map = {
        p["Id"]: p["Name"]
        for p in sf.query_all(f"SELECT Id, Name FROM {POSITION}")["records"]
    }
    jo_records = sf.query_all(
        f"SELECT Id, Name, Quokka__JobOfferBody__c, Quokka__Position__c FROM {JOB_OFFER}"
    )["records"]
    ja_records = sf.query_all(
        f"SELECT Id, Name, Quokka__JobOffer__c FROM {JOB_APP}"
    )["records"]

    offer_to_apps: dict = {}
    for app in ja_records:
        sf_offer_id = app.get("Quokka__JobOffer__c")
        if sf_offer_id:
            offer_to_apps.setdefault(sf_offer_id, []).append(app)

    result = []
    for jo in jo_records:
        jid    = jo["Id"]
        pos_id = jo.get("Quokka__Position__c")
        apps   = offer_to_apps.get(jid, [])

        app_data = []
        for app in apps:
            resume_files = download_resume_bytes(sf, token, app["Id"])
            app_data.append({
                "app_id":       app["Id"],
                "app_name":     app.get("Name", app["Id"]),
                "resume_files": resume_files,
            })

        result.append({
            "position_id":    pos_id,
            "position_name":  pos_map.get(pos_id, "Unknown Position") if pos_id else "No Position",
            "job_offer_id":   jid,
            "job_offer_name": jo.get("Name", jid),
            "jd_text":        strip_html(jo.get("Quokka__JobOfferBody__c", "")),
            "applications":   app_data,
        })

    return result


# ══════════════════════════════════════════════════════════════════════════════
# PDF HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def extract_text_from_pdf(pdf_path: str) -> str:
    try:
        reader = PdfReader(pdf_path)
        return "".join(page.extract_text() or "" for page in reader.pages)
    except Exception as e:
        print(f"PDF error: {e}")
        return ""


def bytes_to_text(content_bytes: bytes, ext: str) -> str:
    if ext.lower() != "pdf":
        return ""
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        tmp.write(content_bytes)
        tmp_path = tmp.name
    text = extract_text_from_pdf(tmp_path)
    os.unlink(tmp_path)
    return text


# ══════════════════════════════════════════════════════════════════════════════
# LANGGRAPH AGENT
# ══════════════════════════════════════════════════════════════════════════════

class AgentState(TypedDict):
    resume_text:      str
    jd_text:          str
    candidate_name:   Optional[str]
    candidate_email:  Optional[str]
    analysis_summary: Optional[str]
    score:            Optional[int]
    skills:           Optional[str]
    role:             Optional[str]
    years_experience: Optional[str]
    status:           str
    error:            Optional[str]


def analyze_resume_node(state: AgentState) -> AgentState:
    print(f"  🤖 Scoring resume for: {state.get('candidate_name', 'unknown')}...")
    try:
        resume_text = state["resume_text"]
        if not resume_text:
            return {**state, "status": "Error", "error": "Resume text empty"}

        prompt = f"""
Analyze the resume against the job description.

JOB DESCRIPTION:
{state['jd_text']}

RESUME:
{resume_text}

Extract:
1. Candidate Name — usually at the top of the resume. Default: "Unknown Candidate"
2. Candidate Email — any email address. Default: "no-email@unknown.com"
3. Short Summary (1-2 sentences about fit for the role)
4. Matching Score (0-100, score 70+ if there is reasonable skill overlap)
5. Key Skills (comma-separated, max 3-4 skills matching the JD)
6. Role/Position Title (from JD that best matches)
7. Years of Experience (e.g. "5 yrs" — estimate from resume, default "2 yrs" if unclear)

Return ONLY valid JSON:
{{
    "name": "...",
    "email": "...",
    "summary": "...",
    "score": 82,
    "skills": "...",
    "role": "...",
    "years_experience": "..."
}}
"""
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            max_tokens=1500,
        )
        result = json.loads(response.choices[0].message.content)
        score  = int(result.get("score", 0))
        print(f"     ✅ {result.get('name')}  Score: {score}")

        return {
            **state,
            "candidate_name":   result.get("name"),
            "candidate_email":  result.get("email"),
            "analysis_summary": result.get("summary"),
            "score":            score,
            "skills":           result.get("skills", ""),
            "role":             result.get("role", ""),
            "years_experience": result.get("years_experience", "N/A"),
            "status":           "Analyzed",
        }

    except Exception as e:
        return {**state, "status": "Error", "error": str(e)}


workflow = StateGraph(AgentState)
workflow.add_node("analyze", analyze_resume_node)
workflow.set_entry_point("analyze")
workflow.add_edge("analyze", END)
lg_app = workflow.compile()


def score_resume(resume_text: str, jd_text: str) -> dict:
    initial_state: AgentState = {
        "resume_text": resume_text, "jd_text": jd_text,
        "candidate_name": None, "candidate_email": None,
        "analysis_summary": None, "score": None,
        "skills": None, "role": None, "years_experience": None,
        "status": "Started", "error": None,
    }
    return lg_app.invoke(initial_state)


def score_to_stage(score: int) -> str:
    if score >= 90:
        return "Shortlisted"
    elif score >= 80:
        return "Interview"
    return "Screening"


# ══════════════════════════════════════════════════════════════════════════════
# MONGODB SAVE HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def save_job_description(job_doc: dict) -> str:
    job_offer_id = job_doc["job_offer_id"]
    job_doc["updated_at"] = datetime.now(timezone.utc)
    job_doc.setdefault("created_at", datetime.now(timezone.utc))

    jd_col.update_one(
        {"job_offer_id": job_offer_id},
        {"$set": job_doc},
        upsert=True,
    )
    print(f"  💾 job_descriptions ← {job_doc.get('title') or job_doc.get('job_offer_name')} ({job_offer_id})")
    return job_offer_id


def save_candidate(candidate_doc: dict) -> None:
    candidate_doc["updated_at"] = datetime.now(timezone.utc)
    candidate_doc.setdefault("created_at", datetime.now(timezone.utc))

    candidates_col.update_one(
        {
            "email":        candidate_doc.get("email", ""),
            "job_offer_id": candidate_doc.get("job_offer_id", ""),
        },
        {"$set": candidate_doc},
        upsert=True,
    )


def save_candidates_bulk(candidate_docs: List[dict]) -> int:
    if not candidate_docs:
        return 0

    now = datetime.now(timezone.utc)
    ops = []
    for doc in candidate_docs:
        doc["updated_at"] = now
        doc.setdefault("created_at", now)
        ops.append(
            UpdateOne(
                {"email": doc.get("email", ""), "job_offer_id": doc.get("job_offer_id", "")},
                {"$set": doc},
                upsert=True,
            )
        )

    result = candidates_col.bulk_write(ops, ordered=False)
    return result.upserted_count + result.modified_count


def save_linkedin_profiles_bulk(profile_docs: List[dict]) -> int:
    if not profile_docs:
        return 0

    now = datetime.now(timezone.utc)
    ops = []
    for doc in profile_docs:
        doc["updated_at"] = now
        doc.setdefault("created_at", now)
        filter_key = {"profile_url": doc.get("profile_url", doc.get("name", ""))}
        ops.append(UpdateOne(filter_key, {"$set": doc}, upsert=True))

    result = li_col.bulk_write(ops, ordered=False)
    return result.upserted_count + result.modified_count


def save_salesforce_results(output_by_position: dict, score_threshold: int) -> dict:
    now              = datetime.now(timezone.utc)
    total_jds        = total_candidates = 0

    for pos in output_by_position.values():
        for jo in pos["job_offers"]:
            jd_doc = {
                "job_offer_id":      jo["job_offer_id"],
                "job_offer_name":    jo["job_offer_name"],
                "position_id":       pos["position_id"],
                "position_name":     pos["position_name"],
                "title":             jo["job_offer_name"],
                "dept":              pos["position_name"],
                "location":          jo.get("location", ""),
                "experience":        jo.get("experience", ""),
                "status":            "Active",
                "urgent":            False,
                "posted":            jo.get("posted", "Recently"),
                "jd_text":           jo["jd_preview"],
                "total_applicants":  jo["total_applicants"],
                "shortlisted_count": jo["shortlisted_count"],
                "score_threshold":   score_threshold,
                "source":            "salesforce",
                "created_at":        now,
                "updated_at":        now,
            }
            save_job_description(jd_doc)
            total_jds += 1

            cand_docs = [
                {
                    **c,
                    "job_offer_id":   jo["job_offer_id"],
                    "job_offer_name": jo["job_offer_name"],
                    "position_id":    pos["position_id"],
                    "position_name":  pos["position_name"],
                    "source":         "salesforce",
                    "created_at":     now,
                }
                for c in jo["candidates"]
            ]
            saved = save_candidates_bulk(cand_docs)
            total_candidates += saved

    print(f"\n✅ MongoDB saved → job_descriptions: {total_jds}, candidates: {total_candidates}")
    return {"jobs_saved": total_jds, "candidates_saved": total_candidates}


# ══════════════════════════════════════════════════════════════════════════════
# PYDANTIC MODELS
# ══════════════════════════════════════════════════════════════════════════════

class SourceRequest(BaseModel):
    job_title:   str
    department:  str
    location:    str
    experience:  str
    description: str

class SaveProfilesRequest(BaseModel):
    job_title:   str
    location:    str
    candidates:  List[dict]
    shortlisted: List[dict]

class AddJobRequest(BaseModel):
    title:       str
    dept:        str
    location:    str
    experience:  str
    description: str
    status:      str        = "Active"
    urgent:      bool       = False
    posted:      str        = "Just now"
    candidates:  int        = 0
    pipeline:    List[dict] = []


# ══════════════════════════════════════════════════════════════════════════════
# FASTAPI APP
# ══════════════════════════════════════════════════════════════════════════════

app = FastAPI(title="HR Recruitment AI Agent — Salesforce + LinkedIn + Interviews")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(interviews_router, dependencies=[Depends(require_api_key)])

# ── Candidate documents router (portal upload / HR view) ──────────────────────
from candidate_documents_backend import router as candidate_docs_router
app.include_router(candidate_docs_router)

app.get("/interviews/feedback-form", response_class=HTMLResponse)(serve_feedback_form)

# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    try:
        counts = {
            "job_descriptions":  jd_col.count_documents({}),
            "candidates":        candidates_col.count_documents({}),
            "linkedin_profiles": li_col.count_documents({}),
            "interview_details": interview_details_col.count_documents({}),
        }
        return MongoResponse(200, content={"status": "healthy", "db_counts": counts})
    except Exception as e:
        return MongoResponse(500, content={"status": "unhealthy", "error": str(e)})


# ── Salesforce analysis ───────────────────────────────────────────────────────

@app.post("/analyze-salesforce")
async def analyze_salesforce(score_threshold: int = 80):
    try:
        print("\n🔗 Connecting to Salesforce...")
        sf_data = fetch_salesforce_data()
        print(f"✅ Fetched {len(sf_data)} Job Offer(s) from Salesforce\n")

        output_by_position: dict = {}

        for job in sf_data:
            pos_name   = job["position_name"]
            jd_text    = job["jd_text"]
            offer_name = job["job_offer_name"]

            if not jd_text:
                print(f"⚠️  Skipping {offer_name} — no JD text")
                continue

            print(f"\n📄 Job Offer : {offer_name}")
            print(f"🏢 Position  : {pos_name}")
            print(f"📋 Applications: {len(job['applications'])}")

            shortlisted = []

            for app in job["applications"]:
                app_name = app["app_name"]
                files    = app["resume_files"]

                if not files:
                    print(f"  ⚠️  {app_name} — no resume attached")
                    continue

                best_score  = 0
                best_result = None

                for f in files:
                    resume_text = bytes_to_text(f["content_bytes"], f["ext"])
                    if not resume_text:
                        continue
                    final_state = score_resume(resume_text, jd_text)
                    if (
                        final_state.get("status") != "Error"
                        and final_state.get("score", 0) >= best_score
                    ):
                        best_score  = final_state["score"]
                        best_result = final_state

                if best_result and best_score >= score_threshold:
                    cand_name = best_result.get("candidate_name", "")
                    shortlisted.append({
                        "application_id":   app["app_id"],
                        "application_name": app_name,
                        "name":             cand_name,
                        "email":            best_result.get("candidate_email", ""),
                        "initials":         get_initials(cand_name),
                        "color":            get_avatar_color(cand_name),
                        "ai_score":         best_score,
                        "score":            best_score,
                        "stage":            score_to_stage(best_score),
                        "skills":           best_result.get("skills", ""),
                        "tags":             [s.strip() for s in best_result.get("skills", "").split(",") if s.strip()],
                        "yoe":              best_result.get("years_experience", "N/A"),
                        "role":             best_result.get("role", offer_name),
                        "summary":          best_result.get("analysis_summary", ""),
                        "source":           "salesforce",
                    })

            if shortlisted:
                shortlisted.sort(key=lambda x: x["ai_score"], reverse=True)
                if pos_name not in output_by_position:
                    output_by_position[pos_name] = {
                        "position_id":   job["position_id"],
                        "position_name": pos_name,
                        "job_offers":    [],
                    }
                output_by_position[pos_name]["job_offers"].append({
                    "job_offer_id":      job["job_offer_id"],
                    "job_offer_name":    offer_name,
                    "jd_preview":        jd_text[:300] + "..." if len(jd_text) > 300 else jd_text,
                    "total_applicants":  len(job["applications"]),
                    "shortlisted_count": len(shortlisted),
                    "candidates":        shortlisted,
                    "location":          "",
                    "experience":        "",
                    "posted":            "Recently",
                })

        candidates_store.clear()
        for pos in output_by_position.values():
            for jo in pos["job_offers"]:
                candidates_store.extend(jo["candidates"])

        db_stats = save_salesforce_results(output_by_position, score_threshold)

        final_output = {
            "score_threshold":   score_threshold,
            "total_positions":   len(output_by_position),
            "total_shortlisted": len(candidates_store),
            "positions":         list(output_by_position.values()),
            "db_saved":          db_stats,
        }

        with open("salesforce_results.json", "w") as f:
            json.dump(final_output, f, indent=2, default=str)
        print(f"\n💾 Results saved → salesforce_results.json")

        return MongoResponse(200, content=final_output)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return MongoResponse(500, content={"error": str(e)})


# ── Jobs page ─────────────────────────────────────────────────────────────────

@app.get("/jobs-page")
async def get_jobs_page():
    jobs_raw = list(jd_col.find({}, {"_id": 0}))
    result   = []

    for job in jobs_raw:
        job_offer_id = job.get("job_offer_id")
        source       = job.get("source", "salesforce")

        if source == "linkedin":
            pipeline = []
            candidate_count = job.get("total_applicants", 0)
        else:
            pipeline_raw = list(candidates_col.find({"job_offer_id": job_offer_id}, {"_id": 0}))
            pipeline = [
                {
                    "initials": c.get("initials") or get_initials(c.get("name", "")),
                    "color":    c.get("color")    or get_avatar_color(c.get("name", "")),
                    "name":     c.get("name", ""),
                    "score":    c.get("ai_score", c.get("score", 0)),
                    "stage":    c.get("stage", score_to_stage(c.get("ai_score", 0))),
                    "yoe":      c.get("yoe", "N/A"),
                    "tags":     c.get("tags", [s.strip() for s in c.get("skills", "").split(",") if s.strip()]),
                }
                for c in pipeline_raw
            ]
            pipeline.sort(key=lambda x: x.get("score", 0), reverse=True)
            candidate_count = job.get("total_applicants", len(pipeline))

        result.append({
            "title":        job.get("title") or job.get("job_offer_name", ""),
            "dept":         job.get("dept")  or job.get("position_name", ""),
            "location":     job.get("location", ""),
            "candidates":   candidate_count,
            "posted":       job.get("posted", "Recently"),
            "status":       job.get("status", "Active"),
            "urgent":       job.get("urgent", False),
            "experience":   job.get("experience", ""),
            "description":  job.get("jd_text", ""),
            "pipeline":     pipeline,
            "job_offer_id": job_offer_id,
            "position_id":  job.get("position_id", ""),
            "source":       source,
        })

    return MongoResponse(200, content={"total": len(result), "jobs": result})


@app.get("/jobs-page/{job_offer_id}/pipeline")
async def get_job_pipeline(job_offer_id: str):
    job = jd_col.find_one({"job_offer_id": job_offer_id}, {"_id": 0})
    if not job:
        return MongoResponse(404, content={"error": "Job not found"})

    source = job.get("source", "salesforce")

    if source == "linkedin":
        pipeline = job.get("pipeline", [])
    else:
        pipeline_raw = list(candidates_col.find({"job_offer_id": job_offer_id}, {"_id": 0}))
        pipeline = [
            {
                "initials": c.get("initials") or get_initials(c.get("name", "")),
                "color":    c.get("color")    or get_avatar_color(c.get("name", "")),
                "name":     c.get("name", ""),
                "score":    c.get("ai_score", c.get("score", 0)),
                "stage":    c.get("stage", score_to_stage(c.get("ai_score", 0))),
                "yoe":      c.get("yoe", "N/A"),
                "tags":     c.get("tags", [s.strip() for s in c.get("skills", "").split(",") if s.strip()]),
            }
            for c in pipeline_raw
        ]

    pipeline.sort(key=lambda x: x.get("score", 0), reverse=True)

    return MongoResponse(200, content={
        "job_offer_id": job_offer_id,
        "title":        job.get("title") or job.get("job_offer_name", ""),
        "total":        len(pipeline),
        "pipeline":     pipeline,
    })


# ── LinkedIn endpoints ────────────────────────────────────────────────────────

@app.post("/source-candidates")
async def source_candidates_route(req: SourceRequest):
    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured.")
    if not os.getenv("SERPER_API_KEY"):
        raise HTTPException(status_code=500, detail="SERPER_API_KEY not configured.")

    jd_text = (
        f"Job Title: {req.job_title}\nDepartment: {req.department}\n"
        f"Location: {req.location}\nExperience: {req.experience}\n\n{req.description}"
    ).strip()

    try:
        results = li_source_candidates(jd_text=jd_text, location=req.location)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return MongoResponse(200, content=results)


@app.post("/save-linkedin-profiles")
async def save_linkedin_profiles(req: SaveProfilesRequest):
    shortlist_map: dict = {s.get("Name", ""): s for s in req.shortlisted}
    now_ts = int(time.time())

    docs = []
    for c in req.candidates:
        name  = c.get("Name", "")
        short = shortlist_map.get(name, {})
        docs.append({
            "job_title":   req.job_title,
            "location":    req.location,
            "fetched_at":  now_ts,
            "name":        name,
            "source":      c.get("Source", "LinkedIn"),
            "title":       c.get("Title", ""),
            "snippet":     c.get("Snippet", ""),
            "profile_url": c.get("URL", ""),
            "score":       short.get("Score"),
            "reasoning":   short.get("Reasoning"),
            "shortlisted": bool(short),
            "initials":    get_initials(name),
            "color":       get_avatar_color(name),
        })

    saved = save_linkedin_profiles_bulk(docs)
    print(f"💾 linkedin_profiles ← {saved} upserted (of {len(docs)} total)")

    return MongoResponse(200, content={
        "saved":       len(docs),
        "upserted":    saved,
        "shortlisted": len(req.shortlisted),
    })


@app.post("/jobs")
async def add_linkedin_job(req: AddJobRequest):
    job_offer_id = hashlib.md5(f"{req.title}-{time.time()}".encode()).hexdigest()

    jd_doc = {
        "job_offer_id":     job_offer_id,
        "job_offer_name":   req.title,
        "title":            req.title,
        "dept":             req.dept,
        "location":         req.location,
        "experience":       req.experience,
        "jd_text":          req.description,
        "description":      req.description,
        "status":           req.status,
        "urgent":           req.urgent,
        "posted":           req.posted,
        "total_applicants": req.candidates,
        "pipeline":         req.pipeline,
        "source":           "linkedin",
    }

    save_job_description(jd_doc)

    if req.pipeline:
        cand_docs = [
            {
                **p,
                "job_offer_id":   job_offer_id,
                "job_offer_name": req.title,
                "source":         "linkedin",
                "email":          p.get("email", f"linkedin_{p.get('name','unknown').replace(' ','_').lower()}@sourced"),
            }
            for p in req.pipeline
        ]
        saved = save_candidates_bulk(cand_docs)
        print(f"💾 candidates (LinkedIn pipeline) ← {saved} upserted")

    return MongoResponse(200, content={
        "job_offer_id": job_offer_id,
        "message":      "LinkedIn job created and saved to MongoDB.",
    })


# ── Candidate endpoints ───────────────────────────────────────────────────────

@app.get("/jobs")
async def get_jobs():
    jobs = list(jd_col.find({}, {"_id": 0}))
    return MongoResponse(200, content={"total": len(jobs), "jobs": jobs})


@app.get("/jobs/{job_offer_id}/candidates")
async def get_candidates_by_job(job_offer_id: str):
    job = jd_col.find_one({"job_offer_id": job_offer_id}, {"_id": 0})
    if not job:
        return MongoResponse(404, content={"error": "Job not found"})

    sf_candidates = list(candidates_col.find({"job_offer_id": job_offer_id}, {"_id": 0}))
    li_candidates = list(li_col.find(
        {"job_title": job.get("title", ""), "shortlisted": True}, {"_id": 0}
    ))

    all_candidates = sf_candidates + li_candidates
    return MongoResponse(200, content={
        "job": job, "candidates": all_candidates, "total": len(all_candidates),
    })


@app.get("/candidates")
async def get_candidates(min_score: int = 80):
    all_candidates = list(
        candidates_col.find(
            {"ai_score": {"$gte": min_score}, "source": "salesforce"},
            {"_id": 0},
        ).sort("ai_score", -1)
    )

    if not all_candidates and candidates_store:
        all_candidates = sorted(
            [c for c in candidates_store
             if c.get("ai_score", 0) >= min_score and c.get("source") == "salesforce"],
            key=lambda x: x.get("ai_score", 0),
            reverse=True,
        )

    return MongoResponse(200, content={
        "total":           len(all_candidates),
        "active_pipeline": len(all_candidates),
        "candidates":      all_candidates,
    })


@app.post("/candidates/send-email")
async def send_email(candidate_email: str):
    # Validate email format first
    from email_validation import is_valid_email
    if not is_valid_email(candidate_email):
        return MongoResponse(400, content={"error": "Invalid email address format."})

    candidate = candidates_col.find_one({"email": candidate_email}, {"_id": 0})
    if not candidate:
        candidate = next(
            (c for c in candidates_store if c.get("email") == candidate_email), None
        )
    if not candidate:
        return MongoResponse(404, content={"error": "Candidate not found"})

    name    = candidate["name"]
    role    = candidate["role"]
    score   = candidate.get("ai_score", candidate.get("score", 0))
    skills  = candidate.get("skills", "")
    summary = candidate.get("summary", "")

    c_body = f"""
<h2>Dear {name},</h2>
<p>We have reviewed your application for <b>{role}</b>.</p>
<p>Your profile has been <b>shortlisted</b> by our HR team.</p>
<p><b>AI Match Score:</b> {score}/100</p>
<p><b>Key Skills:</b> {skills}</p>
<p>Our team will contact you soon with next steps.</p>
<br><p>Best Regards,<br><b>HR Recruitment Team</b></p>
"""
    hr_body = f"""
<h2>Shortlisted Candidate</h2>
<table border="1" cellpadding="8">
<tr><td><b>Name</b></td><td>{name}</td></tr>
<tr><td><b>Email</b></td><td>{candidate_email}</td></tr>
<tr><td><b>Role</b></td><td>{role}</td></tr>
<tr><td><b>AI Score</b></td><td>{score}/100</td></tr>
<tr><td><b>Skills</b></td><td>{skills}</td></tr>
<tr><td><b>Summary</b></td><td>{summary}</td></tr>
</table>
"""
    c_sent  = send_ms_graph_email(f"Application Update - {role}", c_body, candidate_email)
    hr_sent = send_ms_graph_email(f"Shortlisted: {name} | {role}", hr_body, HR_APPROVER_EMAIL)

    return MongoResponse(
        status_code=200 if (c_sent and hr_sent) else 500,
        content={
            "message":              f"Emails sent to {name} and HR" if (c_sent and hr_sent) else "Some emails failed",
            "candidate_email_sent": c_sent,
            "hr_email_sent":        hr_sent,
        },
    )


@app.get("/linkedin-profiles")
async def get_linkedin_profiles(job_title: str = "", shortlisted_only: bool = False):
    query: dict = {}
    if job_title:
        query["job_title"] = {"$regex": job_title, "$options": "i"}
    if shortlisted_only:
        query["shortlisted"] = True

    profiles = list(li_col.find(query, {"_id": 0}).sort("fetched_at", -1).limit(500))
    return MongoResponse(200, content={"total": len(profiles), "profiles": profiles})


@app.get("/jobs-page/{job_offer_id}/linkedin-candidates")
async def get_linkedin_candidates_for_job(job_offer_id: str):
    job = jd_col.find_one({"job_offer_id": job_offer_id}, {"_id": 0})
    if not job:
        return MongoResponse(404, content={"error": "Job not found"})

    if job.get("source") != "linkedin":
        return MongoResponse(400, content={"error": "This endpoint is only for LinkedIn-sourced jobs."})

    pipeline_raw = list(
        candidates_col.find(
            {"job_offer_id": job_offer_id, "source": "linkedin"},
            {"_id": 0},
        ).sort("score", -1)
    )

    candidates = [
        {
            "name":        c.get("name", ""),
            "initials":    c.get("initials") or get_initials(c.get("name", "")),
            "color":       c.get("color")    or get_avatar_color(c.get("name", "")),
            "score":       c.get("score", 0),
            "reasoning":   c.get("reasoning", ""),
            "profile_url": c.get("profile_url", c.get("URL", "")),
            "title":       c.get("title", ""),
            "snippet":     c.get("snippet", ""),
            "shortlisted": c.get("shortlisted", False),
            "yoe":         c.get("yoe", "N/A"),
            "tags":        c.get("tags", []),
        }
        for c in pipeline_raw
    ]

    return MongoResponse(200, content={
        "job_offer_id": job_offer_id,
        "title":        job.get("title") or job.get("job_offer_name", ""),
        "total":        len(candidates),
        "candidates":   candidates,
    })


# ══════════════════════════════════════════════════════════════════════════════
# RUN
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    import sys

    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8000
    print(f"\n🚀 Starting HR Recruitment AI Agent on port {port}")
    print(f"   Salesforce + LinkedIn + Interviews edition")
    print(f"📚 Docs: http://localhost:{port}/docs")
    uvicorn.run(app, host="0.0.0.0", port=port)
