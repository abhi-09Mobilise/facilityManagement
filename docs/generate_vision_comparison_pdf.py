"""
Generate a PDF version of the AI vision model comparison for the floor-scan
feature. Reads the same MODELS data used by generate_vision_comparison.py so
the Excel, CSV, and PDF are always consistent.

Output:
  AI_Vision_Model_Comparison.pdf   (multi-page, portrait + landscape)

Layout:
  Page 1        Title + executive summary
  Page 2        Weighting rationale + top 5 ranking
  Page 3        Category winners + final recommendations
  Page 4        Charts (bar + scatter)
  Pages 5-6     Detailed comparison (landscape, split into sub-tables)
  Page 7        Technical scores table
  Page 8        Per-model recommendation table
"""

import os
import sys
from datetime import date

# Data source (single source of truth)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generate_vision_comparison import MODELS_RANKED, WEIGHTS

# ---- Chart rendering (matplotlib) ----------------------------------------
import matplotlib
matplotlib.use("Agg")  # headless — no display window
import matplotlib.pyplot as plt

CHART_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_pdf_charts")
os.makedirs(CHART_DIR, exist_ok=True)

# ---- PDF (reportlab) -----------------------------------------------------
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, Image, KeepTogether,
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER

OUT_PDF = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "AI_Vision_Model_Comparison.pdf")

# Colors from the project palette
INK        = colors.HexColor("#0F1B2D")
INDIGO     = colors.HexColor("#3657E8")
INDIGO_INK = colors.HexColor("#1E3AB5")
INDIGO_SOFT = colors.HexColor("#E7ECFF")
TEAL_SOFT  = colors.HexColor("#DCF3EE")
AMBER_SOFT = colors.HexColor("#FFF3D3")
CORAL_SOFT = colors.HexColor("#FBE4DF")
LINE       = colors.HexColor("#E2E6EE")
PAPER      = colors.HexColor("#F5F7FB")
WHITE      = colors.white
MUTED      = colors.HexColor("#667089")

