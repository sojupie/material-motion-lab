import argparse
import json
from . import analysis as core


def main():
    parser = argparse.ArgumentParser(description="Measure UI motion from video")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("inspect")
    p.add_argument("video")
    p = sub.add_parser("import")
    p.add_argument("video")
    p = sub.add_parser("track")
    p.add_argument("project")
    p.add_argument("--region", required=True, help="x,y,width,height")
    p.add_argument("--start", type=int, default=0)
    p.add_argument("--end", type=int)
    p.add_argument("--search", type=int, default=60)
    p = sub.add_parser("correct")
    p.add_argument("project")
    p.add_argument("--frame", type=int, required=True)
    p.add_argument("--region", required=True)
    p = sub.add_parser("frames")
    p.add_argument("project")
    p.add_argument("--start", type=int, default=0)
    p.add_argument("--end", type=int)
    p.add_argument("--step", type=int, default=1)
    p = sub.add_parser("zero")
    p.add_argument("project")
    p.add_argument("--frame", type=int, required=True)
    p = sub.add_parser("compare")
    p.add_argument("project")
    p.add_argument("reference")
    p.add_argument("--zero-frame", type=int, default=0)
    p = sub.add_parser("export")
    p.add_argument("project")
    p.add_argument("--format", choices=["json", "csv", "video"], default="json")
    p.add_argument("--axis", choices=["x", "y"], default="x")
    p = sub.add_parser("serve")
    p.add_argument("--port", type=int, default=8091)
    args = parser.parse_args()
    try:
        if args.command == "inspect":
            result = core.inspect(args.video)
        elif args.command == "import":
            result = core.import_video(args.video)
        elif args.command == "track":
            result = core.track(
                args.project,
                [float(v) for v in args.region.split(",")],
                args.start,
                args.end,
                search=args.search,
            )
        elif args.command == "correct":
            data = core.load(args.project)
            s = data["settings"]
            if not s:
                raise ValueError("Track a region first")
            if not s["start"] <= args.frame <= s["end"]:
                raise ValueError("Correction must be inside the tracked interval")
            anchors = [a for a in data["anchors"] if a["frame"] != args.frame]
            roi = [float(v) for v in args.region.split(",")]
            anchors.append({"frame": args.frame, "region": roi})
            result = core.track(
                args.project,
                roi if args.frame == s["start"] else data["selection"],
                s["start"],
                s["end"],
                anchors,
                s["search"],
                s["threshold"],
            )
        elif args.command == "frames":
            data = core.load(args.project)
            if args.step < 1:
                raise ValueError("Step must be positive")
            result = [
                {
                    "frame": i,
                    "t": data["times"][i],
                    "file": str(
                        core.folder(args.project) / "frames" / f"{i + 1:06d}.png"
                    ),
                }
                for i in range(
                    max(0, args.start),
                    min(
                        len(data["times"]),
                        args.end + 1 if args.end is not None else len(data["times"]),
                    ),
                    args.step,
                )
            ]
        elif args.command == "zero":
            result = core.set_zero(args.project, args.frame)
        elif args.command == "compare":
            result = core.compare(args.project, args.reference, args.zero_frame)
        elif args.command == "export":
            result = str(
                core.export_video(args.project, args.axis)
                if args.format == "video"
                else core.export_csv(args.project)
                if args.format == "csv"
                else core.folder(args.project) / "project.json"
            )
        else:
            import uvicorn

            uvicorn.run("app.server:app", host="127.0.0.1", port=args.port)
            return
        print(json.dumps(result, indent=2))
    except (ValueError, FileNotFoundError) as exc:
        parser.exit(1, str(exc) + "\n")


if __name__ == "__main__":
    main()
