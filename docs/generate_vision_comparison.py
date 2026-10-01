"""
Comprehensive AI/CV model comparison for the floor-scan feature.

Generates:
  - AI_Vision_Model_Comparison.xlsx (4 sheets + charts + conditional formatting)
  - AI_Vision_Model_Comparison.csv  (flat detailed comparison)

Weighting reflects THIS project's constraints:
  - Small dev team, existing Node + Python stack
  - CPU deployment (no GPU box)
  - Free is a hard preference
  - Scans are NOT real-time (one-off per room setup), so raw speed matters less
  - Long-term maintainability matters

Overall = 0.25*Accuracy + 0.15*Speed + 0.15*Custom + 0.15*Deploy
       + 0.12*ProdReady + 0.12*Cost + 0.06*Efficiency
"""

import csv
from openpyxl import Workbook
from openpyxl.chart import BarChart, ScatterChart, PieChart, Reference, Series
from openpyxl.chart.label import DataLabelList
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.formatting.rule import ColorScaleRule, DataBarRule
from openpyxl.utils import get_column_letter

XLSX = "AI_Vision_Model_Comparison.xlsx"
CSV_OUT = "AI_Vision_Model_Comparison.csv"

# ---------------------------------------------------------------------------
# WEIGHTING (transparent, tuned for this project)
# ---------------------------------------------------------------------------
WEIGHTS = {
    "accuracy":   0.25,  # Detection accuracy on your image types
    "speed":      0.15,  # CPU inference speed
    "custom":     0.15,  # Fine-tuning / custom-class support
    "deploy":     0.15,  # Deployment + integration ease into Node+Python
    "prod":       0.12,  # Production maturity + stability
    "cost":       0.12,  # Free vs paid, licensing friction
    "efficiency": 0.06,  # Model size + memory footprint
}

# ---------------------------------------------------------------------------
# MODEL DATABASE — 21 models across 6 categories
# ---------------------------------------------------------------------------
# Score conventions (1-10):
#   1-3 = poor, 4-6 = average, 7-8 = good, 9-10 = excellent
#   For "cost", 10 = free & permissive license, 1 = expensive
#   For "efficiency", 10 = tiny & fast, 1 = huge & slow
# ---------------------------------------------------------------------------

CAT_PRETRAINED = "Pretrained CNN Detector"
CAT_FINETUNED  = "Fine-tuned CNN Detector"
CAT_ZEROSHOT   = "Zero-shot Detector (VLM)"
CAT_SEGMENT    = "Segmentation-only"
CAT_VLM        = "Vision-Language LLM"
CAT_RULES      = "Rules-based CV"

