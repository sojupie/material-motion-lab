// Go templates own control anatomy. This adapter synchronizes application state
// with the unmodified Forge interaction runtimes.
const selects = new Map<HTMLSelectElement, HTMLElement>();
export function syncMaterialControls() {
  for (const [select, root] of selects) {
    const value = root.querySelector<HTMLInputElement>(
      "input[data-field-value]",
    )!;
    const button = root.querySelector<HTMLButtonElement>(
      "button[data-field-combo]",
    )!;
    const display = root.querySelector<HTMLElement>("[data-field-display]")!;
    value.value = select.value;
    button.value = select.selectedOptions[0]?.textContent || "";
    display.textContent = button.value;
    button.disabled = select.disabled;
    for (const row of root.querySelectorAll<HTMLElement>(
      "[role=option][data-field-value]",
    ))
      row.setAttribute(
        "aria-selected",
        String(row.dataset.fieldValue === select.value),
      );
  }
}
export async function installMaterialControls() {
  for (const select of document.querySelectorAll<HTMLSelectElement>("select")) {
    const root = select.closest<HTMLElement>("[data-field-example]")!;
    selects.set(select, root);
    root.querySelector("button")!.addEventListener("change", () => {
      select.value = root.querySelector<HTMLInputElement>(
        "input[data-field-value]",
      )!.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      syncMaterialControls();
    });
    new MutationObserver(() => {
      const list = root.querySelector("ul")!;
      list.replaceChildren();
      const template = document.getElementById(
        "field-option-template",
      ) as HTMLTemplateElement;
      for (const [i, option] of Array.from(select.options).entries()) {
        const item = template.content.firstElementChild!.cloneNode(
          true,
        ) as HTMLElement;
        const row = item.querySelector<HTMLElement>("[role=option]")!;
        row.id = `${select.id}-option-${i}`;
        row.dataset.fieldOption = option.textContent || "";
        row.dataset.fieldValue = option.value;
        row.querySelector("[data-option-label]")!.textContent =
          option.textContent;
        list.append(item);
      }
      syncMaterialControls();
      document.dispatchEvent(new Event("htmx:afterSwap"));
    }).observe(select, { childList: true, subtree: true });
  }
  syncMaterialControls();
  for (const file of [
    "motion.js",
    "buttons.js",
    "fields.js",
    "utils.js",
    "navigation.js",
    "sliders.js",
    "button-groups.js",
    "tabs.js",
    "menus.js",
  ]) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/material/" + file;
      script.onload = () => resolve();
      script.onerror = () =>
        reject(Error("Failed to load shared controls: " + file));
      document.head.append(script);
    });
  }
}
