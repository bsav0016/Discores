"""Find disc golf courses in OpenStreetMap that Discores does not have yet, and write SQL files that load them.

    pip install duckdb
    python supabase/osm/build-osm-refresh.py --release 2026-11-18.0 --exclude-sql supabase/overture --out supabase/osm/refresh-2026-11

What it does, in order:
 1. Reads the courses the live project has now, through the public read key the app ships with (SUPABASE_URL and
    SUPABASE_ANON_KEY in the environment; both are in app/eas.json). Nothing is written.
 2. Pulls every OSM element tagged leisure=disc_golf_course or sport=disc_golf from Overpass (set a real contact in
    OVERPASS_UA; Overpass refuses requests with no User-Agent).
 3. Keeps whole courses only: drops holes, baskets, tees, signs, shops, footgolf and mini golf, and anything unnamed.
    A sport=disc_golf element with no course tag is kept only when its name says disc golf or frisbee golf.
 4. Drops anything within 400 m of a live course, or of a course in an earlier load file under --exclude-sql
    (Overture load files carry lat/lng), and anything with the same name within 5 km of a live course. A course drawn
    as several elements is kept once. import_osm_courses() only skips osm_ids, so this check is what prevents doubles.
 5. Labels each course "City, ST" (US, Canada, Australia) or "City, CC" from OSM's addr:city or, failing that, the
    Overture division boundary that holds the point (no city: just "ST" or "CC"). A point in no country is skipped.
 6. Writes one file per US state or country (split every 250 courses), each one `select public.import_osm_courses(...)`.

Pars are not in OSM, so imported layouts get par 3 on every hole (18 holes unless OSM says) and stay unverified,
as with the first OSM import. Data (c) OpenStreetMap contributors, ODbL; the app shows the attribution.
"""
import argparse
import collections
import glob
import json
import math
import os
import re
import unicodedata
import urllib.parse
import urllib.request

import duckdb

p = argparse.ArgumentParser()
p.add_argument("--release", required=True, help="Overture release for the division boundaries, e.g. 2026-11-18.0")
p.add_argument("--exclude-sql", action="append", default=[], help="folder of earlier load files (lat/lng are read from them)")
p.add_argument("--out", required=True)
a = p.parse_args()

URL = os.environ.get("SUPABASE_URL", "https://ygewircfvsadazpwxquv.supabase.co")
KEY = os.environ["SUPABASE_ANON_KEY"]
UA = os.environ.get("OVERPASS_UA", "Discores-course-import/1.0")

# 1. live courses
live = []
start = 0
while True:
    req = urllib.request.Request(URL + "/rest/v1/courses?select=name,exact_location&order=id",
                                 headers={"apikey": KEY, "Authorization": "Bearer " + KEY, "Range": f"{start}-{start + 999}"})
    page = json.load(urllib.request.urlopen(req))
    live += page
    if len(page) < 1000:
        break
    start += 1000
print("live courses:", len(live))

# 2. OSM
query = '[out:json][timeout:250];(nwr["sport"="disc_golf"];nwr["leisure"="disc_golf_course"];);out center tags;'
req = urllib.request.Request("https://overpass-api.de/api/interpreter", data=urllib.parse.urlencode({"data": query}).encode(),
                             headers={"User-Agent": UA, "Accept": "*/*"})
elements = json.load(urllib.request.urlopen(req, timeout=290))["elements"]
print("OSM elements:", len(elements))

# 3. whole courses only
PART = {"hole", "basket", "tee", "putting", "fairway", "out_of_bounds", "target", "practice_basket"}
WORDS = re.compile(r"disc ?golf|diskgolf|disc-golf|frisbee|frisbi|dgc|frolf|disk golf|discpark|disc park", re.I)
HOLEISH = re.compile(r"^(hole|bahn|korg|kori|basket|tee|green|fairway|rata|rada)?\s*[#]?\d+[a-z]?$|^(hole|bahn|basket|tee|korb|kori|korg|rata)[\s#-]*\d+", re.I)
BAD = re.compile(r"shop|store|club ?house|footgolf|foot golf|mini|miniature|putt|retail|pro ?shop", re.I)
cands = []
for e in elements:
    t = e.get("tags", {})
    lat = e.get("lat") or (e.get("center") or {}).get("lat")
    lng = e.get("lon") or (e.get("center") or {}).get("lon")
    name = t.get("name", "").strip()
    if lat is None or not name or HOLEISH.search(name) or BAD.search(name):
        continue
    if t.get("disc_golf") in PART or t.get("golf") in ("pin", "tee", "green", "hole") or t.get("tourism") == "information":
        continue
    if t.get("shop") or t.get("amenity") in ("restaurant", "cafe", "bar", "pub", "parking"):
        continue
    if t.get("leisure") == "disc_golf_course" or t.get("type") == "disc_golf_course" or (t.get("sport") == "disc_golf" and WORDS.search(name)):
        cands.append({"id": f'{e["type"]}/{e["id"]}', "name": re.sub(r"\s+", " ", name), "lat": lat, "lng": lng, "tags": t})