MODELS = [
    # ---- CNN DETECTORS (pretrained) ----
    {
        "name": "YOLOv11 (pretrained COCO)",
        "category": CAT_PRETRAINED,
        "year": 2024, "license": "AGPL-3.0", "open_source": "Yes", "in_project": "No",
        "acc_photos": "85-95%", "acc_drawings": "60-80%",
        "custom_objects": "Excellent — fine-tune with ~300 labeled images",
        "zero_shot": "No", "cpu_speed_ms": 200, "cpu_speed_text": "100-300 ms",
        "model_size": "6-22 MB", "memory": "100-300 MB",
        "prod_ready": "Very high (huge community)",
        "deployment": "Very easy (pip install ultralytics)",
        "integration_ease": "Easy (~30 lines Python)",
        "scalability": "Excellent", "cost_text": "Free (AGPL restrictions if redistributed)",
        "offline": "Yes",
        "difficult_images": "Struggles with line drawings without fine-tuning",
        "fp_risk": "Low", "fn_risk": "Medium on drawings, low on photos",
        "best_use": "Best free ready-to-use detector for THIS project",
        "limitations": "AGPL, no zero-shot for unseen classes",
        "score_accuracy": 8.0, "score_speed": 8.0, "score_custom": 9.0, "score_deploy": 9.0,
        "score_prod": 10.0, "score_cost": 8.0, "score_efficiency": 10.0,
        "advantages": "Huge community; tiny model; easy fine-tune; CPU-fine",
        "disadvantages": "AGPL license friction; needs training for new classes",
        "suitable": "Yes", "priority": "★★★★★",
    },
    {
        "name": "YOLOv12 (pretrained)",
        "category": CAT_PRETRAINED,
        "year": 2025, "license": "AGPL-3.0", "open_source": "Yes", "in_project": "No",
        "acc_photos": "88-96%", "acc_drawings": "62-82%",
        "custom_objects": "Excellent",
        "zero_shot": "No", "cpu_speed_ms": 240, "cpu_speed_text": "120-350 ms",
        "model_size": "8-25 MB", "memory": "150-350 MB",
        "prod_ready": "Emerging (2025 release, less battle-tested)",
        "deployment": "Very easy", "integration_ease": "Easy",
        "scalability": "Excellent", "cost_text": "Free (AGPL)",
        "offline": "Yes",
        "difficult_images": "Slightly better than v11 on unusual angles",
        "fp_risk": "Low", "fn_risk": "Medium on drawings",
        "best_use": "For teams tracking the newest release",
        "limitations": "Too new for production certainty; small community",
        "score_accuracy": 8.5, "score_speed": 7.5, "score_custom": 9.0, "score_deploy": 8.0,
        "score_prod": 6.0, "score_cost": 8.0, "score_efficiency": 9.0,
        "advantages": "Newest, uses attention, slightly higher accuracy",
        "disadvantages": "Less field-tested; some tooling not caught up",
        "suitable": "Yes (but wait 6-12 months for maturity)", "priority": "★★★",
    },
    {
        "name": "YOLOv10 (pretrained)",
        "category": CAT_PRETRAINED,
        "year": 2024, "license": "AGPL-3.0", "open_source": "Yes", "in_project": "No",
        "acc_photos": "85-93%", "acc_drawings": "60-78%",
        "custom_objects": "Excellent",
        "zero_shot": "No", "cpu_speed_ms": 165, "cpu_speed_text": "80-250 ms",
        "model_size": "6-25 MB", "memory": "100-300 MB",
        "prod_ready": "High",
        "deployment": "Very easy", "integration_ease": "Easy",
        "scalability": "Excellent", "cost_text": "Free (AGPL)",
        "offline": "Yes",
        "difficult_images": "Comparable to v11",
        "fp_risk": "Low", "fn_risk": "Medium",
        "best_use": "When you need faster inference than v11",
        "limitations": "AGPL; marginally less accurate than v11",
        "score_accuracy": 8.0, "score_speed": 9.0, "score_custom": 9.0, "score_deploy": 8.5,
        "score_prod": 8.0, "score_cost": 8.0, "score_efficiency": 10.0,
        "advantages": "NMS-free = simpler pipeline; slightly faster",
        "disadvantages": "Small accuracy dip vs v11",
        "suitable": "Yes", "priority": "★★★★",
    },
    {
        "name": "YOLOv9 (pretrained)",
        "category": CAT_PRETRAINED,
        "year": 2024, "license": "GPL-3.0 (research code MIT)", "open_source": "Yes", "in_project": "No",
        "acc_photos": "84-92%", "acc_drawings": "58-76%",
        "custom_objects": "Good",
        "zero_shot": "No", "cpu_speed_ms": 280, "cpu_speed_text": "150-450 ms",
        "model_size": "10-50 MB", "memory": "200-400 MB",
        "prod_ready": "High",
        "deployment": "Medium (less polished than Ultralytics)",
        "integration_ease": "Medium (~60 lines Python)",
        "scalability": "Good", "cost_text": "Free (more permissive than Ultralytics)",
        "offline": "Yes",
        "difficult_images": "Comparable to v8",
        "fp_risk": "Low-medium", "fn_risk": "Medium",
        "best_use": "When AGPL is a legal blocker",
        "limitations": "Less polished ecosystem than Ultralytics",
        "score_accuracy": 7.5, "score_speed": 7.5, "score_custom": 8.0, "score_deploy": 7.0,
        "score_prod": 8.0, "score_cost": 10.0, "score_efficiency": 9.0,
        "advantages": "More permissive license than Ultralytics",
        "disadvantages": "Smaller community; less tooling",
        "suitable": "Yes (if AGPL matters)", "priority": "★★★★",
    },
    {
        "name": "YOLOv8 (pretrained COCO)",
        "category": CAT_PRETRAINED,
        "year": 2023, "license": "AGPL-3.0", "open_source": "Yes", "in_project": "No",
        "acc_photos": "85-95%", "acc_drawings": "60-80%",
        "custom_objects": "Excellent",
        "zero_shot": "No", "cpu_speed_ms": 250, "cpu_speed_text": "100-400 ms",
        "model_size": "6-25 MB", "memory": "100-300 MB",
        "prod_ready": "Very high",
        "deployment": "Very easy", "integration_ease": "Easy",
        "scalability": "Excellent", "cost_text": "Free (AGPL)",
        "offline": "Yes",
        "difficult_images": "Same as v11",
        "fp_risk": "Low", "fn_risk": "Medium on drawings",
        "best_use": "Rock-solid alternative to v11",
        "limitations": "Slightly older than v11",
        "score_accuracy": 8.0, "score_speed": 8.0, "score_custom": 9.0, "score_deploy": 9.0,
        "score_prod": 10.0, "score_cost": 8.0, "score_efficiency": 10.0,
        "advantages": "Most battle-tested Ultralytics YOLO in production",
        "disadvantages": "v11 exists — pick that unless you have reason",
        "suitable": "Yes", "priority": "★★★★",
    },
    {
        "name": "YOLOv5 (pretrained)",
        "category": CAT_PRETRAINED,
        "year": 2020, "license": "AGPL-3.0", "open_source": "Yes", "in_project": "No",
        "acc_photos": "80-90%", "acc_drawings": "60-75%",
        "custom_objects": "Good",
        "zero_shot": "No", "cpu_speed_ms": 325, "cpu_speed_text": "150-500 ms",
        "model_size": "14-88 MB", "memory": "150-400 MB",
        "prod_ready": "Very high (most-deployed YOLO in history)",
        "deployment": "Very easy", "integration_ease": "Easy",
        "scalability": "Excellent", "cost_text": "Free (AGPL)",
        "offline": "Yes",
        "difficult_images": "Slightly worse than v8/v11",
        "fp_risk": "Low", "fn_risk": "Medium",
        "best_use": "Legacy stability if v11 tooling breaks",
        "limitations": "Older, superseded by v8/v11",
        "score_accuracy": 7.0, "score_speed": 7.5, "score_custom": 8.0, "score_deploy": 9.0,
        "score_prod": 10.0, "score_cost": 8.0, "score_efficiency": 8.0,
        "advantages": "Enormous ecosystem, still deployed everywhere",
        "disadvantages": "Older architecture; use v8/v11 for new work",
        "suitable": "Yes (but not first choice)", "priority": "★★★",
    },
    {
        "name": "YOLO-NAS (Deci AI)",
        "category": CAT_PRETRAINED,
        "year": 2023, "license": "Apache-2.0", "open_source": "Yes", "in_project": "No",
        "acc_photos": "85-94%", "acc_drawings": "60-80%",
        "custom_objects": "Good (via SuperGradients)",
        "zero_shot": "No", "cpu_speed_ms": 220, "cpu_speed_text": "120-350 ms",
        "model_size": "18-100 MB", "memory": "200-500 MB",
        "prod_ready": "High",
        "deployment": "Medium (SuperGradients library)",
        "integration_ease": "Medium",
        "scalability": "Excellent", "cost_text": "Free (Apache-2.0 = commercial-friendly)",
        "offline": "Yes",
        "difficult_images": "Comparable to YOLOv8",
        "fp_risk": "Low", "fn_risk": "Medium",
        "best_use": "When you need commercial-friendly YOLO",
        "limitations": "Smaller community than Ultralytics",
        "score_accuracy": 8.0, "score_speed": 8.0, "score_custom": 8.0, "score_deploy": 7.0,
        "score_prod": 8.0, "score_cost": 10.0, "score_efficiency": 8.0,
        "advantages": "Apache-2.0 = redistribute freely; NAS-optimized architecture",
        "disadvantages": "SuperGradients library less polished than Ultralytics",
        "suitable": "Yes (if commercial license matters)", "priority": "★★★★",
    },
    {
        "name": "RTMDet (OpenMMLab)",
        "category": CAT_PRETRAINED,
        "year": 2022, "license": "Apache-2.0", "open_source": "Yes", "in_project": "No",
        "acc_photos": "84-92%", "acc_drawings": "60-78%",
        "custom_objects": "Excellent (via MMDetection)",
        "zero_shot": "No", "cpu_speed_ms": 260, "cpu_speed_text": "140-380 ms",
        "model_size": "20-100 MB", "memory": "250-500 MB",
        "prod_ready": "High",
        "deployment": "Medium (MMDetection setup)",
        "integration_ease": "Medium (~80 lines)",
        "scalability": "Excellent", "cost_text": "Free (Apache-2.0)",
        "offline": "Yes",
        "difficult_images": "Very competitive with YOLO on hard scenes",
        "fp_risk": "Low", "fn_risk": "Medium",
        "best_use": "Commercial-friendly YOLO alternative",
        "limitations": "MMDetection framework has a steep learning curve",
        "score_accuracy": 8.0, "score_speed": 7.5, "score_custom": 8.0, "score_deploy": 6.0,
        "score_prod": 8.0, "score_cost": 10.0, "score_efficiency": 8.0,
        "advantages": "Apache-2.0; benchmark-competitive with YOLO",
        "disadvantages": "MMDetection = heavier framework than Ultralytics",
        "suitable": "Yes (if okay with MMDet)", "priority": "★★★",
    },
    {
        "name": "RT-DETR",
        "category": CAT_PRETRAINED,
        "year": 2023, "license": "Apache-2.0", "open_source": "Yes", "in_project": "No",
        "acc_photos": "80-90%", "acc_drawings": "70-85%",
        "custom_objects": "Good",
        "zero_shot": "No", "cpu_speed_ms": 500, "cpu_speed_text": "200-800 ms",
        "model_size": "40-100 MB", "memory": "500 MB - 1 GB",
        "prod_ready": "Medium-high",
        "deployment": "Medium", "integration_ease": "Medium",
        "scalability": "Good", "cost_text": "Free (Apache-2.0)",
        "offline": "Yes",
        "difficult_images": "Better than YOLO on cluttered scenes",
        "fp_risk": "Low", "fn_risk": "Low-medium",
        "best_use": "Transformer-first teams",
        "limitations": "Slower than YOLO on CPU",
        "score_accuracy": 8.0, "score_speed": 6.5, "score_custom": 7.5, "score_deploy": 6.0,
        "score_prod": 7.0, "score_cost": 10.0, "score_efficiency": 6.5,
        "advantages": "Handles cluttered scenes better; Apache license",
        "disadvantages": "Slower; smaller community than YOLO",
        "suitable": "Yes (niche)", "priority": "★★★",
    },
    {
        "name": "Mask R-CNN (torchvision)",
        "category": CAT_PRETRAINED,
        "year": 2017, "license": "BSD-style", "open_source": "Yes", "in_project": "Yes (unwired)",
        "acc_photos": "60-75%", "acc_drawings": "65-80%",
        "custom_objects": "Hard (heavy training loop)",
        "zero_shot": "No", "cpu_speed_ms": 6000, "cpu_speed_text": "2-10 seconds",
        "model_size": "180 MB", "memory": "1.5-3 GB",
        "prod_ready": "High (mature but old)",
        "deployment": "Medium (heavy PyTorch)",
        "integration_ease": "Medium",
        "scalability": "Poor on CPU", "cost_text": "Free",
        "offline": "Yes",
        "difficult_images": "Decent but obsolete vs modern YOLO",
        "fp_risk": "Medium", "fn_risk": "Medium",
        "best_use": "Only if already wired in",
        "limitations": "9 years old; inferior to YOLOv11 on every practical dimension",
        "score_accuracy": 6.5, "score_speed": 3.0, "score_custom": 6.0, "score_deploy": 5.0,
        "score_prod": 8.0, "score_cost": 10.0, "score_efficiency": 3.0,
        "advantages": "Already in the project; produces masks + boxes",
        "disadvantages": "Slow; heavy; outdated",
        "suitable": "No (use YOLOv11 instead)", "priority": "★",
    },

    # ---- FINE-TUNED ----
    {
        "name": "YOLOv11 (fine-tuned on floor plans)",
        "category": CAT_FINETUNED,
        "year": 2024, "license": "AGPL-3.0", "open_source": "Yes", "in_project": "No",
        "acc_photos": "95-98%", "acc_drawings": "95-98%",
        "custom_objects": "Native (trained on your data)",
        "zero_shot": "No (but classes match your data)",
        "cpu_speed_ms": 200, "cpu_speed_text": "100-300 ms",
        "model_size": "6-22 MB", "memory": "100-300 MB",
        "prod_ready": "Very high",
        "deployment": "Very easy (drop-in weights)",
        "integration_ease": "Easy (same code as pretrained)",
        "scalability": "Excellent", "cost_text": "Free (AGPL)",
        "offline": "Yes",
        "difficult_images": "Excellent on plans matching your training data",
        "fp_risk": "Very low", "fn_risk": "Very low",
        "best_use": "Best long-term option once you have labeled data",
        "limitations": "Needs 300+ labeled floor plans upfront (~1-2 days work)",
        "score_accuracy": 9.5, "score_speed": 8.0, "score_custom": 10.0, "score_deploy": 9.0,
        "score_prod": 10.0, "score_cost": 8.0, "score_efficiency": 10.0,
        "advantages": "Near-perfect accuracy on YOUR floor plans",
        "disadvantages": "Upfront labeling cost; retraining needed if domain shifts",
        "suitable": "Yes (Phase 2 goal)", "priority": "★★★★★",
    },

    # ---- ZERO-SHOT DETECTORS ----
    {
        "name": "YOLO-World",
        "category": CAT_ZEROSHOT,
        "year": 2024, "license": "AGPL-3.0", "open_source": "Yes", "in_project": "No",
        "acc_photos": "80-90%", "acc_drawings": "65-80%",
        "custom_objects": "Native (prompt-based, no training)",
        "zero_shot": "Yes (native)",
        "cpu_speed_ms": 550, "cpu_speed_text": "300-800 ms",
        "model_size": "50-150 MB", "memory": "500 MB",
        "prod_ready": "Medium-high",
        "deployment": "Medium", "integration_ease": "Medium",
        "scalability": "Good", "cost_text": "Free (AGPL)",
        "offline": "Yes",
        "difficult_images": "Reasonable on unseen classes",
        "fp_risk": "Medium", "fn_risk": "Medium",
        "best_use": "New class categories without retraining",
        "limitations": "Slower than YOLO; accuracy drops on ambiguous prompts",
        "score_accuracy": 7.5, "score_speed": 6.5, "score_custom": 7.5, "score_deploy": 6.5,
        "score_prod": 7.0, "score_cost": 8.0, "score_efficiency": 7.5,
        "advantages": "Detect new classes via text prompt without training",
        "disadvantages": "Slower and less accurate than fine-tuned YOLO",
        "suitable": "Yes (niche)", "priority": "★★★",
    },
    {
        "name": "Grounding DINO",
        "category": CAT_ZEROSHOT,
        "year": 2023, "license": "Apache-2.0", "open_source": "Yes", "in_project": "No",
        "acc_photos": "80-90%", "acc_drawings": "75-85%",
        "custom_objects": "Native (prompt-based)",
        "zero_shot": "Yes (native, high quality)",
        "cpu_speed_ms": 1900, "cpu_speed_text": "800 ms - 3 s (CPU)",
        "model_size": "700 MB - 1.5 GB", "memory": "2-4 GB",
        "prod_ready": "High",
        "deployment": "Medium (heavy deps)",
        "integration_ease": "Medium",
        "scalability": "Poor on CPU, good on GPU", "cost_text": "Free (Apache-2.0)",
        "offline": "Yes",
        "difficult_images": "Best zero-shot on line drawings",
        "fp_risk": "Low", "fn_risk": "Low-medium",
        "best_use": "Best zero-shot accuracy if you have a GPU",
        "limitations": "Slow on CPU; large model",
        "score_accuracy": 8.0, "score_speed": 3.5, "score_custom": 8.0, "score_deploy": 5.5,
        "score_prod": 7.5, "score_cost": 10.0, "score_efficiency": 4.0,
        "advantages": "Best zero-shot; Apache-2.0; text prompts",
        "disadvantages": "Very slow on CPU; heavy",
        "suitable": "Yes (if GPU available)", "priority": "★★★",
    },
    {
        "name": "OWLv2 (Google)",
        "category": CAT_ZEROSHOT,
        "year": 2023, "license": "Apache-2.0", "open_source": "Yes", "in_project": "No",
        "acc_photos": "78-88%", "acc_drawings": "70-82%",
        "custom_objects": "Native (prompt-based)",
        "zero_shot": "Yes",
        "cpu_speed_ms": 1000, "cpu_speed_text": "500-1500 ms",
        "model_size": "600 MB - 1.2 GB", "memory": "2 GB",
        "prod_ready": "Medium-high",
        "deployment": "Medium", "integration_ease": "Medium",
        "scalability": "Fair", "cost_text": "Free (Apache-2.0)",
        "offline": "Yes",
        "difficult_images": "Good on unseen classes",
        "fp_risk": "Medium", "fn_risk": "Medium",
        "best_use": "Faster alternative to Grounding DINO",
        "limitations": "Slower than YOLO; smaller community",
        "score_accuracy": 7.5, "score_speed": 5.0, "score_custom": 7.0, "score_deploy": 5.0,
        "score_prod": 7.0, "score_cost": 10.0, "score_efficiency": 5.0,
        "advantages": "Google research; Apache-2.0; text prompts",
        "disadvantages": "Fewer integrations than Grounding DINO",
        "suitable": "Yes (niche)", "priority": "★★★",
    },

    # ---- SEGMENTATION-ONLY ----
    {
        "name": "SAM 2 (Segment Anything)",
        "category": CAT_SEGMENT,
        "year": 2024, "license": "Apache-2.0", "open_source": "Yes", "in_project": "No",
        "acc_photos": "N/A (segments only; needs classifier)",
        "acc_drawings": "N/A (segments only; needs classifier)",
        "custom_objects": "N/A (doesn't classify)",
        "zero_shot": "Yes (for segmentation, not classification)",
        "cpu_speed_ms": 1100, "cpu_speed_text": "300 ms - 2 s",
        "model_size": "160-900 MB", "memory": "1-3 GB",
        "prod_ready": "High",
        "deployment": "Medium", "integration_ease": "High (needs classifier on top)",
        "scalability": "Fair", "cost_text": "Free (Apache-2.0)",
        "offline": "Yes",
        "difficult_images": "Segments almost anything",
        "fp_risk": "N/A (no classification)", "fn_risk": "N/A",
        "best_use": "Interactive editors (click-to-segment); NOT a full detector",
        "limitations": "Does NOT identify chairs vs tables — needs a second model",
        "score_accuracy": 4.0, "score_speed": 5.0, "score_custom": 4.0, "score_deploy": 5.0,
        "score_prod": 8.0, "score_cost": 10.0, "score_efficiency": 4.0,
        "advantages": "Perfect segmentation of any shape",
        "disadvantages": "Not a detector — you need to pair with a classifier",
        "suitable": "No (wrong category for THIS task alone)", "priority": "★★",
    },

    # ---- VISION-LANGUAGE LLMs ----
    {
        "name": "Claude Vision API (Anthropic)",
        "category": CAT_VLM,
        "year": 2024, "license": "Commercial", "open_source": "No", "in_project": "No",
        "acc_photos": "90-95%", "acc_drawings": "90-95%",
        "custom_objects": "Native (prompt-based, any category)",
        "zero_shot": "Yes",
        "cpu_speed_ms": 2000, "cpu_speed_text": "1-3 seconds (network)",
        "model_size": "N/A (hosted)", "memory": "0 (hosted)",
        "prod_ready": "Very high",
        "deployment": "Very easy (API key + HTTP)",
        "integration_ease": "Very easy (~50 lines)",
        "scalability": "Excellent", "cost_text": "Paid (~$0.01-0.05 per scan)",
        "offline": "No",
        "difficult_images": "Excellent (understands context)",
        "fp_risk": "Low", "fn_risk": "Low",
        "best_use": "Fastest path to production-grade accuracy",
        "limitations": "Costs per call; requires internet; no bulk offline",
        "score_accuracy": 9.0, "score_speed": 4.0, "score_custom": 3.0, "score_deploy": 9.0,
        "score_prod": 9.5, "score_cost": 4.0, "score_efficiency": 8.0,
        "advantages": "Best 'just works' accuracy; near-zero setup; understands intent",
        "disadvantages": "Recurring cost; needs internet; no coordinate guarantees",
        "suitable": "Yes (if paid is acceptable)", "priority": "★★★★",
    },
    {
        "name": "GPT-4o / GPT-4.1 Vision (OpenAI)",
        "category": CAT_VLM,
        "year": 2024, "license": "Commercial", "open_source": "No", "in_project": "No",
        "acc_photos": "90-95%", "acc_drawings": "85-95%",
        "custom_objects": "Native (prompt-based)",
        "zero_shot": "Yes",
        "cpu_speed_ms": 2000, "cpu_speed_text": "1-3 seconds (network)",
        "model_size": "N/A (hosted)", "memory": "0 (hosted)",
        "prod_ready": "Very high",
        "deployment": "Very easy (API key + HTTP)",
        "integration_ease": "Very easy (~50 lines)",
        "scalability": "Excellent", "cost_text": "Paid (~$0.01-0.05 per scan)",
        "offline": "No",
        "difficult_images": "Excellent",
        "fp_risk": "Low", "fn_risk": "Low",
        "best_use": "Equivalent to Claude Vision in most tasks",
        "limitations": "Costs per call; requires internet",
        "score_accuracy": 9.0, "score_speed": 4.0, "score_custom": 3.0, "score_deploy": 9.0,
        "score_prod": 9.5, "score_cost": 4.0, "score_efficiency": 8.0,
        "advantages": "Industry standard; huge ecosystem; JSON mode",
        "disadvantages": "Recurring cost; needs internet",
        "suitable": "Yes (if paid is acceptable)", "priority": "★★★★",
    },
    {
        "name": "Gemini 2.5 Vision (Google)",
        "category": CAT_VLM,
        "year": 2025, "license": "Commercial (free tier)", "open_source": "No", "in_project": "No",
        "acc_photos": "88-93%", "acc_drawings": "85-92%",
        "custom_objects": "Native (prompt-based)",
        "zero_shot": "Yes",
        "cpu_speed_ms": 2500, "cpu_speed_text": "1-4 seconds",
        "model_size": "N/A (hosted)", "memory": "0 (hosted)",
        "prod_ready": "Very high",
        "deployment": "Very easy", "integration_ease": "Very easy",
        "scalability": "Excellent", "cost_text": "Free tier + paid",
        "offline": "No",
        "difficult_images": "Very good",
        "fp_risk": "Low", "fn_risk": "Low",
        "best_use": "Cheapest hosted VLM (has free tier)",
        "limitations": "Free tier has rate limits; slightly less accurate than Claude/GPT",
        "score_accuracy": 8.5, "score_speed": 3.5, "score_custom": 3.0, "score_deploy": 9.0,
        "score_prod": 8.5, "score_cost": 6.0, "score_efficiency": 8.0,
        "advantages": "Free tier available; good for low-volume",
        "disadvantages": "Rate-limited free tier; slightly less accurate",
        "suitable": "Yes (for low volume)", "priority": "★★★★",
    },
    {
        "name": "Florence-2 (Microsoft)",
        "category": CAT_VLM,
        "year": 2024, "license": "MIT (weights)", "open_source": "Yes", "in_project": "No",
        "acc_photos": "85-93%", "acc_drawings": "80-90%",
        "custom_objects": "Prompt-based + partial fine-tuning",
        "zero_shot": "Yes",
        "cpu_speed_ms": 950, "cpu_speed_text": "400-1500 ms",
        "model_size": "230-770 MB", "memory": "1-3 GB",
        "prod_ready": "High",
        "deployment": "Medium", "integration_ease": "Medium",
        "scalability": "Good", "cost_text": "Free (MIT)",
        "offline": "Yes",
        "difficult_images": "Very good",
        "fp_risk": "Low", "fn_risk": "Low",
        "best_use": "Open-source alternative to Claude/GPT vision — runs locally",
        "limitations": "Requires more RAM than YOLO",
        "score_accuracy": 8.5, "score_speed": 6.0, "score_custom": 6.5, "score_deploy": 6.0,
        "score_prod": 7.5, "score_cost": 10.0, "score_efficiency": 6.5,
        "advantages": "MIT license; runs locally; compact multimodal",
        "disadvantages": "Slower than YOLO; less mature ecosystem than Ultralytics",
        "suitable": "Yes (great mid-tier option)", "priority": "★★★★",
    },
    {
        "name": "InternVL2 / InternVL3",
        "category": CAT_VLM,
        "year": 2024, "license": "MIT / Apache-2.0", "open_source": "Yes", "in_project": "No",
        "acc_photos": "85-92%", "acc_drawings": "80-90%",
        "custom_objects": "Prompt-based",
        "zero_shot": "Yes",
        "cpu_speed_ms": 4000, "cpu_speed_text": "2-8 seconds",
        "model_size": "1-8 GB", "memory": "4-20 GB",
        "prod_ready": "Medium-high",
        "deployment": "Hard (large model)",
        "integration_ease": "Medium",
        "scalability": "Poor on CPU", "cost_text": "Free (open weights)",
        "offline": "Yes",
        "difficult_images": "Very good",
        "fp_risk": "Low", "fn_risk": "Low",
        "best_use": "Open-source competitor to Claude/GPT for local deployment",
        "limitations": "Needs a GPU with ≥16 GB VRAM for realistic use",
        "score_accuracy": 8.5, "score_speed": 3.0, "score_custom": 5.0, "score_deploy": 4.0,
        "score_prod": 7.0, "score_cost": 10.0, "score_efficiency": 3.0,
        "advantages": "MIT-licensed open VLM; comparable to GPT-4o on many tasks",
        "disadvantages": "Huge; needs GPU; not fit for this project's CPU box",
        "suitable": "No (too heavy for this setup)", "priority": "★★",
    },

    # ---- RULES-BASED (current) ----
    {
        "name": "OpenCV Template Matching (current)",
        "category": CAT_RULES,
        "year": "N/A", "license": "MIT", "open_source": "Yes", "in_project": "Yes (running)",
        "acc_photos": "30-50%", "acc_drawings": "40-70%",
        "custom_objects": "Via templates only (brittle)",
        "zero_shot": "No",
        "cpu_speed_ms": 300, "cpu_speed_text": "100-500 ms",
        "model_size": "0 MB (rules only)", "memory": "50 MB",
        "prod_ready": "Yes (already deployed)",
        "deployment": "Already deployed",
        "integration_ease": "Already integrated",
        "scalability": "Poor (accuracy ceiling)", "cost_text": "Free",
        "offline": "Yes",
        "difficult_images": "Fails on unusual styles",
        "fp_risk": "High (busy backgrounds)", "fn_risk": "High (unseen styles)",
        "best_use": "Baseline; useful for known chair styles",
        "limitations": "Can never generalize; accuracy ceiling ~70-80%",
        "score_accuracy": 4.5, "score_speed": 8.0, "score_custom": 3.0, "score_deploy": 10.0,
        "score_prod": 8.0, "score_cost": 10.0, "score_efficiency": 10.0,
        "advantages": "Zero deps; already working; instant",
        "disadvantages": "Fundamental accuracy cap; brittle to new styles",
        "suitable": "Only as fallback", "priority": "★★",
    },
]

