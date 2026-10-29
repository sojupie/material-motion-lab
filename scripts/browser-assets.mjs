import { cp, mkdir, writeFile } from "node:fs/promises";
await mkdir("dist/ffmpeg", { recursive: true });
await cp(
  "node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js",
  "dist/ffmpeg/ffmpeg-core.js",
);
await cp(
  "node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm",
  "dist/ffmpeg/ffmpeg-core.wasm",
);
for (const name of ["worker.js", "const.js", "errors.js"])
  await cp(
    `node_modules/@ffmpeg/ffmpeg/dist/esm/${name}`,
    `dist/ffmpeg/${name}`,
  );
await mkdir("dist/example", { recursive: true });
await cp("internal/analysis/example/project.json", "dist/example/project.json");
await cp("internal/analysis/example/carousel.mp4", "dist/example/carousel.mp4");

await mkdir("dist/licenses", { recursive: true });
await cp(
  "node_modules/@techstark/opencv-js/LICENSE",
  "dist/licenses/OpenCV-Apache-2.0.txt",
);
await cp("node_modules/fflate/LICENSE", "dist/licenses/fflate-MIT.txt");
await writeFile(
  "dist/licenses/THIRD_PARTY.txt",
  `Browser processing dependencies

FFmpeg WebAssembly core: @ffmpeg/core 0.12.10, GPL-2.0-or-later.
FFmpeg JavaScript wrapper: @ffmpeg/ffmpeg, MIT.
Source, build instructions and license: https://github.com/ffmpegwasm/ffmpeg.wasm
Core source and build recipes: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/packages/core

OpenCV.js: OpenCV 4.12.0, Apache-2.0.
Distribution: https://github.com/TechStark/opencv-js
Upstream source: https://github.com/opencv/opencv/tree/4.12.0

fflate: MIT. https://github.com/101arrowz/fflate
Dependency versions are pinned in package-lock.json.
`,
);

await mkdir("dist/opencv", { recursive: true });
await cp(
  "node_modules/@techstark/opencv-js/dist/opencv.js",
  "dist/opencv/opencv.js",
);
