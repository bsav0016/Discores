"""Pull disc golf courses from Overture Maps (places theme) and write SQL that loads them.

    pip install duckdb

    # one state
    python supabase/overture/import-overture.py --state KY --bbox -89.6 36.45 -81.9 39.2 out.sql

    # the whole US (50 states + DC), one folder of per-state files, skipping states you already loaded
    python supabase/overture/import-overture.py --state US --per-state --skip KY,OH,IN,TN,WV,VA,MO,IL supabase/overture/us

--bbox is west south east north. It only narrows what is read from the public bucket (for --state US it defaults to
the US including Alaska and Hawaii, minus the far Aleutians); --state then keeps rows whose address region matches, so
neighbouring states in the box are dropped. Rows with no region are skipped (we cannot tell which state they are in),
as are rows below --min-confidence, ones marked closed, and ones whose names say shop/gym/footgolf/etc. (see
NOT_A_COURSE below).

--chunk N splits output into files of N courses (default 250, about 40 KB each, comfortable for the SQL editor).
With --per-state the output argument is a folder and each state gets TX.sql, or TX-1.sql, TX-2.sql, ... when it is
bigger than one chunk.

Run the files in the Supabase SQL editor (or `psql -f`). import_overture_courses() skips anything already loaded and
anything within 400 m of an existing course (or same name within 5 km), so re-running and mixing with the OSM import is
safe. Each file returns how many courses it added.

Data (c) Overture Maps Foundation, places theme, mostly CDLA Permissive 2.0 (Foursquare rows are Apache 2.0 with the
notice "Copyright 2024 Foursquare Labs, Inc. All rights reserved"). The app shows the attribution; this script reports
how many selected rows come from Foursquare so you know whether that notice applies.
"""
import argparse
import json
import os
import re
import sys
from collections import defaultdict

import duckdb

RELEASE = "2026-09-23.1"  # see https://docs.overturemaps.org/getting-data/ for newer releases
US_STATES = (
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA "
    "RI SC SD TN TX UT VT VA WA WV WI WY"
).split()
US_BBOX = (-179.2, 17.9, -66.9, 71.5)

p = argparse.ArgumentParser()
p.add_argument("--state", required=True, help="two-letter region code to keep (KY), or US for all 50 states + DC")
p.add_argument("--bbox", nargs=4, type=float, metavar=("W", "S", "E", "N"))
p.add_argument("--skip", default="", help="comma-separated state codes to leave out, e.g. KY,OH")
p.add_argument("--min-confidence", type=float, default=0.4)
p.add_argument("--release", default=RELEASE)
p.add_argument("--chunk", type=int, default=250, help="courses per output file (0 = one file)")
p.add_argument("--per-state", action="store_true", help="write one set of files per state into the output folder")
p.add_argument("out", nargs="?", default="overture-courses.sql")
a = p.parse_args()

if a.state.upper() == "US":
    keep = set(US_STATES)
    bbox = a.bbox or US_BBOX
else:
    if not a.bbox:
        p.error("--bbox is required unless --state US")
    keep = {a.state.upper()}
    bbox = a.bbox
keep -= {x.strip().upper() for x in a.skip.split(",") if x.strip()}
w, s, e, n = bbox

con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
src = f"read_parquet('s3://overturemaps-us-west-2/release/{a.release}/theme=places/type=place/*', hive_partitioning=1)"
rows = con.execute(
    f"""
    select id, names.primary as nm, addresses[1].locality as loc, addresses[1].region as reg,
           confidence, bbox.ymin as lat, bbox.xmin as lng, operating_status as st,
           list_contains(list_transform(sources, x -> x.dataset), 'Foursquare') as fsq
    from {src}
    where bbox.xmin between ? and ? and bbox.ymin between ? and ?
      and taxonomy.primary = 'disc_golf_course'
    order by confidence desc
    """,
    [w, e, s, n],
).fetchall()