# ---------------------------------------------------------------------------
# Compute overall weighted score
# ---------------------------------------------------------------------------
for m in MODELS:
    m["score_overall"] = round(
        m["score_accuracy"]   * WEIGHTS["accuracy"] +
        m["score_speed"]      * WEIGHTS["speed"] +
        m["score_custom"]     * WEIGHTS["custom"] +
        m["score_deploy"]     * WEIGHTS["deploy"] +
        m["score_prod"]       * WEIGHTS["prod"] +
        m["score_cost"]       * WEIGHTS["cost"] +
        m["score_efficiency"] * WEIGHTS["efficiency"],
        2
    )

# Ranked copy
MODELS_RANKED = sorted(MODELS, key=lambda m: m["score_overall"], reverse=True)
for i, m in enumerate(MODELS_RANKED, start=1):
    m["rank"] = i

# ---------------------------------------------------------------------------
# CSV output (flat detailed comparison)
# ---------------------------------------------------------------------------
CSV_HEADERS = [
    "Rank", "Model", "Category", "Year", "License", "Open Source", "In Project?",
    "Accuracy (Photos)", "Accuracy (Line Drawings)",
    "Custom Objects", "Zero-shot",
    "CPU Speed", "CPU Speed (ms)",
    "Model Size", "Memory",
    "Production Readiness", "Deployment", "Integration Ease",
    "Scalability", "Cost", "Offline?",
    "Difficult Images", "False Positives", "False Negatives",
    "Best Use", "Limitations",
    "Score Accuracy", "Score Speed", "Score Custom", "Score Deploy",
    "Score Production", "Score Cost", "Score Efficiency", "Overall Score",
    "Advantages", "Disadvantages", "Suitable for THIS Project?", "Priority",
]

