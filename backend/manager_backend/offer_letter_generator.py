"""
offer_letter_generator.py
═══════════════════════════════════════════════════════════════════════════════
Fills the SprintPark offer-letter PDF template with live candidate data and
returns the finished PDF as raw bytes (ready to base64-encode as an email
attachment).

Strategy
--------
Page 1 of the template has 5 bracketed / labelled blanks we need to fill:
    "SprintPark Ref:"      -> reference number
    "Date:"                -> issue date
    "[Candidate Name]"     -> candidate's full name
    "[Date of Joining]"    -> DOJ
    "[Designation]"        -> role / job title

Rather than hard-coding pixel coordinates (fragile — breaks if the template
is ever re-exported), we locate each placeholder at *load time* with
pdfplumber's text search, then draw the real value directly on top of it
using a transparent reportlab overlay merged in with pypdf. If a future
version of the template changes the wording, this raises a clear error
instead of silently producing a blank letter.
"""

import io
import os
import re
from typing import Optional

import pdfplumber
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.lib.colors import HexColor, white, black

TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), "templates", "SprintPark_Offer_Letter_Template.pdf")

# Placeholder search patterns -> the piece we replace them with.
# "label" placeholders (Ref/Date) keep their prefix and we just append the value.
_PLACEHOLDERS = {
    "candidate_name": r"\[Candidate Name\]",
    "doj":            r"\[Date of Joining\]",
    "designation":    r"\[Designation\]",
    "ref":            r"SprintPark Ref:",
    "date":           r"Date:",
}


# ═══════════════════════════════════════════════════════════════════════════
# Salary breakup calculation
# ═══════════════════════════════════════════════════════════════════════════
#
# Computation order matters — several fields depend on earlier ones, so they
# must be derived in this sequence (both monthly and yearly use the same
# logic, just scaled by 12):
#
#   1. total_ctc                 = compensation_lpa / 12   (yearly: compensation_lpa)
#   2. basic_salary               = 50% * total_ctc
#   3. hra                        = 40% * basic_salary
#   4. pf_employer_contribution   = 12% * basic_salary, CAPPED at Rs. 1,800
#                                    (statutory PF ceiling — if 12% * basic
#                                    is >= 1800, the contribution is exactly
#                                    1800, never more; if it's less than
#                                    1800, the actual computed amount is used)
#   5. pf_employee_contribution   = 12% * basic_salary, capped the same way
#   6. total_gross_salary         = total_ctc - pf_employer_contribution
#   7. other_allowance            = total_gross_salary - (basic_salary + hra)
#   8. insurance                  = flat monthly/yearly figure (per-employee override allowed)
#   9. professional_tax           = flat monthly/yearly figure
#  10. net_take_home              = total_gross_salary - (pf_employee_contribution
#                                    + professional_tax + insurance)
#
# NOTE: employer PF is already excluded from total_gross_salary in step 6,
# so it must NOT be subtracted again in step 10 (that would double-count it).

DEFAULT_INSURANCE_MONTHLY = 700
DEFAULT_INSURANCE_YEARLY = 8400
DEFAULT_PROFESSIONAL_TAX_MONTHLY = 200
DEFAULT_PROFESSIONAL_TAX_YEARLY = 2400

# Statutory PF ceiling. PF contribution (employer & employee) is 12% of
# basic salary, but is never allowed to exceed this flat cap — if 12% of
# basic comes out below the cap, the smaller, actual amount is used instead.
PF_CONTRIBUTION_CAP_MONTHLY = 1800
PF_CONTRIBUTION_CAP_YEARLY = 1800 * 12


def _round2(n: float) -> float:
    return round(n, 2)


