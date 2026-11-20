"""Pull disc golf courses from Foursquare's open places dataset and write SQL files that load the ones Discores lacks.

    pip install duckdb
    set HF_TOKEN (a Hugging Face read token for an account that accepted the terms at
                  https://huggingface.co/datasets/foursquare/fsq-os-places) and SUPABASE_ANON_KEY (the key in app/eas.json)
    python supabase/foursquare/import-foursquare.py --release 2026-11-17 --tier strict --out supabase/foursquare/strict-2026-11

Foursquare's open data (Apache 2.0, notice "Copyright 2024 Foursquare Labs, Inc. All rights reserved"; the app already
shows it) is crowd sourced: its generic "Disc Golf" category is full of shops, bars and unrelated businesses, and one
country's rows are almost all noise, so the rows are filtered hard:

 1. Rows tagged "Disc Golf" or "Disc Golf Course", not closed.
 2. The name must say disc, disk, frisbee, frolf or DGC, and must not be a shop, gym or ordinary golf business
    (overture_rules.is_not_a_course); hole and tee suffixes are stripped.
 3. Either the specific "Disc Golf Course" category, or a name that plainly says it is a course.
 4. Not within 400 m of a live course (read with the public key; nothing is written), not the same name within 15 km
    of one, no other course within 1 km, and one row per 400 m (same name: 5 km). Names that say defunct or closed go.

--tier strict   the specific category AND a name that says "disc golf course / park / complex", DGC, a frisbee golf
                park or a disc golf lane; leaving out names with private, member, HOA, apartments, brewery, hotel,
                LLC, Inc or church in them. About 240 courses at the first run, 184 in the US.
--tier medium   what is left after the strict tier that still passes steps 1 to 4 (no category check).
--rows-json F   reuse a saved list of rows instead of reading the dataset (reading it takes about 15 minutes).

Output is import_overture_courses() calls (it also skips anything within 400 m of a course, or the same name within
5 km), with overture_id "fsq:<fsq_place_id>", 18 holes at par 3, unverified. They are stored with source 'overture'
(the source column has no Foursquare value yet).
"""
import argparse
import collections
import json
import math
import os
import re
import sys
import unicodedata
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "overture"))
from overture_rules import DISCISH, LOOKS_LIKE_COURSE, EXTRA_NAME, EXTRA_SKIP, clean_name, is_not_a_course  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument("--release", required=True, help="Foursquare release date, e.g. 2026-11-17")
p.add_argument("--tier", choices=["strict", "medium"], required=True)
p.add_argument("--out", required=True)
p.add_argument("--rows-json")
a = p.parse_args()

COURSE_CAT = "63be6904847c3692a84b9c03"  # Disc Golf Course
GENERIC_CAT = "52e81612bcbc57f1066b79e8"  # Disc Golf
URL = os.environ.get("SUPABASE_URL", "https://ygewircfvsadazpwxquv.supabase.co")
KEY = os.environ["SUPABASE_ANON_KEY"]

if a.rows_json:
    rows = json.load(open(a.rows_json, encoding="utf-8"))
else:
    import duckdb
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("CREATE SECRET hf (TYPE HUGGINGFACE, TOKEN '" + os.environ["HF_TOKEN"] + "')")
    rows = con.execute(
        f"""select fsq_place_id, name, latitude, longitude, locality, region, country, fsq_category_ids, date_closed
            from read_parquet('hf://datasets/foursquare/fsq-os-places/release/dt={a.release}/places/parquet/*.parquet')
            where list_has_any(fsq_category_ids, ['{COURSE_CAT}', '{GENERIC_CAT}']) and latitude is not null"""
    ).fetchall()
print("rows tagged disc golf:", len(rows))


def cats(r):
    c = r[7]
    if isinstance(c, str):
        try:
            c = json.loads(c.replace("'", '"'))
        except ValueError:
            c = [c]
    return c


