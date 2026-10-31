import unittest

from overture_rules import area_label, classify, clean_name


class Classify(unittest.TestCase):
    def test_regular_course_is_kept(self):
        self.assertEqual(classify("Maple Hill Disc Golf Course", "disc_golf_course", 0.9, "open"), ("keep", "primary"))

    def test_shop_gym_and_golf_business_are_skipped(self):
        for name in ("The Nati Disc Golf Pro Shop", "Davidson's All Natural Gym", "Waterloo Dog Park",
                     "Dretzka Golf Courses", "Black Stream Disc Golf LLC"):
            self.assertEqual(classify(name, "disc_golf_course", 0.9, None)[0], "skip", name)

    def test_closed_is_skipped_in_any_category(self):
        self.assertEqual(classify("Old Disc Golf Course", "disc_golf_course", 1.0, "permanently_closed"), ("skip", "closed"))
        self.assertEqual(classify("Old Disc Golf Park", "park", 1.0, "closed"), ("skip", "closed"))

    def test_low_confidence_is_kept_only_when_the_name_says_course(self):
        self.assertEqual(classify("Land of Memories Disc Golf Course", "disc_golf_course", 0.35, None),
                         ("keep", "low_confidence_named"))
        self.assertEqual(classify("The Heritage DGC", "disc_golf_course", 0.34, None), ("keep", "low_confidence_named"))
        self.assertEqual(classify("Disc Golf", "disc_golf_course", 0.36, None), ("skip", "low_confidence"))
        self.assertEqual(classify("Sky High Disc Golf Club", "disc_golf_course", 0.25, None), ("skip", "low_confidence"))

    def test_other_categories_need_a_plain_course_name(self):
        self.assertEqual(classify("Horizon Disc Golf Park", "park", 0.83, None), ("keep", "extra"))
        self.assertEqual(classify("Jack Brooks Disc Golf", "park", 0.75, None), ("keep", "extra"))
        self.assertEqual(classify("Treasure Cove Disc Golf Course", "golf_course", 0.95, None), ("keep", "extra"))

    def test_other_categories_that_are_not_courses_are_skipped(self):
        cases = [
            ("Riverside Disc Golf Shop", "sporting_goods_store", 0.9),   # wrong category
            ("Discount Disc Golf", "discount_store", 0.9),
            ("Seltice Wash & Disc Golf", "laundromat", 0.99),
            ("Mossy Bluff Disc Golf Association", "park", 0.92),         # an association, not a course
            ("FTA Disc Golf and Pickleball", "sports_and_recreation", 0.9),
            ("Disc Golf Baskets", "sports_and_recreation", 0.9),         # does not end like a course name
            ("Whittier Narrows Disc Golf", "stadium_arena", 0.36),       # below the confidence cutoff
        ]
        for name, primary, conf in cases:
            self.assertEqual(classify(name, primary, conf, None)[0], "skip", name)

    def test_outside_the_us_the_name_must_mention_discs(self):
        self.assertEqual(classify("Aytekin Oto Boya", "disc_golf_course", 0.9, None, need_disc_word=True),
                         ("skip", "no_disc_word"))
        self.assertEqual(classify("Aytekin Oto Boya", "disc_golf_course", 0.9, None)[0], "keep")
        for name in ("Paiholan frisbeegolfrata", "Tyresö Frisbegolf", "Tallbackens DGB", "Knektaparkens Discgolfbana"):
            self.assertEqual(classify(name, "disc_golf_course", 0.9, None, need_disc_word=True)[0], "keep", name)

    def test_empty_name(self):
        self.assertEqual(classify("", "disc_golf_course", 1.0, None), ("skip", "no_name"))


class Names(unittest.TestCase):
    def test_hole_and_tee_records_are_renamed_to_the_course(self):
        self.assertEqual(clean_name("Riverside Disc Golf Course Hole #1 - Blue"), "Riverside Disc Golf Course")
        self.assertEqual(clean_name("Riverside DGC, Tee 3"), "Riverside DGC")
        self.assertEqual(clean_name(None), "")


class Area(unittest.TestCase):
    def test_labels(self):
        self.assertEqual(area_label("Anchorage", "AK", "US"), "Anchorage, AK")
        self.assertEqual(area_label("Toronto", "ON", "CA"), "Toronto, ON")
        self.assertEqual(area_label("Helsinki", "Uusimaa", "FI"), "Helsinki, FI")
        self.assertEqual(area_label(None, "AK", "US"), "AK")
        self.assertEqual(area_label("Anchorage", None, "US"), "Anchorage, US")


if __name__ == "__main__":
    unittest.main()