def calculate_salary_breakup(
    compensation_lpa: float,
    variable_pay_lpa: float = 0.0,
    insurance_monthly: float = DEFAULT_INSURANCE_MONTHLY,
    insurance_yearly: float = DEFAULT_INSURANCE_YEARLY,
    professional_tax_monthly: float = DEFAULT_PROFESSIONAL_TAX_MONTHLY,
    professional_tax_yearly: float = DEFAULT_PROFESSIONAL_TAX_YEARLY,
) -> dict:
    """
    Compute the full Monthly + Yearly CTC breakup for the salary structure
    table, given the fixed CTC (in LPA, i.e. lakhs per annum) and optional
    variable pay (also in LPA).

    Returns a dict of {row_key: {"monthly": float, "yearly": float}} matching
    the rows in the offer-letter salary structure table, in display order.
    """

    def _breakup(total_ctc: float, insurance: float, professional_tax: float, pf_cap: float) -> dict:
        basic_salary = 0.50 * total_ctc
        hra = 0.40 * basic_salary
        # PF contribution is 12% of basic, but capped — never more than the
        # statutory ceiling, and left as-is (the smaller, real amount) when
        # 12% of basic falls below that ceiling.
        pf_employer_contribution = min(0.12 * basic_salary, pf_cap)
        pf_employee_contribution = min(0.12 * basic_salary, pf_cap)
        total_gross_salary = total_ctc - pf_employer_contribution
        other_allowance = total_gross_salary - (basic_salary + hra)
        net_take_home = total_gross_salary - (
            pf_employee_contribution + professional_tax + insurance
        )
        return {
            "basic_salary": basic_salary,
            "hra": hra,
            "other_allowance": other_allowance,
            "total_gross_salary": total_gross_salary,
            "pf_employer_contribution": pf_employer_contribution,
            "total_ctc": total_ctc,
            "insurance": insurance,
            "pf_employee_contribution": pf_employee_contribution,
            "professional_tax": professional_tax,
            "net_take_home": net_take_home,
        }

    # compensation_lpa is in LAKHS per annum (1 LPA = Rs. 1,00,000) — convert
    # to rupees before doing any arithmetic, otherwise every downstream
    # figure (and especially net_take_home, which subtracts flat rupee
    # amounts like insurance/PT) comes out wrong.
    yearly_ctc = compensation_lpa * 100_000
    monthly_ctc = yearly_ctc / 12

    monthly = _breakup(monthly_ctc, insurance_monthly, professional_tax_monthly, PF_CONTRIBUTION_CAP_MONTHLY)
    yearly = _breakup(yearly_ctc, insurance_yearly, professional_tax_yearly, PF_CONTRIBUTION_CAP_YEARLY)

    # "Total CTC (Including Variable)" — fixed CTC + variable pay, same split monthly/yearly
    # (variable_pay_lpa is also in lakhs, so convert it too)
    variable_pay_yearly = variable_pay_lpa * 100_000
    monthly["total_ctc_incl_variable"] = monthly_ctc + (variable_pay_yearly / 12)
    yearly["total_ctc_incl_variable"] = yearly_ctc + variable_pay_yearly

    # Row order to match the offer letter table exactly
    row_order = [
        "basic_salary",
        "hra",
        "other_allowance",
        "total_gross_salary",
        "pf_employer_contribution",
        "total_ctc",
        "total_ctc_incl_variable",
        "insurance",
        "pf_employee_contribution",
        "professional_tax",
        "net_take_home",
    ]

    return {
        key: {"monthly": _round2(monthly[key]), "yearly": _round2(yearly[key])}
        for key in row_order
    }


# Display labels for each row, in the exact order/wording used in the
# offer-letter table image.
_SALARY_ROW_LABELS = [
    ("basic_salary", "Basic Salary", False),
    ("hra", "Hour Rent Allowance", False),
    ("other_allowance", "Other Allowance", False),
    ("total_gross_salary", "Total Gross Salary", True),
    ("pf_employer_contribution", "PF employer contribution", False),
    ("total_ctc", "Total CTC", True),
    ("total_ctc_incl_variable", "Total CTC (Including Variable)", False),
    ("insurance", "Insurance", False),
    ("pf_employee_contribution", "PF employee contribution", False),
    ("professional_tax", "Professional Tax", False),
    ("net_take_home", "Net take Home", True),
]


# ── Formal letterhead styling ────────────────────────────────────────────
INK = black
RULE = HexColor("#333333")
MUTED = HexColor("#595959")
GRID = HexColor("#bfbfbf")

COMPANY_NAME = "SprintPark Solutions Pvt Ltd"
COMPANY_ADDRESS_LINES = [
    "Asian Sun City, Unit No 1204, Block B, Asian Sun City, Forest Department",
    "Colony, Kondapur, Hyderabad, Telangana 500084",
]
COMPANY_CONTACT = "Humanresources@sprintpark.com   7207735554"
COMPANY_CONFIDENTIALITY = (
    "The information contained in this message is proprietary and confidential. "
    "Copyright \u00a9 2023. All rights reserved by SprintPark."
)


