import unittest

from merge_vip_dataset import EXPECTED_FIELDS, merge, normalize_handle, x_identity


def row(**values):
    return {field: values.get(field, "") for field in EXPECTED_FIELDS}


class MergeTests(unittest.TestCase):
    def test_handle_normalization(self):
        self.assertEqual(normalize_handle(" @Some_User "), "some_user")
        self.assertEqual(normalize_handle("https://x.com/Some_User?ref=test"), "some_user")
        self.assertEqual(x_identity(row(x_url="https://twitter.com/LegacyName/status/1")), "legacyname")

    def test_new_record_is_added_and_duplicate_is_ignored(self):
        existing = row(x_handle="known", pump_handle="pump1")
        duplicate = row(x_handle="@KNOWN", pump_handle="pump1", followers="new value")
        new = row(x_handle="new_person", pump_handle="pump2")
        merged, inactive, stats = merge([existing], [duplicate, new])
        self.assertEqual(len(merged), 2)
        self.assertEqual(inactive, [])
        self.assertEqual(stats["added"], 1)
        self.assertEqual(stats["duplicate"], 1)
        self.assertEqual(existing["followers"], "")

    def test_conflicting_supporting_identity_is_skipped(self):
        existing = row(x_handle="same", pump_handle="person_a")
        incoming = row(x_handle="same", pump_handle="person_b")
        merged, inactive, stats = merge([existing], [incoming])
        self.assertEqual(merged, [existing])
        self.assertEqual(inactive, [])
        self.assertEqual(stats["conflict"], 1)

    def test_missing_x_handle_is_saved_inactive_and_deduplicated(self):
        candidate = row(pump_handle="only_pump")
        merged, inactive, stats = merge([], [candidate, candidate])
        self.assertEqual(merged, [])
        self.assertEqual(inactive, [candidate])
        self.assertEqual(stats["inactive_added"], 1)
        self.assertEqual(stats["inactive_duplicate"], 1)

    def test_inactive_records_do_not_affect_active_index(self):
        inactive_record = row(profile_name="Only Pump", pump_handle="only_pump")
        merged, inactive, stats = merge([], [inactive_record])
        self.assertEqual(merged, [])
        self.assertEqual(inactive, [inactive_record])
        self.assertEqual(stats["added"], 0)

    def test_legacy_incomplete_active_record_is_migrated(self):
        incomplete = row(profile_name="Only Pump", pump_handle="only_pump")
        merged, inactive, stats = merge([incomplete], [])
        self.assertEqual(merged, [])
        self.assertEqual(inactive, [incomplete])
        self.assertEqual(stats["migrated_inactive"], 1)

    def test_completed_record_is_promoted_out_of_inactive_store(self):
        incomplete = row(profile_name="Only Pump", pump_handle="only_pump")
        completed = row(
            profile_name="Only Pump",
            pump_handle="only_pump",
            x_handle="complete_person",
            x_url="https://x.com/complete_person",
        )
        merged, inactive, stats = merge([], [completed], [incomplete])
        self.assertEqual(merged, [completed])
        self.assertEqual(inactive, [])
        self.assertEqual(stats["added"], 1)
        self.assertEqual(stats["promoted"], 1)

    def test_inactive_profiles_deduplicate_by_pump_identity(self):
        old = row(pump_handle="only_pump", followers="100 followers")
        refreshed = row(pump_handle="ONLY_PUMP", followers="101 followers")
        merged, inactive, stats = merge([], [refreshed], [old])
        self.assertEqual(merged, [])
        self.assertEqual(inactive, [old])
        self.assertEqual(stats["inactive_duplicate"], 1)


if __name__ == "__main__":
    unittest.main()