# ---------------------------------------------------------------------------
# Charts
# ---------------------------------------------------------------------------
def make_chart_overall_bar():
    fig, ax = plt.subplots(figsize=(10, 8))
    models = [m["name"] for m in MODELS_RANKED]
    scores = [m["score_overall"] for m in MODELS_RANKED]
    y_pos = range(len(models))
    bars = ax.barh(y_pos, scores, color=["#DCA200" if i == 0 else
                                          "#0E8C7F" if i == 1 else
                                          "#D8432A" if i == 2 else
                                          "#3657E8" if i < 5 else
                                          "#98A2B8" for i in range(len(models))])
    ax.set_yticks(y_pos)
    ax.set_yticklabels(models, fontsize=8)
    ax.invert_yaxis()
    ax.set_xlabel("Weighted Score (0-10)", fontsize=10)
    ax.set_title("Overall Ranking — Weighted Score", fontsize=13, weight="bold", color="#0F1B2D")
    ax.set_xlim(0, 10)
    ax.grid(axis="x", linestyle=":", alpha=0.5)
    for i, (bar, score) in enumerate(zip(bars, scores)):
        ax.text(score + 0.05, bar.get_y() + bar.get_height() / 2,
                f"{score:.2f}", va="center", fontsize=8)
    plt.tight_layout()
    p = os.path.join(CHART_DIR, "overall_ranking.png")
    fig.savefig(p, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return p

def make_chart_accuracy_speed_scatter():
    fig, ax = plt.subplots(figsize=(10, 7))
    for m in MODELS_RANKED:
        color = "#DCA200" if m["rank"] == 1 else \
                "#0E8C7F" if m["rank"] == 2 else \
                "#D8432A" if m["rank"] == 3 else \
                "#3657E8" if m["rank"] <= 5 else "#98A2B8"
        size = 220 if m["rank"] <= 3 else 120 if m["rank"] <= 5 else 70
        ax.scatter(m["score_speed"], m["score_accuracy"], s=size, color=color, alpha=0.75, edgecolors="#0F1B2D")
        # Label short version
        short = m["name"].split(" (")[0]
        ax.annotate(short, (m["score_speed"], m["score_accuracy"]),
                    xytext=(6, 4), textcoords="offset points", fontsize=7, color="#1C2433")
    ax.set_xlabel("CPU Speed Score (higher = faster)", fontsize=10)
    ax.set_ylabel("Accuracy Score (higher = better)", fontsize=10)
    ax.set_title("Accuracy vs Speed — top-right = best deals", fontsize=13, weight="bold", color="#0F1B2D")
    ax.set_xlim(0, 11); ax.set_ylim(0, 11)
    ax.grid(True, linestyle=":", alpha=0.5)
    plt.tight_layout()
    p = os.path.join(CHART_DIR, "accuracy_vs_speed.png")
    fig.savefig(p, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return p

def make_chart_speed_ms():
    fig, ax = plt.subplots(figsize=(10, 8))
    models = [m["name"] for m in MODELS_RANKED]
    ms = [m["cpu_speed_ms"] if isinstance(m["cpu_speed_ms"], (int, float)) else 0
          for m in MODELS_RANKED]
    y_pos = range(len(models))
    ax.barh(y_pos, ms, color="#3657E8")
    ax.set_yticks(y_pos)
    ax.set_yticklabels(models, fontsize=8)
    ax.invert_yaxis()
    ax.set_xlabel("Milliseconds per scan (lower = better)", fontsize=10)
    ax.set_title("CPU Speed per Scan", fontsize=13, weight="bold", color="#0F1B2D")
    ax.grid(axis="x", linestyle=":", alpha=0.5)
    for i, v in enumerate(ms):
        ax.text(v + 30, i, f"{v} ms", va="center", fontsize=7, color="#0F1B2D")
    plt.tight_layout()
    p = os.path.join(CHART_DIR, "speed_ms.png")
    fig.savefig(p, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return p

def make_chart_cost():
    fig, ax = plt.subplots(figsize=(10, 8))
    models = [m["name"] for m in MODELS_RANKED]
    costs = [m["score_cost"] for m in MODELS_RANKED]
    y_pos = range(len(models))
    bars = ax.barh(y_pos, costs, color=["#0E8C7F" if c >= 8 else
                                         "#DCA200" if c >= 5 else
                                         "#D8432A" for c in costs])
    ax.set_yticks(y_pos)
    ax.set_yticklabels(models, fontsize=8)
    ax.invert_yaxis()
    ax.set_xlabel("Cost Score (10 = free & permissive)", fontsize=10)
    ax.set_title("Cost / Licensing", fontsize=13, weight="bold", color="#0F1B2D")
    ax.set_xlim(0, 10.5)
    ax.grid(axis="x", linestyle=":", alpha=0.5)
    for i, (bar, v) in enumerate(zip(bars, costs)):
        ax.text(v + 0.1, bar.get_y() + bar.get_height() / 2, f"{v:.1f}", va="center", fontsize=7)
    plt.tight_layout()
    p = os.path.join(CHART_DIR, "cost.png")
    fig.savefig(p, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return p

# ---------------------------------------------------------------------------
# PDF sections
# ---------------------------------------------------------------------------
styles = getSampleStyleSheet()

def _style(name, base="BodyText", **kwargs):
    return ParagraphStyle(name=name, parent=styles[base], **kwargs)

TITLE_STYLE = _style("MyTitle", "Title", fontSize=22, leading=26,
                    textColor=INK, spaceAfter=8, fontName="Helvetica-Bold")
SUBTITLE_STYLE = _style("MySubtitle", "Normal", fontSize=11, leading=15,
                       textColor=MUTED, spaceAfter=16)
H1_STYLE = _style("MyH1", "Heading1", fontSize=16, leading=20,
                 textColor=INK, spaceBefore=14, spaceAfter=8, fontName="Helvetica-Bold")
H2_STYLE = _style("MyH2", "Heading2", fontSize=13, leading=17,
                 textColor=INDIGO_INK, spaceBefore=10, spaceAfter=6, fontName="Helvetica-Bold")
BODY_STYLE = _style("MyBody", "BodyText", fontSize=10, leading=14,
                   textColor=colors.HexColor("#1C2433"), spaceAfter=6)
SMALL_STYLE = _style("MySmall", "BodyText", fontSize=8, leading=10,
                    textColor=colors.HexColor("#1C2433"))
LABEL_STYLE = _style("MyLabel", "BodyText", fontSize=10, leading=14,
                    textColor=INDIGO_INK, fontName="Helvetica-Bold")

def hr():
    return Table([[""]], colWidths=[170 * mm], rowHeights=[0.4],
                 style=TableStyle([("LINEABOVE", (0, 0), (-1, -1), 0.6, LINE)]))

def _base_table_style():
    return TableStyle([
        ("FONTNAME",  (0, 0), (-1, 0),  "Helvetica-Bold"),
        ("FONTSIZE",  (0, 0), (-1, -1), 8.5),
        ("BACKGROUND",(0, 0), (-1, 0),  INK),
        ("TEXTCOLOR", (0, 0), (-1, 0),  WHITE),
        ("ALIGN",     (0, 0), (-1, 0),  "CENTER"),
        ("VALIGN",    (0, 0), (-1, -1), "MIDDLE"),
        ("GRID",      (0, 0), (-1, -1), 0.35, LINE),
        ("LEFTPADDING",   (0, 0), (-1, -1), 5),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 5),
        ("TOPPADDING",    (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ])

def _highlight_top(style, top_n=5, start_row=1):
    # First-place gold, 2nd teal, 3rd coral, 4-5 indigo-soft
    style.add("BACKGROUND", (0, start_row), (-1, start_row), AMBER_SOFT)
    if top_n >= 2:
        style.add("BACKGROUND", (0, start_row + 1), (-1, start_row + 1), TEAL_SOFT)
    if top_n >= 3:
        style.add("BACKGROUND", (0, start_row + 2), (-1, start_row + 2), CORAL_SOFT)
    for i in range(3, top_n):
        style.add("BACKGROUND", (0, start_row + i), (-1, start_row + i), INDIGO_SOFT)

# ---------------------------------------------------------------------------
# Page 1 — Title + Executive Summary
# ---------------------------------------------------------------------------
def section_title():
    return [
        Paragraph("AI Vision Model Comparison", TITLE_STYLE),
        Paragraph("Decision document for the facilityManagement floor-scan feature", SUBTITLE_STYLE),
        Paragraph(f"Generated {date.today().isoformat()} · 21 models compared · Weighted scoring", SMALL_STYLE),
        Spacer(1, 8),
        hr(),
        Spacer(1, 8),

        Paragraph("Executive summary", H1_STYLE),
        Paragraph(
            "This document compares 21 modern AI / computer-vision approaches for the floor-scan feature "
            "(chair and table detection in floor-plan images). Ranking is weighted for THIS project's "
            "constraints — small dev team, existing Node + Python stack, CPU-only server, free preferred, "
            "scans are one-off per room setup (not real-time). This is a decision document, not a general "
            "AI overview.",
            BODY_STYLE),

        Paragraph("Bottom-line recommendation", H2_STYLE),
        Paragraph(
            f"<b>Implement now:</b> {MODELS_RANKED[1]['name']} — weighted score {MODELS_RANKED[1]['score_overall']}. "
            "Pip install + ~30 lines of Python. Immediately fixes the 'fails on new photos' problem. Zero recurring cost.",
            BODY_STYLE),
        Paragraph(
            f"<b>Long-term winner:</b> {MODELS_RANKED[0]['name']} — weighted score {MODELS_RANKED[0]['score_overall']}. "
            "Same architecture as above, retrained on ~300 labeled floor plans. Lifts drawing accuracy from ~70% to ~95%. "
            "1-2 days of upfront labeling work.",
            BODY_STYLE),
        Paragraph(
            "<b>Do NOT use:</b> Mask R-CNN (already in the project, but 9 years old, 10-30x slower than YOLOv11 with lower accuracy). "
            "SAM 2 is a segmentation tool, not a detector — wrong category for this task alone.",
            BODY_STYLE),
        PageBreak(),
    ]

# ---------------------------------------------------------------------------
# Page 2 — Weighting + Top 5
# ---------------------------------------------------------------------------
def section_weighting():
    weight_rows = [
        ["Criterion", "Weight", "Rationale"],
        ["Accuracy",              "25%", "Detection quality is the top user pain"],
        ["CPU inference speed",   "15%", "Scans aren't real-time (once per room setup)"],
        ["Fine-tuning capability","15%", "Long-term flexibility to specialize"],
        ["Deployment ease",       "15%", "Small dev team; must fit existing Node+Python stack"],
        ["Production readiness",  "12%", "Reliability, community, long-term maintenance"],
        ["Cost / license",        "12%", "Free preferred; AGPL restrictions matter"],
        ["Model efficiency",      "6%",  "CPU-only server; RAM and download size matter"],
    ]
    weight_tbl = Table(weight_rows, colWidths=[52 * mm, 22 * mm, 92 * mm])
    ws = _base_table_style()
    ws.add("ALIGN", (1, 1), (1, -1), "CENTER")
    ws.add("FONTNAME", (1, 1), (1, -1), "Helvetica-Bold")
    weight_tbl.setStyle(ws)

    top_rows = [["#", "Model", "Score", "Category"]]
    for m in MODELS_RANKED[:10]:
        top_rows.append([str(m["rank"]), m["name"], f"{m['score_overall']:.2f}", m["category"]])
    top_tbl = Table(top_rows, colWidths=[10 * mm, 68 * mm, 20 * mm, 68 * mm])
    ts = _base_table_style()
    ts.add("ALIGN", (0, 1), (0, -1), "CENTER")
    ts.add("ALIGN", (2, 1), (2, -1), "CENTER")
    ts.add("FONTNAME", (2, 1), (2, -1), "Helvetica-Bold")
    _highlight_top(ts, top_n=5, start_row=1)
    top_tbl.setStyle(ts)

    return [
        Paragraph("Weighting rationale (transparent)", H1_STYLE),
        Paragraph("These weights reflect this specific project's constraints. Total = 100%.", BODY_STYLE),
        weight_tbl,
        Spacer(1, 12),
        Paragraph("Top 10 by weighted score", H1_STYLE),
        top_tbl,
        PageBreak(),
    ]

# ---------------------------------------------------------------------------
# Page 3 — Category winners + Final recommendations
# ---------------------------------------------------------------------------
def section_winners_and_recs():
    winners = [
        ["Category", "Winner", "Why"],
        ["Best overall (right now)", MODELS_RANKED[1]["name"],
            "Easiest deploy; huge community; fine-tune-ready"],
        ["Best after fine-tuning", MODELS_RANKED[0]["name"],
            "Same arch as above, retrained on your data → 95%+"],
        ["Best alternative", MODELS_RANKED[2]["name"],
            "Practically tied with #1; more battle-tested"],
        ["Best for real-time / speed", "YOLOv10 (pretrained)",
            "NMS-free architecture — fastest CPU YOLO"],
        ["Best raw accuracy (no training)", "Claude Vision API",
            "90-95% out-of-box (docked in ranking for cost)"],
        ["Best cost-effective free", "YOLOv11 (pretrained COCO)",
            "Free, tiny, easy — everything in a Python venv"],
        ["Best MIT-license local", "Florence-2 (Microsoft)",
            "MIT weights, runs on CPU, commercial-friendly"],
        ["Best license for commercial redistribution", "YOLO-NAS (Deci)",
            "Apache-2.0 avoids Ultralytics' AGPL friction"],
        ["Do NOT use", "Mask R-CNN (torchvision)",
            "9 years old, inferior on every dimension"],
        ["Wrong category for this task", "SAM 2",
            "Segments shapes but doesn't classify — needs a detector on top"],
    ]
    tbl = Table(winners, colWidths=[52 * mm, 55 * mm, 65 * mm])
    ts = _base_table_style()
    ts.add("BACKGROUND", (0, 1), (-1, 1), AMBER_SOFT)   # gold
    ts.add("BACKGROUND", (0, 2), (-1, 2), TEAL_SOFT)    # teal
    ts.add("BACKGROUND", (0, 3), (-1, 3), CORAL_SOFT)   # bronze
    ts.add("BACKGROUND", (0, 9), (-1, 9), colors.HexColor("#FFE5E0"))  # do-not-use
    ts.add("BACKGROUND", (0, 10),(-1, 10),colors.HexColor("#FFE5E0")) # wrong category
    tbl.setStyle(ts)

    recs = [
        ("1. Best model to implement NOW",
            "YOLOv11 (pretrained COCO) — one pip install, ~30 lines of Python. "
            "Detects chair, dining table, couch from COCO's 80 classes. Fixes the "
            "'fails on new photos' problem immediately."),
        ("2. Best model for future fine-tuning",
            "YOLOv11 (fine-tuned on floor plans). Same architecture as #1, retrained "
            "on 300+ labeled plans → 95%+ accuracy on drawings too."),
        ("3. Best alternative",
            "AGPL blocker? → YOLO-NAS (Apache-2.0) or YOLOv9. Want zero setup + accept paid? "
            "→ Claude Vision API. Want fully open MIT VLM that runs locally? → Florence-2."),
        ("4. Model to NOT use",
            "Mask R-CNN — 9 years old, 10-30x slower than YOLOv11 with lower accuracy. "
            "SAM 2 — segmentation only, doesn't identify chairs vs tables."),
        ("5. Recommended architecture",
            "Phase 1: Keep OpenCV path in app.py as fallback. Add YOLOv11 (pretrained) as new "
            "endpoint. Frontend gains 'Fast scan' vs 'Smart scan' toggle. Phase 2: Fine-tune "
            "YOLOv11 on labeled data — swap best.pt into app.py. No other code changes."),
        ("6. Migration difficulty from OpenCV",
            "LOW. One Python file + one Node route. No frontend/DB changes. One-day integration. "
            "Existing OpenCV code stays in place as fallback."),
        ("7. Expected trade-offs",
            "YOLOv11 vs current OpenCV: +40-50 pp accuracy on photos, similar CPU speed, +100-300 MB RAM. "
            "YOLOv11 vs Claude Vision: -5 pp accuracy but $0/scan forever + offline-capable."),
    ]
    rec_blocks = [Paragraph("Final numbered recommendations", H1_STYLE)]
    for label, text in recs:
        rec_blocks.append(Paragraph(label, LABEL_STYLE))
        rec_blocks.append(Paragraph(text, BODY_STYLE))

    return [
        Paragraph("Category winners for this project", H1_STYLE),
        tbl,
        Spacer(1, 12),
    ] + rec_blocks + [PageBreak()]

# ---------------------------------------------------------------------------
# Page 4 — Charts
# ---------------------------------------------------------------------------
def section_charts():
    p1 = make_chart_overall_bar()
    p2 = make_chart_accuracy_speed_scatter()
    p3 = make_chart_speed_ms()
    p4 = make_chart_cost()
    return [
        Paragraph("Charts", H1_STYLE),
        Paragraph("Overall ranking — weighted score (0-10). Top 3 highlighted.", H2_STYLE),
        Image(p1, width=170 * mm, height=140 * mm, kind="proportional"),
        PageBreak(),

        Paragraph("Accuracy vs Speed", H2_STYLE),
        Paragraph(
            "Each dot is one model. X = CPU speed score (higher = faster), Y = accuracy score "
            "(higher = better). Top-right is 'high accuracy AND fast' — the best deals sit there.",
            BODY_STYLE),
        Image(p2, width=170 * mm, height=120 * mm, kind="proportional"),
        Spacer(1, 6),
        PageBreak(),

        Paragraph("CPU speed per scan (milliseconds — lower is better)", H2_STYLE),
        Image(p3, width=170 * mm, height=150 * mm, kind="proportional"),
        PageBreak(),

        Paragraph("Cost score (10 = free & permissive, lower = more expensive/restrictive)", H2_STYLE),
        Image(p4, width=170 * mm, height=150 * mm, kind="proportional"),
        PageBreak(),
    ]

# ---------------------------------------------------------------------------
# Landscape: Detailed comparison
# ---------------------------------------------------------------------------
def _truncate(s, n):
    if s is None: return ""
    s = str(s)
    return s if len(s) <= n else s[:n - 1] + "…"

def _make_subtable(headers, get_row, col_widths_mm):
    """Helper: build one styled sub-table for the detailed sections."""
    rows = [headers]
    for m in MODELS_RANKED:
        rows.append(get_row(m))
    tbl = Table(rows, colWidths=[w * mm for w in col_widths_mm])
    ts = _base_table_style()
    ts.add("FONTSIZE", (0, 1), (-1, -1), 7.5)
    _highlight_top(ts, top_n=5, start_row=1)
    tbl.setStyle(ts)
    return tbl

def section_detailed_landscape():
    """
    Detailed comparison split into FOUR sub-tables, each sized to fit A4
    portrait printable width (~174 mm). Previous single-table version was
    ~274 mm wide, causing the leftmost columns (# and Model) to be clipped
    off the page. The 4-way split keeps every column readable without
    switching page orientation.
    """
    # ---- Part 1 · Basic info (6 cols, 150 mm) ----
    tbl_1a = _make_subtable(
        ["#", "Model", "Category", "Year", "License", "In Project?"],
        lambda m: [
            str(m["rank"]),
            _truncate(m["name"], 34),
            _truncate(m["category"], 26),
            str(m["year"]),
            _truncate(m["license"], 22),
            _truncate(m["in_project"], 18),
        ],
        [8, 55, 32, 12, 30, 20],
    )

    # ---- Part 1 · Detection capabilities (6 cols, 174 mm) ----
    tbl_1b = _make_subtable(
        ["#", "Model", "Acc Photos", "Acc Drawings", "Custom Objects", "Zero-shot"],
        lambda m: [
            str(m["rank"]),
            _truncate(m["name"], 32),
            _truncate(m["acc_photos"], 20),
            _truncate(m["acc_drawings"], 20),
            _truncate(m["custom_objects"], 38),
            _truncate(m["zero_shot"], 26),
        ],
        [8, 50, 22, 22, 42, 30],
    )

    # ---- Part 2 · Performance & deployment (6 cols, 170 mm) ----
    tbl_2a = _make_subtable(
        ["#", "Model", "CPU Speed", "Size", "RAM", "Deployment"],
        lambda m: [
            str(m["rank"]),
            _truncate(m["name"], 30),
            _truncate(m["cpu_speed_text"], 22),
            _truncate(m["model_size"], 18),
            _truncate(m["memory"], 16),
            _truncate(m["deployment"], 45),
        ],
        [8, 45, 24, 20, 18, 55],
    )

    # ---- Part 2 · Integration & business (6 cols, 174 mm) ----
    tbl_2b = _make_subtable(
        ["#", "Model", "Integration", "Cost", "Best Use", "Limitations"],
        lambda m: [
            str(m["rank"]),
            _truncate(m["name"], 30),
            _truncate(m["integration_ease"], 30),
            _truncate(m["cost_text"], 22),
            _truncate(m["best_use"], 28),
            _truncate(m["limitations"], 32),
        ],
        [8, 42, 35, 25, 30, 34],
    )

    return [
        Paragraph("Detailed comparison — Part 1: capabilities", H1_STYLE),
        Paragraph("Sorted by overall score. Top 3 highlighted (gold / teal / coral).", BODY_STYLE),
        Paragraph("Section A — Basic info", H2_STYLE),
        tbl_1a,
        PageBreak(),

        Paragraph("Detailed comparison — Part 1: capabilities (continued)", H1_STYLE),
        Paragraph("Section B — Detection capabilities", H2_STYLE),
        tbl_1b,
        PageBreak(),

        Paragraph("Detailed comparison — Part 2: performance & business", H1_STYLE),
        Paragraph("Section A — Performance & deployment", H2_STYLE),
        tbl_2a,
        PageBreak(),

        Paragraph("Detailed comparison — Part 2: performance & business (continued)", H1_STYLE),
        Paragraph("Section B — Integration & business", H2_STYLE),
        tbl_2b,
        PageBreak(),
    ]

# ---------------------------------------------------------------------------
# Technical scores + Recommendation tables
# ---------------------------------------------------------------------------
def section_scores():
    headers = ["#", "Model", "Acc", "Spd", "Cust", "Depl", "Prod", "Cost", "Eff", "OVERALL"]
    rows = [headers]
    for m in MODELS_RANKED:
        rows.append([
            str(m["rank"]),
            _truncate(m["name"], 34),
            f"{m['score_accuracy']:.1f}",
            f"{m['score_speed']:.1f}",
            f"{m['score_custom']:.1f}",
            f"{m['score_deploy']:.1f}",
            f"{m['score_prod']:.1f}",
            f"{m['score_cost']:.1f}",
            f"{m['score_efficiency']:.1f}",
            f"{m['score_overall']:.2f}",
        ])
    tbl = Table(rows, colWidths=[8*mm, 62*mm, 12*mm, 12*mm, 12*mm, 12*mm,
                                 12*mm, 12*mm, 12*mm, 18*mm])
    ts = _base_table_style()
    ts.add("ALIGN", (2, 1), (-1, -1), "CENTER")
    ts.add("FONTNAME", (-1, 1), (-1, -1), "Helvetica-Bold")
    _highlight_top(ts, top_n=5, start_row=1)
    tbl.setStyle(ts)
    return [
        Paragraph("Technical scores (0-10 per dimension, weighted overall)", H1_STYLE),
        Paragraph(
            "Acc = Accuracy · Spd = Speed · Cust = Custom training · Depl = Deployment · "
            "Prod = Production readiness · Cost = Cost score · Eff = Efficiency",
            BODY_STYLE),
        tbl,
        PageBreak(),
    ]

def section_recommendation_landscape():
    """
    Per-model recommendation table. Split into TWO sub-tables (verdict vs.
    pros/cons) to fit A4 portrait printable width.
    """
    # ---- Verdict (6 cols, ~172 mm) ----
    tbl_a = _make_subtable(
        ["#", "Model", "Overall", "Suitable?", "Priority", "Why Recommended"],
        lambda m: [
            str(m["rank"]),
            _truncate(m["name"], 30),
            f"{m['score_overall']:.2f}",
            _truncate(m["suitable"], 20),
            m["priority"],
            _truncate(m["best_use"], 55),
        ],
        [8, 42, 15, 22, 20, 65],
    )
    ts_a = tbl_a._cellStyles  # noqa: not used but kept for parity
    # Add centered alignment on numeric columns (post-hoc)
    style_a = _base_table_style()
    style_a.add("FONTSIZE", (0, 1), (-1, -1), 7.5)
    style_a.add("ALIGN", (0, 1), (0, -1), "CENTER")
    style_a.add("ALIGN", (2, 1), (2, -1), "CENTER")
    style_a.add("ALIGN", (4, 1), (4, -1), "CENTER")
    _highlight_top(style_a, top_n=5, start_row=1)
    tbl_a.setStyle(style_a)

    # ---- Pros & cons (4 cols, ~172 mm) ----
    tbl_b = _make_subtable(
        ["#", "Model", "Advantages", "Disadvantages"],
        lambda m: [
            str(m["rank"]),
            _truncate(m["name"], 30),
            _truncate(m["advantages"], 55),
            _truncate(m["disadvantages"], 55),
        ],
        [8, 42, 62, 60],
    )
    style_b = _base_table_style()
    style_b.add("FONTSIZE", (0, 1), (-1, -1), 7.5)
    style_b.add("ALIGN", (0, 1), (0, -1), "CENTER")
    _highlight_top(style_b, top_n=5, start_row=1)
    tbl_b.setStyle(style_b)

    return [
        Paragraph("Per-model recommendation — verdict", H1_STYLE),
        Paragraph("Every model's suitability and priority.", BODY_STYLE),
        tbl_a,
        PageBreak(),

        Paragraph("Per-model recommendation — pros & cons", H1_STYLE),
        Paragraph("Continuation: advantages and disadvantages of each option.", BODY_STYLE),
        tbl_b,
    ]

# ---------------------------------------------------------------------------
# Page-flow builder (mixes portrait + landscape via BaseDocTemplate would be
# ideal, but SimpleDocTemplate is enough if we render all landscape content on
# an A4-landscape doc. Simpler approach: build the whole PDF in landscape.
# Trade-off: portrait pages look wide. Compromise: build in portrait, use
# smaller font on wide tables, and let the tables span the printable width.
# ---------------------------------------------------------------------------
def build():
    doc = SimpleDocTemplate(
        OUT_PDF,
        pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm,
        title="AI Vision Model Comparison — Floor-Scan",
        author="facilityManagement docs",
    )
    story = []
    story += section_title()
    story += section_weighting()
    story += section_winners_and_recs()
    story += section_charts()
    story += section_detailed_landscape()
    story += section_scores()
    story += section_recommendation_landscape()
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(f"Wrote {OUT_PDF}")

def footer(canv, doc):
    canv.saveState()
    canv.setFont("Helvetica", 8)
    canv.setFillColor(MUTED)
    canv.drawString(18 * mm, 10 * mm, "facilityManagement · AI Vision Model Comparison")
    canv.drawRightString(200 * mm, 10 * mm, f"Page {doc.page}")
    canv.restoreState()

if __name__ == "__main__":
    build()
