"""Pull disc golf courses from Overture Maps (places theme) and write SQL that loads them.

    pip install duckdb

    # one state
    python supabase/overture/import-overture.py --state KY --bbox -89.6 36.45 -81.9 39.2 out.sql

    # the whole US (50 states + DC), one folder of per-state files, skipping states you already loaded
    python supabase/overture/import-overture.py --state US --per-state --skip KY,OH,IN,TN,WV,VA,MO,IL supabase/overture/us

    # only what the files in a folder do not already have (a refresh, or after the rules got wider)
    python supabase/overture/import-overture.py --state US --per-state --exclude-from supabase/overture/us --exclude-from supabase/overture/kentucky.sql supabase/overture/us-more

    # other countries, one set of files per country
    python supabase/overture/import-overture.py --country FI,SE,CA supabase/overture/world
    python supabase/overture/import-overture.py --country ALL supabase/overture/world   # every country except the US

--bbox is west south east north. It only narrows what is read from the public bucket (for --state US it defaults to
the US including Alaska and Hawaii, minus the far Aleutians); --state then keeps rows whose region matches, so
neighbouring states in the box are dropped.

Which places count as courses is decided by overture_rules.py (with tests): the disc_golf_course category minus
shops, gyms, footgolf and so on; rows below --min-confidence are still kept when the name plainly says it is a course
("... Disc Golf Course", "... DGC"); and places filed under another category (a park, a recreation area) are kept when
the name plainly says "... Disc Golf Course/Park/Complex/Trail" or "... DGC" or ends in "Disc Golf". Closed places are
dropped. Outside the US the name must also mention discs or frisbees (Overture's category is sometimes wrong there). A row with no region in its address gets the state or province whose boundary (Overture's division areas)
contains its point; if there is none it is skipped.

--review FILE writes every kept row that the plain category rule would not have found as a tab-separated file, to
check by eye before loading. --exclude-from DIR leaves out rows whose overture_id is already in DIR's .sql files.

--chunk N splits output into files of N courses (default 250, about 40 KB each, comfortable for the SQL editor).
With --per-state (always on for --country) the output argument is a folder and each state or country gets TX.sql, or
TX-1.sql, TX-2.sql, ... when it is bigger than one chunk.

Run the files in the Supabase SQL editor (or `psql -f`). import_overture_courses() skips anything already loaded and
anything within 400 m of an existing course (or same name within 5 km), so re-running and mixing with the OSM import is
safe. Each file returns how many courses it added. Areas read "Anchorage, AK" (US, Canada, Australia) or "Helsinki, FI".

Data (c) Overture Maps Foundation, places theme, mostly CDLA Permissive 2.0 (Foursquare rows are Apache 2.0 with the
notice "Copyright 2024 Foursquare Labs, Inc. All rights reserved"). The app shows the attribution; this script reports
how many selected rows come from Foursquare so you know whether that notice applies.
"""
import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict

import duckdb

from overture_rules import area_label, classify, clean_name

RELEASE = "2026-09-23.1"  # see https://docs.overturemaps.org/getting-data/ for newer releases
US_STATES = (
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA "
    "RI SC SD TN TX UT VT VA WA WV WI WY"
).split()
US_BBOX = (-179.2, 17.9, -66.9, 71.5)

p = argparse.ArgumentParser()
p.add_argument("--state", help="two-letter region code to keep (KY), or US for all 50 states + DC")
p.add_argument("--country", help="comma-separated ISO country codes other than the US (FI,SE,CA)")
p.add_argument("--bbox", nargs=4, type=float, metavar=("W", "S", "E", "N"))
p.add_argument("--skip", default="", help="comma-separated state or country codes to leave out, e.g. KY,OH")
p.add_argument("--exclude-from", action="append", default=[],
               help="folder (or file) of earlier output; rows already in its .sql files are left out; repeatable")
p.add_argument("--review", help="write the rows found by the wider rules to this TSV file")
p.add_argument("--min-confidence", type=float, default=0.4)
p.add_argument("--release", default=RELEASE)
p.add_argument("--chunk", type=int, default=250, help="courses per output file (0 = one file)")
p.add_argument("--per-state", action="store_true", help="write one set of files per state into the output folder")
p.add_argument("out", nargs="?", default="overture-courses.sql")
a = p.parse_args()

if bool(a.state) == bool(a.country):
    p.error("give exactly one of --state and --country")
by_country = bool(a.country)
everywhere = False
if by_country:
    countries = [c.strip().upper() for c in a.country.split(",") if c.strip()]
    if "US" in countries:
        p.error("use --state US for the United States")
    everywhere = countries == ["ALL"]  # every country except the US
    keep = set(countries)
    bbox = a.bbox or (-180.0, -90.0, 180.0, 90.0)
    a.per_state = True
elif a.state.upper() == "US":
    countries = ["US"]
    keep = set(US_STATES)
    bbox = a.bbox or US_BBOX
