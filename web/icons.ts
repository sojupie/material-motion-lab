import icons from "../internal/web/icons.json";

export function setIcon(svg: SVGElement, name: keyof typeof icons) {
  svg.dataset.icon = name;
  svg.querySelector("path")!.setAttribute("d", icons[name].path);
}
