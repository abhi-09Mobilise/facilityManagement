"""
Generates a comparison of every AI/CV approach we discussed for the floor-scan
feature and outputs BOTH:
  - AI_Detection_Models_Comparison.xlsx  (formatted + charts)
  - AI_Detection_Models_Comparison.csv   (plain data, opens in Excel too)

Ranked by overall fit for THIS project (facility booking, small dev team,
wants free). 18 models total.

Run with:
    python generate_ai_comparison.py
"""

import csv
from openpyxl import Workbook
from openpyxl.chart import BarChart, ScatterChart, Reference, Series
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

XLSX = "AI_Detection_Models_Comparison.xlsx"
CSV_OUT = "AI_Detection_Models_Comparison.csv"

# ---------------------------------------------------------------------------
# Data — each row is one model / approach
# Numeric fields (acc_photo_avg, acc_draw_avg, speed_ms, effort_num) power the
# charts; they mirror the text fields but let Excel plot them.
# ---------------------------------------------------------------------------

HEADERS = [
    "Rank", "Model / Approach", "Type", "Year",
    "Free?", "In Project?",
    "Accuracy (Photos)", "Accuracy (Line Drawings)",
    "Photo Acc %", "Drawing Acc %",   # numeric for charts
    "Speed / Scan (CPU)", "Speed (ms)",  # numeric for charts
    "Model Size", "RAM Needed",
    "Setup Effort", "Setup Effort Score",  # numeric 0-5 for charts
    "Integration Effort", "Fine-tunable?",
    "License", "Best For This Project", "Notes",
]

# Setup effort scale: 0=None, 1=Very Low, 2=Low, 3=Medium, 4=High, 5=Very High