def _draw_letterhead(c: "canvas.Canvas", width: float, height: float, margin: float) -> float:
    """Draws the same company letterhead block used on every page of the
    template, so pages we generate ourselves are visually seamless with the
    template pages around them. Returns the y-coordinate to start content at."""
    y = height - 40
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(margin, y, COMPANY_NAME)
    y -= 12
    c.setFont("Helvetica", 7.5)
    c.setFillColor(MUTED)
    for line in COMPANY_ADDRESS_LINES:
        c.drawString(margin, y, line)
        y -= 9.5
    c.drawString(margin, y, COMPANY_CONTACT)
    y -= 9.5
    c.setFont("Helvetica-Oblique", 6.5)
    c.drawString(margin, y, COMPANY_CONFIDENTIALITY)
    y -= 14

    c.setStrokeColor(RULE)
    c.setLineWidth(1)
    c.line(margin, y, width - margin, y)
    y -= 28
    return y


def _draw_section_title(c: "canvas.Canvas", width: float, margin: float, y: float, title: str) -> float:
    """Centered, letter-spaced caps heading with a thin rule beneath —
    matches the 'EMPLOYMENT OFFER LETTER' heading style on page 1."""
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 13)
    spaced = " ".join(title.upper())  # simple letter-spacing effect
    c.drawCentredString(width / 2, y, spaced)
    y -= 10
    c.setStrokeColor(RULE)
    c.setLineWidth(0.75)
    c.line(width / 2 - 70, y, width / 2 + 70, y)
    return y - 26


def _format_indian_currency(value: float) -> str:
    """Formats a rupee amount with Indian digit grouping (lakh/crore),
    e.g. 2350000 -> '23,50,000'. Falls back gracefully on non-numeric input."""
    try:
        is_negative = value < 0
        n = str(int(round(abs(value))))
    except (TypeError, ValueError):
        return str(value)

    if len(n) <= 3:
        grouped = n
    else:
        last_three = n[-3:]
        rest = n[:-3]
        parts = []
        while len(rest) > 2:
            parts.insert(0, rest[-2:])
            rest = rest[:-2]
        if rest:
            parts.insert(0, rest)
        grouped = ",".join(parts) + "," + last_three

    return f"-Rs. {grouped}" if is_negative else f"Rs. {grouped}"


def _fmt_currency(value: float) -> str:
    return _format_indian_currency(value)


def _fmt_lpa_field(raw_value) -> str:
    """Formats the Compensation Band field. Arrives as a plain number in
    LPA (lakhs per annum) from the UI (e.g. 20.0) or as literal 'TBD' when
    not yet finalized — handle both cleanly."""
    if raw_value is None:
        return "TBD"
    if isinstance(raw_value, str):
        stripped = raw_value.strip()
        if stripped.upper() in ("TBD", "", "N/A"):
            return "TBD"
        try:
            raw_value = float(stripped)
        except ValueError:
            return stripped
    try:
        rupees = float(raw_value) * 100_000
        return f"{_format_indian_currency(rupees)} per annum ({float(raw_value):g} LPA)"
    except (TypeError, ValueError):
        return str(raw_value)


# ═══════════════════════════════════════════════════════════════════════════
# Filling the template's OWN salary table (not a separate appended page)
# ═══════════════════════════════════════════════════════════════════════════
#
# The table on page 1 has generic "_______" underscore blanks — two per row
# (Monthly / Yearly), nothing that identifies which row is which except the
# row label text itself. Strategy: search for each row's label text to get
# its vertical position, then grab whichever underscore tokens sit on that
# same line (same "top" within a few points), sorted left-to-right so the
# first is the Monthly blank and the second is the Yearly blank.
#
# "Total CTC (Including Variable)" has NO underscore blanks in the template
# at all (confirmed by inspecting the real output) — it's meant to stay
# blank unless variable pay applies, in which case we draw the values
# directly under the Monthly/Yearly header columns at that row's height.

