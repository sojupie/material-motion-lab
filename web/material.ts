// These controls use Token Catalog's generated styles and unmodified runtimes.
const check =
  '<svg viewBox="0 -960 960 960" focusable="false"><path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/></svg>';
const caret =
  '<svg viewBox="0 -960 960 960" focusable="false"><path d="M480-344 240-584l56-56 184 184 184-184 56 56-240 240Z"/></svg>';
const selects = new Map<
  HTMLSelectElement,
  {
    root: HTMLElement;
    button: HTMLButtonElement;
    value: HTMLInputElement;
    display: HTMLElement;
  }
>();

function selectLabel(select: HTMLSelectElement) {
  const explicit = document.querySelector<HTMLLabelElement>(
    `label[for="${select.id}"]`,
  );
  return (
    explicit?.textContent?.trim() ||
    select.closest("label")?.firstChild?.textContent?.trim() ||
    select.id
  );
}

function menu(select: HTMLSelectElement, label: string) {
  const root = document.createElement("div");
  root.className = "tokens-preview-filter";
  root.dataset.fieldExample = "";
  root.dataset.populated = "true";
  root.innerHTML = `<button type="button" class="md-filter-chip" id="filter-${select.id}" role="combobox" aria-expanded="false" aria-haspopup="listbox" aria-controls="${select.id}-options" aria-autocomplete="none" data-field-combo data-field-select><span class="filter-label"></span><span data-field-display></span><span data-slot="trailing-icon" aria-hidden="true">${caret}</span></button><input type="hidden" data-field-value><div class="md-field-menu md-menu tokens-catalog-menu" data-variant="standard" data-orientation="vertical" id="${select.id}-options" role="listbox" popover="auto"><section><ul role="presentation"></ul></section><p class="md-field-empty" role="option" aria-disabled="true" hidden>No matches</p></div>`;
  const button = root.querySelector("button")!;
  button.setAttribute("aria-label", label);
  root.querySelector(".filter-label")!.textContent = label + ":";
  root.querySelector("[role=listbox]")!.setAttribute("aria-label", label);
  const list = root.querySelector("ul")!;
  for (const [i, option] of Array.from(select.options).entries()) {
    const li = document.createElement("li");
    li.setAttribute("role", "presentation");
    const row = document.createElement("div");
    row.className = "md-menu-item";
    row.id = `${select.id}-option-${i}`;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(option.selected));
    row.dataset.fieldOption = option.textContent || "";
    row.dataset.fieldValue = option.value;
    const text = document.createElement("span");
    text.textContent = option.textContent;
    const icon = document.createElement("span");
    icon.dataset.slot = "trailing-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = check;
    row.append(text, icon);
    li.append(row);
    list.append(li);
  }
  const previous = selects.get(select);
  if (previous) {
    previous.root.before(select);
    previous.root.remove();
  }
  select.before(root);
  root.append(select);
  select.hidden = true;
  const value = root.querySelector<HTMLInputElement>("[data-field-value]")!;
  const display = root.querySelector<HTMLElement>("[data-field-display]")!;
  selects.set(select, { root, button, value, display });
  button.addEventListener("change", () => {
    select.value = value.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    syncMaterialControls();
  });
  document.dispatchEvent(new Event("htmx:afterSwap"));
}

export function syncMaterialControls() {
  for (const [select, { root, button, value, display }] of selects) {
    value.value = select.value;
    button.value = select.selectedOptions[0]?.textContent || "";
    display.textContent = button.value;
    button.disabled = select.disabled;
    for (const row of root.querySelectorAll<HTMLElement>(
      "[data-field-value][role=option]",
    ))
      row.setAttribute(
        "aria-selected",
        String(row.dataset.fieldValue === select.value),
      );
  }
}

export async function installMaterialControls() {
  for (const input of document.querySelectorAll<HTMLInputElement>(
    "input[type=number]",
  )) {
    const label = document.querySelector<HTMLLabelElement>(
      `label[for="${input.id}"]`,
    )!;
    const wrapper = document.createElement("div");
    wrapper.className = "md-outlined-text-field";
    for (const extra of ["", " md-field-focus-outline"]) {
      const fieldset = document.createElement("fieldset");
      fieldset.className = "md-field-outline" + extra;
      fieldset.setAttribute("aria-hidden", "true");
      const legend = document.createElement("legend");
      legend.textContent = label.textContent;
      fieldset.append(legend);
      wrapper.append(fieldset);
    }
    input.parentElement!.classList.add("field-row");
    label.before(wrapper);
    label.dataset.slot = "label";
    input.placeholder = " ";
    wrapper.append(label, input);
  }
  for (const select of document.querySelectorAll<HTMLSelectElement>("select")) {
    const label = selectLabel(select);
    const explicit = document.querySelector<HTMLLabelElement>(
      `label[for="${select.id}"]`,
    );
    if (explicit) explicit.hidden = true;
    const enclosing = select.closest("label");
    if (enclosing)
      for (const node of Array.from(enclosing.childNodes))
        if (node.nodeType === Node.TEXT_NODE) node.textContent = "";
    menu(select, label);
    new MutationObserver(() => {
      menu(select, label);
      syncMaterialControls();
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