# Overture's disc_golf_course category also catches shops, bars, gyms, ball diamonds, footgolf, ordinary golf courses
# and so on. Drop names with those words unless they also say "disc golf course" / "dgc" / "disc golf park" /
# "disc golf complex". A name that says "golf" or "country club" but nothing disc-like is an ordinary golf business.
NOT_A_COURSE = re.compile(
    r"pro shop|\bsupply\b|footgolf|foot golf|ball diamonds|\bllc\b|\binc\b|\bgym\b|athletic club|campground|\bstore\b|"
    r"\bshop\b|tap ?room|\bbrew|enterprises|skate park|ziplines|press box|water production|dog park", re.I)
LOOKS_LIKE_COURSE = re.compile(r"disc golf course|\bdgc\b|disc golf park|disc golf complex", re.I)
DISCISH = re.compile(r"disc|dgc|dgp|\bdg\b|frisbee|disk", re.I)
# Records for a single tee or hole ("... Hole #1 - Blue", "... Tee 1") are renamed to the course they belong to.
HOLE_SUFFIX = re.compile(r"[\s,\-–]*(?:hole\s*#?\d+(?:\s*-\s*\w+)?|tee\s*#?\d+)(?:\s+tee)?\s*$", re.I)

by_state = defaultdict(list)
skipped = {"other_or_skipped_region": 0, "no_region": 0, "low_confidence": 0, "closed": 0, "no_name": 0, "not_a_course": 0}
fsq_selected = 0
for id_, nm, loc, reg, conf, lat, lng, st, fsq in rows:
    nm = HOLE_SUFFIX.sub("", nm or "").strip()
    if not nm:
        skipped["no_name"] += 1
    elif (NOT_A_COURSE.search(nm) and not LOOKS_LIKE_COURSE.search(nm)) or (
            re.search(r"\bgolf\b|country club", nm, re.I) and not DISCISH.search(nm)):
        skipped["not_a_course"] += 1
    elif reg is None:
        skipped["no_region"] += 1
    elif reg.upper() not in keep:
        skipped["other_or_skipped_region"] += 1
    elif conf < a.min_confidence:
        skipped["low_confidence"] += 1
    elif st and "closed" in st:
        skipped["closed"] += 1
    else:
        by_state[reg.upper()].append(
            {"overture_id": id_, "name": nm, "area": ", ".join(x for x in (loc, reg) if x),
             "lat": round(lat, 6), "lng": round(lng, 6)})
        fsq_selected += bool(fsq)


def sql_for(chunk):
    payload = json.dumps(chunk, separators=(",", ":"))
    tag = "ovt"
    while f"${tag}$" in payload:  # the dollar-quote tag must not appear in the JSON
        tag += "x"
    return f"select public.import_overture_courses(${tag}${payload}${tag}$::jsonb);\n"


def write_chunks(items, stem):
    """Write items to stem.sql, or stem-1.sql, stem-2.sql, ... when there are more than --chunk of them."""
    if a.chunk <= 0 or len(items) <= a.chunk:
        paths = [f"{stem}.sql"]
        parts = [items]
    else:
        parts = [items[i:i + a.chunk] for i in range(0, len(items), a.chunk)]
        paths = [f"{stem}-{i + 1}.sql" for i in range(len(parts))]
    for path, part in zip(paths, parts):
        with open(path, "w", encoding="utf-8") as f:
            f.write(sql_for(part))
    return paths


if a.per_state:
    os.makedirs(a.out, exist_ok=True)
    total_files = 0
    for state in sorted(by_state):
        total_files += len(write_chunks(by_state[state], os.path.join(a.out, state)))
    summary = {st_: len(v) for st_, v in sorted(by_state.items())}
    print(f"{sum(summary.values())} courses in {total_files} files under {a.out} (release {a.release})", file=sys.stderr)
    print(f"per state: {summary}", file=sys.stderr)
else:
    items = [it for state in sorted(by_state) for it in by_state[state]]
    stem = a.out[:-4] if a.out.endswith(".sql") else a.out
    paths = write_chunks(items, stem)
    print(f"{len(items)} courses written to {paths[0]}{' ...' if len(paths) > 1 else ''} (release {a.release})", file=sys.stderr)
print(f"skipped: {skipped}", file=sys.stderr)
print(f"selected rows sourced from Foursquare: {fsq_selected}", file=sys.stderr)