_SALARY_LABEL_PATTERNS = {
    "basic_salary":               r"Basic Salary",
    "hra":                        r"Hour Rent Allowance",
    "other_allowance":            r"Other Allowance",
    "total_gross_salary":         r"Total Gross Salary",
    "pf_employer_contribution":   r"PF employer contribution",
    "total_ctc":                  r"Total CTC(?!\s*\()",          # not "...(Including Variable)"
    "total_ctc_incl_variable":    r"Total CTC \(Including Variable\)",
    "insurance":                  r"Insurance",
    "pf_employee_contribution":   r"PF employee contribution",
    "professional_tax":           r"Professional Tax",
    "net_take_home":              r"Net take Home",
}

_UNDERSCORE_RE = re.compile(r"^_+$")


def _fmt_monthly_value(value: float) -> str:
    # Matches the reference spreadsheet's style: plain number, 2 decimals,
    # no thousands separator, no currency symbol.
    return f"{value:.2f}"


def _fmt_yearly_value(value: float) -> str:
    # Same style, whole rupees, no thousands separator.
    return f"{value:.0f}"


def _locate_salary_table(pdf_path: str, page_index: int = 0) -> tuple:
    """Finds each salary-table row's underscore blanks (if any) plus the
    Monthly/Yearly header column x-positions, by searching the template
    text directly — no hard-coded coordinates."""
    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[page_index]
        words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
        underscore_words = [w for w in words if _UNDERSCORE_RE.match(w["text"])]

        header_monthly = page.search(r"Monthly Amount", regex=True)
        header_yearly = page.search(r"Yearly Amount", regex=True)
        monthly_col_x = header_monthly[0]["x0"] if header_monthly else None
        yearly_col_x = header_yearly[0]["x0"] if header_yearly else None

        row_cells = {}
        for key, pattern in _SALARY_LABEL_PATTERNS.items():
            hits = page.search(pattern, regex=True)
            if not hits:
                row_cells[key] = None
                continue
            label_hit = hits[0]
            same_row = [w for w in underscore_words if abs(w["top"] - label_hit["top"]) < 4]
            same_row.sort(key=lambda w: w["x0"])
            row_cells[key] = {"label": label_hit, "blanks": same_row}

        page_size = (page.width, page.height)
    return row_cells, page_size, monthly_col_x, yearly_col_x


def _build_salary_table_overlay(
    row_cells: dict,
    breakup: Optional[dict],
    page_size: tuple,
    monthly_col_x: Optional[float],
    yearly_col_x: Optional[float],
    variable_pay_lpa: float = 0.0,
) -> io.BytesIO:
    """Transparent overlay that whites out each underscore blank in the
    template's own salary table and writes the real figure in its place.

    `breakup=None` means compensation hasn't been finalized yet (e.g. a
    Draft offer) — in that case every cell gets "TBD" instead of computed
    numbers. This matters: silently defaulting compensation to 0 doesn't
    just leave blanks empty, it produces a NEGATIVE net take-home (gross
    salary minus flat PF/insurance/tax deductions on a zero base), which is
    actively wrong information to put in front of a candidate."""
    width, height = page_size
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(width, height))
    font_name, font_size = "Helvetica", 10.5
    c.setFont(font_name, font_size)

    for key, cell in row_cells.items():
        if cell is None:
            continue
        if key == "total_ctc_incl_variable" and not variable_pay_lpa:
            continue  # template leaves this row blank when there's no variable pay

        if breakup is None:
            monthly_text = yearly_text = "TBD"
        else:
            values = breakup.get(key)
            if values is None:
                continue
            monthly_text = _fmt_monthly_value(values["monthly"])
            yearly_text = _fmt_yearly_value(values["yearly"])

        blanks = cell["blanks"]

        if len(blanks) >= 2:
            for blank, text in zip(blanks[:2], (monthly_text, yearly_text)):
                x0, x1, top, bottom = blank["x0"], blank["x1"], blank["top"], blank["bottom"]
                y = height - bottom
                text_width = c.stringWidth(text, font_name, font_size)
                box_width = max(x1 - x0, text_width) + 2
                box_height = (bottom - top) + 4
                c.setFillColor(white)
                c.rect(x0 - 1, y - 1.5, box_width, box_height, fill=1, stroke=0)
                c.setFillColor(black)
                c.drawString(x0, y + 2, text)
        elif monthly_col_x is not None and yearly_col_x is not None:
            # No underscore blanks for this row (e.g. Total CTC Including
            # Variable) — write directly under the header columns instead.
            y = height - cell["label"]["bottom"]
            c.setFillColor(black)
            c.drawString(monthly_col_x, y + 2, monthly_text)
            c.drawString(yearly_col_x, y + 2, yearly_text)

    c.save()
    buf.seek(0)
    return buf


