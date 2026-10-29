import { $ } from "./api";
import { reportFailure,required } from "./errors";
import { setIcon } from "./icons";
import {
alignedOffset,
playbackPosition,
snapTime,
sourceFrame,
workspaceFrame,
} from "./timing";
import type { Playback } from "./types";
import type { VideoView } from "./video";
import type { WorkspaceController } from "./workspace";

export class TransportController {
  constructor(private readonly editor: WorkspaceController) {}
  time = 0;
  playing = false;
  playbackToken = 0;
  clock = 0;
  startTime = 0;
  endHold = 1000 / 60;
  playback: Playback = { range: null, speed: 1, loop: false };
  showGeneration = 0;
  playButton = (active: boolean) => {
    const button = $("play");
    button.setAttribute("aria-label", active ? "Pause" : "Play");
    button.title = active ? "Pause" : "Play";
    const label = button.querySelector("[data-transport-label]");
    if (label) {
      label.textContent = active ? "Pause" : "Play";
    }
    setIcon(button.querySelector("svg")!, active ? "pause" : "play_arrow");
  };
  pause = () => {
    this.playing = false;
    this.playbackToken++;
    this.playButton(false);
  };
  playbackRange = (): [number, number] => {
    const full = this.editor.timeline.full();
    if (!this.playback.range) {
      return full;
    }
    const start = Math.max(full[0], Math.min(full[1], this.playback.range[0]));
    return [start, Math.max(start, Math.min(full[1], this.playback.range[1]))];
  };
  playbackControls = () => {
    const [first, last] = this.playbackRange();
    $("playback-range").textContent = this.editor.a.project
      ? `${(first / 1000).toFixed(3)} s to ${(last / 1000).toFixed(3)} s`
      : "Playback interval";
    $<HTMLSelectElement>("playback-speed").value = String(this.playback.speed);
    $("playback-range").parentElement!.title =
      `Playback interval: ${$("playback-range").textContent}`;
    $<HTMLInputElement>("playback-loop").checked = this.playback.loop;
  };
  setPlaybackEdge = (edge: "start" | "end", t: number, save: boolean) => {
    this.pause();
    const p = this.editor.selected.project;
    if (!p) {
      return;
    }
    const snapped = snapTime(p.times, this.editor.selected.offset, t);
    const [first, last] = this.playbackRange();
    this.playback.range =
      edge === "start"
        ? [snapped, Math.max(snapped, last)]
        : [Math.min(first, snapped), snapped];
    this.changed(save);
  };
  changed = (save: boolean) => {
    if (this.playback.range) {
      this.playback.range = this.playbackRange();
    }
    this.playbackControls();
    for (const v of this.editor.views()) {
      v.controls(this.editor.operations.busy);
    }
    this.editor.timeline.paint();
    if (save) {
      void this.editor.graph.refresh();
    } else {
      this.editor.graph.paint();
    }
    this.editor.inspector();
    if (save) {
      this.editor.projects.saveWorkspace();
    }
  };
  show = async (t: number) => {
    const loaded = this.editor.views().filter((v) => v.project);
    t = workspaceFrame(
      loaded.map((v) => ({ times: v.project!.times, offset: v.offset })),
      loaded.indexOf(this.editor.selected),
      t,
      this.playing ? this.playbackRange() : undefined,
    );
    this.time = t;
    const generation = ++this.showGeneration;
    await Promise.all(
      this.editor
        .views()
        .filter((v) => v.project)
        .map(async (v) => {
          const p = v.project!;
          const source = t - v.offset;
          v.outside = source < 0 || source > p.times.at(-1)!;
          await v.show(sourceFrame(p.times, v.offset, t));
        }),
    );
    if (generation !== this.showGeneration) {
      return;
    }
    $("playhead-time").textContent = `${(this.time / 1000).toFixed(3)} s`;
    this.editor.inspector();
    this.editor.timeline.paint();
    this.editor.graph.paint();
  };
  seek = (t: number) => {
    if (this.editor.operations.busy) {
      return;
    }
    this.pause();
    const [min, max] = this.editor.timeline.full();
    void reportFailure(
      this.show(Math.max(min, Math.min(max, t))),
      (message) => {
        this.editor.operations.status(message, true);
      },
    );
  };
  seekFrame = (v: VideoView, i: number) => {
    if (!v.project) {
      return;
    }
    this.editor.selectVideo(v);
    const frame = Math.max(
      0,
      Math.min(v.project.times.length - 1, Math.round(i)),
    );
    this.seek(required(v.project.times[frame]) + v.offset);
  };
  tick = async (now: number, token: number) => {
    if (token !== this.playbackToken || !this.playing) {
      return;
    }
    const range = this.playbackRange();
    const next = playbackPosition(
      this.startTime,
      now - this.clock,
      this.playback.speed,
      range,
      this.playback.loop,
      this.endHold,
    );
    try {
      await this.show(next.time);
      if (token !== this.playbackToken) {
        return;
      }
      if (next.done) {
        this.pause();
        return;
      }
      requestAnimationFrame((now) => void this.tick(now, token));
    } catch (error) {
      this.pause();
      this.editor.operations.status(
        error instanceof Error ? error.message : String(error),
        true,
      );
    }
  };
  bind = () => {
    $("playback-start").onclick = () => {
      this.setPlaybackEdge("start", this.time, true);
    };
    $("playback-end").onclick = () => {
      this.setPlaybackEdge("end", this.time, true);
    };
    $("playback-reset").onclick = () => {
      this.pause();
      this.playback.range = null;
      this.changed(true);
    };
    $("playback-speed").onchange = () => {
      const resume = this.playing;
      this.pause();
      this.playback.speed = Number(
        $<HTMLSelectElement>("playback-speed").value,
      );
      this.changed(true);
      if (resume) {
        $("play").click();
      }
    };
    $("playback-loop").onchange = () => {
      this.playback.loop = $<HTMLInputElement>("playback-loop").checked;
      this.changed(true);
    };
    $("previous-frame").onclick = () => {
      this.seekFrame(this.editor.selected, this.editor.selected.index - 1);
    };
    $("next-frame").onclick = () => {
      this.seekFrame(this.editor.selected, this.editor.selected.index + 1);
    };
    $("play").onclick = () => {
      if (this.playing) {
        this.pause();
        return;
      }
      if (!this.editor.a.project) {
        return;
      }
      const [min, max] = this.playbackRange();
      if (this.time < min || this.time >= max) {
        this.time = min;
      }
      this.playing = true;
      this.clock = performance.now();
      this.startTime = this.time;
      const lastView =
        this.editor
          .views()
          .find(
            (v) =>
              v.project !== null &&
              max >= v.offset &&
              max <= v.offset + v.project.times.at(-1)!,
          ) ?? this.editor.selected;
      const { times } = lastView.project!;
      const frame = sourceFrame(times, lastView.offset, max);
      this.endHold =
        (times[frame + 1] ??
          required(times[frame]) +
            (required(times[frame]) -
              (times[frame - 1] ?? required(times[frame]) - 1000 / 60))) -
        required(times[frame]);
      this.playButton(true);
      const token = ++this.playbackToken;
      requestAnimationFrame((now) => void this.tick(now, token));
    };
    $("mark-sync").onclick = () => {
      this.editor.selected.sync = this.editor.selected.index;
      this.changed(true);
    };
    $("goto-sync").onclick = () => {
      if (this.editor.selected.sync !== null) {
        this.seekFrame(this.editor.selected, this.editor.selected.sync);
      }
    };
    $("align-sync").onclick = () => {
      if (
        this.editor.a.sync === null ||
        this.editor.b.sync === null ||
        !this.editor.a.project ||
        !this.editor.b.project
      ) {
        return;
      }
      this.pause();
      const offset = alignedOffset(
        required(this.editor.a.project.times[this.editor.a.sync]),
        this.editor.a.offset,
        required(this.editor.b.project.times[this.editor.b.sync]),
      );
      // If aligning B would cross zero, move A later instead.
      if (offset < 0) {
        this.editor.a.offset -= offset;
      }
      this.editor.b.offset = offset;
      this.editor.timeline.window = null;
      this.changed(true);
      void this.show(
        required(this.editor.a.project.times[this.editor.a.sync]) +
          this.editor.a.offset,
      );
      this.editor.operations.status("Sync points aligned.");
    };
    $("clip-offset").onchange = () => {
      const n = Number($<HTMLInputElement>("clip-offset").value);
      if (!Number.isFinite(n) || n < 0 || n > 86_400_000) {
        this.editor.operations.status(
          "Clip offset must be between zero and one day.",
          true,
          $("clip-offset"),
        );
        this.editor.inspector();
        return;
      }
      this.pause();
      this.editor.selected.offset = n;
      this.changed(true);
      void this.show(this.time);
    };
    for (const [id, dir] of [
      ["nudge-earlier", -1],
      ["nudge-later", 1],
    ] as const) {
      $(id).onclick = () => {
        this.pause();
        this.editor.selected.offset +=
          dir * this.editor.timeline.frameStep(this.editor.selected);
        this.changed(true);
        void this.show(this.time);
      };
    }
    document.addEventListener("keydown", (e) => {
      if (
        e.defaultPrevented ||
        this.editor.operations.busy ||
        document.querySelector("dialog:modal") !== null ||
        !this.editor.a.project ||
        (e.target instanceof Element &&
          e.target.closest(
            "input,select,textarea,button,summary,#timeline-pan",
          ))
      ) {
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        $("play").click();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        this.seekFrame(
          this.editor.selected,
          this.editor.selected.index + (e.key === "ArrowLeft" ? -1 : 1),
        );
      }
    });
  };
}