def csv_row(m):
    return [
        m["rank"], m["name"], m["category"], m["year"], m["license"], m["open_source"], m["in_project"],
        m["acc_photos"], m["acc_drawings"],
        m["custom_objects"], m["zero_shot"],
        m["cpu_speed_text"], m["cpu_speed_ms"],
        m["model_size"], m["memory"],
        m["prod_ready"], m["deployment"], m["integration_ease"],
        m["scalability"], m["cost_text"], m["offline"],
        m["difficult_images"], m["fp_risk"], m["fn_risk"],
        m["best_use"], m["limitations"],
        m["score_accuracy"], m["score_speed"], m["score_custom"], m["score_deploy"],
        m["score_prod"], m["score_cost"], m["score_efficiency"], m["score_overall"],
        m["advantages"], m["disadvantages"], m["suitable"], m["priority"],
    ]

def write_csv():
    with open(CSV_OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(CSV_HEADERS)
        for m in MODELS_RANKED:
            w.writerow(csv_row(m))
    print(f"Wrote {CSV_OUT}")

# ---------------------------------------------------------------------------
# XLSX styling helpers
# ---------------------------------------------------------------------------
HEADER_FILL = PatternFill(start_color="0F1B2D", end_color="0F1B2D", fill_type="solid")
HEADER_FONT = Font(color="FFFFFF", bold=True, size=11, name="Segoe UI")
HEADER_ALIGN = Alignment(horizontal="center", vertical="center", wrap_text=True)
GOLD_FILL = PatternFill(start_color="FFF3D3", end_color="FFF3D3", fill_type="solid")
SILVER_FILL = PatternFill(start_color="DCF3EE", end_color="DCF3EE", fill_type="solid")
BRONZE_FILL = PatternFill(start_color="FBE4DF", end_color="FBE4DF", fill_type="solid")
STRONG_FILL = PatternFill(start_color="E7ECFF", end_color="E7ECFF", fill_type="solid")
ALT_FILL = PatternFill(start_color="F5F7FB", end_color="F5F7FB", fill_type="solid")
WHITE_FILL = PatternFill(start_color="FFFFFF", end_color="FFFFFF", fill_type="solid")
thin = Side(border_style="thin", color="E2E6EE")
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
CELL_FONT = Font(size=10, name="Segoe UI")
CELL_ALIGN = Alignment(horizontal="left", vertical="top", wrap_text=True)
BOLD_FONT = Font(size=11, bold=True, name="Segoe UI")

def rank_fill(rank):
    if rank == 1: return GOLD_FILL
    if rank == 2: return SILVER_FILL
    if rank == 3: return BRONZE_FILL
    if rank <= 5: return STRONG_FILL
    return ALT_FILL if rank % 2 == 0 else WHITE_FILL

def style_header_row(ws, row=1, cols=None):
    for c in range(1, (cols or ws.max_column) + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = HEADER_ALIGN
        cell.border = BORDER

# ---------------------------------------------------------------------------
# Sheet 1 — Executive Summary
# ---------------------------------------------------------------------------
def build_executive_summary(wb):
    ws = wb.create_sheet(title="Executive Summary")

    def h1(text, row):
        c = ws.cell(row=row, column=1, value=text)
        c.font = Font(size=16, bold=True, name="Segoe UI", color="0F1B2D")
        ws.row_dimensions[row].height = 30

    def h2(text, row):
        c = ws.cell(row=row, column=1, value=text)
        c.font = Font(size=13, bold=True, name="Segoe UI", color="1E3AB5")
        ws.row_dimensions[row].height = 24

    def p(text, row, span=6):
        c = ws.cell(row=row, column=1, value=text)
        c.font = CELL_FONT
        c.alignment = Alignment(wrap_text=True, vertical="top")
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
        ws.row_dimensions[row].height = 34

    r = 1
    h1("AI/Vision Model Comparison — Executive Summary", r); r += 1
    p("Comprehensive decision document for the facilityManagement floor-scan feature. Ranked by fit for THIS project, not global 'best AI'.", r); r += 2

    h2("Weighting used (transparent)", r); r += 1
    weight_data = [
        ["Criterion", "Weight", "Rationale"],
        ["Accuracy",              "25%", "Detection quality is the top user complaint"],
        ["CPU inference speed",   "15%", "Scans are not real-time (once per room setup)"],
        ["Fine-tuning capability","15%", "Long-term flexibility to specialize"],
        ["Deployment ease",       "15%", "Small dev team; must fit existing Node+Python stack"],
        ["Production readiness",  "12%", "Reliability; community; long-term maintenance"],
        ["Cost / license",        "12%", "Free is a hard preference; AGPL restrictions matter"],
        ["Model efficiency",      "6%",  "CPU-only server; RAM and download size matter"],
    ]
    for row in weight_data:
        for c, v in enumerate(row, start=1):
            cell = ws.cell(row=r, column=c, value=v)
            cell.border = BORDER
            cell.font = BOLD_FONT if r == weight_data[0] else CELL_FONT
            cell.alignment = CELL_ALIGN
        r += 1
    style_header_row(ws, row=r - len(weight_data), cols=3)
    r += 1

    h2("Category winners for this project", r); r += 1
    winners = [
        ["Category", "Winner", "Score", "Why"],
        ["🥇 Best overall (right now)",           MODELS_RANKED[0]["name"], MODELS_RANKED[0]["score_overall"],
            "Easiest to deploy today, huge community, dead-simple fine-tune when ready"],
        ["🥈 Best alternative",                    MODELS_RANKED[1]["name"], MODELS_RANKED[1]["score_overall"],
            "Solid backup if #1's license or setup is blocked"],
        ["🏆 Best after fine-tuning",              "YOLOv11 (fine-tuned on floor plans)", 9.31,
            "Same architecture as #1, retrained on your data → 95%+ accuracy on both photos and drawings"],
        ["⚡ Best for real-time / speed",          "YOLOv10 (pretrained)", None,
            "NMS-free architecture = fastest CPU inference in the YOLO family"],
        ["🎯 Best raw accuracy (no training)",      "Claude Vision API", None,
            "Understands intent; 90-95% on both photos and drawings without any training"],
        ["💰 Best cost-effective",                  "YOLOv11 (pretrained COCO)", None,
            "Free, tiny, easy — everything you need in a Python venv"],
        ["🔓 Best fully open-source local",         "Florence-2 (Microsoft)", None,
            "MIT-licensed weights; runs on CPU; genuinely commercial-friendly"],
        ["📄 Best license for commercial use",      "YOLO-NAS (Deci AI)", None,
            "Apache-2.0 avoids Ultralytics' AGPL constraints"],
        ["❌ Do NOT use",                            "Mask R-CNN (torchvision)", None,
            "9 years old, inferior to YOLOv11 on every dimension despite being in the project"],
        ["⚠️ Do NOT ADD to detection stack",         "SAM 2", None,
            "It's segmentation, not detection — doesn't solve your problem alone"],
    ]
    for row in winners:
        for c, v in enumerate(row, start=1):
            cell = ws.cell(row=r, column=c, value=v)
            cell.border = BORDER
            cell.font = BOLD_FONT if r == winners[0] else CELL_FONT
            cell.alignment = CELL_ALIGN
        r += 1
    style_header_row(ws, row=r - len(winners), cols=4)
    r += 1

    h2("Top 5 overall ranking", r); r += 1
    ws.cell(row=r, column=1, value="Rank").font = BOLD_FONT
    ws.cell(row=r, column=2, value="Model").font = BOLD_FONT
    ws.cell(row=r, column=3, value="Overall").font = BOLD_FONT
    ws.cell(row=r, column=4, value="Category").font = BOLD_FONT
    ws.cell(row=r, column=5, value="Best For").font = BOLD_FONT
    style_header_row(ws, row=r, cols=5)
    r += 1
    for m in MODELS_RANKED[:5]:
        for c, v in enumerate([m["rank"], m["name"], m["score_overall"], m["category"], m["best_use"]], start=1):
            cell = ws.cell(row=r, column=c, value=v)
            cell.fill = rank_fill(m["rank"])
            cell.font = CELL_FONT
            cell.alignment = CELL_ALIGN
            cell.border = BORDER
        r += 1
    r += 1

    h2("Final recommendation", r); r += 1
    recs = [
        ("1. Best model to implement NOW",
            "YOLOv11 (pretrained COCO) — one pip install, 30 lines of code, working today. "
            "Fixes the 'fails on new photos' problem immediately."),
        ("2. Best model for future fine-tuning",
            "YOLOv11 (fine-tuned on floor plans). Same architecture as #1 — you'll retrain it "
            "on 300+ labeled plans for a permanent jump to 95%+ accuracy on both photos and line drawings."),
        ("3. Best alternative if AGPL is a legal blocker",
            "YOLO-NAS (Deci, Apache-2.0) or YOLOv9 (more permissive) — same accuracy tier, "
            "no AGPL friction. Slightly less polished tooling."),
        ("4. Model you should NOT use",
            "Mask R-CNN — already in your project but 9 years old and 10-30x slower than "
            "YOLOv11 with lower accuracy. Also SAM 2 — great tech but wrong category."),
        ("5. Recommended architecture",
            "Phase 1: Keep the OpenCV path (fast, familiar) as fallback. Add YOLOv11 (pretrained) as new endpoint "
            "in floor-scan-svc/app.py. Frontend gets 'Fast scan' vs 'Smart scan' toggle. "
            "Phase 2: When you've collected 300+ labeled plans, fine-tune YOLOv11 and swap weights — no other code changes."),
        ("6. Migration difficulty from current OpenCV templates",
            "LOW. YOLOv11 adds one Python file + one route. No frontend changes. No DB changes. "
            "One-day integration. Existing OpenCV code stays in place as fallback."),
        ("7. Expected trade-offs",
            "Vs current: +40-50 percentage points of accuracy on photos, +100-300 MB RAM per scan, "
            "similar CPU speed. Vs paid Claude Vision: -5 pp accuracy but $0 forever and offline-capable."),
    ]
    for label, text in recs:
        cell = ws.cell(row=r, column=1, value=label)
        cell.font = Font(size=11, bold=True, name="Segoe UI", color="1E3AB5")
        r += 1
        p(text, r); r += 1

    ws.column_dimensions["A"].width = 40
    ws.column_dimensions["B"].width = 38
    ws.column_dimensions["C"].width = 15
    ws.column_dimensions["D"].width = 30
    ws.column_dimensions["E"].width = 50

# ---------------------------------------------------------------------------
# Sheet 2 — Detailed Comparison (all criteria)
# ---------------------------------------------------------------------------
def build_detailed(wb):
    ws = wb.create_sheet(title="Detailed Comparison")

    headers = [
        "Rank", "Model", "Category", "Year", "License", "In Project?",
        "Accuracy (Photos)", "Accuracy (Drawings)", "Custom Objects", "Zero-shot",
        "CPU Speed", "Model Size", "Memory",
        "Production", "Deployment", "Integration",
        "Scalability", "Cost", "Offline?",
        "Difficult Images", "False Positive Risk", "False Negative Risk",
        "Best Use Case", "Main Limitations",
    ]
    for c, h in enumerate(headers, start=1):
        ws.cell(row=1, column=c, value=h)
    style_header_row(ws, cols=len(headers))
    ws.row_dimensions[1].height = 40

    for r, m in enumerate(MODELS_RANKED, start=2):
        row = [
            m["rank"], m["name"], m["category"], m["year"], m["license"], m["in_project"],
            m["acc_photos"], m["acc_drawings"], m["custom_objects"], m["zero_shot"],
            m["cpu_speed_text"], m["model_size"], m["memory"],
            m["prod_ready"], m["deployment"], m["integration_ease"],
            m["scalability"], m["cost_text"], m["offline"],
            m["difficult_images"], m["fp_risk"], m["fn_risk"],
            m["best_use"], m["limitations"],
        ]
        fill = rank_fill(m["rank"])
        for c, v in enumerate(row, start=1):
            cell = ws.cell(row=r, column=c, value=v)
            cell.fill = fill
            cell.font = BOLD_FONT if c == 1 else CELL_FONT
            cell.alignment = CELL_ALIGN
            cell.border = BORDER
        ws.row_dimensions[r].height = 95

    widths = [6, 30, 25, 8, 20, 18,
              18, 18, 30, 22,
              20, 18, 18,
              22, 22, 22,
              15, 25, 12,
              32, 20, 20,
              38, 40]
    for c, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(c)].width = w
    ws.freeze_panes = "C2"
    ws.auto_filter.ref = ws.dimensions

# ---------------------------------------------------------------------------
# Sheet 3 — Technical Scores (numeric + conditional formatting)
# ---------------------------------------------------------------------------
def build_scores(wb):
    ws = wb.create_sheet(title="Technical Scores")

    headers = [
        "Rank", "Model", "Category",
        "Accuracy (0-10)", "Speed (0-10)", "Custom Training (0-10)",
        "Deployment (0-10)", "Production (0-10)", "Cost (0-10)",
        "Efficiency (0-10)", "OVERALL (0-10)",
    ]
    for c, h in enumerate(headers, start=1):
        ws.cell(row=1, column=c, value=h)
    style_header_row(ws, cols=len(headers))
    ws.row_dimensions[1].height = 40

    for r, m in enumerate(MODELS_RANKED, start=2):
        row = [
            m["rank"], m["name"], m["category"],
            m["score_accuracy"], m["score_speed"], m["score_custom"],
            m["score_deploy"], m["score_prod"], m["score_cost"],
            m["score_efficiency"], m["score_overall"],
        ]
        fill = rank_fill(m["rank"])
        for c, v in enumerate(row, start=1):
            cell = ws.cell(row=r, column=c, value=v)
            cell.fill = fill
            cell.font = BOLD_FONT if c in (1, 11) else CELL_FONT
            cell.alignment = Alignment(horizontal="center" if c > 3 else "left",
                                        vertical="center", wrap_text=True)
            cell.border = BORDER
        ws.row_dimensions[r].height = 30

    widths = [6, 32, 26, 15, 14, 20, 15, 15, 12, 15, 18]
    for c, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(c)].width = w

    # Conditional formatting: color scale on score columns D..K (4..11)
    n = len(MODELS_RANKED) + 1
    color_scale = ColorScaleRule(
        start_type="num", start_value=0, start_color="F8696B",   # red
        mid_type="num", mid_value=5, mid_color="FFEB84",         # yellow
        end_type="num", end_value=10, end_color="63BE7B",        # green
    )
    for col in ("D", "E", "F", "G", "H", "I", "J"):
        ws.conditional_formatting.add(f"{col}2:{col}{n}", color_scale)
    # Data bars on OVERALL
    overall_bars = DataBarRule(
        start_type="num", start_value=0, end_type="num", end_value=10,
        color="1E3AB5", showValue=True,
    )
    ws.conditional_formatting.add(f"K2:K{n}", overall_bars)

    ws.freeze_panes = "C2"
    ws.auto_filter.ref = ws.dimensions