def _locate_placeholders(pdf_path: str, page_index: int = 0) -> dict:
    """Search page `page_index` of the template for each known placeholder
    and return {key: bbox_dict}. Raises ValueError if any are missing so a
    template change doesn't silently produce a broken letter."""
    found = {}
    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[page_index]
        for key, pattern in _PLACEHOLDERS.items():
            hits = page.search(pattern, regex=True)
            if not hits:
                raise ValueError(
                    f"Could not find placeholder '{pattern}' on page {page_index + 1} "
                    f"of the offer letter template. The template may have been edited — "
                    f"update _PLACEHOLDERS in offer_letter_generator.py."
                )
            found[key] = hits[0]  # first match
        page_size = (page.width, page.height)
    return found, page_size


def _build_overlay(placeholders: dict, page_size: tuple, values: dict) -> "canvas.Canvas":
    """Build a single-page transparent-background overlay PDF with the real
    values painted at each placeholder's location (white rectangle to blank
    out the bracket text, then the real value drawn in its place)."""
    width, height = page_size
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(width, height))

    def paint(key, text, font="Helvetica-Bold", size=11):
        box = placeholders[key]
        x0, x1 = box["x0"], box["x1"]
        top, bottom = box["top"], box["bottom"]
        y_bottom_reportlab = height - bottom
        text_width = c.stringWidth(text, font, size)
        box_width = max(x1 - x0, text_width) + 1
        c.setFillColor(white)
        c.rect(x0 - 1, y_bottom_reportlab - 1, box_width, (bottom - top) + 3, fill=1, stroke=0)
        c.setFillColor(black)
        c.setFont(font, size)
        c.drawString(x0, y_bottom_reportlab + 1.5, text)

    def paint_after_label(key, text, font="Helvetica-Bold", size=11, gap=8):
        """For 'SprintPark Ref:' / 'Date:' — the match IS the label itself,
        so we must keep the label and draw the value just to its right,
        not overwrite the label with a whiteout box."""
        box = placeholders[key]
        x1, top, bottom = box["x1"], box["top"], box["bottom"]
        y_bottom_reportlab = height - bottom
        c.setFillColor(black)
        c.setFont(font, size)
        c.drawString(x1 + gap, y_bottom_reportlab + 1.5, text)

    paint_after_label("ref",  values["ref"])
    paint_after_label("date", values["date"])
    paint("candidate_name", values["candidate_name"])
    paint("doj",             values["doj"], size=10)
    paint("designation",     values["designation"], size=10)

    c.save()
    buf.seek(0)
    return buf


def _format_doj(doj_raw: Optional[str]) -> str:
    """Normalizes the Date of Joining for display on the letter.

    The frontend's date picker (`<input type="date">`) hands this function
    a plain ISO string like "2026-08-04" — parse that into the letter's
    "04 August 2026" style. If the caller already passed a pre-formatted
    string (or nothing at all), leave it alone / fall back gracefully.
    """
    if not doj_raw:
        return "To be communicated"
    text = str(doj_raw).strip()
    if not text or text.upper() in ("TBD", "N/A"):
        return "To be communicated"
    if re.match(r"^\d{4}-\d{2}-\d{2}$", text):
        from datetime import datetime
        try:
            return datetime.strptime(text, "%Y-%m-%d").strftime("%d %B %Y")
        except ValueError:
            return text
    return text


