"""Find OSM disc golf courses that have no name, name them after the park they sit in, and write SQL files that load them.

    pip install duckdb
    SUPABASE_ANON_KEY=... python supabase/osm/name-unnamed-osm.py --release 2026-11-18.0 --out supabase/osm/refresh-2026-11-named

build-osm-refresh.py skips OSM elements with no name. Many of those are real courses inside a named park. This keeps only
elements tagged leisure=disc_golf_course (never a hole, basket or tee), not within 400 m of a live course, once per 400 m,
and names each "<Park> Disc Golf Course" from the nearest Overture place of a park category within 200 m. The park name
must be plain (no dog parks, skateparks, splash pads, gardens, football fields and so on, Latin letters only) and the
point must fall in a country. Everything else is left out: about 340 courses with no usable park name at the time of
writing, which would need a generic name such as "Disc Golf Course (Henrietta, NY)" and a decision to load them.

The output uses import_osm_courses(), like build-osm-refresh.py: 18 holes at par 3, unverified. Data (c) OpenStreetMap
contributors (ODbL) and Overture Maps Foundation (place names).
"""
import argparse
import collections
import json
import math
import os
import re
import urllib.parse
import urllib.request

import duckdb

p = argparse.ArgumentParser()
p.add_argument("--release", required=True)
p.add_argument("--out", required=True)
p.add_argument("--osm-json", help="an Overpass result saved earlier (skips the download)")
p.add_argument("--drop", default="", help="park names to leave out after a look at the list, separated by semicolons")
a = p.parse_args()
URL = os.environ.get("SUPABASE_URL", "https://ygewircfvsadazpwxquv.supabase.co")
KEY = os.environ["SUPABASE_ANON_KEY"]
UA = os.environ.get("OVERPASS_UA", "Discores-course-import/1.0")
drop = {x.strip().lower() for x in a.drop.split(";") if x.strip()}

live, start = [], 0
while True:
    req = urllib.request.Request(URL + "/rest/v1/courses?select=exact_location&order=id",
                                 headers={"apikey": KEY, "Authorization": "Bearer " + KEY, "Range": f"{start}-{start + 999}"})
    page = json.load(urllib.request.urlopen(req))
    live += page
    if len(page) < 1000:
        break
    start += 1000
grid = collections.defaultdict(list)
for c in live:
    if c.get("exact_location"):
        x, y = c["exact_location"].strip("()").split(",")
        grid[(int(float(y) / 0.01), int(float(x) / 0.01))].append((float(y), float(x)))


