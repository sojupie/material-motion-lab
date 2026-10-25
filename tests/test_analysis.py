import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import cv2
import numpy as np
from app import analysis as core


class VideoTrackingTest(unittest.TestCase):
    def test_varying_timestamps_tracking_loss_correction_and_export(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            previous = core.PROJECTS
            core.PROJECTS = root / "projects"
            try:
                rng = np.random.default_rng(17)
                patch = rng.integers(10, 245, (24, 30), dtype=np.uint8)
                positions = [20, 23, 26, 26, 31, 200, 205]
                times = [0, 0.04, 0.10, 0.16, 0.20, 0.30, 0.36]
                listing = []
                for i, x in enumerate(positions):
                    frame = np.full((120, 320), 248, np.uint8)
                    frame[45:69, x : x + 30] = patch
                    cv2.imwrite(str(root / f"{i}.png"), frame)
                    duration = times[i + 1] - times[i] if i + 1 < len(times) else 0.04
                    listing += [
                        f"file '{i}.png'",
                        "option framerate 1000",
                        f"duration {duration}",
                    ]
                # Last entry supplies the preceding duration to the concat demuxer.
                listing += ["file '6.png'", "option framerate 1000"]
                (root / "frames.txt").write_text("\n".join(listing))
                video = root / "test.mp4"
                core.command(
                    [
                        "ffmpeg",
                        "-v",
                        "error",
                        "-f",
                        "concat",
                        "-safe",
                        "0",
                        "-i",
                        str(root / "frames.txt"),
                        "-fps_mode",
                        "vfr",
                        "-enc_time_base",
                        "1:1000",
                        "-c:v",
                        "libx264",
                        "-crf",
                        "10",
                        "-pix_fmt",
                        "yuv420p",
                        str(video),
                    ]
                )
                data = core.import_video(video)
                self.assertEqual((data["width"], data["height"]), (320, 120))
                for actual, expected in zip(data["times"], times):
                    self.assertAlmostEqual(actual, expected * 1000, delta=1)
                tracked = core.track(data["id"], [20, 45, 30, 24], end=6, search=30)
                self.assertEqual(
                    [s["x"] for s in tracked["samples"][:5]], positions[:5]
                )
                self.assertFalse(tracked["samples"][5]["valid"])
                self.assertIsNone(tracked["samples"][5]["x"])
                fixed = core.track(
                    data["id"],
                    [20, 45, 30, 24],
                    end=6,
                    search=30,
                    anchors=[{"frame": 5, "region": [200, 45, 30, 24]}],
                )
                self.assertEqual([s["x"] for s in fixed["samples"]], positions)
                self.assertTrue(fixed["samples"][5]["manual"])
                self.assertEqual(core.load(data["id"])["samples"], fixed["samples"])
                csv = core.export_csv(data["id"]).read_text()
                self.assertIn("300.0,200,45", csv)
                out = core.export_video(data["id"])
                exported = core.inspect(out)
                self.assertEqual(len(exported["times"]), len(data["times"]) + 1)
                for actual, expected in zip(exported["times"], data["times"]):
                    self.assertAlmostEqual(actual, expected, delta=1)
                command = subprocess.run(
                    [
                        sys.executable,
                        "-m",
                        "app.cli",
                        "inspect",
                        str(video),
                    ],
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(command.returncode, 0, command.stderr)
                self.assertEqual(json.loads(command.stdout)["times"], data["times"])
                with self.assertRaises(ValueError):
                    core.track(data["id"], [-1, 0, 10, 10])
                with self.assertRaises(ValueError):
                    core.track(data["id"], [0, 0, 10, 10])
                with self.assertRaises(ValueError):
                    core.folder("../outside")
            finally:
                core.PROJECTS = previous


if __name__ == "__main__":
    unittest.main()
