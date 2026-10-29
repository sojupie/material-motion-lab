// OpenCV is loaded as a classic worker script: its Emscripten `then` export
// must not be assimilated as an ES-module namespace promise.
function matchPatch(cv, gray, template, rect) {
  const image = cv.matFromArray(gray.height, gray.width, cv.CV_8UC1, gray.data);
  const patch = cv.matFromArray(
    template.height,
    template.width,
    cv.CV_8UC1,
    template.data,
  );
  const area = image.roi(new cv.Rect(...rect)),
    scores = new cv.Mat(),
    mask = new cv.Mat();
  try {
    cv.matchTemplate(area, patch, scores, cv.TM_CCOEFF_NORMED, mask);
    const result = cv.minMaxLoc(scores, mask),
      x = result.maxLoc.x,
      y = result.maxLoc.y,
      score = result.maxVal;
    const peak = (a, b, c) => {
      const den = a - 2 * b + c;
      return den >= -1e-9
        ? 0
        : Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
    };
    return {
      x: rect[0] + x,
      y: rect[1] + y,
      score: Number.isFinite(score) ? score : 0,
      dx:
        x > 0 && x + 1 < scores.cols
          ? peak(scores.floatAt(y, x - 1), score, scores.floatAt(y, x + 1))
          : 0,
      dy:
        y > 0 && y + 1 < scores.rows
          ? peak(scores.floatAt(y - 1, x), score, scores.floatAt(y + 1, x))
          : 0,
    };
  } finally {
    mask.delete();
    scores.delete();
    area.delete();
    patch.delete();
    image.delete();
  }
}
if (typeof module === "object" && module.exports)
  module.exports = { matchPatch };
else {
  importScripts("opencv.js");
  const ready = new Promise((resolve) => {
    if (cv.Mat) resolve();
    else cv.onRuntimeInitialized = () => resolve();
  });
  self.onmessage = async ({ data }) => {
    try {
      await ready;
      postMessage({
        id: data.id,
        result: matchPatch(cv, data.gray, data.template, data.rect),
      });
    } catch (e) {
      postMessage({ id: data.id, error: String(e) });
    }
  };
}
