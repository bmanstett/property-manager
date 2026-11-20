/* Shared form components. Each helper returns an HTML string; styles are in ui.css.
   Rules they enforce: a visible label on every control, at most one line of help,
   pill choices instead of dropdowns for short lists, and 44px touch targets.
   Help text is linked with aria-describedby, so a control's accessible name is its label only. */
(() => {
  "use strict";
  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  let serial = 0;
  const uid = (name) => "ui-" + String(name || "f").replace(/[^a-zA-Z0-9_-]/g, "-") + "-" + ++serial;
  const helpLine = (help, id) => (help ? `<p class="ui-help" id="${id}-help">${esc(help)}</p>` : "");
  const labelText = (o) => esc(o.label) + (o.optional ? ' <span class="ui-opt">(optional)</span>' : "");

  /* Text, number, date, email, tel, file… `prefix`/`suffix` add an adornment such as "$". */
  function field(o) {
    const id = o.id || uid(o.name);
    const attrs = [
      `id="${id}"`,
      `name="${esc(o.name)}"`,
      `type="${esc(o.type || "text")}"`,
      o.type === "file" ? "" : `value="${esc(o.value)}"`,
      o.placeholder ? `placeholder="${esc(o.placeholder)}"` : "",
      o.required ? "required" : "",
      o.help ? `aria-describedby="${id}-help"` : "",
      o.attrs || "",
    ]
      .filter(Boolean)
      .join(" ");
    const input = `<input ${attrs}>`;
    const control =
      o.prefix || o.suffix
        ? `<div class="ui-affix">${o.prefix ? `<span aria-hidden="true">${esc(o.prefix)}</span>` : ""}${input}${o.suffix ? `<span aria-hidden="true">${esc(o.suffix)}</span>` : ""}</div>`
        : input;
    return `<div class="ui-field${o.wide ? " ui-wide" : ""}"><label for="${id}">${labelText(o)}</label>${helpLine(o.help, id)}${control}</div>`;
  }
  const money = (o) => field({ type: "text", prefix: "$", ...o, attrs: 'inputmode="decimal" autocomplete="off" ' + (o.attrs || "") });
  function textarea(o) {
    const id = o.id || uid(o.name);
    return `<div class="ui-field${o.wide === false ? "" : " ui-wide"}"><label for="${id}">${labelText(o)}</label>${helpLine(o.help, id)}<textarea id="${id}" name="${esc(o.name)}" rows="${Number(o.rows) || 3}" ${o.placeholder ? `placeholder="${esc(o.placeholder)}"` : ""} ${o.required ? "required" : ""} ${o.help ? `aria-describedby="${id}-help"` : ""} ${o.attrs || ""}>${esc(o.value)}</textarea></div>`;
  }
  /* A dropdown, for the rare list that is too long for pills. options: [value, label] pairs or strings. */
  function select(o) {
    const id = o.id || uid(o.name);
    const options = (o.options || []).map((x) => (Array.isArray(x) ? x : [x, x]));
    return `<div class="ui-field${o.wide ? " ui-wide" : ""}"><label for="${id}">${labelText(o)}</label>${helpLine(o.help, id)}<select id="${id}" name="${esc(o.name)}" ${o.help ? `aria-describedby="${id}-help"` : ""} ${o.attrs || ""}>${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(o.value ?? "") ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div>`;
  }
  function group(o, cls, body) {
    const id = o.id || uid(o.name);
    return `<fieldset class="ui-group${o.wide === false ? "" : " ui-wide"}" ${o.help ? `aria-describedby="${id}-help"` : ""}><legend>${labelText(o)}</legend>${helpLine(o.help, id)}<div class="${cls}">${body}</div></fieldset>`;
  }
  /* One choice from a short list, shown as pills. options: [value, label] pairs. */
  function seg(o) {
    return group(
      o,
      "ui-options",
      (o.options || [])
        .map(([v, l]) => `<label class="ui-seg"><input type="radio" name="${esc(o.name)}" value="${esc(v)}"${String(v) === String(o.value ?? "") ? " checked" : ""}${o.required ? " required" : ""}><span>${esc(l)}</span></label>`)
        .join(""),
    );
  }
  /* Any number of choices, shown as pills with a check mark. `locked` values cannot be turned off. */
  function chips(o) {
    const on = new Set((o.values || []).map(String)),
      locked = new Set((o.locked || []).map(String));
    return group(
      o,
      "ui-options",
      (o.options || [])
        .map(([v, l]) => `<label class="ui-chip"><input type="checkbox" name="${esc(o.name)}" value="${esc(v)}"${on.has(String(v)) ? " checked" : ""}${locked.has(String(v)) ? " disabled checked" : ""}><span>${esc(l)}</span></label>`)
        .join(""),
    );
  }
  /* One choice where each option needs a line of explanation. options: [value, title, description]. */
  function picks(o) {
    return group(
      o,
      "ui-picks",
      (o.options || [])
        .map(([v, title, desc]) => `<label class="ui-pick"><input type="radio" name="${esc(o.name)}" value="${esc(v)}"${String(v) === String(o.value ?? "") ? " checked" : ""}><span class="ui-pick-body"><b>${esc(title)}</b>${desc ? `<small>${esc(desc)}</small>` : ""}</span></label>`)
        .join(""),
    );
  }
  /* Yes/no. Submits `value` (default "yes") when on and nothing when off. */
  function toggle(o) {
    return `<label class="ui-switch${o.wide === false ? "" : " ui-wide"}"><input type="checkbox" role="switch" name="${esc(o.name)}" value="${esc(o.value || "yes")}"${o.checked ? " checked" : ""} ${o.attrs || ""}><span class="ui-switch-track" aria-hidden="true"></span><span class="ui-switch-text"><b>${esc(o.label)}</b>${o.help ? `<small>${esc(o.help)}</small>` : ""}</span></label>`;
  }
  /* Progressive disclosure for the fields most people never need. `html` is trusted markup. */
  const more = (summary, html, open = false) => `<details class="ui-more ui-wide"${open ? " open" : ""}><summary>${esc(summary)}</summary><div class="ui-more-body">${html}</div></details>`;
  /* kind: "info" | "warn" | "error" | "plain". `html` is trusted markup; escape user text first. */
  const note = (kind, html) => `<div class="ui-note ui-note--${esc(kind)} ui-wide"${kind === "error" ? ' role="alert"' : ""}><div>${html}</div></div>`;
  /* kind: "ok" | "due" | "muted" | "error". */
  const status = (kind, text) => `<span class="ui-status ui-status--${esc(kind)}">${esc(text)}</span>`;
  function empty(o) {
    const icon = o.icon && typeof globalThis.ico === "function" ? globalThis.ico(o.icon, 30) : "";
    return `<div class="ui-empty">${icon}<h3>${esc(o.title)}</h3>${o.text ? `<p>${esc(o.text)}</p>` : ""}${o.action || ""}</div>`;
  }
  /* Read a form into plain strings: checked boxes with the same name are joined with commas,
     an unchecked switch reads as `off` (default ""). */
  function read(form, off = "") {
    const out = {};
    for (const el of form.elements) {
      if (!el.name || el.disabled && el.type !== "checkbox") continue;
      if (el.type === "radio") {
        if (el.checked) out[el.name] = el.value;
        else if (!(el.name in out)) out[el.name] = "";
      } else if (el.type === "checkbox") {
        const many = form.querySelectorAll('input[type="checkbox"][name="' + CSS.escape(el.name) + '"]').length > 1;
        if (many) out[el.name] = [out[el.name], el.checked ? el.value : ""].filter(Boolean).join(",");
        else out[el.name] = el.checked ? el.value : off;
      } else if (el.type !== "file" && el.type !== "submit" && el.type !== "button") out[el.name] = el.value.trim();
    }
    return out;
  }
  globalThis.UI = Object.freeze({ esc, field, money, textarea, select, seg, chips, picks, toggle, more, note, status, empty, read });
})();
