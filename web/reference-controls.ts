import { $, post } from "./api";
import { required } from "./errors";
import { objectValue, parseJSON } from "./json";
import { syncMaterialControls } from "./material";
import type { MotionReference } from "./types";

export class ReferenceControls {
  private presets = new Map<string, MotionReference>();
  constructor(private readonly changed: () => Promise<void>) {
    $("curve").onchange = () => {
      const ref = this.presets.get(this.preset);
      if (ref) {
        this.fillReference(ref);
      }
      this.update();
      void this.changed();
    };
    for (const id of [
      "bezier-x1",
      "bezier-y1",
      "bezier-x2",
      "bezier-y2",
      "spring-stiffness",
      "spring-damping",
      "spring-velocity",
    ]) {
      $<HTMLInputElement>(id).step = "any";
      $(id).oninput = () => {
        $<HTMLSelectElement>("curve").value = id.startsWith("spring-")
          ? "custom-spring"
          : "custom-bezier";
        this.update();
        void this.changed();
      };
    }
    $("reference-save").onclick = () => void this.saveReference();
    $("reference-load").onclick = () => {
      $<HTMLInputElement>("reference-file").click();
    };
    $("reference-file").onchange = () => void this.loadReference();
    $("duration").oninput = () => void this.changed();
    $("duration-mode").onchange = () => void this.changed();
  }
  get preset() {
    return $<HTMLSelectElement>("curve").value;
  }
  async loadPresets() {
    const response = await fetch(
      new URL(/* @vite-ignore */ "../references.json", import.meta.url),
    );
    if (!response.ok) {throw new Error("Reference presets unavailable.");}
    const refs = (await response.json()) as MotionReference[];
    this.presets = new Map(refs.map((ref) => [ref.id!, ref]));
  }
  private fillReference(ref: MotionReference) {
    ref.curve.forEach((value, i) => {
      $<HTMLInputElement>(
        required(["bezier-x1", "bezier-y1", "bezier-x2", "bezier-y2"][i]),
      ).value = String(value);
    });
    for (const [field, value] of [
      ["stiffness", ref.stiffness ?? 380],
      ["damping", ref.damping ?? 0.8],
      ["velocity", ref.velocity ?? 0],
    ] as const) {
      $<HTMLInputElement>(`spring-${field}`).value = String(value);
    }
  }
  curve(): MotionReference {
    const preset = this.presets.get(this.preset);
    if (preset) {
      return preset;
    }
    if (this.preset === "custom-spring") {
      return {
        kind: "spring",
        curve: [0, 0, 0, 0],
        stiffness: Number($<HTMLInputElement>("spring-stiffness").value),
        damping: Number($<HTMLInputElement>("spring-damping").value),
        velocity: Number($<HTMLInputElement>("spring-velocity").value),
      };
    }
    return {
      kind: "bezier",
      curve: ["bezier-x1", "bezier-y1", "bezier-x2", "bezier-y2"].map((id) =>
        Number($<HTMLInputElement>(id).value),
      ) as MotionReference["curve"],
    };
  }
  update() {
    const ref = this.curve();
    const none = this.preset === "none";
    $("reference-controls").hidden = none;
    $("no-reference").hidden = !none;
    $("reference-summary").textContent = none
      ? "Reference settings"
      : (ref.label ?? "Custom reference");
    $("bezier-controls").hidden = none || ref.kind !== "bezier";
    $("spring-controls").hidden = none || ref.kind !== "spring";
    $("spring-note").hidden = none || ref.kind !== "spring";
    $("duration-controls").hidden = none || ref.kind === "spring";
    const link = $<HTMLAnchorElement>("reference-source");
    const source = this.presets.get(this.preset)?.source;
    link.hidden = !(source !== undefined && source !== "");
    if (source !== undefined && source !== "") {
      link.href = source;
    }
    $("reference-status").textContent = "";
    syncMaterialControls();
  }
  private async saveReference() {
    try {
      const reference = await post<MotionReference>(
        "/references/validate",
        this.curve(),
      );
      const duration = Number($<HTMLInputElement>("duration").value);
      if (!Number.isFinite(duration) || duration < 1 || duration > 60_000) {
        throw new Error("Reference duration must be 1–60000 ms.");
      }
      const url = URL.createObjectURL(
        new Blob(
          [JSON.stringify({ schema: 1, reference, duration }, null, 2)],
          { type: "application/json" },
        ),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "motion-reference.json";
      a.click();
      URL.revokeObjectURL(url);
      $("reference-status").textContent = "Reference saved.";
    } catch (error) {
      $("reference-status").textContent = String(error);
    }
  }
  private async loadReference() {
    const input = $<HTMLInputElement>("reference-file");
    try {
      const file = input.files?.[0];
      if (!file) {
        return;
      }
      if (file.size > 65_536) {
        throw new Error("Reference file exceeds 64 KB.");
      }
      const data = objectValue(parseJSON(await file.text()));
      if (
        data.schema !== 1 ||
        typeof data.duration !== "number" ||
        !Number.isFinite(data.duration) ||
        data.duration < 1 ||
        data.duration > 60_000
      ) {
        throw new Error("Invalid reference file.");
      }
      const ref = await post<MotionReference>(
        "/references/validate",
        data.reference,
      );
      this.fillReference(ref);
      $<HTMLSelectElement>("duration-mode").value = "manual";
      $<HTMLInputElement>("duration").value = String(data.duration);
      $<HTMLSelectElement>("curve").value =
        ref.kind === "emphasized" ? "emphasized" : `custom-${ref.kind}`;
      this.update();
      await this.changed();
      $("reference-status").textContent = "Reference loaded.";
    } catch (error) {
      $("reference-status").textContent = String(error);
    } finally {
      input.value = "";
    }
  }
}
