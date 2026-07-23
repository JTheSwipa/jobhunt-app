#!/usr/bin/env python3
"""Scan Indeed for early-career data/AI roles, print matching jobs as JSON.

Ported from goodwillhuntingv2/workflow/job_scan.py. The difference: this
script does no file I/O of its own — it just prints a JSON array to stdout.
Dedup/persistence is the Node backend's job (apps/api/src/jobs/indeed.ts),
via Postgres's unique constraint on jobUrl, so this script can stay a pure
"search -> filtered results" function callable from any language.

Usage: python3 scripts/indeed_scan.py [--days N] [--term TERM]... [--location LOC]...
  --days N       look back N days (default 7)
  --term TERM    search term; repeatable (default: the canned early-career
                 data/AI terms below)
  --location LOC country name jobspy/Indeed expects; repeatable (default:
                 netherlands, luxembourg, switzerland, germany, italy, france)

Deps live in scripts/.venv (python-jobspy); re-execs itself with the venv
python if jobspy isn't importable in the current interpreter.
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

try:
    from jobspy import scrape_jobs
except ImportError:
    venv_py = Path(__file__).resolve().parent / ".venv/bin/python"
    if venv_py.exists() and sys.executable != str(venv_py):
        os.execv(str(venv_py), [str(venv_py)] + sys.argv)
    raise

DEFAULT_TERMS = ["data science intern", "data analyst intern", "AI intern", "junior data scientist"]
DEFAULT_LOCATIONS = ["netherlands", "luxembourg", "switzerland", "germany", "italy", "france"]

DATA_RE = re.compile(
    r"\b(data|analytics|analyst|scientist|machine learning|ml|ai|"
    r"artificial intelligence|business intelligence|bi)\b", re.I)
LEVEL_RE = re.compile(
    r"\b(intern(ship)?s?|stage|stagiair\w*|trainee(ship)?|graduate|junior|"
    r"entry[- ]level|working student|werkstudent\w*|praktik\w*|tirocin\w*)\b"
    r"|afstudeer", re.I)
EXCLUDE_RE = re.compile(
    r"\b(senior|sr\.?|lead|principal|staff|head|director|manager|architect|"
    r"postdoc|professor|phd|promovendus)\b", re.I)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--term", action="append", default=None)
    ap.add_argument("--location", action="append", default=None)
    ap.add_argument("--no-filter", action="store_true", help="skip the data/AI + early-career title filter")
    args = ap.parse_args()

    terms = args.term or DEFAULT_TERMS
    locations = args.location or DEFAULT_LOCATIONS

    results, errors = [], []
    for term in terms:
        for country in locations:
            try:
                df = scrape_jobs(
                    site_name=["indeed"], search_term=term, location=country,
                    country_indeed=country, results_wanted=25,
                    hours_old=24 * args.days, verbose=0,
                )
            except Exception as exc:  # jobspy raises a variety of exception types
                errors.append(f"{term} / {country}: {exc}")
                continue
            for _, j in df.iterrows():
                title = str(j.get("title") or "")
                if not args.no_filter:
                    if not (DATA_RE.search(title) and LEVEL_RE.search(title)):
                        continue
                    if EXCLUDE_RE.search(title):
                        continue
                results.append({
                    "title": title,
                    "company": str(j.get("company") or ""),
                    "location": str(j.get("location") or ""),
                    "country": country,
                    "site": str(j.get("site") or "indeed"),
                    "date_posted": str(j.get("date_posted") or ""),
                    "job_url": str(j.get("job_url") or ""),
                })

    print(json.dumps({"results": results, "errors": errors}))


if __name__ == "__main__":
    main()