def _build_acceptance_overlay(
    page_size: tuple,
    hr_signatory_name: str = "",
    acceptance_date: str = "",
    page_type: str = "acceptance",
) -> io.BytesIO:
    """
    Builds a transparent overlay for either:
      page 3 — fills the HR signatory name below the signature blank
      page 4 — fills candidate Signature name, Name, Date blanks
    Coordinates come from pdfplumber inspection of the actual template.
    """
    width, height = page_size
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(width, height))
    c.setFont("Helvetica", 10.5)
    c.setFillColor(black)

    def _fill_blank(x0: float, x1: float, top: float, bottom: float, text: str) -> None:
        if not text:
            return
        y = height - bottom
        # White out the underscore blank
        box_width = max(x1 - x0, c.stringWidth(text, "Helvetica", 10.5)) + 4
        box_height = (bottom - top) + 4
        c.setFillColor(white)
        c.rect(x0 - 1, y - 2, box_width, box_height, fill=1, stroke=0)
        c.setFillColor(black)
        c.drawString(x0, y + 1.5, text)

    if page_type == "hr_signature":
        # Page 3: signature blank at x0=55, top=437.6, bottom=448.6
        # Signatory name prints over the blank line
        if hr_signatory_name:
            _fill_blank(55.0, 55.0 + 200, 437.6, 448.6, hr_signatory_name)
        # HR date printed to the right of the signatory name on same blank line
        if acceptance_date:
            date_x = 55.0 + 210   # right side of same row
            y = height - 448.6
            c.setFillColor(black)
            c.setFont("Helvetica", 10.5)
            c.drawString(date_x, y + 1.5, acceptance_date)

    elif page_type == "acceptance":
        pass  # candidate acceptance page — left as-is, not filled by HR

    c.save()
    buf.seek(0)
    return buf


