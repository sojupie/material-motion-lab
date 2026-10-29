// Go templates own control anatomy. This adapter synchronizes application state
// With the unmodified Forge interaction runtimes.
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
    button.value = select.selectedOptions[0]?.textContent ?? "";
    display.textContent = button.value;
    button.disabled = select.disabled;
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
      const template = document.querySelector(
        "#field-option-template",
      ) as HTMLTemplateElement;
      for (const [i, option] of [...select.options].entries()) {
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
