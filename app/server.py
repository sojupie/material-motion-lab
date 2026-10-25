from pathlib import Path
from typing import Literal
import tempfile
import threading
from collections import defaultdict

from fastapi import FastAPI, UploadFile, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import analysis as core


class Anchor(BaseModel):
    frame: int = Field(ge=0)
    region: tuple[float, float, float, float]


class TrackRequest(BaseModel):
    region: tuple[float, float, float, float]
    start: int = Field(default=0, ge=0)
    end: int | None = Field(default=None, ge=0)
    anchors: list[Anchor] | None = None
    search: int = Field(default=60, ge=4, le=1000)
    threshold: float = Field(default=0.65, ge=0, le=1)


class CompareRequest(BaseModel):
    reference: str | None = None
    zero: int = Field(default=0, ge=0)


class ZeroRequest(BaseModel):
    frame: int = Field(ge=0)


app = FastAPI(title="UI Motion")
locks = defaultdict(threading.Lock)


@app.exception_handler(ValueError)
async def bad_value(request: Request, exc: ValueError):
    from fastapi.responses import JSONResponse

    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(FileNotFoundError)
async def missing_file(request: Request, exc: FileNotFoundError):
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=404, content={"detail": "Project or file not found"}
    )


@app.get("/api/projects")
def projects():
    if not core.PROJECTS.exists():
        return []
    return [
        {"id": p.parent.name, "name": core.load(p.parent.name)["name"]}
        for p in sorted(
            core.PROJECTS.glob("*/project.json"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
    ]


@app.post("/api/import")
def import_video(file: UploadFile):
    suffix = Path(file.filename or "video.mp4").suffix.lower()
    if suffix not in {".mp4", ".mov", ".webm", ".mkv", ".avi", ".gif"}:
        raise ValueError("Choose an MP4, MOV, WebM, MKV, AVI or GIF video")
    with tempfile.NamedTemporaryFile(suffix=suffix) as temp:
        total = 0
        while chunk := file.file.read(1024 * 1024):
            total += len(chunk)
            if total > 256 * 1024 * 1024:
                raise ValueError("Video exceeds 256 MB. Trim it before importing.")
            temp.write(chunk)
        temp.flush()
        return core.import_video(temp.name, file.filename)


@app.get("/api/projects/{project}")
def project_data(project: str):
    return core.load(project)


@app.get("/api/projects/{project}/frames/{frame}")
def frame_file(project: str, frame: int):
    data = core.load(project)
    if not 0 <= frame < len(data["times"]):
        raise ValueError("Frame outside recording")
    return FileResponse(core.folder(project) / "frames" / f"{frame + 1:06d}.png")


@app.post("/api/projects/{project}/track")
def track(project: str, payload: TrackRequest):
    with locks[project]:
        return core.track(
            project,
            payload.region,
            payload.start,
            payload.end,
            [a.model_dump() for a in payload.anchors]
            if payload.anchors is not None
            else None,
            payload.search,
            payload.threshold,
        )


@app.post("/api/projects/{project}/zero")
def zero(project: str, payload: ZeroRequest):
    with locks[project]:
        return core.set_zero(project, payload.frame)


@app.post("/api/projects/{project}/comparison")
def comparison(project: str, payload: CompareRequest):
    with locks[project]:
        return core.compare(project, payload.reference, payload.zero)


@app.get("/api/projects/{project}/download/{kind}")
def download(project: str, kind: str, axis: Literal["x", "y"] = "x"):
    with locks[project]:
        if kind == "json":
            path = core.folder(project) / "project.json"
            core.load(project)
        elif kind == "csv":
            path = core.export_csv(project)
        elif kind == "video":
            path = core.export_video(project, axis)
        else:
            raise HTTPException(404)
    return FileResponse(path, filename=path.name)


if (core.ROOT / "dist").exists():
    app.mount("/", StaticFiles(directory=core.ROOT / "dist", html=True), name="ui")
