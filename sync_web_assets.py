#!/usr/bin/env python3
"""Copy the editable web UI into Android's bundled WebView assets."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "site"
DESTINATION = ROOT / "android" / "app" / "src" / "main" / "assets" / "www"
if not (SOURCE / "index.html").is_file():
    raise SystemExit("Missing site/index.html")
if DESTINATION.exists():
    shutil.rmtree(DESTINATION)
shutil.copytree(SOURCE, DESTINATION)
print(f"Synced {SOURCE.relative_to(ROOT)} -> {DESTINATION.relative_to(ROOT)}")