live, start = [], 0
while True:
    req = urllib.request.Request(URL + "/rest/v1/courses?select=name,exact_location&order=id",
                                 headers={"apikey": KEY, "Authorization": "Bearer " + KEY, "Range": f"{start}-{start + 999}"})
    page = json.load(urllib.request.urlopen(req))
    live += page
    if len(page) < 1000:
        break
    start += 1000


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(disc ?golf|discgolf|disk ?golf|frisbee ?golf|frisbeegolf|course|park|dgc|the|defunct)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def km(x, y):
    dla = math.radians(y[0] - x[0])
    dln = math.radians(y[1] - x[1])
    h = math.sin(dla / 2) ** 2 + math.cos(math.radians(x[0])) * math.cos(math.radians(y[0])) * math.sin(dln / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


grid = collections.defaultdict(list)
for c in live:
    if c.get("exact_location"):
        x, y = c["exact_location"].strip("()").split(",")
        grid[(int(float(y) / 0.05), int(float(x) / 0.05))].append((float(y), float(x), norm(c["name"])))


def around(la, ln):
    ci, cj = int(la / 0.05), int(ln / 0.05)
    return [q for i in (-1, 0, 1) for j in (-1, 0, 1) for q in grid.get((ci + i, cj + j), ())]


PRIVATEISH = re.compile(r"private|member|\bhoa\b|apartments|brew|hotel|\bllc\b|\binc\b|church|defunct|closed", re.I)
STRONG = re.compile(r"disc golf course|\bdgc\b|disc golf park|disc golf complex|discgolfpark|frisbeegolf|discgolfbane|diskgolf", re.I)
passed = []
for r in rows:
    if r[8]:
        continue
    name = clean_name(r[1])
    cs = cats(r)
    if not name or not DISCISH.search(name) or is_not_a_course(name):
        continue
    if not (COURSE_CAT in cs or LOOKS_LIKE_COURSE.search(name) or (EXTRA_NAME.search(name) and not EXTRA_SKIP.search(name))):
        continue
    if re.search(r"defunct|closed", name, re.I):
        continue
    near = around(r[2], r[3])
    if any(km((r[2], r[3]), (q[0], q[1])) <= 0.4 for q in near):
        continue
    key = norm(name)
    if len(key) >= 4 and any(q[2] == key and km((r[2], r[3]), (q[0], q[1])) <= 15 for q in near):
        continue
    if any(km((r[2], r[3]), (q[0], q[1])) <= 1.0 for q in near):
        continue
    passed.append((r, name))
strict = [(r, n) for r, n in passed if COURSE_CAT in cats(r) and STRONG.search(n) and not PRIVATEISH.search(n)]
strict_ids = {r[0] for r, _ in strict}
chosen = strict if a.tier == "strict" else [(r, n) for r, n in passed if r[0] not in strict_ids]
print(f"passed the filters: {len(passed)}; strict: {len(strict)}; this tier ({a.tier}): {len(chosen)}")

kept = []
for r, n in sorted(chosen, key=lambda x: COURSE_CAT not in cats(x[0])):  # the specific category first
    if not any(km((r[2], r[3]), (k[0][2], k[0][3])) <= 0.4 or (k[1].lower() == n.lower() and km((r[2], r[3]), (k[0][2], k[0][3])) <= 5) for k in kept):
        kept.append((r, n))

groups = collections.defaultdict(list)
for r, n in kept:
    ctry = r[6]
    code = r[5] if ctry in ("US", "CA", "AU") and r[5] else ctry
    area = ", ".join(x for x in (r[4], code) if x)
    group = f"US-{r[5]}" if ctry == "US" and r[5] else ctry
    groups[group].append({"overture_id": "fsq:" + r[0], "name": n, "area": area, "lat": round(r[2], 6), "lng": round(r[3], 6)})
os.makedirs(a.out, exist_ok=True)
files = 0
for g, rows_ in sorted(groups.items()):
    for k in range(0, len(rows_), 250):
        part = rows_[k:k + 250]
        tag = "fsq" + re.sub(r"\W", "", g)
        body = json.dumps(part, ensure_ascii=False, separators=(",", ":"))
        assert f"${tag}$" not in body
        name = g if len(rows_) <= 250 else f"{g}-{k // 250 + 1}"
        with open(os.path.join(a.out, name + ".sql"), "w", encoding="utf-8", newline="\n") as f:
            f.write(f"select public.import_overture_courses(${tag}${body}${tag}$::jsonb);\n")
        files += 1
print(f"{len(kept)} courses in {files} files under {a.out}")