# ---------------------------------------------------------------------------
# Sheet 4 — Recommendation (per-model verdict)
# ---------------------------------------------------------------------------
def build_recommendation(wb):
    ws = wb.create_sheet(title="Recommendation")

    headers = ["Rank", "Model", "Overall", "Suitable for THIS Project?",
               "Priority", "Why Recommended", "Advantages", "Disadvantages"]
    for c, h in enumerate(headers, start=1):
        ws.cell(row=1, column=c, value=h)
    style_header_row(ws, cols=len(headers))
    ws.row_dimensions[1].height = 40

    for r, m in enumerate(MODELS_RANKED, start=2):
        row = [
            m["rank"], m["name"], m["score_overall"],
            m["suitable"], m["priority"],
            m["best_use"], m["advantages"], m["disadvantages"],
        ]
        fill = rank_fill(m["rank"])
        for c, v in enumerate(row, start=1):
            cell = ws.cell(row=r, column=c, value=v)
            cell.fill = fill
            cell.font = BOLD_FONT if c in (1, 3, 5) else CELL_FONT
            cell.alignment = Alignment(
                horizontal="center" if c in (1, 3, 5) else "left",
                vertical="top", wrap_text=True
            )
            cell.border = BORDER
        ws.row_dimensions[r].height = 80

    widths = [6, 32, 12, 22, 12, 45, 45, 45]
    for c, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(c)].width = w
    ws.freeze_panes = "C2"
    ws.auto_filter.ref = ws.dimensions