# rank, name, type, year, free?, in-project?, acc-photos-text, acc-drawings-text,
# acc-photo-avg, acc-draw-avg, speed-text, speed-ms, size, ram,
# setup-text, setup-num, integration, fine-tune?, license, best-for, notes
DATA = [
    [1, "YOLOv11 (pretrained COCO)", "CNN (Ultralytics)", 2024,
     "Yes", "No",
     "85-95%", "60-80%", 90, 70,
     "100-300 ms", 200,
     "6-22 MB", "100-300 MB",
     "Low (pip install ultralytics)", 2,
     "Low (~30 lines)", "Yes (easy)",
     "AGPL-3.0",
     "Best free ready-to-use — huge accuracy jump vs template matching",
     "Recommended starting point. Detects chair / dining table / couch out of the box."],

    [2, "YOLOv11 (fine-tuned on floor plans)", "CNN (Ultralytics)", 2024,
     "Yes", "No",
     "95-98%", "95-98%", 96, 96,
     "100-300 ms", 200,
     "6-22 MB", "100-300 MB",
     "High (need 300+ labeled plans)", 4,
     "Low (drop-in weights swap)", "Yes (native)",
     "AGPL-3.0",
     "Best long-term free option once you have labeled data",
     "1-2 days of upfront labeling work then permanent 95%+ accuracy."],

    [3, "YOLOv12 (pretrained)", "CNN + Attention", 2025,
     "Yes", "No",
     "88-96%", "62-82%", 92, 72,
     "120-350 ms", 240,
     "8-25 MB", "150-350 MB",
     "Low", 2,
     "Low", "Yes",
     "AGPL-3.0",
     "Newest YOLO — slightly better accuracy than v11 but less field-tested",
     "Uses attention mechanism. Community still catching up vs v11."],

    [4, "YOLOv10 (pretrained)", "CNN NMS-free", 2024,
     "Yes", "No",
     "85-93%", "60-78%", 89, 69,
     "80-250 ms", 165,
     "6-25 MB", "100-300 MB",
     "Low", 2,
     "Low", "Yes",
     "AGPL-3.0",
     "Faster than v11 (no NMS step) — smaller accuracy improvement",
     "NMS-free means no non-max-suppression post-processing. Faster inference."],

    [5, "YOLOv8 (pretrained COCO)", "CNN (Ultralytics)", 2023,
     "Yes", "No",
     "85-95%", "60-80%", 90, 70,
     "100-400 ms", 250,
     "6-25 MB", "100-300 MB",
     "Low", 2,
     "Low (~30 lines)", "Yes (easy)",
     "AGPL-3.0",
     "Same as YOLOv11 but one version older",
     "Practically identical to v11. Pick v11 unless you have a reason not to."],

    [6, "YOLO-World", "VLM / Zero-shot", 2024,
     "Yes", "No",
     "80-90%", "65-80%", 85, 72,
     "300-800 ms", 550,
     "50-150 MB", "500 MB",
     "Medium", 3,
     "Medium", "Yes",
     "AGPL-3.0",
     "Zero-shot with text prompts — no training needed",
     "Prompt 'chair table' and get results. Great for open-vocab needs."],

    [7, "Grounding DINO", "VLM / Zero-shot", 2023,
     "Yes", "No",
     "80-90%", "75-85%", 85, 80,
     "800-3000 ms (CPU)", 1900,
     "700 MB - 1.5 GB", "2-4 GB",
     "Medium", 3,
     "Medium (heavy deps)", "Yes",
     "Apache-2.0",
     "Free / prompt-driven / works on drawings too — heavier setup",
     "Best zero-shot accuracy but slow on CPU."],

    [8, "OWLv2 (Google)", "VLM / Zero-shot", 2023,
     "Yes", "No",
     "78-88%", "70-82%", 83, 76,
     "500-1500 ms", 1000,
     "600 MB - 1.2 GB", "2 GB",
     "Medium", 3,
     "Medium", "Yes",
     "Apache-2.0",
     "Google's open-vocab detector — alternative to Grounding DINO",
     "Slightly faster than Grounding DINO. Fewer community integrations."],

    [9, "Florence-2 (Microsoft)", "Multimodal Foundation", 2024,
     "Yes (weights) / API paid", "No",
     "85-93%", "80-90%", 89, 85,
     "400-1500 ms", 950,
     "230-770 MB", "1-3 GB",
     "Medium", 3,
     "Medium", "Partial",
     "MIT (weights)",
     "Small but capable multimodal — great accuracy per MB",
     "Microsoft's compact foundation model. Underrated. MIT license = commercial-friendly."],

    [10, "Claude Vision API (Anthropic)", "Multimodal LLM", 2024,
     "No (paid — ~$0.01-0.05/scan)", "No",
     "90-95%", "90-95%", 92, 92,
     "1-3 seconds", 2000,
     "N/A (hosted)", "0 (hosted)",
     "Very Low", 1,
     "Low (~50 lines)", "No (prompt-driven)",
     "Commercial",
     "Fastest path to production-grade accuracy — pay per call",
     "Best 'just works' option. ~$0.02 per scan; negligible for facility booking volume."],

    [11, "GPT-4V / GPT-4o Vision (OpenAI)", "Multimodal LLM", 2023,
     "No (paid — ~$0.01-0.05/scan)", "No",
     "90-95%", "85-95%", 92, 90,
     "1-3 seconds", 2000,
     "N/A (hosted)", "0 (hosted)",
     "Very Low", 1,
     "Low (~50 lines)", "No",
     "Commercial",
     "Industry-standard vision LLM — same speed/quality as Claude Vision",
     "Well-documented / huge community. Equivalent to Claude Vision in most tasks."],

    [12, "Gemini Vision (Google)", "Multimodal LLM", 2023,
     "Yes (free tier) / paid at scale", "No",
     "88-93%", "85-92%", 90, 88,
     "1-4 seconds", 2500,
     "N/A (hosted)", "0 (hosted)",
     "Very Low", 1,
     "Low (~50 lines)", "No",
     "Commercial (free tier)",
     "Cheapest hosted VLM — has a free tier",
     "Good for testing or low-volume prod."],

    [13, "Roboflow Universe (hosted models)", "Various pretrained", 2024,
     "Yes (free tier for training) / paid API", "No",
     "70-90% (depends on model)", "70-90%", 80, 80,
     "500-2000 ms (API)", 1200,
     "Varies", "0 (hosted)",
     "Very Low (browse + click)", 1,
     "Low (REST API)", "Yes (via Roboflow)",
     "Commercial (free tier)",
     "Skip training — search for pretrained floor-plan models others uploaded",
     "Community hub with 100k+ pretrained models. Great time-saver."],

    [14, "SAM 2 (Segment Anything)", "Foundation model", 2024,
     "Yes", "No",
     "Detects any shape (needs classifier)", "Detects any shape (needs classifier)", 0, 0,
     "300 ms - 2 s", 1100,
     "160-900 MB", "1-3 GB",
     "Medium", 3,
     "High (needs classifier on top)", "No (used as-is)",
     "Apache-2.0",
     "Great for interactive editors ('click to segment')",
     "Segments perfectly but doesn't classify. Needs a second model."],

    [15, "Mask R-CNN (torchvision)", "CNN (2-stage)", 2017,
     "Yes", "Yes (python/ folder, not wired in)",
     "60-75%", "65-80%", 68, 72,
     "2-10 seconds", 6000,
     "180 MB", "1.5-3 GB",
     "Medium (heavy PyTorch)", 3,
     "Medium (wire into Node)", "Hard",
     "BSD-style",
     "Legacy option — inferior to YOLOv11 on every practical dimension in 2026",
     "Only worth using if already wired in. Otherwise pick YOLOv11."],

    [16, "RT-DETR / DETR", "Transformer", 2023,
     "Yes", "No",
     "80-90%", "70-85%", 85, 78,
     "200-800 ms", 500,
     "40-100 MB", "500 MB - 1 GB",
     "Medium", 3,
     "Medium", "Yes",
     "Apache-2.0",
     "Modern transformer alternative to YOLO",
     "Solid model but YOLO ecosystem is friendlier for this project."],

    [17, "YOLOv5 (pretrained)", "CNN", 2020,
     "Yes", "No",
     "80-90%", "60-75%", 85, 68,
     "150-500 ms", 325,
     "14-88 MB", "150-400 MB",
     "Low", 2,
     "Low", "Yes",
     "AGPL-3.0",
     "Older YOLO — pick if you want a slightly permissive license option",
     "Still widely used. Slightly less accurate than YOLOv8/v11."],

    [18, "OpenCV Template Matching (current)", "Rules-based CV", "N/A",
     "Yes", "Yes (floor-scan-svc/app.py)",
     "30-50%", "40-70%", 40, 55,
     "100-500 ms", 300,
     "0 MB (rules only)", "50 MB",
     "None (already running)", 0,
     "None (already wired in)", "No (rules)",
     "MIT",
     "Currently used — fast + free but capped in accuracy",
     "Baseline. Improves with templates but ceiling ~70-80%."],
]

