"""
Quick debug script — run from backend/ folder:
  python test_email_debug.py
"""
import os, asyncio, httpx
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

TENANT   = os.getenv("AZURE_TENANT_ID", "")
CLIENT   = os.getenv("AZURE_CLIENT_ID", "")
SECRET   = os.getenv("AZURE_CLIENT_SECRET", "")
SENDER   = os.getenv("SENDER_EMAIL", "")
TO_EMAIL = SENDER   # send to itself for the test

print("=== Env check ===")
print(f"  AZURE_TENANT_ID     : {'SET (' + TENANT[:8] + '...)' if TENANT else 'NOT SET ❌'}")
print(f"  AZURE_CLIENT_ID     : {'SET (' + CLIENT[:8] + '...)' if CLIENT else 'NOT SET ❌'}")
print(f"  AZURE_CLIENT_SECRET : {'SET' if SECRET else 'NOT SET ❌'}")
print(f"  SENDER_EMAIL        : {SENDER or 'NOT SET ❌'}")
print()

if not all([TENANT, CLIENT, SECRET, SENDER]):
    print("❌ One or more required env vars are missing. Check backend/.env")
    exit(1)


async def main():
    async with httpx.AsyncClient() as http:
        # ── Step 1: Get token ──────────────────────────────────────────────
        print("Step 1: Getting Azure token...")
        resp = await http.post(
            f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token",
            data={
                "grant_type":    "client_credentials",
                "client_id":     CLIENT,
                "client_secret": SECRET,
                "scope":         "https://graph.microsoft.com/.default",
            },
            timeout=15,
        )
        print(f"  Status: {resp.status_code}")
        if resp.status_code != 200:
            print(f"  ❌ Token error: {resp.text}")
            return
        token = resp.json().get("access_token", "")
        if not token:
            print(f"  ❌ No access_token in response: {resp.text}")
            return
        print("  ✅ Token obtained")

        # ── Step 2: Send test email ────────────────────────────────────────
        print(f"\nStep 2: Sending test email to {TO_EMAIL}...")
        send_resp = await http.post(
            f"https://graph.microsoft.com/v1.0/users/{SENDER}/sendMail",
            json={
                "message": {
                    "subject": "RecruitAI — Email Debug Test",
                    "body": {"contentType": "HTML", "content": "<h2>Email test works!</h2>"},
                    "toRecipients": [{"emailAddress": {"address": TO_EMAIL}}],
                },
                "saveToSentItems": True,
            },
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            timeout=30,
        )
        print(f"  Status: {send_resp.status_code}")
        if send_resp.status_code in (200, 202):
            print(f"  ✅ Email sent successfully to {TO_EMAIL}")
        else:
            print(f"  ❌ Send failed: {send_resp.text}")

asyncio.run(main())