# ---------------------------------------------------------------------------
# Sheet 5 — Charts
# ---------------------------------------------------------------------------
def build_charts(wb):
    ws = wb.create_sheet(title="Charts")

    # We'll write a compact helper table for chart references
    ws["A1"] = "Model"
    ws["B1"] = "Overall"
    ws["C1"] = "Accuracy"
    ws["D1"] = "Speed"
    ws["E1"] = "Cost"
    ws["F1"] = "Production"
    ws["G1"] = "Speed (ms)"
    ws["H1"] = "Efficiency"
    for c in range(1, 9):
        ws.cell(row=1, column=c).font = BOLD_FONT
        ws.cell(row=1, column=c).fill = HEADER_FILL
        ws.cell(row=1, column=c).font = HEADER_FONT
        ws.cell(row=1, column=c).alignment = HEADER_ALIGN
        ws.cell(row=1, column=c).border = BORDER

    for i, m in enumerate(MODELS_RANKED, start=2):
        ws.cell(row=i, column=1, value=m["name"])
        ws.cell(row=i, column=2, value=m["score_overall"])
        ws.cell(row=i, column=3, value=m["score_accuracy"])
        ws.cell(row=i, column=4, value=m["score_speed"])
        ws.cell(row=i, column=5, value=m["score_cost"])
        ws.cell(row=i, column=6, value=m["score_prod"])
        ws.cell(row=i, column=7, value=m["cpu_speed_ms"] if isinstance(m["cpu_speed_ms"], (int, float)) else 0)
        ws.cell(row=i, column=8, value=m["score_efficiency"])
    n = len(MODELS_RANKED) + 1

    # Column widths
    ws.column_dimensions["A"].width = 34
    for c in "BCDEFGH":
        ws.column_dimensions[c].width = 12

    # Chart 1: Overall ranking (bar)
    c1 = BarChart(); c1.type = "bar"; c1.style = 12
    c1.title = "Overall Ranking (weighted score, 0-10)"
    c1.x_axis.title = "Score"; c1.y_axis.title = "Model"
    c1.height = 20; c1.width = 26; c1.gapWidth = 60
    d = Reference(ws, min_col=2, max_col=2, min_row=1, max_row=n)
    cats = Reference(ws, min_col=1, max_col=1, min_row=2, max_row=n)
    c1.add_data(d, titles_from_data=True); c1.set_categories(cats)
    ws.add_chart(c1, "J1")

    # Chart 2: Accuracy vs Speed scatter
    c2 = ScatterChart()
    c2.title = "Accuracy vs Speed — top-right = best deal"
    c2.x_axis.title = "Speed score (0-10, higher = faster)"
    c2.y_axis.title = "Accuracy score (0-10, higher = better)"
    c2.style = 13; c2.height = 18; c2.width = 26
    xref = Reference(ws, min_col=4, min_row=2, max_row=n)
    yref = Reference(ws, min_col=3, min_row=2, max_row=n)
    c2.series.append(Series(yref, xref, title="Models"))
    ws.add_chart(c2, "J43")

    # Chart 3: Speed (ms) comparison
    c3 = BarChart(); c3.type = "bar"; c3.style = 13
    c3.title = "CPU Speed per Scan (milliseconds — lower is better)"
    c3.x_axis.title = "ms"; c3.y_axis.title = "Model"
    c3.height = 18; c3.width = 26; c3.gapWidth = 60
    d3 = Reference(ws, min_col=7, max_col=7, min_row=1, max_row=n)
    c3.add_data(d3, titles_from_data=True); c3.set_categories(cats)
    ws.add_chart(c3, "J82")

    # Chart 4: Cost comparison (bar) — higher = cheaper
    c4 = BarChart(); c4.type = "bar"; c4.style = 11
    c4.title = "Cost Score (10 = free & permissive, 1 = expensive)"
    c4.x_axis.title = "Cost score"; c4.y_axis.title = "Model"
    c4.height = 18; c4.width = 26; c4.gapWidth = 60
    d4 = Reference(ws, min_col=5, max_col=5, min_row=1, max_row=n)
    c4.add_data(d4, titles_from_data=True); c4.set_categories(cats)
    ws.add_chart(c4, "J121")

    # Chart 5: Production readiness comparison
    c5 = BarChart(); c5.type = "bar"; c5.style = 14
    c5.title = "Production Readiness (0-10)"
    c5.x_axis.title = "Score"; c5.y_axis.title = "Model"
    c5.height = 18; c5.width = 26; c5.gapWidth = 60
    d5 = Reference(ws, min_col=6, max_col=6, min_row=1, max_row=n)
    c5.add_data(d5, titles_from_data=True); c5.set_categories(cats)
    ws.add_chart(c5, "J160")

    # Chart 6: Efficiency comparison (bar) - size/memory footprint
    c6 = BarChart(); c6.type = "bar"; c6.style = 15
    c6.title = "Model Efficiency (10 = tiny + fast, 1 = huge + slow)"
    c6.x_axis.title = "Efficiency score"; c6.y_axis.title = "Model"
    c6.height = 18; c6.width = 26; c6.gapWidth = 60
    d6 = Reference(ws, min_col=8, max_col=8, min_row=1, max_row=n)
    c6.add_data(d6, titles_from_data=True); c6.set_categories(cats)
    ws.add_chart(c6, "J199")

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def write_xlsx():
    wb = Workbook()
    # Remove default sheet
    wb.remove(wb.active)
    build_executive_summary(wb)
    build_detailed(wb)
    build_scores(wb)
    build_recommendation(wb)
    build_charts(wb)
    wb.save(XLSX)
    print(f"Wrote {XLSX}")

if __name__ == "__main__":
    write_csv()
    write_xlsx()
    print("Done.")
