"""Exercise the boundary between a final shutdown record and its prior replay LSN."""
import unittest

from proof import applied, identity, promoted, terminal


class TerminalProof(unittest.TestCase):
    control = ("Database system identifier: 123456789\nDatabase cluster state: shut down\n"
               "Latest checkpoint location: 2/3000170\nLatest checkpoint's TimeLineID: 1")
    record = ("rmgr: XLOG len (rec/tot): 114/114, tx: 0, lsn: 2/03000170, prev 2/03000148, "
              "desc: CHECKPOINT_SHUTDOWN redo 2/3000170; tli 1; prev tli 1; shutdown")

    def test_pre_stop_flush_is_equal_to_start_of_the_final_record(self):
        source = terminal(self.control, self.record)
        for reply, recovering in [("123456789|1|2/3000170|", True), ("123456789|1|2/2000000|", True),
                                  ("123456789|2|2/30001E8|", True), ("123456788|1|2/30001E8|", True),
                                  ("123456789|1|2/30001E8|", False)]:
            with self.subTest(reply=reply, recovering=recovering), self.assertRaises(ValueError):
                applied(source, reply, recovering)
        before = applied(source, "123456789|1|2/30001E8|", True)
        primary = "123456789|2|2/3000220|"
        self.assertEqual(promoted(before, primary, False, "1\t2/30001E8\tno recovery target")["forkLsn"], "2/30001E8")
        for history in ["2 2/30001E8", "1 2/3000170", "1 2/3000700", "", "1 2/30001E8\n2 2/30001F2"]:
            with self.subTest(history=history), self.assertRaises(ValueError):
                promoted(before, primary, False, history)

    def test_native_record_and_physical_identity(self):
        for control, record in [(self.control.replace("shut down", "in production"), self.record),
                                (self.control, self.record.replace("CHECKPOINT_SHUTDOWN", "CHECKPOINT_ONLINE")),
                                (self.control, self.record.replace("lsn: 2/03000170", "lsn: 2/03000178")),
                                (self.control, self.record.replace("tli 1;", "tli 2;"))]:
            with self.subTest(control=control, record=record), self.assertRaises(ValueError):
                terminal(control, record)
        for invalid in ["123456789|1|1/100000000|", "123456789|0|1/20|", "123456789|1|1/20|postgres"]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                identity(invalid)


if __name__ == "__main__":
    unittest.main()
