// Autocomplétion du champ adresse (Base Adresse Nationale, Géoplateforme).
// Liste déroulante accessible (motif ARIA "combobox") : flèches pour
// naviguer, Entrée pour choisir, Échap pour fermer, clic ou toucher.
// L'adresse choisie est conservée avec ses coordonnées : le diagnostic part
// exactement du point sélectionné, sans second géocodage.

import { suggestAddresses, SUGGEST_MIN_CHARS, type GeocodeResult } from "../core/geocode";

const DEBOUNCE_MS = 200;

const KIND_LABELS: Record<string, string> = {
  housenumber: "Adresse",
  street: "Voie",
  locality: "Lieu-dit",
  municipality: "Commune",
};

export interface AddressAutocompleteOptions {
  /** Position vers laquelle orienter les suggestions (dernier site analysé…). */
  near?: () => { lat: number; lon: number } | null;
  /** Appelé quand l'utilisateur choisit une suggestion. */
  onSelect?: (result: GeocodeResult) => void;
}

export interface AddressAutocomplete {
  /** Suggestion choisie si le champ n'a pas été retouché depuis, sinon null. */
  getSelection(): GeocodeResult | null;
  close(): void;
}

export function attachAddressAutocomplete(
  input: HTMLInputElement,
  opts: AddressAutocompleteOptions = {},
): AddressAutocomplete {
  const listId = `${input.id || "address"}-suggestions`;

  // Le champ est enveloppé pour positionner la liste juste dessous.
  const wrapper = document.createElement("div");
  wrapper.className = "address-field";
  input.parentElement?.insertBefore(wrapper, input);
  wrapper.appendChild(input);

  const list = document.createElement("ul");
  list.id = listId;
  list.className = "address-suggestions";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Suggestions d'adresses");
  list.hidden = true;
  wrapper.appendChild(list);

  const status = document.createElement("div");
  status.className = "visually-hidden";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  wrapper.appendChild(status);

  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", listId);
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");

  let results: GeocodeResult[] = [];
  let active = -1;
  let selection: GeocodeResult | null = null;
  let timer: number | undefined;
  let controller: AbortController | null = null;

  function open(): void {
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function close(): void {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function setActive(i: number): void {
    const items = list.querySelectorAll<HTMLLIElement>("li[role=option]");
    items.forEach((li, j) => li.setAttribute("aria-selected", String(j === i)));
    active = i;
    if (i >= 0 && items[i]) {
      input.setAttribute("aria-activedescendant", items[i].id);
      items[i].scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function render(): void {
    list.innerHTML = "";
    if (results.length === 0) {
      const empty = document.createElement("li");
      empty.className = "address-empty";
      empty.textContent = "Aucune adresse trouvée — vérifiez l'orthographe ou ajoutez la commune.";
      list.appendChild(empty);
      status.textContent = "Aucune suggestion.";
      open();
      return;
    }
    results.forEach((r, i) => {
      const li = document.createElement("li");
      li.id = `${listId}-${i}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");

      const main = document.createElement("span");
      main.className = "address-main";
      main.textContent = r.label;
      li.appendChild(main);

      const meta = [
        r.kind ? KIND_LABELS[r.kind] ?? r.kind : null,
        r.context,
        r.source === "osm" ? "OpenStreetMap (secours)" : null,
      ]
        .filter(Boolean)
        .join(" · ");
      if (meta) {
        const sub = document.createElement("span");
        sub.className = "address-meta";
        sub.textContent = meta;
        li.appendChild(sub);
      }

      // mousedown plutôt que click : se déclenche avant le blur du champ.
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        choose(i);
      });
      list.appendChild(li);
    });
    status.textContent = `${results.length} suggestion${results.length > 1 ? "s" : ""}.`;
    open();
    setActive(-1);
  }

  function choose(i: number): void {
    const r = results[i];
    if (!r) return;
    selection = r;
    input.value = r.label;
    close();
    opts.onSelect?.(r);
  }

  async function search(query: string): Promise<void> {
    controller?.abort();
    controller = new AbortController();
    try {
      results = await suggestAddresses(query, controller.signal, opts.near?.() ?? undefined);
      if (input.value.trim() !== query) return; // saisie dépassée entre-temps
      render();
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      // Service indisponible : le champ reste utilisable sans suggestions.
      close();
    }
  }

  input.addEventListener("input", () => {
    selection = null; // toute retouche invalide le choix précédent
    window.clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < SUGGEST_MIN_CHARS) {
      controller?.abort();
      results = [];
      close();
      return;
    }
    timer = window.setTimeout(() => void search(q), DEBOUNCE_MS);
  });

  input.addEventListener("keydown", (e) => {
    const visible = !list.hidden && results.length > 0;
    switch (e.key) {
      case "ArrowDown":
        if (!visible) return;
        e.preventDefault();
        setActive((active + 1) % results.length);
        break;
      case "ArrowUp":
        if (!visible) return;
        e.preventDefault();
        setActive(active <= 0 ? results.length - 1 : active - 1);
        break;
      case "Enter":
        // Une suggestion surlignée : on la choisit et on laisse partir le
        // formulaire, qui lancera l'analyse sur ce point.
        if (visible && active >= 0) choose(active);
        else if (visible && results.length > 0 && !selection) choose(0);
        else close();
        break;
      case "Escape":
        if (!list.hidden) {
          e.preventDefault();
          close();
        }
        break;
      case "Tab":
        close();
        break;
    }
  });

  input.addEventListener("blur", () => window.setTimeout(close, 100));
  input.addEventListener("focus", () => {
    if (!selection && results.length > 0 && input.value.trim().length >= SUGGEST_MIN_CHARS) {
      render();
    }
  });

  return {
    getSelection: () => (selection && selection.label === input.value ? selection : null),
    close,
  };
}