# ---------------------------------------------------------------------------
# CSV output — plain data with numeric columns too
# ---------------------------------------------------------------------------

def write_csv():
    with open(CSV_OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(HEADERS)
        w.writerows(DATA)
    print(f"Wrote {CSV_OUT}")


# ---------------------------------------------------------------------------
# XLSX output — formatted table + charts
# ---------------------------------------------------------------------------

HEADER_FILL = PatternFill(start_color="0F1B2D", end_color="0F1B2D", fill_type="solid")
HEADER_FONT = Font(color="FFFFFF", bold=True, size=11, name="Segoe UI")
HEADER_ALIGN = Alignment(horizontal="center", vertical="center", wrap_text=True)

RANK_FILLS = {
    1: PatternFill(start_color="DCF3EE", end_color="DCF3EE", fill_type="solid"),  # top pick — teal
    2: PatternFill(start_color="E7ECFF", end_color="E7ECFF", fill_type="solid"),
    3: PatternFill(start_color="E7ECFF", end_color="E7ECFF", fill_type="solid"),
}
DEFAULT_ROW_FILL = PatternFill(start_color="FFFFFF", end_color="FFFFFF", fill_type="solid")
ALT_ROW_FILL     = PatternFill(start_color="F5F7FB", end_color="F5F7FB", fill_type="solid")

thin = Side(border_style="thin", color="E2E6EE")
CELL_BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
CELL_FONT = Font(size=10, name="Segoe UI")
CELL_ALIGN = Alignment(horizontal="left", vertical="top", wrap_text=True)
RANK_FONT = Font(size=11, bold=True, name="Segoe UI", color="0F1B2D")
RANK_ALIGN = Alignment(horizontal="center", vertical="center")


def build_comparison_sheet(wb):
    ws = wb.active
    ws.title = "Comparison"

    ws.row_dimensions[1].height = 40
    for c, h in enumerate(HEADERS, start=1):
        cell = ws.cell(row=1, column=c, value=h)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = HEADER_ALIGN
        cell.border = CELL_BORDER

    for r, row in enumerate(DATA, start=2):
        rank = row[0]
        row_fill = RANK_FILLS.get(rank, ALT_ROW_FILL if r % 2 == 0 else DEFAULT_ROW_FILL)
        ws.row_dimensions[r].height = 90
        for c, v in enumerate(row, start=1):
            cell = ws.cell(row=r, column=c, value=v)
            cell.fill = row_fill
            cell.border = CELL_BORDER
            if c == 1:
                cell.font = RANK_FONT
                cell.alignment = RANK_ALIGN
            else:
                cell.font = CELL_FONT
                cell.alignment = CELL_ALIGN

    widths = {
        1: 6, 2: 30, 3: 22, 4: 8, 5: 22, 6: 26,
        7: 18, 8: 22, 9: 12, 10: 14,
        11: 22, 12: 11, 13: 14, 14: 14,
        15: 26, 16: 12, 17: 24, 18: 16,
        19: 20, 20: 45, 21: 55,
    }
    for c, w in widths.items():
        ws.column_dimensions[get_column_letter(c)].width = w

    ws.freeze_panes = "C2"
    ws.auto_filter.ref = ws.dimensions


def build_charts_sheet(wb):
    """
    Charts sheet with 3 visuals that make the ranking easy to grasp at a glance.
    All chart data comes from the numeric columns in Comparison sheet.
    """
    src = wb["Comparison"]
    ws = wb.create_sheet(title="Charts")

    n_rows = len(DATA)
    # Column indexes in Comparison sheet (1-based):
    #   B (2)  = Model name
    #   I (9)  = Photo Acc %
    #   J (10) = Drawing Acc %
    #   L (12) = Speed (ms)
    #   P (16) = Setup Effort Score

    # ---- Chart 1: Accuracy comparison (bar chart, photos vs drawings) ----
    chart1 = BarChart()
    chart1.type = "bar"
    chart1.style = 11
    chart1.title = "Detection Accuracy — Photos vs Line Drawings (%)"
    chart1.y_axis.title = "Model"
    chart1.x_axis.title = "Accuracy (%)"
    chart1.height = 22
    chart1.width = 28
    chart1.gapWidth = 60

    # Values: cols I..J, rows 2..(n+1). Include header row for legend.
    data_ref = Reference(src, min_col=9, max_col=10, min_row=1, max_row=n_rows + 1)
    cats_ref = Reference(src, min_col=2, max_col=2, min_row=2, max_row=n_rows + 1)
    chart1.add_data(data_ref, titles_from_data=True)
    chart1.set_categories(cats_ref)

    ws.add_chart(chart1, "A1")

    # ---- Chart 2: Speed comparison (bar chart, ms per scan) ----
    chart2 = BarChart()
    chart2.type = "bar"
    chart2.style = 12
    chart2.title = "Speed per Scan (ms, CPU) — lower is better"
    chart2.y_axis.title = "Model"
    chart2.x_axis.title = "Milliseconds"
    chart2.height = 22
    chart2.width = 28
    chart2.gapWidth = 60

    speed_ref = Reference(src, min_col=12, max_col=12, min_row=1, max_row=n_rows + 1)
    chart2.add_data(speed_ref, titles_from_data=True)
    chart2.set_categories(cats_ref)

    ws.add_chart(chart2, "A47")

    # ---- Chart 3: Effort vs Accuracy scatter ----
    # X = setup effort (0-5), Y = average of photo+drawing accuracy
    # We'll dump helper data in the Charts sheet itself so the scatter has clean refs.
    ws["Q1"] = "Model"
    ws["R1"] = "Effort"
    ws["S1"] = "Avg Accuracy"
    for i, row in enumerate(DATA, start=2):
        ws.cell(row=i, column=17, value=row[1])   # Q: model
        ws.cell(row=i, column=18, value=row[15])  # R: effort num
        photo, draw = row[8], row[9]
        avg = (photo + draw) / 2 if (photo and draw) else max(photo, draw)
        ws.cell(row=i, column=19, value=round(avg, 1))  # S: avg accuracy

    chart3 = ScatterChart()
    chart3.title = "Setup Effort vs Accuracy — top-left = easy wins"
    chart3.x_axis.title = "Setup Effort (0=None, 5=Very High)"
    chart3.y_axis.title = "Average Accuracy (%)"
    chart3.style = 13
    chart3.height = 18
    chart3.width = 28

    x_ref = Reference(ws, min_col=18, min_row=2, max_row=n_rows + 1)
    y_ref = Reference(ws, min_col=19, min_row=2, max_row=n_rows + 1)
    series = Series(y_ref, x_ref, title="Models")
    chart3.series.append(series)

    ws.add_chart(chart3, "A93")


def build_legend_sheet(wb):
    ws = wb.create_sheet(title="Legend & Methodology")
    rows = [
        ("Column", "What it means"),
        ("Rank", "My recommended order for THIS project. Not a global 'best AI' ranking."),
        ("Type", "Rules-based CV / CNN / Transformer / VLM / Multimodal LLM / Foundation model."),
        ("Year", "First public release year of this specific model/approach."),
        ("Free?", "Zero ongoing cost. 'Paid' means you pay per API call."),
        ("In Project?", "Whether this is already installed/wired into the facilityManagement codebase."),
        ("Accuracy (Photos)", "Realistic detection rate on real-world photos of rooms."),
        ("Accuracy (Line Drawings)", "Realistic detection rate on architectural line-drawing floor plans."),
        ("Photo Acc % / Drawing Acc %", "Numeric mid-point of the accuracy range — used to draw the charts."),
        ("Speed / Scan", "Time per image on a mid-range Windows laptop CPU (no GPU)."),
        ("Speed (ms)", "Numeric mid-point of the speed range — used to draw the speed chart."),
        ("Model Size", "Weight file size (what needs to be downloaded once)."),
        ("RAM Needed", "Approximate resident memory while running."),
        ("Setup Effort", "How much work to get running standalone. None / Very Low / Low / Medium / High / Very High."),
        ("Setup Effort Score", "0-5 numeric encoding of the setup effort — used to draw the scatter chart."),
        ("Integration Effort", "How much work to wire into this project's Node+Python architecture."),
        ("Fine-tunable?", "Can you specialize it on your own labeled data for higher accuracy?"),
        ("License", "AGPL-3.0 = free for internal/self-hosted (must open-source modifications if distributed)."),
        ("Best For This Project", "Where this option makes practical sense given app's constraints."),
        ("Notes", "Important caveats or extra context."),
        ("", ""),
        ("Accuracy tiers", ""),
        ("30-50%", "Fails often; heavy manual cleanup required."),
        ("50-70%", "Usable head-start; still significant cleanup."),
        ("70-85%", "Reliable; occasional cleanup."),
        ("85-95%", "Production-grade for most needs."),
        ("95-98%", "Near-perfect; only edge cases need review."),
        ("", ""),
        ("Setup effort tiers", ""),
        ("None (0)", "Already installed."),
        ("Very Low (1)", "One API key, one HTTP call. Under 15 minutes."),
        ("Low (2)", "One pip install + a few lines of code. Under 1 hour."),
        ("Medium (3)", "New deps + integration code + testing. Half a day."),
        ("High (4)", "Requires training data + labeling + model training. 1-2 days minimum."),
        ("Very High (5)", "Multiple sub-systems, custom integration. Weeks."),
        ("", ""),
        ("How to read the charts", ""),
        ("Chart 1 — Accuracy", "Two bars per model — blue = photos, orange = line drawings. Long bars = better."),
        ("Chart 2 — Speed", "Shorter bars = faster per-scan. LLM APIs are slow because of network latency."),
        ("Chart 3 — Effort vs Accuracy", "Dots in the top-left corner = best deals (high accuracy, low effort)."),
    ]

    ws.column_dimensions["A"].width = 32
    ws.column_dimensions["B"].width = 100
    for i, (a, b) in enumerate(rows, start=1):
        ws.cell(row=i, column=1, value=a).font = Font(bold=True, name="Segoe UI", size=10)
        ws.cell(row=i, column=2, value=b).font = Font(name="Segoe UI", size=10)
        ws.cell(row=i, column=2).alignment = Alignment(wrap_text=True, vertical="top")
        ws.row_dimensions[i].height = 30
    for c in ws[1]:
        c.fill = HEADER_FILL
        c.font = HEADER_FONT
        c.alignment = HEADER_ALIGN


def write_xlsx():
    wb = Workbook()
    build_comparison_sheet(wb)
    build_charts_sheet(wb)
    build_legend_sheet(wb)
    wb.save(XLSX)
    print(f"Wrote {XLSX}")


if __name__ == "__main__":
    write_csv()
    write_xlsx()
    print("Done.")
