"""Which Overture places count as disc golf courses. Pure functions (no duckdb), so test_overture_rules.py can run
anywhere. import-overture.py reads the data and applies these rules."""
import re

# Overture's disc_golf_course category also catches shops, bars, gyms, ball diamonds, footgolf, ordinary golf courses
# and so on. Drop names with those words unless they also say "disc golf course" / "dgc" / "disc golf park" /
# "disc golf complex". A name that says "golf" or "country club" but nothing disc-like is an ordinary golf business.
NOT_A_COURSE = re.compile(
    r"pro shop|\bsupply\b|footgolf|foot golf|ball diamonds|\bllc\b|\binc\b|\bgym\b|athletic club|campground|\bstore\b|"
    r"\bshop\b|tap ?room|\bbrew|enterprises|skate park|ziplines|press box|water production|dog park", re.I)
LOOKS_LIKE_COURSE = re.compile(r"disc golf course|\bdgc\b|disc golf park|disc golf complex", re.I)
DISCISH = re.compile(r"disc|dgc|dgp|dgb|\bdg\b|frisbe|frolf|disk", re.I)
# Records for a single tee or hole ("... Hole #1 - Blue", "... Tee 1") are renamed to the course they belong to.
HOLE_SUFFIX = re.compile(r"[\s,\-–]*(?:hole\s*#?\d+(?:\s*-\s*\w+)?|tee\s*#?\d+)(?:\s+tee)?\s*$", re.I)

# Places filed under another category (a park, a recreation area...) whose name plainly says they are a course.
# Much stricter than the disc_golf_course category itself: a shop or a club also says "disc golf".
EXTRA_PRIMARY = {"park", "sports_and_recreation", "sport_or_fitness_facility", "stadium_arena", "golf_course",
                 "recreation_center", "nature_reserve", "playground", "historic_site"}
EXTRA_NAME = re.compile(
    r"disc golf (?:course|park|complex|trail|preserve|center)|\bdgc\b|disc golf$|frisbee ?golf ?(?:park|rata|course)?$",
    re.I)
EXTRA_SKIP = re.compile(NOT_A_COURSE.pattern + r"|\bclub\b|association|league|tournament|pickleball|&|\band\b", re.I)


def clean_name(name):
    return HOLE_SUFFIX.sub("", name or "").strip()


def is_not_a_course(name):
    """True for names of shops, gyms and ordinary golf businesses that Overture files as disc golf."""
    return bool(
        (NOT_A_COURSE.search(name) and not LOOKS_LIKE_COURSE.search(name))
        or (re.search(r"\bgolf\b|country club", name, re.I) and not DISCISH.search(name)))


def classify(name, primary, confidence, status, min_confidence=0.4, need_disc_word=False):
    """Returns ('keep', why) or ('skip', why) for one place whose name was already cleaned.

    why is 'primary' (disc_golf_course category), 'low_confidence_named' (below the cutoff but the name plainly says
    it is a course) or 'extra' (another category, plainly named a course).

    need_disc_word: the name must also mention discs, frisbees or the like. Used outside the US, where the category is
    sometimes applied to unrelated places (a country's car repair shops, for instance)."""
    if not name:
        return "skip", "no_name"
    if status and "closed" in status:
        return "skip", "closed"
    if need_disc_word and not DISCISH.search(name):
        return "skip", "no_disc_word"
    if primary == "disc_golf_course":
        if is_not_a_course(name):
            return "skip", "not_a_course"
        if confidence < min_confidence:
            if LOOKS_LIKE_COURSE.search(name):
                return "keep", "low_confidence_named"
            return "skip", "low_confidence"
        return "keep", "primary"
    if primary in EXTRA_PRIMARY and confidence >= min_confidence and EXTRA_NAME.search(name) \
            and not EXTRA_SKIP.search(name) and not is_not_a_course(name):
        return "keep", "extra"
    return "skip", "other_category"


def area_label(locality, region, country):
    """'Anchorage, AK' for the US, Canada and Australia (state or province code); 'Helsinki, FI' elsewhere."""
    part = region if country in ("US", "CA", "AU") and region else country
    return ", ".join(x for x in (locality, part) if x)
