// Go templates own control anatomy. This adapter synchronizes application state
// With the unmodified Forge interaction runtimes.
const selects = new Map<HTMLSelectElement, {
  root: HTMLElement;
  display: HTMLElement;
  native: HTMLSelectElement;
  trigger: HTMLButtonElement;
}>();

export function syncMaterialControls() {
  for (const [select, { root, display, native, trigger }] of selects) {
    native.value = select.value;
    native.disabled = select.disabled;
    trigger.value = select.selectedOptions[0]?.textContent ?? "";
    display.textContent = trigger.value;
    trigger.disabled = select.disabled;
    for (const row of root.querySelectorAll<HTMLElement>(
      "[role=option][data-field-value]",
    )) {
      row.setAttribute(
        "aria-selected",
        String(row.dataset.fieldValue === select.value),
      );
    }
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-select-choice]",
  )) {
    const select = document.querySelector(
      `#${CSS.escape(button.dataset.selectChoice!)}`,
    ) as HTMLSelectElement;
    button.disabled = select.disabled;
    setButtonToggle(button, select.value === button.dataset.choiceValue);
    button.tabIndex = select.value === button.dataset.choiceValue ? 0 : -1;
  }
}
export function installMaterialControls() {
  for (const select of document.querySelectorAll<HTMLSelectElement>(
    "[data-field-example] select[hidden]:not([data-field-value])",
  )) {
    const root = select.closest<HTMLElement>("[data-field-example]")!;
    const native = root.querySelector<HTMLSelectElement>("select[data-field-value]");
    const trigger = root.querySelector<HTMLButtonElement>("button[data-field-combo]");
    const display = root.querySelector<HTMLElement>("[data-field-display]");
    if (!native || !trigger || !display) {
      throw new Error(`Missing Forge select controls for ${select.id}.`);
    }
    selects.set(select, { root, display, native, trigger });
    const applySelection = () => {
      select.value = native.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      syncMaterialControls();
    };
    trigger.addEventListener("change", applySelection);
    native.addEventListener("change", applySelection);
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-select-choice]",
  )) {
    button.onclick = () => {
      const select = document.querySelector(
        `#${CSS.escape(button.dataset.selectChoice!)}`,
      ) as HTMLSelectElement;
      select.value = button.dataset.choiceValue!;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      syncMaterialControls();
    };
  }
  syncMaterialControls();
}

// Shared button variants own their selected styling through aria-pressed.
export function setButtonToggle(button: HTMLElement, selected: boolean) {
  button.setAttribute("aria-pressed", String(selected));
}

// The shared runtime owns notification placement, dismissal and focus return.
export function showSnackbar(bar: HTMLElement, opener?: HTMLElement) {
  const runtime = (
    globalThis as typeof globalThis & {
      MaterialSnackbars?: {
        show: (bar: HTMLElement, opener?: HTMLElement) => void;
      };
    }
  ).MaterialSnackbars;
  if (runtime?.show) {
    runtime.show(bar, opener);
  } else {
    bar.showPopover();
  }
}