print("whole courses:", len(cands))


def km(x, y):
    dla = math.radians(y[0] - x[0])
    dln = math.radians(y[1] - x[1])
    h = math.sin(dla / 2) ** 2 + math.cos(math.radians(x[0])) * math.cos(math.radians(y[0])) * math.sin(dln / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(disc ?golf|discgolf|frisbee ?golf|frisbeegolf|course|park|dgc|diskgolf|the)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", "", s)


# 4. not already there
pts = []  # (lat, lng, normalised name)
for c in live:
    if c.get("exact_location"):
        x, y = c["exact_location"].strip("()").split(",")
        pts.append((float(y), float(x), norm(c["name"])))
for folder in a.exclude_sql:
    for f in glob.glob(os.path.join(folder, "**", "*.sql"), recursive=True):
        for m in re.finditer(r'"lat":(-?[\d.]+),"lng":(-?[\d.]+)', open(f, encoding="utf-8").read()):
            pts.append((float(m.group(1)), float(m.group(2)), ""))
grid = collections.defaultdict(list)
for la, ln, nm in pts:
    grid[(int(la / 0.01), int(ln / 0.01))].append((la, ln, nm))


def near(c, r_km, same_name=False):
    ci, cj = int(c["lat"] / 0.01), int(c["lng"] / 0.01)
    span = 3 if r_km <= 0.4 else 8
    key = norm(c["name"])
    for i in range(ci - span, ci + span + 1):
        for j in range(cj - span, cj + span + 1):
            for la, ln, nm in grid.get((i, j), ()):
                if km((c["lat"], c["lng"]), (la, ln)) <= r_km and (not same_name or (nm == key and len(key) >= 4)):
                    return True
    return False


fresh = [c for c in cands if not near(c, 0.4) and not near(c, 5, same_name=True)]
kept = []
for c in sorted(fresh, key=lambda c: c["id"].split("/")[0] != "relation"):  # a relation stands for its ways and nodes
    if not any(km((c["lat"], c["lng"]), (k["lat"], k["lng"])) <= 0.4 or (k["name"] == c["name"] and km((c["lat"], c["lng"]), (k["lat"], k["lng"])) <= 5) for k in kept):
        kept.append(c)
print("new after de-duplicating:", len(kept))

# 5. places
con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
con.execute("create table pts(i int, lat double, lng double)")
con.executemany("insert into pts values (?,?,?)", [(i, c["lat"], c["lng"]) for i, c in enumerate(kept)])
base = f"s3://overturemaps-us-west-2/release/{a.release}/theme=divisions/type=division_area/*"
areas = collections.defaultdict(lambda: collections.defaultdict(list))
for i, subtype, nm, region, country in con.execute(
    f"""select p.i, a.subtype, a.names.primary, a.region, a.country
        from pts p join read_parquet('{base}', hive_partitioning=1) a on ST_Contains(a.geometry, ST_Point(p.lng, p.lat))
        where a.subtype in ('country', 'region', 'localadmin', 'locality') and a.is_land"""
).fetchall():
    areas[i][subtype].append((nm, region, country))

# 6. files
groups = collections.defaultdict(list)
skipped = 0
for i, c in enumerate(kept):
    ar = areas.get(i, {})
    reg = ar["region"][0] if ar.get("region") else (None, None, None)
    country = reg[2] or (ar["country"][0][2] if ar.get("country") else None)
    if not country:
        skipped += 1
        continue
    city = c["tags"].get("addr:city") or next((ar[s][0][0] for s in ("locality", "localadmin") if ar.get(s)), None)
    code = reg[1].split("-")[-1] if country in ("US", "CA", "AU") and reg[1] else country
    try:
        holes = int(c["tags"].get("holes", ""))
        holes = holes if 1 <= holes <= 36 else 18
    except ValueError:
        holes = 18
    group = f"US-{code}" if country == "US" and reg[1] else country
    groups[group].append({"osm_id": c["id"], "name": c["name"], "area": ", ".join(x for x in (city, code) if x),
                          "lat": round(c["lat"], 6), "lng": round(c["lng"], 6), "holes": holes})
os.makedirs(a.out, exist_ok=True)
files = 0
for g, rows in sorted(groups.items()):
    for k in range(0, len(rows), 250):
        part = rows[k:k + 250]
        tag = "osm" + re.sub(r"\W", "", g)
        body = json.dumps(part, ensure_ascii=False, separators=(",", ":"))
        assert f"${tag}$" not in body
        name = g if len(rows) <= 250 else f"{g}-{k // 250 + 1}"
        with open(os.path.join(a.out, name + ".sql"), "w", encoding="utf-8", newline="\n") as f:
            f.write(f"select public.import_osm_courses(${tag}${body}${tag}$::jsonb);\n")
        files += 1
print(f"{sum(len(v) for v in groups.values())} courses in {files} files under {a.out} ({skipped} skipped: no country)")
