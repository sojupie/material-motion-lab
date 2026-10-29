import { required } from "./errors";
import { syncMaterialControls } from "./material";

// Mobile menus invoke the existing controls; desktop owns the settings/state.
export function installMobileTools(prepareExport: () => void) {
  const host = document.querySelector("#mobile-tools")!;
  let serial = 0;
  const activeTrigger: { value?: HTMLButtonElement } = {};
  const close = () => {
    for (const menu of host.querySelectorAll<HTMLElement>(":popover-open")) {
      menu.hidePopover();
    }
    activeTrigger.value?.focus({ preventScroll: true });
  };
  const panel = (id: string, label: string, main = false) => {
    const template = document.querySelector(
      "#mobile-menu-template",
    ) as HTMLTemplateElement;
    const menu = template.content.firstElementChild!.cloneNode(
      true,
    ) as HTMLElement;
    menu.id = id;
    menu.classList.add("mobile-command-menu");
    menu.toggleAttribute("data-menu-main", main);
    menu.setAttribute("aria-label", label);
    host.append(menu);
    return menu;
  };
  const list = (menu: HTMLElement) => menu.querySelector("ul")!;
  const symbol = (name: string) =>
    document
      .querySelector<HTMLTemplateElement>("#mobile-menu-symbols")!
      .content.querySelector(`[data-icon="${name}"]`)!
      .cloneNode(true);
  const slot = (button: HTMLElement, name: string, icon: Node) => {
    const target = button.querySelector<HTMLElement>(
      `[data-slot="${name}-icon"]`,
    )!;
    target.replaceChildren(icon);
    target.hidden = false;
  };
  const checked = (button: HTMLElement, value: boolean) => {
    button.setAttribute("aria-checked", String(value));
    button.dataset.selected = String(value);
    if (value) {
      slot(button, "trailing", symbol("check"));
    }
  };
  const item = (menu: HTMLElement, label: string, action?: () => void) => {
    const template = document.querySelector(
      "#mobile-menu-item-template",
    ) as HTMLTemplateElement;
    const button = template.content.firstElementChild!.cloneNode(
      true,
    ) as HTMLButtonElement;
    button.querySelector(".md-menu-item-text > span")!.textContent = label;
    for (const icon of button.querySelectorAll<HTMLElement>("[data-slot]")) {
      icon.hidden = true;
    }
    if (action) {
      button.onclick = (event) => {
        event.stopPropagation();
        close();
        action();
      };
    }
    const li = document.createElement("li");
    li.role = "presentation";
    li.append(button);
    list(menu).append(li);
    return button;
  };
  const submenu = (menu: HTMLElement, label: string) => {
    const child = panel(`mobile-submenu-${++serial}`, label);
    const trigger = item(menu, label);
    // Native auto-popovers use DOM ancestry to keep the parent open. A sibling
    // Popover dismisses it, leaving a zero-sized anchor box in Firefox.
    trigger.closest("li")!.append(child);
    trigger.dataset.menuSubmenu = child.id;
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-controls", child.id);
    trigger.setAttribute("aria-expanded", "false");
    trigger.querySelector<HTMLElement>('[data-slot="trailing-icon"]')!.hidden =
      false;
    const back = item(child, "Back");
    slot(back, "leading", symbol("arrow_back"));
    back.dataset.menuBack = "";
    return { child, trigger };
  };
  const labelFor = (control: HTMLElement) =>
    [
      document.querySelector(`label[for="${control.id}"]`)?.textContent.trim(),
      control.getAttribute("aria-label"),
      control.textContent.trim(),
      control.id,
    ].find(
      (label) => label !== undefined && label !== null && label.length > 0,
    ) ?? control.id;
  const populate = (menu: HTMLElement, source: HTMLElement, grouped = true) => {
    if (grouped) {
      const sections = [
        ...source.querySelectorAll<HTMLElement>("section[aria-label]"),
      ].filter(
        (section) =>
          !section.closest("[hidden]") &&
          !section.parentElement?.closest("section[aria-label]"),
      );
      if (sections.length > 0) {
        // Keep each menu short; retain the desktop section names and ownership.
        // Export has format/source selectors outside its grouped options.
        if (source.id === "export-dialog") {
          const format = source.querySelector<HTMLElement>(".export-format")!;
          populate(menu, format, false);
        }
        for (const section of sections) {
          const sectionLabel = section.getAttribute("aria-label")!;
          const { child, trigger } = submenu(
            menu,
            sectionLabel === "Export" ? "Video options" : sectionLabel,
          );
          populate(child, section, false);
          trigger.disabled = ![
            ...child.querySelectorAll<HTMLButtonElement>(
              '[role^="menuitem"]:not([data-menu-back])',
            ),
          ].some((button) => !button.disabled);
        }
        if (source.id === "export-dialog") {
          const run = document.querySelector(
            "#export-run",
          ) as HTMLButtonElement;
          item(menu, "Download export", () => {
            run.click();
          }).disabled = run.disabled;
        }
        return;
      }
    }
    for (const control of source.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLButtonElement
    >("select,input[type=number],input[type=checkbox],button[id]")) {
      if (
        control.closest("[data-desktop-only]") ||
        control.parentElement?.closest("[hidden]") ||
        (control.hidden === true && !(control instanceof HTMLSelectElement)) ||
        (control.closest("[data-field-example]") &&
          control.tagName === "BUTTON")
      ) {
        continue;
      }
      const label = labelFor(control);
      if (control instanceof HTMLSelectElement) {
        const { child, trigger } = submenu(
          menu,
          `${label}: ${control.selectedOptions[0]?.textContent ?? ""}`,
        );
        trigger.disabled = control.disabled;
        for (const option of control.options) {
          const choice = item(child, option.label, () => {
            control.value = option.value;
            control.dispatchEvent(new Event("change", { bubbles: true }));
            syncMaterialControls();
          });
          choice.role = "menuitemradio";
          checked(choice, option.selected);
          choice.disabled = option.disabled;
        }
      } else if (
        control instanceof HTMLInputElement &&
        control.type === "number"
      ) {
        const { child, trigger } = submenu(menu, `${label}: ${control.value}`);
        trigger.disabled = control.disabled;
        const field = control.closest(".field-row")?.cloneNode(true) as
          HTMLElement | undefined;
        const input =
          field?.querySelector<HTMLInputElement>("input[type=number]") ??
          (control.cloneNode(true) as HTMLInputElement);
        if (field) {
          for (const node of field.querySelectorAll("[id]")) {
            node.removeAttribute("id");
          }
          field.querySelector("label")?.removeAttribute("for");
        }
        input.removeAttribute("id");
        input.value = control.value;
        input.setAttribute("aria-label", label);
        input.onkeydown = (event) => {
          event.stopPropagation();
        };
        const fieldRow = document.createElement("li");
        fieldRow.role = "presentation";
        fieldRow.append(field ?? input);
        list(child).append(fieldRow);
        const apply = item(child, "Apply");
        apply.onclick = (event) => {
          event.stopPropagation();
          if (!input.reportValidity()) {
            return;
          }
          control.value = input.value;
          control.dispatchEvent(new Event("input", { bubbles: true }));
          control.dispatchEvent(new Event("change", { bubbles: true }));
          close();
        };
      } else if (control instanceof HTMLInputElement) {
        const toggle = item(menu, label, () => {
          control.click();
        });
        toggle.role = "menuitemcheckbox";
        checked(toggle, control.checked);
        toggle.disabled = control.disabled;
      } else {
        if (control.id === "export-close") {
          continue;
        }
        const command = item(menu, label, () => {
          control.click();
        });
        command.disabled = control.disabled;
        const icon = control.querySelector("svg");
        if (icon) {
          slot(command, "leading", icon.cloneNode(true));
        }
        if (control.hasAttribute("aria-pressed")) {
          command.role = "menuitemcheckbox";
          checked(command, control.getAttribute("aria-pressed") === "true");
        }
      }
    }
  };
  const sources: Record<string, string> = {
    tracking: "tracking-settings",
    alignment: "alignment-settings",
    chart: "reference-settings",
    export: "export-dialog",
  };
  for (const name of ["tracking", "alignment", "chart", "export"]) {
    const trigger = document.querySelector(
      `#${CSS.escape(`mobile-${name}`)}`,
    ) as HTMLButtonElement;
    const menu = panel(
      `mobile-${name}-menu`,
      trigger.getAttribute("aria-label")!,
      true,
    );
    trigger.addEventListener("click", () => {
      activeTrigger.value = trigger;
      if (menu.matches(":popover-open")) {
        return;
      }
      document.dispatchEvent(
        new CustomEvent("htmx:beforeCleanupElement", { detail: { elt: menu } }),
      );
      list(menu).replaceChildren();
      if (name === "export") {
        prepareExport();
      }
      populate(
        menu,
        document.querySelector(`#${CSS.escape(required(sources[name]))}`)!,
      );
      document.dispatchEvent(new Event("htmx:afterSwap"));
    });
  }
  const availability = () => {
    const add = document.querySelector("#mobile-add") as HTMLButtonElement;
    const exportButton = document.querySelector(
      "#mobile-export",
    ) as HTMLButtonElement;
    add.disabled = (
      document.querySelector("#open-recording") as HTMLButtonElement
    ).disabled;
    for (const name of ["tracking", "alignment", "chart"]) {
      (
        document.querySelector(
          `#${CSS.escape(`mobile-${name}`)}`,
        ) as HTMLButtonElement
      ).disabled = (
        document.querySelector("#maximize-viewer") as HTMLButtonElement
      ).disabled;
    }
    exportButton.disabled = (
      document.querySelector("#open-export") as HTMLButtonElement
    ).disabled;
  };
  for (const id of ["open-recording", "open-export", "maximize-viewer"]) {
    new MutationObserver(availability).observe(
      document.querySelector(`#${id}`)!,
      {
        attributes: true,
        attributeFilter: ["disabled"],
      },
    );
  }
  availability();
  // Responsive changes dismiss popovers rather than leaving orphaned tool surfaces.
  matchMedia("(max-width: 999px)").addEventListener("change", close);
}