def generate_offer_letter_pdf(
    candidate_name: str,
    designation: str,
    doj_str: str,
    ref_no: str,
    date_str: str,
    compensation_lpa: Optional[float] = None,
    variable_pay_lpa: float = 0.0,
    band: str = "TBD",
    insurance_monthly: float = DEFAULT_INSURANCE_MONTHLY,
    insurance_yearly: float = DEFAULT_INSURANCE_YEARLY,
    professional_tax_monthly: float = DEFAULT_PROFESSIONAL_TAX_MONTHLY,
    professional_tax_yearly: float = DEFAULT_PROFESSIONAL_TAX_YEARLY,
    # ── Acceptance & consent fields (page 3 HR signature only) ──────────────
    hr_signatory_name: str = "",          # name printed below HR signature line (page 3)
    acceptance_date: str = "",            # date printed alongside HR signature (page 3)
    template_path: Optional[str] = None,
    **_legacy_kwargs,
) -> bytes:
    """
    Fill the SprintPark offer letter template with candidate data and return
    the resulting PDF as bytes. Fills the template's OWN salary structure
    table (Basic / HRA / PF / Gross / Net take-home, Monthly + Yearly) in
    place on page 1. No extra pages are appended — the finished letter is
    exactly the template's own page count.

    `doj_str` is the candidate's Date of Joining. It accepts either an ISO
    date ("2026-08-04", as produced by the frontend's calendar/date-input
    field) or an already human-formatted string ("04 August 2026") — both
    are normalized to the letter's display style via `_format_doj`.

    `**_legacy_kwargs` absorbs stale arguments from callers that haven't
    been updated yet — most notably `bonus`, which the API layer used to
    pass from the old "Joining Bonus" field. That field no longer exists
    (replaced by the Joining Date picker), so any such kwarg is accepted
    and silently ignored rather than raising a TypeError. This is a safety
    net, not a fix: the actual caller (the API route that invokes this
    function) should be updated to stop passing `bonus` at all.
    """
    template_path = template_path or TEMPLATE_PATH
    if _legacy_kwargs:
        import warnings
        warnings.warn(
            f"generate_offer_letter_pdf() received deprecated argument(s) "
            f"{list(_legacy_kwargs.keys())} — these are ignored. Update the "
            f"caller to stop passing them (e.g. 'bonus' was replaced by the "
            f"Joining Date field and is no longer used).",
            stacklevel=2,
        )
    if not os.path.exists(template_path):
        raise FileNotFoundError(f"Offer letter template not found at {template_path}")

    placeholders, page_size = _locate_placeholders(template_path, page_index=0)
    row_cells, _, monthly_col_x, yearly_col_x = _locate_salary_table(template_path, page_index=0)

    values = {
        "candidate_name": candidate_name or "Candidate",
        "designation":    designation or "TBD",
        "doj":            _format_doj(doj_str),
        "ref":            ref_no,
        "date":           date_str,
        "band":           band,
    }

    # SELF-HEALING FALLBACK: in production, `band` (compensation band, e.g.
    # "20.0" / "20L") has consistently arrived populated while
    # `compensation_lpa` (used for the actual salary-table math) has not.
    # Rather than depend on the caller wiring both correctly, derive the
    # numeric comp from `band` whenever compensation_lpa itself is missing.
    # An explicitly-passed compensation_lpa always wins.
    #
    # NOTE: this no longer falls back to a "bonus" field for variable pay —
    # the offer form replaced the free-text Joining Bonus field with a
    # Joining Date picker, so there's no monetary bonus value to derive
    # variable_pay_lpa from anymore. Pass variable_pay_lpa explicitly if a
    # candidate has variable pay.
    def _coerce_numeric_lpa(value) -> Optional[float]:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)
        text = str(value).strip()
        if not text or text.upper() in ("TBD", "N/A"):
            return None
        try:
            return float(text)
        except ValueError:
            return None

    if compensation_lpa is None or compensation_lpa <= 0:
        compensation_lpa = _coerce_numeric_lpa(band)

    # compensation_lpa may still not be set (e.g. offer still in "Draft"
    # before the comp band is finalized). Treating a missing value as 0
    # doesn't just leave the table empty — it produces a NEGATIVE net
    # take-home (gross minus flat PF/insurance/tax on a zero base), which is
    # actively wrong information to hand a candidate. So: no valid comp ->
    # every cell shows "TBD", not a computed number.
    is_priced = compensation_lpa is not None and compensation_lpa > 0
    if is_priced:
        breakup = calculate_salary_breakup(
            compensation_lpa=compensation_lpa,
            variable_pay_lpa=variable_pay_lpa or 0.0,
            insurance_monthly=insurance_monthly,
            insurance_yearly=insurance_yearly,
            professional_tax_monthly=professional_tax_monthly,
            professional_tax_yearly=professional_tax_yearly,
        )
    else:
        breakup = None

    overlay_buf = _build_overlay(placeholders, page_size, values)
    overlay_reader = PdfReader(overlay_buf)
    overlay_page = overlay_reader.pages[0]

    table_overlay_buf = _build_salary_table_overlay(
        row_cells, breakup, page_size, monthly_col_x, yearly_col_x,
        variable_pay_lpa=variable_pay_lpa or 0.0,
    )
    table_overlay_reader = PdfReader(table_overlay_buf)
    table_overlay_page = table_overlay_reader.pages[0]

    template_reader = PdfReader(template_path)
    writer = PdfWriter()

    # Pre-build acceptance overlays once (they share the same page size)
    hr_sig_overlay_buf    = _build_acceptance_overlay(page_size, hr_signatory_name=hr_signatory_name, acceptance_date=acceptance_date, page_type="hr_signature")
    accept_overlay_buf    = _build_acceptance_overlay(page_size, page_type="acceptance")
    hr_sig_overlay_page   = PdfReader(hr_sig_overlay_buf).pages[0]
    accept_overlay_page   = PdfReader(accept_overlay_buf).pages[0]

    for i, page in enumerate(template_reader.pages):
        if i == 0:
            page.merge_page(overlay_page)
            page.merge_page(table_overlay_page)
        elif i == 2:   # page 3 — HR signature
            page.merge_page(hr_sig_overlay_page)
        elif i == 3:   # page 4 — candidate acceptance
            page.merge_page(accept_overlay_page)
        writer.add_page(page)

    out_buf = io.BytesIO()
    writer.write(out_buf)
    return out_buf.getvalue()


if __name__ == "__main__":
    # Quick manual test
    pdf_bytes = generate_offer_letter_pdf(
        candidate_name="Laxman Kosana",
        designation="Salesforce Developer",
        doj_str="08-04-2026",       # ISO date, same format the frontend's date-picker sends
        ref_no="SPK/OFR/2026/AAYALAAQ",
        date_str="16 July 2026",
        compensation_lpa=25.0,      # in lakhs per annum
        variable_pay_lpa=2.0,
        band="25L",
    )
    with open("/home/claude/test_offer_letter.pdf", "wb") as f:
        f.write(pdf_bytes)
    print(f"Wrote {len(pdf_bytes)} bytes")