def km(x, y):
    dla = math.radians(y[0] - x[0])
    dln = math.radians(y[1] - x[1])
    h = math.sin(dla / 2) ** 2 + math.cos(math.radians(x[0])) * math.cos(math.radians(y[0])) * math.sin(dln / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def near_live(la, ln):
    ci, cj = int(la / 0.01), int(ln / 0.01)
    return any(km((la, ln), q) <= 0.4 for i in range(ci - 3, ci + 4) for j in range(cj - 3, cj + 4) for q in grid.get((i, j), ()))


query = '[out:json][timeout:250];(nwr["sport"="disc_golf"];nwr["leisure"="disc_golf_course"];);out center tags;'
if a.osm_json:
    elements = json.load(open(a.osm_json, encoding="utf-8"))["elements"]
else:
    req = urllib.request.Request("https://overpass-api.de/api/interpreter", data=urllib.parse.urlencode({"data": query}).encode(),
                                 headers={"User-Agent": UA, "Accept": "*/*"})
    elements = json.load(urllib.request.urlopen(req, timeout=290))["elements"]

PART = {"hole", "basket", "tee", "putting", "fairway", "out_of_bounds", "target", "practice_basket"}
cands = []
for e in elements:
    t = e.get("tags", {})
    la = e.get("lat") or (e.get("center") or {}).get("lat")
    ln = e.get("lon") or (e.get("center") or {}).get("lon")
    if la is None or t.get("name"):
        continue
    if t.get("disc_golf") in PART or t.get("golf") in ("pin", "tee", "green", "hole") or t.get("tourism") == "information" or t.get("shop"):
        continue
    if (t.get("leisure") == "disc_golf_course" or t.get("type") == "disc_golf_course") and not near_live(la, ln):
        cands.append({"id": f'{e["type"]}/{e["id"]}', "lat": la, "lng": ln, "tags": t})
rank = {"relation": 0, "way": 1, "node": 2}
kept = []
for c in sorted(cands, key=lambda c: rank[c["id"].split("/")[0]]):
    if not any(km((c["lat"], c["lng"]), (k["lat"], k["lng"])) <= 0.4 for k in kept):
        kept.append(c)
print("unnamed courses not already live:", len(kept))

con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
con.execute("create table pts(i int, lat double, lng double)")
con.executemany("insert into pts values (?,?,?)", [(i, c["lat"], c["lng"]) for i, c in enumerate(kept)])
pl = f"s3://overturemaps-us-west-2/release/{a.release}/theme=places/type=place/*"
best = {}
for i, nm, conf, d in con.execute(
    f"""select p.i, a.names.primary, a.confidence,
               sqrt(power((a.bbox.ymin - p.lat) * 111.0, 2) + power((a.bbox.xmin - p.lng) * 111.0 * cos(radians(p.lat)), 2))
        from pts p join read_parquet('{pl}', hive_partitioning=1) a
          on a.bbox.xmin between p.lng - 0.01 and p.lng + 0.01 and a.bbox.ymin between p.lat - 0.01 and p.lat + 0.01
        where a.taxonomy.primary in ('park', 'state_park', 'city_park', 'national_park', 'recreation_area', 'nature_reserve')
          and a.names.primary is not null and coalesce(a.operating_status, 'open') <> 'permanently_closed'"""
).fetchall():
    if d <= 0.2 and (i not in best or (d, -conf) < (best[i][1], -best[i][2])):
        best[i] = (nm, d, conf)
dv = f"s3://overturemaps-us-west-2/release/{a.release}/theme=divisions/type=division_area/*"
areas = collections.defaultdict(lambda: collections.defaultdict(list))
for i, st, nm, region, country in con.execute(
    f"""select p.i, a.subtype, a.names.primary, a.region, a.country
        from pts p join read_parquet('{dv}', hive_partitioning=1) a on ST_Contains(a.geometry, ST_Point(p.lng, p.lat))
        where a.subtype in ('country','region','localadmin','locality') and a.is_land"""
).fetchall():
    areas[i][st].append((nm, region, country))

BAD = re.compile(r"dog|canine|skate|camp|playground|tennis|pool|cemetery|school|pickle|baseball|softball|soccer|football|golf club|trail\b|lake$|verein|ground$|splash|pad$|promenade|pond|fountain|plaza|garden|historic|district|sports complex", re.I)
LATIN = re.compile(r"^[\x20-\x7eÀ-ɏ]+$")
rows = collections.defaultdict(list)
for i, c in enumerate(kept):
    if i not in best:
        continue
    park = re.sub(r"\s+", " ", best[i][0]).strip()
    if BAD.search(park) or not LATIN.match(park) or park.lower() in drop:
        continue
    ar = areas.get(i, {})
    reg = ar["region"][0] if ar.get("region") else (None, None, None)
    country = reg[2] or (ar["country"][0][2] if ar.get("country") else None)
    if not country:
        continue
    city = next((ar[s][0][0] for s in ("locality", "localadmin") if ar.get(s)), None)
    code = reg[1].split("-")[-1] if country in ("US", "CA", "AU") and reg[1] else country
    name = park if re.search(r"disc ?golf", park, re.I) else f"{park} Disc Golf Course"
    try:
        holes = int(c["tags"].get("holes", ""))
        holes = holes if 1 <= holes <= 36 else 18
    except ValueError:
        holes = 18
    rows[country].append({"osm_id": c["id"], "name": name, "area": ", ".join(x for x in (city, code) if x),
                          "lat": round(c["lat"], 6), "lng": round(c["lng"], 6), "holes": holes})
os.makedirs(a.out, exist_ok=True)
for g, part in sorted(rows.items()):
    tag = "osmn" + re.sub(r"\W", "", g)
    body = json.dumps(part, ensure_ascii=False, separators=(",", ":"))
    assert f"${tag}$" not in body
    with open(os.path.join(a.out, g + ".sql"), "w", encoding="utf-8", newline="\n") as f:
        f.write(f"select public.import_osm_courses(${tag}${body}${tag}$::jsonb);\n")
print(f"{sum(len(v) for v in rows.values())} courses in {len(rows)} files under {a.out}")