else:
    countries = ["US"]
    if not a.bbox:
        p.error("--bbox is required unless --state US")
    keep = {a.state.upper()}
    bbox = a.bbox
keep -= {x.strip().upper() for x in a.skip.split(",") if x.strip()}
w, s, e, n = bbox

already = set()
for where in a.exclude_from:
    paths = [os.path.join(where, f) for f in os.listdir(where)] if os.path.isdir(where) else [where]
    for path in paths:
        if path.endswith(".sql"):
            with open(path, encoding="utf-8") as f:
                already.update(re.findall(r'"overture_id":"([^"]+)"', f.read()))

con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
base = f"s3://overturemaps-us-west-2/release/{a.release}/theme="
src = f"read_parquet('{base}places/type=place/*', hive_partitioning=1)"
areas = f"read_parquet('{base}divisions/type=division_area/*', hive_partitioning=1)"
country_filter = "p.addresses[1].country <> 'US'" if by_country and everywhere else     f"p.addresses[1].country in ({','.join(repr(c) for c in countries)})"
# Every place with the disc golf category or "disc golf" / "frisbee golf" in its name; overture_rules.py decides.
# A place with no region in its address gets the region whose boundary holds its point (region reads 'US-KY').
rows = con.execute(
    f"""
    select p.id, p.names.primary as nm, p.addresses[1].locality as loc,
           coalesce(p.addresses[1].region, split_part(r.region, '-', 2)) as reg,
           p.addresses[1].country as ctry, p.confidence, p.bbox.ymin as lat, p.bbox.xmin as lng,
           p.operating_status as st, p.taxonomy.primary as prim,
           list_contains(list_transform(p.sources, x -> x.dataset), 'Foursquare') as fsq
    from {src} p
    left join (select region, geometry from {areas} where subtype = 'region' and is_land) r
      on p.addresses[1].region is null and ST_Contains(r.geometry, ST_Point(p.bbox.xmin, p.bbox.ymin))
    where p.bbox.xmin between ? and ? and p.bbox.ymin between ? and ?
      and {country_filter}
      and (p.taxonomy.primary = 'disc_golf_course' or p.names.primary ilike '%disc golf%'
           or p.names.primary ilike '%frisbee%golf%')
    order by p.confidence desc
    """,
    [w, e, s, n],
).fetchall()

by_group = defaultdict(list)
skipped = Counter()
kept_why = Counter()
review = []
fsq_selected = 0
seen = set()
for id_, nm, loc, reg, ctry, conf, lat, lng, st, prim, fsq in rows:
    if id_ in seen:  # a point on a border can match two region polygons
        continue
    seen.add(id_)
    nm = clean_name(nm)
    verdict, why = classify(nm, prim, conf, st, a.min_confidence, need_disc_word=by_country)
    if verdict == "skip":
        skipped[why] += 1
        continue
    group = ctry if by_country else (reg or "").upper()
    if not group:
        skipped["no_region"] += 1
        continue
    if group not in keep and not (by_country and everywhere):
        skipped["other_or_skipped_region"] += 1
        continue
    if id_ in already:
        skipped["already_in_exclude_folder"] += 1
        continue
    kept_why[why] += 1
    if why != "primary":
        review.append((why, prim, nm, loc, reg or ctry, round(conf, 2), id_))
    by_group[group].append(
        {"overture_id": id_, "name": nm, "area": area_label(loc, reg, ctry),
         "lat": round(lat, 6), "lng": round(lng, 6)})
    fsq_selected += bool(fsq)


def sql_for(chunk):
    payload = json.dumps(chunk, separators=(",", ":"), ensure_ascii=False)
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


if a.review:
    with open(a.review, "w", encoding="utf-8") as f:
        f.write("why\tcategory\tname\tlocality\tregion\tconfidence\toverture_id\n")
        for r in sorted(review, key=lambda r: (r[0], r[4], r[2])):
            f.write("\t".join(str(x) for x in r) + "\n")

if a.per_state:
    os.makedirs(a.out, exist_ok=True)
    total_files = 0
    for group in sorted(by_group):
        total_files += len(write_chunks(by_group[group], os.path.join(a.out, group)))
    summary = {g: len(v) for g, v in sorted(by_group.items())}
    print(f"{sum(summary.values())} courses in {total_files} files under {a.out} (release {a.release})", file=sys.stderr)
    print(f"per {'country' if by_country else 'state'}: {summary}", file=sys.stderr)
else:
    items = [it for group in sorted(by_group) for it in by_group[group]]
    stem = a.out[:-4] if a.out.endswith(".sql") else a.out
    paths = write_chunks(items, stem)
    print(f"{len(items)} courses written to {paths[0]}{' ...' if len(paths) > 1 else ''} (release {a.release})", file=sys.stderr)
print(f"kept by rule: {dict(kept_why)}", file=sys.stderr)
print(f"skipped: {dict(skipped)}", file=sys.stderr)
print(f"selected rows sourced from Foursquare: {fsq_selected}", file=sys.stderr)
