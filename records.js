"use strict";
/* Documents and Tasks: the document list, viewer and details; reminders and repairs;
   inspections with photos; and emails to the tenant.
   Forms are built with the shared kit in ui.js and styled in records.css.
   Stored values never change here. Only the words shown for them do. */
(() => {
  const P = () => window.PM,
    U = () => window.UI,
    $ = (id) => document.getElementById(id),
    E = (x) => P().esc(x),
    I = (...a) => window.ico(...a),
    get = (id) => P().get(id),
    rec = (t) => P().records(t),
    today = () => P().today(),
    uid = () => P().uid(),
    btn = (...a) => P().button(...a);
  /* A pending read, save or OS share must belong to the dialog that started it.
     A form is given to the dialog as it is, so its buttons stay in view; anything else is stacked.
     options: wide, key, onClose, and the shell's self and back for the Back button. */
  function modal(title, html, options = {}) {
    const dataset = P().dataset(),
      propertyId = P().prop()?.id;
    let open = true,
      busy = false;
    const body = P().modal(
      title,
      /^\s*<form\b/.test(html) ? html : `<div class="ui-stack rc">${html}</div>`,
      {
        ...options,
        onClose() {
          open = false;
          options.onClose?.();
        },
      },
    );
    const current = () =>
      open && P().dataset() === dataset && P().prop()?.id === propertyId;
    function check() {
      if (!current())
        throw new DOMException("The initiating dialog closed.", "AbortError");
    }
    async function wait(operation) {
      check();
      const result = await operation();
      check();
      return result;
    }
    function run(action) {
      return async (event) => {
        if (event?.type === "submit") event.preventDefault();
        if (busy || !current()) return;
        busy = true;
        const buttons = Array.from(
          body.querySelectorAll(
            "button:not(:disabled), input[type=file]:not(:disabled)",
          ),
        );
        buttons.forEach((b) => (b.disabled = true));
        try {
          return await action(event);
        } catch (e) {
          if (current()) P().error(e);
        } finally {
          buttons.forEach((b) => (b.disabled = false));
          busy = false;
        }
      };
    }
    return {
      body,
      alive: current,
      check,
      wait,
      run,
      propertyId,
      blob: (file) => wait(() => P().blob(file)),
      file: (hash) => wait(() => P().file(hash)),
      save: (type, data) =>
        wait(() =>
          P().save(type, {
            ...data,
            propertyId: data.propertyId || propertyId,
          }),
        ),
      batch: (items) =>
        wait(() =>
          P().batch(
            items.map((r) => ({
              ...r,
              propertyId: r.propertyId || propertyId,
            })),
          ),
        ),
      refresh: () => wait(() => P().refresh()),
      // action: an optional { act, id, label } button on the confirmation, such as Undo.
      async finish(msg, action) {
        try {
          await wait(() => P().refresh());
        } catch (error) {
          if (!current()) return;
          P().close();
          P().toast(
            msg.replace(/\.$/, "") +
              ". Open this page again to see it in the list.",
          );
          return;
        }
        P().close();
        P().toast(msg, action);
      },
    };
  }

  /* ---------- Stored values and the plain words shown for them ---------- */
  const kinds = [
    "Receipt",
    "Invoice",
    "Lease",
    "Executed lease",
    "Amendment",
    "Disclosure",
    "Inspection",
    "Photo",
    "Correspondence",
    "Tax document",
    "Other",
  ];
  const categories = ["Reminder", "Inspection", "Maintenance"];
  const taskTypes = [
    ["Reminder", "Reminder"],
    ["Maintenance", "Repair"],
    ["Inspection", "Inspection visit"],
  ];
  const taskLabel = (k) =>
    ({ Maintenance: "Repair", Inspection: "Inspection visit" })[k] ||
    k ||
    "Reminder";
  const inspectionTypes = [
    "Move-in",
    "Preliminary move-out",
    "Move-out",
    "Periodic inspection",
    "Maintenance",
  ];
  const inspectionLabel = (k) =>
    ({
      "Preliminary move-out": "Before move-out",
      "Periodic inspection": "Routine",
      Maintenance: "Repair check",
    })[k] ||
    k ||
    "Inspection";
  const condition = [
    "Not inspected",
    "Good",
    "Ordinary wear",
    "Damage",
    "Needs repair",
    "Disputed",
  ];
  const conditionLabel = (c) =>
    ({ "Not inspected": "Not checked", "Ordinary wear": "Normal wear" })[c] ||
    c ||
    "Not checked";
  const conditionTone = (c) =>
    !c || c === "Not inspected"
      ? "muted"
      : c === "Good" || c === "Ordinary wear"
        ? "ok"
        : "due";
  const defaultRooms = [
    "Entry & living areas",
    "Kitchen & appliances",
    "Bathrooms",
    "Bedrooms",
    "Exterior & grounds",
  ];
  const templates = {
    "Lease signature request": [
      "Your lease to review and sign",
      "Attached is the lease, together with the booklets California and San Diego ask me to give you. Please read it through and let me know if you have any questions before signing.",
    ],
    Renewal: [
      "Lease renewal",
      "I would like to discuss the upcoming lease renewal. Please let me know a convenient time.",
    ],
    "Rent reminder": [
      "Rent reminder",
      "I am following up about the rent payment for the period listed below. Please let me know if your records differ.",
    ],
    "Maintenance scheduling": [
      "Scheduling maintenance",
      "Please let me know which dates and times work for scheduling the maintenance described below.",
    ],
    "Inspection coordination": [
      "Coordinating an inspection",
      "I would like to coordinate a time for an inspection. Please reply with your availability.",
    ],
    Acknowledgment: [
      "Acknowledgment",
      "Thank you. I have received the information you sent.",
    ],
  };
  const templateLabels = {
    "Lease signature request": "Lease to sign",
    Renewal: "Lease renewal",
    "Rent reminder": "Rent reminder",
    "Maintenance scheduling": "Repair visit",
    "Inspection coordination": "Inspection visit",
    Acknowledgment: "Thank you",
  };
  const mailStatus = {
    Draft: ["muted", "Draft"],
    Ready: ["due", "Ready to send"],
    "Handed to mail app/exported": ["due", "Opened in mail app"],
    "Sent confirmed by owner": ["ok", "Sent"],
  };
  const mailChip = (m) => {
    const [tone, label] = mailStatus[m.status] || ["muted", m.status || "Draft"];
    return U().status(tone, label);
  };
  const filters = {
    docQuery: "",
    kind: "",
    allVersions: false,
    taskTab: "Tasks",
    taskFilter: "Open",
  };

  /* ---------- Small helpers ---------- */
  const DAY = { month: "short", day: "numeric", year: "numeric" };
  const isDay = (d) => /^\d{4}-\d{2}-\d{2}/.test(String(d || ""));
  const day = (d) => (isDay(d) ? P().fmt(d, DAY) : "");
  // Leaves the year off while it is the current one.
  const shortDay = (d) =>
    !isDay(d)
      ? ""
      : String(d).slice(0, 4) === today().slice(0, 4)
        ? P().fmt(d)
        : P().fmt(d, DAY);
  // A saved moment is stored in UTC. Show the calendar day at the property.
  function localDay(moment, options = DAY) {
    const text = String(moment || "");
    if (!text.includes("T")) return isDay(text) ? P().fmt(text, options) : "";
    const t = new Date(text);
    if (!Number.isFinite(+t)) return "";
    try {
      return new Intl.DateTimeFormat("en-US", {
        ...options,
        timeZone: P().prop()?.timezone || "America/Los_Angeles",
      }).format(t);
    } catch {
      return new Intl.DateTimeFormat("en-US", options).format(t);
    }
  }
  const fileSize = (n) =>
    n >= 1048576
      ? (n / 1048576).toFixed(1).replace(/\.0$/, "") + " MB"
      : Math.max(1, Math.ceil((n || 0) / 1024)) + " KB";
  const plural = (n, one, many = one + "s") => n + " " + (n === 1 ? one : many);
  function formValues(form) {
    return Object.fromEntries(new FormData(form));
  }
  const optionHtml = ([value, label], selected) =>
    `<option value="${E(value)}"${value === selected ? " selected" : ""}>${E(label)}</option>`;
  /* A control that only drives the screen. It has no name, so a form never saves it. */
  const viewSelect = (label, id, options, value = "") =>
    `<div class="ui-field"><label for="${id}">${E(label)}</label><select id="${id}">${options.map((o) => optionHtml(o, value)).join("")}</select></div>`;
  function actRow(action, id, icon, title, sub, end = "") {
    return `<button class="doc-row" data-act="${E(action)}" data-id="${E(id)}"><span class="row-icon">${I(icon)}</span><span class="row-text"><strong>${E(title)}</strong><small>${E(sub)}</small></span>${end}${I("chevron", 15)}</button>`;
  }
  /* Opens "More options" when a value inside it came back from an unfinished form. */
  function openFilled(form) {
    form.querySelectorAll("details.ui-more:not([open])").forEach((box) => {
      const changed = [...box.querySelectorAll("input,select,textarea")].some(
        (el) =>
          el.type === "checkbox" || el.type === "radio"
            ? el.checked !== el.defaultChecked
            : el.tagName === "SELECT"
              ? !el.selectedOptions[0]?.defaultSelected && el.selectedIndex > 0
              : el.type !== "file" && el.value !== el.defaultValue,
      );
      if (changed) box.open = true;
    });
  }
  const moneyLabel = (t) =>
    [
      t.vendor ||
        t.title ||
        t.purpose ||
        { payment: "Payment received", deposit: "Deposit", expense: "Expense" }[
          t.type
        ] ||
        "Money entry",
      day(t.date),
      t.amount != null ? P().currency(t.amount) : "",
    ]
      .filter(Boolean)
      .join(" · ");
  const newestFirst = (a, b) =>
    String(b.date || "").localeCompare(String(a.date || ""));
  function expenseChoices() {
    return [
      ["", "None"],
      ...rec("expense")
        .slice()
        .sort(newestFirst)
        .map((x) => [x.id, moneyLabel(x)]),
    ];
  }

  /* ---------- Documents ---------- */
  const kindOf = (d) => d.kind || d.category || "Other";
  const kindOptions = (current) =>
    !current || kinds.includes(current) ? kinds : [current, ...kinds];
  const docName = (d) => d.name || d.filename || "Document";
  const docIcon = (k) =>
    k === "Receipt"
      ? "receipt"
      : k === "Photo"
        ? "camera"
        : k === "Correspondence"
          ? "mail"
          : /lease|amendment/i.test(k)
            ? "leases"
            : "file";
  const docAdded = (d) => localDay(d.created || d._updatedAt);
  const docWhen = (d) =>
    day(d.date) || (docAdded(d) ? "Added " + docAdded(d) : "");
  const docLine = (d) => [kindOf(d), docWhen(d)].filter(Boolean).join(" · ");
  const newestDoc = (a, b) =>
    String(b.created || b.date || "").localeCompare(
      String(a.created || a.date || ""),
    );
  /* Every edit or replacement is a new record that points at the one before it.
     Lists show the newest of each chain; the viewer reaches the rest. */
  function library() {
    const all = rec("document"),
      byId = new Map(all.map((d) => [d.id, d])),
      newer = new Map();
    for (const d of all)
      if (d.previousId && byId.has(d.previousId)) newer.set(d.previousId, d);
    const head = (d) => {
      let x = d;
      for (let i = 0; newer.has(x.id) && i < 1000; i++) x = newer.get(x.id);
      return x;
    };
    const chain = (d) => {
      const list = [];
      for (let x = head(d), i = 0; x && i < 1000; i++) {
        list.push(x);
        x = x.previousId ? byId.get(x.previousId) : null;
      }
      return list;
    };
    return {
      all,
      newer,
      head,
      chain,
      heads: all.filter((d) => !newer.has(d.id)),
    };
  }
  /* Newest versions for a picker, plus an older one that is already linked. */
  function docChoices(index, current) {
    const list = index.heads.slice().sort(newestDoc),
      linked = current ? get(current) : null;
    if (linked && !list.includes(linked)) list.unshift(linked);
    return [
      ["", "None"],
      ...list.map((d) => [
        d.id,
        [
          docName(d),
          docLine(d),
          index.newer.has(d.id) ? "earlier version" : "",
        ]
          .filter(Boolean)
          .join(" · "),
      ]),
    ];
  }
  function docs() {
    const root = P().content(),
      index = library(),
      some = index.all.length > 0;
    root.innerHTML =
      P().heading(
        "Documents",
        "Leases, receipts, photos and letters for this rental. Every file is kept exactly as you added it.",
        btn("Add document", "import", "plus"),
      ) +
      (some
        ? `<div class="filter-bar"><input type="search" id="vault-search" aria-label="Search documents" placeholder="Search by name or keyword" value="${E(filters.docQuery)}"></div><div id="vault-kinds" class="rc-filter"></div>`
        : "") +
      '<div id="vault-list" class="panel list-panel"></div>' +
      (index.all.length > index.heads.length
        ? U().more(
            "More options",
            U().toggle({
              name: "vault-versions",
              label: "Show earlier versions",
              help: "List every saved version of each document, not only the newest.",
              checked: filters.allVersions,
              attrs: 'id="vault-versions"',
            }),
            filters.allVersions,
          )
        : "");
    const pool = () => (filters.allVersions ? index.all : index.heads);
    const drawKinds = () => {
      const counts = new Map();
      for (const d of pool())
        counts.set(kindOf(d), (counts.get(kindOf(d)) || 0) + 1);
      if (!counts.has(filters.kind)) filters.kind = "";
      // The standard types keep their usual order; types made elsewhere in the app follow.
      const order = (k) => (kinds.includes(k) ? kinds.indexOf(k) : kinds.length);
      const names = [...counts.keys()].sort(
        (a, b) => order(a) - order(b) || a.localeCompare(b),
      );
      $("vault-kinds").innerHTML =
        names.length > 1
          ? U().seg({
              label: "Type of document",
              name: "vault-kind",
              value: filters.kind,
              options: [
                ["", `All (${pool().length})`],
                ...names.map((k) => [k, `${k} (${counts.get(k)})`]),
              ],
            })
          : "";
    };
    const draw = () => {
      const q = filters.docQuery.trim().toLowerCase();
      const rows = pool()
        .filter(
          (d) =>
            (!filters.kind || kindOf(d) === filters.kind) &&
            (!q ||
              [
                d.name,
                d.filename,
                d.notes,
                d.tags,
                kindOf(d),
                d.date,
                day(d.date),
                d.sourcePath,
              ]
                .join(" ")
                .toLowerCase()
                .includes(q)),
        )
        .sort(newestDoc);
      $("vault-list").innerHTML =
        rows
          .map((d) => {
            const count = index.chain(d).length;
            const tag = index.newer.has(d.id)
              ? U().status("muted", "Earlier version")
              : count > 1 && !filters.allVersions
                ? U().status("muted", count + " versions")
                : "";
            return actRow(
              "doc",
              d.id,
              docIcon(kindOf(d)),
              docName(d),
              docLine(d),
              tag,
            );
          })
          .join("") ||
        (some
          ? U().empty({
              title: "Nothing matches",
              text: "Try another word, or choose All.",
            })
          : U().empty({
              icon: "documents",
              title: "No documents yet",
              text: "Add your lease, receipts and photos so they are kept with your backups.",
            }));
    };
    if (some) {
      $("vault-search").oninput = (e) => {
        filters.docQuery = e.target.value;
        draw();
      };
      $("vault-kinds").onchange = (e) => {
        filters.kind = e.target.value;
        draw();
      };
      if ($("vault-versions"))
        $("vault-versions").onchange = (e) => {
          filters.allVersions = e.target.checked;
          drawKinds();
          draw();
        };
      drawKinds();
    }
    draw();
  }
  const formatOf = (name) => {
    const x = String(name).toLowerCase().split(".").pop();
    return (
      {
        pdf: "application/pdf",
        txt: "text/plain",
        csv: "text/csv",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        webp: "image/webp",
        avif: "image/avif",
        heic: "image/heic",
        heif: "image/heif",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }[x] || "application/octet-stream"
    );
  };
  const safeImage = (m) =>
    [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/avif",
    ].includes(m);
  const isText = (m) => ["text/plain", "text/csv"].includes(m);
  const previewable = (m) =>
    safeImage(m) || isText(m) || m === "application/pdf";
  /* A first guess at what a file is, from its name. The owner can change it. */
  function guessKind(name, mime) {
    const has = (pattern) => pattern.test(String(name).toLowerCase());
    if (has(/receipt|rcpt/)) return "Receipt";
    if (has(/invoice|estimate|quote/)) return "Invoice";
    if (has(/amend|addendum/)) return "Amendment";
    if (has(/lease|rental.?agreement/))
      return has(/signed|executed/) ? "Executed lease" : "Lease";
    if (has(/disclos|lead.?paint|mold|bed.?bug/)) return "Disclosure";
    if (has(/inspect|move.?in|move.?out|walk.?through/)) return "Inspection";
    if (has(/1099|1098|w-?9|tax|schedule.?e/)) return "Tax document";
    if (has(/letter|notice|email/)) return "Correspondence";
    return mime.startsWith("image/") ? "Photo" : "Other";
  }
  /* Buttons that open another dialog carry data-act, so the shell adds Back to this one. */
  async function documentView(id) {
    const d = get(id);
    if (!d) return P().toast("That document is no longer here.");
    const index = library(),
      superseded = index.newer.has(d.id),
      chain = index.chain(d),
      name = docName(d);
    const linked = [
      ...new Set(
        [
          d.transactionId,
          ...["payment", "expense", "deposit"]
            .flatMap((t) => rec(t))
            .filter((t) => t.attachments?.includes(d.id))
            .map((t) => t.id),
        ].filter(Boolean),
      ),
    ]
      .map((t) => get(t))
      .filter(Boolean);
    const facts = [
      d.tags ? ["Keywords", d.tags] : null,
      day(d.expiry) ? ["Expires", day(d.expiry)] : null,
      get(d.tenancyId)?.name ? ["Tenant", get(d.tenancyId).name] : null,
      d.notes ? ["Notes", d.notes] : null,
    ].filter(Boolean);
    const earlier = d.previousId ? get(d.previousId) : null;
    // Where this file leads: a newer copy, the version before it, and the money entries it supports.
    const related =
      (superseded
        ? ""
        : `<button type="button" id="doc-version" data-act="doc-replace" data-id="${E(d.id)}">Replace with a newer file</button>`) +
      (earlier
        ? btn("See the earlier version", "doc", "file", "secondary", earlier.id)
        : "") +
      linked
        .map((t) =>
          btn(
            "See the linked " +
              ({ expense: "expense", payment: "payment", deposit: "deposit" }[
                t.type
              ] || "money entry"),
            "activity",
            "money",
            "secondary",
            t.id,
          ),
        )
        .join("");
    let url = "",
      file = null;
    const view = modal(
      name,
      (superseded
        ? U().note(
            "warn",
            `This is an earlier version. <button type="button" class="rc-inline" data-act="doc" data-id="${E(index.head(d).id)}">See the newest version</button>`,
          )
        : "") +
        `<p class="rc-line">${E(docLine(d))}</p>` +
        (facts.length
          ? `<dl class="rc-facts">${facts.map(([k, v]) => `<dt>${E(k)}</dt><dd>${E(v)}</dd>`).join("")}</dl>`
          : "") +
        `<div class="actions rc-actions"><button type="button" class="primary" id="doc-download">${I("download", 16)}Download</button><button type="button" id="doc-mail" data-act="compose" data-id="${E(d.id)}">${I("mail", 16)}Email this</button>${superseded ? "" : `<button type="button" id="doc-review" data-act="doc-edit" data-id="${E(d.id)}">Edit details</button>`}</div>` +
        '<div id="doc-preview" class="rc-preview"><p class="rc-wait" role="status">Opening…</p></div>' +
        U().more(
          "File details and history",
          `<dl class="rc-facts"><dt>Original name</dt><dd>${E(d.filename || name)}</dd>` +
            (docAdded(d) ? `<dt>Added</dt><dd>${E(docAdded(d))}</dd>` : "") +
            (d.sourcePath
              ? `<dt>From folder</dt><dd>${E(d.sourcePath)}</dd>`
              : "") +
            `<dt>Size</dt><dd id="doc-size">${d.size ? fileSize(d.size) : "…"}</dd>` +
            (chain.length > 1
              ? `<dt>Version</dt><dd>${chain.length - chain.indexOf(d)} of ${chain.length}</dd>`
              : "") +
            "</dl>" +
            (related ? `<div class="actions rc-actions">${related}</div>` : "") +
            `<div class="rc-block"><dl class="rc-facts"><dt>Fingerprint</dt><dd class="rc-code">${E(d.hash)}</dd></dl><p class="ui-help">A code that shows the file has not changed since you added it.</p></div>`,
        ),
      {
        wide: true,
        self: { act: "doc", id: d.id },
        // A tab opened from the preview may still be loading the file.
        onClose: () => url && setTimeout(() => URL.revokeObjectURL(url), 60000),
      },
    );
    $("doc-download").onclick = () =>
      file && P().download(file, d.filename || name);
    const cannot = (text) => U().note("plain", `<p>${E(text)}</p>`);
    await view.run(async () => {
      const box = $("doc-preview");
      let blob = null;
      try {
        blob = await view.file(d.hash);
      } catch (e) {
        if (e?.name === "AbortError") throw e;
      }
      if (!blob) {
        box.innerHTML = cannot("There is nothing to show for this file.");
        throw Error(
          "This file’s contents are not on this device. Restore a backup that includes it.",
        );
      }
      const mime = d.mime || blob.type || formatOf(name);
      // The copy handed to the browser always carries the type we expect, never one it could run.
      file = new Blob([blob], { type: mime });
      url = URL.createObjectURL(file);
      if (!d.size) $("doc-size").textContent = fileSize(blob.size);
      if (safeImage(mime) || /^image\/hei[cf]$/.test(mime)) {
        box.innerHTML = `<img class="preview-img" src="${url}" alt="Preview of ${E(name)}">`;
        box.querySelector("img").onerror = () =>
          (box.innerHTML = cannot(
            "This photo format cannot be shown here. Download it to open it.",
          ));
      } else if (mime === "application/pdf") {
        const start = await view.wait(() => blob.slice(0, 1024).text());
        /* The browser's own PDF viewer cannot run inside a sandboxed frame, so the frame is
           left unsandboxed for this one case: a file typed application/pdf that starts as one. */
        box.innerHTML =
          start.includes("%PDF-") && navigator.pdfViewerEnabled !== false
            ? `<iframe class="preview-frame" title="Preview of ${E(name)}" src="${url}#toolbar=0&amp;navpanes=0"></iframe><p class="rc-preview-foot"><a class="rc-linkbtn" href="${url}" target="_blank" rel="noopener">Open in a new tab</a></p>`
            : cannot(
                "This PDF cannot be shown here. Download it to open it.",
              );
      } else if (isText(mime)) {
        const text = await view.wait(() => blob.slice(0, 65536).text());
        box.innerHTML = `<pre class="source-lines">${E(text)}</pre>`;
      } else
        box.innerHTML = cannot(
          "This kind of file cannot be previewed here. Download it to open it.",
        );
    })();
    if (view.alive() && !file)
      ["doc-download", "doc-mail"].forEach((n) => ($(n).disabled = true));
  }
  function metadataForm(given) {
    const d = library().head(given);
    const view = modal(
      "Edit details",
      `<form id="doc-meta" class="ui-stack rc"><p class="dialog-intro">Say what this file is so it is easy to find later.</p>${U().select({ label: "What is it?", name: "kind", options: kindOptions(kindOf(d)), value: kindOf(d) })}${U().field({ label: "Date on the document", name: "date", type: "date", value: d.date, help: "Optional. For example the invoice date." })}${U().more(
        "More options",
        U().field({
          label: "Expires on",
          name: "expiry",
          type: "date",
          value: d.expiry,
          help: "For insurance, licences or warranties.",
        }) +
          U().field({
            label: "Keywords",
            name: "tags",
            value: d.tags,
            help: "Words that help you find this later, such as roof or warranty.",
          }) +
          U().textarea({ label: "Notes", name: "notes", value: d.notes }),
        Boolean(d.expiry || d.tags || d.notes),
      )}<p class="ui-help">The file itself never changes. Your edits are saved as a new version.</p><div class="ui-foot"><button type="submit">Save details</button></div></form>`,
      {
        key: "doc-metadata-" + d.id,
      },
    );
    const versionId = uid();
    openFilled($("doc-meta"));
    $("doc-meta").onsubmit = view.run(async (e) => {
      e.preventDefault();
      const { _rev, _parents, _ancestors, _device, _updatedAt, ...values } = d;
      await view.save("document", {
        ...values,
        ...formValues(e.target),
        id: versionId,
        previousId: d.id,
        version: (d.version || 1) + 1,
        created: new Date().toISOString(),
        reviewStatus: "Owner reviewed",
        immutable: true,
      });
      await view.finish("Details saved");
    });
  }
  function importFiles(previousId = "") {
    // A newer file always follows the newest version, so a document keeps one line of history.
    const picked = previousId ? get(previousId) : null,
      prior = picked ? library().head(picked) : null;
    const folder = !prior && "webkitdirectory" in document.createElement("input");
    const camera = Boolean(window.matchMedia?.("(pointer: coarse)").matches);
    const view = modal(
      prior ? "Replace with a newer file" : "Add documents",
      `<p class="dialog-intro">${prior ? "Pick the newer file. The earlier version stays in this document’s history." : "Pick files from this device. We keep an exact copy."}</p>` +
        `<div class="rc-picker" id="import-pick"><label class="rc-file rc-file--primary"><span>${I("plus", 17)}<span id="import-label">${prior ? "Choose file" : "Choose files"}</span></span><input type="file" id="import-files" ${prior ? "" : "multiple"}></label>${camera ? `<label class="rc-file"><span>${I("camera", 17)}Take a photo</span><input type="file" id="import-camera" accept="image/*" capture="environment"></label>` : ""}</div>` +
        (camera
          ? '<p class="ui-help" id="import-hint">Take a photo to add a paper document.</p>'
          : "") +
        (folder
          ? `<div id="import-more">${U().more(
              "More options",
              `<div class="rc-picker"><label class="rc-file"><span>${I("documents", 17)}Add a whole folder</span><input type="file" id="import-folder" webkitdirectory multiple></label></div><p class="ui-help">Adds every file in the folder, up to 400.</p>`,
            )}</div>`
          : "") +
        '<div id="import-review"></div>',
      { key: "document-import-" + (prior?.id || "new") },
    );
    const begin = async (files) => {
      if (!files.length) return;
      const out = $("import-review");
      if (files.length > 400)
        throw Error("Choose up to 400 files at a time.");
      out.innerHTML = '<p class="rc-wait" role="status">Checking files…</p>';
      const prepared = [];
      for (const f of files) {
        if (f.size > 32 * 1024 * 1024) {
          prepared.push({ f, oversize: true });
          continue;
        }
        const bytes = new Uint8Array(
          await view.wait(async () =>
            crypto.subtle.digest("SHA-256", await f.arrayBuffer()),
          ),
        );
        const hash = Array.from(bytes, (x) =>
          x.toString(16).padStart(2, "0"),
        ).join("");
        const duplicate =
          rec("document").find((d) => d.hash === hash) ||
          prepared.find((d) => d.hash === hash);
        const mime = formatOf(f.name);
        prepared.push({
          f,
          id: uid(),
          hash,
          duplicate,
          mime,
          kind: prior ? kindOf(prior) : guessKind(f.name, mime),
        });
      }
      const usable = prepared.filter((r) => !r.oversize),
        tenancies = rec("tenancy"),
        entries = ["expense", "payment", "deposit"]
          .flatMap((t) => rec(t))
          .sort(newestFirst);
      /* The 15 newest money entries, then "Show all". A link carried over from the earlier version stays listed. */
      const moneyOptions = (all, keep) => {
        const shown = all ? entries : entries.slice(0, 15),
          kept =
            keep && !shown.some((t) => t.id === keep)
              ? entries.filter((t) => t.id === keep)
              : [];
        return [
          ["", "None"],
          ...[...kept, ...shown].map((t) => [t.id, moneyLabel(t)]),
          ...(all || entries.length <= 15
            ? []
            : [["__all", "Show all " + entries.length]]),
        ];
      };
      const tenantHelp =
        "Optional. Choose a tenant if the file is about their lease.";
      const card = (r, i) => {
        const tag = r.oversize
          ? U().status("error", "Too large (32 MB limit)")
          : r.duplicate
            ? U().status("muted", "Already saved")
            : !previewable(r.mime)
              ? U().status("muted", "Stored, no preview")
              : U().status("ok", "New");
        const from =
          r.f.webkitRelativePath && r.f.webkitRelativePath !== r.f.name
            ? r.f.webkitRelativePath + " · "
            : "";
        const hint = r.oversize
          ? " · This file is too large to keep here."
          : r.duplicate && !prior
            ? " · Tick the box to save another copy."
            : "";
        const tenant = !tenancies.length
          ? `<input type="hidden" name="tenancy${i}" value="">`
          : tenancies.length === 1
            ? U().seg({
                label: "Belongs to a tenant",
                name: "tenancy" + i,
                value:
                  prior?.tenancyId === tenancies[0].id ? tenancies[0].id : "",
                options: [
                  ["", "Not tenant-specific"],
                  [tenancies[0].id, tenancies[0].name],
                ],
                help: tenantHelp,
              })
            : U().select({
                label: "Belongs to a tenant",
                name: "tenancy" + i,
                value: prior?.tenancyId || "",
                options: [
                  ["", "Not tenant-specific"],
                  ...tenancies.map((t) => [t.id, t.name]),
                ],
                help: tenantHelp,
              });
        return (
          `<div class="sub-card rc-import"><div class="rc-import-head"><label class="check-label rc-import-name"><input type="checkbox" name="use${i}" ${r.oversize ? "disabled" : r.duplicate && !prior ? "" : "checked"}><span>${E(r.f.name)}</span></label>${tag}</div>` +
          `<p class="rc-import-meta">${E(from)}${fileSize(r.f.size)}${hint}</p>` +
          (r.oversize
            ? ""
            : U().select({
                label: "What is it?",
                name: "kind" + i,
                options: kindOptions(r.kind),
                value: r.kind,
              }) +
              U().more(
                "More options",
                U().field({
                  label: "Date on the document",
                  name: "date" + i,
                  type: "date",
                  value: "",
                  help: "Optional. For example the invoice date.",
                }) +
                  tenant +
                  (entries.length
                    ? U().select({
                        label: "Goes with a payment or expense",
                        name: "tx" + i,
                        value: prior?.transactionId || "",
                        options: moneyOptions(false, prior?.transactionId),
                        help: "Optional. The file will also show on that Money entry.",
                        attrs: "data-money",
                      })
                    : `<input type="hidden" name="tx${i}" value="">`),
              )) +
          "</div>"
        );
      };
      out.innerHTML =
        `<form class="ui-stack rc" id="commit-docs"><div class="rc-import-top"><div><h3>${plural(prepared.length, "file")} ready</h3><p class="ui-help">${usable.some((r) => !previewable(r.mime)) ? "Everything below is optional. Word and Excel files are stored but cannot be previewed here." : "Check what each file is. Everything else is optional."}</p></div>${usable.length > 1 ? viewSelect("Set all to", "import-setall", [["", "Leave as they are"], ...kinds.map((k) => [k, k])]) : ""}</div>` +
        prepared.map(card).join("") +
        '<div class="ui-foot"><button type="submit" id="import-save">Save documents</button></div></form>';
      const form = $("commit-docs");
      $("import-label").textContent = prior
        ? "Choose a different file"
        : "Choose different files";
      $("import-pick").classList.add("is-done");
      // From here the files are the subject. The other ways to pick step aside.
      for (const extra of ["import-more", "import-hint"])
        if ($(extra)) $(extra).hidden = true;
      /* The button says how many files will be saved, and waits for at least one. */
      const sync = () => {
        const save = $("import-save");
        if (!save || !form.isConnected) return;
        const n = form.querySelectorAll('input[name^="use"]:checked').length;
        save.textContent = prior
          ? "Save new version"
          : n === 1
            ? "Save document"
            : n
              ? `Save ${n} documents`
              : "Save documents";
        save.disabled = !n;
      };
      form.onchange = (e) => {
        const el = e.target;
        if (el.id === "import-setall") {
          if (el.value)
            form
              .querySelectorAll('select[name^="kind"]')
              .forEach((s) => (s.value = el.value));
        } else if (el.dataset.money !== undefined && el.value === "__all") {
          el.innerHTML = moneyOptions(true, "")
            .map((o) => optionHtml(o, ""))
            .join("");
        } else if (el.name?.startsWith("use")) sync();
      };
      sync();
      form.onsubmit = view.run(async (e) => {
        e.preventDefault();
        const v = formValues(form),
          items = [];
        try {
          for (const [i, r] of prepared.entries()) {
            if (!v["use" + i] || r.oversize) continue;
            const hash = await view.blob(r.f);
            items.push({
              type: "document",
              id: r.id,
              name: r.f.name,
              filename: r.f.name,
              kind: v["kind" + i],
              mime: r.mime,
              hash,
              size: r.f.size,
              date: v["date" + i],
              sourcePath: r.f.webkitRelativePath || "",
              sourceModified: r.f.lastModified
                ? new Date(r.f.lastModified).toISOString()
                : "",
              created: new Date().toISOString(),
              tenancyId: v["tenancy" + i] || "",
              transactionId: v["tx" + i] === "__all" ? "" : v["tx" + i] || "",
              previousId: prior?.id || "",
              version: (prior?.version || 0) + 1,
              immutable: true,
            });
          }
          if (!items.length) throw Error("Tick at least one file to save.");
          const transactions = new Map();
          for (const d of items) {
            if (!d.transactionId) continue;
            const t = transactions.get(d.transactionId) || get(d.transactionId);
            if (t && !t.immutable)
              transactions.set(t.id, {
                ...t,
                attachments: [...new Set([...(t.attachments || []), d.id])],
              });
          }
          await view.batch([...items, ...transactions.values()]);
          await view.finish(
            prior
              ? "New version saved"
              : plural(items.length, "document") + " added",
          );
        } finally {
          // The dialog re-enables its buttons after this; put the count rule back.
          setTimeout(sync);
        }
      });
    };
    for (const id of ["import-files", "import-camera", "import-folder"])
      if ($(id)) $(id).onchange = view.run((e) => begin([...e.target.files]));
  }

  /* ---------- Tasks page: to-do, inspections, emails ---------- */
  // Tasks ticked or unticked on the list keep their row, with Undo, until the list is next opened.
  const recent = new Map();
  let keepRecent = false;
  function taskRow(t) {
    const done = Boolean(t.completed),
      now = today();
    const when = done
      ? "Done"
      : !t.due
        ? "No due date"
        : t.due < now
          ? "Was due " + shortDay(t.due)
          : t.due === now
            ? "Due today"
            : "Due " + shortDay(t.due);
    const flag =
      !done && t.due && t.due <= now
        ? U().status("due", t.due < now ? "Overdue" : "Today")
        : "";
    return (
      `<div class="rc-task${done ? " is-done" : ""}" data-task="${E(t.id)}">` +
      `<button type="button" class="rc-check" data-task-toggle="${E(t.id)}" aria-pressed="${done}" aria-label="Done: ${E(t.title)}" title="${done ? "Mark as not done" : "Mark as done"}"><span aria-hidden="true">${I("check", 15)}</span></button>` +
      `<button class="doc-row" data-act="task" data-id="${E(t.id)}"><span class="row-text"><strong>${E(t.title)}</strong><small>${E(taskLabel(t.kind) + " · " + when)}</small></span>${flag}${I("chevron", 15)}</button>` +
      (recent.has(t.id)
        ? `<button type="button" class="ui-quiet rc-undo" data-task-undo="${E(t.id)}">Undo</button>`
        : "") +
      "</div>"
    );
  }
  /* Each tab has its own page address (#tasks, #tasks/inspections, #tasks/emails),
     so Back and a reload return to the tab the owner was on. */
  const tabRoutes = { Tasks: "", Inspections: "inspections", Outbox: "emails" };
  function tasks() {
    const root = P().content();
    if (typeof P().route === "function") {
      const at = String(P().route() || "").split("/")[0];
      filters.taskTab =
        Object.keys(tabRoutes).find((k) => tabRoutes[k] === at) || "Tasks";
    }
    const tab = filters.taskTab;
    if (!keepRecent) recent.clear();
    keepRecent = false;
    const tabs = [
      ["Tasks", "To-do"],
      ["Inspections", "Inspections"],
      ["Outbox", "Emails"],
    ];
    const purpose = {
      Tasks: "Dated tasks appear on Home 30 days before they are due.",
      Inspections:
        "A dated, room-by-room record of the home’s condition, with photos. Do one at move-in and one at move-out.",
      Outbox:
        "Write to your tenant and keep a record of what you sent. The email opens in your own mail app, and nothing is sent until you press Send there.",
    };
    let content = "";
    if (tab === "Tasks")
      content =
        (rec("task").length
          ? `<div class="rc-filter" id="task-filter">${U().seg({
              label: "Show",
              name: "task-filter",
              value: filters.taskFilter,
              options: [
                ["Open", "To do"],
                ["Completed", "Done"],
                ["All tasks", "All"],
              ],
            })}</div>`
          : "") + '<div id="task-list" class="panel list-panel"></div>';
    else if (tab === "Inspections") {
      const list = rec("inspection")
        .slice()
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      content =
        (list.length > 1
          ? `<div class="rc-tools">${btn("Compare two inspections", "compare", "list", "secondary")}</div>`
          : "") +
        `<div class="panel list-panel">${
          list
            .map((r) => {
              const photos = (r.items || []).reduce(
                (n, i) => n + (i.photos || []).length,
                0,
              );
              return actRow(
                "inspection",
                r.id,
                "tasks",
                r.title,
                [...inspectionFacts(r), photos ? plural(photos, "photo") : ""]
                  .filter(Boolean)
                  .join(" · "),
                r.completed
                  ? U().status("ok", "Finished")
                  : U().status("due", "In progress"),
              );
            })
            .join("") ||
          U().empty({
            icon: "tasks",
            title: "No inspections yet",
            text: "Start one when a tenant moves in. Each room gets a condition, a note and photos.",
          })
        }</div>`;
    } else
      content = `<div class="panel list-panel">${
        rec("communication")
          .slice()
          .sort((a, b) => String(b.planned).localeCompare(String(a.planned)))
          .map((m) => {
            const sent = m.status === "Sent confirmed by owner",
              handed = m.status === "Handed to mail app/exported",
              short = { month: "short", day: "numeric" };
            const when =
              sent && m.sentAt
                ? "Sent " + localDay(m.sentAt, short)
                : handed && m.handoffAt
                  ? "Opened " + localDay(m.handoffAt, short)
                  : m.planned
                    ? (m.planned > today() ? "Send on " : "") +
                      shortDay(m.planned)
                    : "No date";
            return actRow(
              "message",
              m.id,
              "mail",
              m.subject || "No subject yet",
              (m.to ? "To " + m.to : "No address yet") + " · " + when,
              mailChip(m),
            );
          })
          .join("") ||
        U().empty({
          icon: "mail",
          title: "No emails yet",
          text: "Write to your tenant here. The email opens in your own mail app, ready to send.",
        })
      }</div>`;
    root.innerHTML =
      P().heading(
        "Tasks",
        "Reminders and repairs to keep track of, inspection records, and emails to your tenant.",
        tab === "Outbox"
          ? btn("Write email", "compose", "mail")
          : tab === "Inspections"
            ? btn("Start inspection", "inspect-new", "plus")
            : btn("Add task", "task-new", "plus"),
      ) +
      `<div class="tabs" role="group" aria-label="Task views">${tabs.map(([n, label]) => `<button data-task-tab="${n}" class="${tab === n ? "active" : ""}" aria-pressed="${tab === n}">${label}</button>`).join("")}</div>` +
      `<p class="rc-purpose">${E(purpose[tab])}</p>` +
      content;
    root.querySelectorAll("[data-task-tab]").forEach(
      (b) =>
        (b.onclick = () => {
          filters.taskTab = b.dataset.taskTab;
          P().setRoute?.(tabRoutes[filters.taskTab]);
          tasks();
          P()
            .content()
            .querySelector('[data-task-tab="' + filters.taskTab + '"]')
            ?.focus();
        }),
    );
    if (tab !== "Tasks") return;
    const list = $("task-list");
    const draw = () => {
      const all = rec("task");
      list.innerHTML =
        all
          .filter(
            (t) =>
              recent.has(t.id) ||
              filters.taskFilter === "All tasks" ||
              Boolean(t.completed) === (filters.taskFilter === "Completed"),
          )
          .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"))
          .map(taskRow)
          .join("") ||
        U().empty(
          !all.length
            ? {
                icon: "tasks",
                title: "Nothing to do yet",
                text: "Add a reminder or a repair. It will show here and, when it is nearly due, on Home.",
              }
            : filters.taskFilter === "Completed"
              ? {
                  title: "Nothing finished yet",
                  text: "Tasks you mark as done will be listed here.",
                }
              : {
                  icon: "checkcircle",
                  title: "All done",
                  text: "Nothing is waiting. Choose Done to see finished tasks.",
                },
        );
    };
    /* One tap on the circle marks a task done. The row stays put with Undo. */
    const flip = async (taskId, button) => {
      const ds = P().dataset(),
        pid = P().prop()?.id,
        t = get(taskId);
      if (!t) return;
      const undo = recent.has(taskId),
        next = undo ? recent.get(taskId) : !t.completed;
      button.disabled = true;
      try {
        await P().save("task", { ...t, completed: next });
        if (P().dataset() !== ds || P().prop()?.id !== pid || !list.isConnected)
          return;
        if (undo) recent.delete(taskId);
        else recent.set(taskId, Boolean(t.completed));
        draw();
        list
          .querySelector(`[data-task="${CSS.escape(taskId)}"] .rc-check`)
          ?.focus();
        P().toast(
          undo ? "Put back" : next ? "Marked as done" : "Marked as not done",
        );
      } catch (e) {
        button.disabled = false;
        P().error(e);
      }
    };
    list.onclick = (e) => {
      const b = e.target.closest("[data-task-toggle],[data-task-undo]");
      if (b && !b.disabled) flip(b.dataset.taskToggle || b.dataset.taskUndo, b);
    };
    if ($("task-filter"))
      $("task-filter").onchange = (e) => {
        filters.taskFilter = e.target.value;
        recent.clear();
        draw();
      };
    draw();
  }

  /* ---------- A task: reminder, repair or inspection visit ---------- */
  function taskForm(id) {
    const existing = id ? get(id) : null;
    if (id && !existing) return P().toast("That task is no longer here.");
    const t = existing || { id: uid() },
      index = library(),
      key = "task-" + (id || "new"),
      kind = t.kind || "Reminder";
    const view = modal(
      existing ? "Task details" : "Add task",
      '<form id="task-form" class="ui-stack rc"><p class="dialog-intro">A reminder or a repair to keep track of. Tasks with a date show on Home when they are nearly due.</p>' +
        U().field({
          label: "What needs doing?",
          name: "title",
          value: t.title,
          required: true,
          placeholder: "For example: service the furnace",
          attrs: 'maxlength="160" autocomplete="off"',
        }) +
        U().seg({
          label: "Type",
          name: "kind",
          value: kind,
          options: categories.includes(kind)
            ? taskTypes
            : [...taskTypes, [kind, kind]],
        }) +
        `<div class="rc-due">${U().field({ label: "Due", name: "due", type: "date", value: existing ? t.due || "" : today(), help: "Shows on Home 30 days before." })}<div class="rc-quick" role="group" aria-label="Quick dates"><button type="button" data-due="0">Today</button><button type="button" data-due="7">Next week</button><button type="button" data-due="">No date</button></div></div>` +
        U().textarea({ label: "Notes", name: "notes", value: t.notes, optional: true }) +
        U().more(
          "More options",
          U().field({
            label: "Who will do it?",
            name: "vendor",
            value: t.vendor,
            help: "A person or company, such as your plumber.",
          }) +
            U().field({
              label: "Expected cost",
              name: "estimate",
              type: "number",
              value: t.estimate,
              prefix: "$",
              help: "A rough figure. It does not create an expense.",
              attrs: 'min="0" step=".01" inputmode="decimal"',
            }) +
            // data-leave: the shell keeps what was typed and adds Back while the linked record is open.
            `<div class="rc-linked">${U().select({ label: "Related document", name: "documentId", options: docChoices(index, t.documentId), value: t.documentId || "", help: "For example the quote or invoice." })}<button type="button" id="task-doc" data-act="doc" data-leave>Open</button></div>` +
            `<div class="rc-linked">${U().select({ label: "Related expense", name: "expenseId", options: expenseChoices(), value: t.expenseId || "", help: "If the cost is already recorded in Money." })}<button type="button" id="task-expense" data-act="activity" data-leave>Open</button></div>` +
            `<div class="rc-choice"><button type="button" id="ics">${I("calendar", 16)}Add to my calendar</button><p class="ui-help" id="ics-help"></p></div>`,
          Boolean(t.vendor || t.estimate || t.documentId || t.expenseId),
        ) +
        `<div class="ui-foot">${existing ? `<button type="button" id="toggle-task" class="ui-foot-start">${t.completed ? "Reopen" : "Mark done"}</button>` : ""}<button type="submit">Save task</button></div></form>`,
      {
        key,
        self: { act: existing ? "task" : "task-new", id: existing?.id },
      },
    );
    const f = $("task-form"),
      values = () => formValues(f);
    openFilled(f);
    /* Buttons that need a value say so instead of doing nothing. */
    const sync = () => {
      const due = f.elements.due.value;
      $("ics").disabled = !due;
      $("ics-help").textContent = due
        ? "Saves a calendar file for the due date. Open it to add the reminder."
        : "Add a due date first.";
      for (const [button, field] of [
        ["task-doc", "documentId"],
        ["task-expense", "expenseId"],
      ]) {
        $(button).dataset.id = f.elements[field].value;
        $(button).disabled = !f.elements[field].value;
      }
    };
    f.addEventListener("input", sync);
    f.addEventListener("change", sync);
    sync();
    f.querySelector(".rc-quick").onclick = (e) => {
      const b = e.target.closest("[data-due]");
      if (!b) return;
      f.elements.due.value =
        b.dataset.due === "" ? "" : P().addDays(today(), +b.dataset.due);
      // Counts as typing, so the date is kept with the rest if the form is left and reopened.
      f.elements.due.dispatchEvent(new Event("input", { bubbles: true }));
    };
    f.onsubmit = view.run(async (e) => {
      e.preventDefault();
      await view.save("task", { ...t, ...values() });
      await view.finish("Task saved");
    });
    if (existing)
      $("toggle-task").onclick = view.run(async () => {
        if (!f.reportValidity()) return;
        const saved = await view.save("task", {
          ...t,
          ...values(),
          completed: !t.completed,
        });
        recent.set(saved.id, Boolean(t.completed));
        keepRecent = true;
        await view.finish(saved.completed ? "Marked as done" : "Task reopened", {
          act: "task-undo",
          id: saved.id,
          label: "Undo",
        });
      });
    $("ics").onclick = view.run(() => {
      const v = values();
      calendar(t.id, v.title || "Reminder", v.due, v.notes);
    });
    if (!existing) f.elements.title.focus({ preventScroll: true });
  }
  /* Undo from the confirmation: put a task back the way it was before the last tick. */
  async function taskUndo(id) {
    const t = get(id);
    if (!t) return;
    const was = recent.has(id) ? recent.get(id) : !t.completed;
    await P().save("task", { ...t, completed: was });
    recent.delete(id);
    await P().refresh();
    P().toast(was ? "Marked as done again" : "Back on your to-do list");
  }
  function calendar(id, title, date, notes) {
    if (!date) throw Error("Add a date first, then add it to your calendar.");
    const escape = (s) =>
      String(s || "")
        .replace(/\\/g, "\\\\")
        .replace(/\r?\n/g, "\\n")
        .replace(/[,;]/g, (v) => "\\" + v);
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Property Manager//Owner reminders//EN",
      "BEGIN:VEVENT",
      "UID:" + escape(id) + "@property-manager.local",
      "DTSTAMP:" +
        new Date()
          .toISOString()
          .replace(/[-:]/g, "")
          .replace(/\.\d{3}/, ""),
      "DTSTART;VALUE=DATE:" + date.replaceAll("-", ""),
      "SUMMARY:" + escape(title),
      "DESCRIPTION:" + escape(notes),
      "END:VEVENT",
      "END:VCALENDAR",
    ];
    P().download(
      new Blob([lines.join("\r\n") + "\r\n"], { type: "text/calendar" }),
      (String(title || "").trim().slice(0, 60) || "Reminder") + ".ics",
    );
  }

  /* ---------- Inspections ---------- */
  const inspectionTitle = (kind, date) =>
    (kind === "Maintenance"
      ? "Repair check"
      : inspectionLabel(kind) + " inspection") +
    (day(date) ? " · " + day(date) : "");
  /* The kind and date of an inspection, leaving out what its name already says. */
  const inspectionFacts = (r) =>
    [inspectionLabel(r.kind), day(r.date)].filter(
      (part) =>
        part &&
        !String(r.title || "")
          .toLowerCase()
          .includes(part.toLowerCase()),
    );
  // Rooms and picked photos of an inspection that was closed before it was saved, kept for this session.
  const unsaved = new Map();
  /* Move-in until this tenant has one, move-out once their end date has come, otherwise routine. */
  function likelyInspection() {
    const t = rec("tenancy")[0],
      since = isDay(t?.start) ? P().addDays(t.start.slice(0, 10), -30) : "";
    const movedIn = rec("inspection").some(
      (r) => r.kind === "Move-in" && (!since || String(r.date) >= since),
    );
    if (!movedIn) return "Move-in";
    return t?.end && t.end <= today() ? "Move-out" : "Periodic inspection";
  }
  /* A new inspection starts with the rooms of the last whole-home inspection, so the two line up. */
  function usualRooms() {
    const last = rec("inspection")
      .filter((r) => r.kind !== "Maintenance" && (r.items || []).length)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    const names = [
      ...new Set(
        (last?.items || []).map((i) => String(i.room || "").trim()),
      ),
    ].filter(Boolean);
    return names.length ? names : defaultRooms;
  }
  const conditionOptions = (current) => [
    ...condition.map((c) => [c, conditionLabel(c)]),
    ...(condition.includes(current) ? [] : [[current, current]]),
  ];
  function roomCard(r, i) {
    const now = r.condition || "Not inspected";
    return (
      '<section class="sub-card rc-room" data-room>' +
      `<div class="rc-room-head">${U().field({ label: "Room or area", name: "room" + i, value: r.room, required: true, attrs: 'autocomplete="off"' })}<button type="button" class="ui-quiet rc-room-remove" data-room-remove>Remove</button></div>` +
      U().seg({
        label: "Condition",
        name: "cond" + i,
        value: now,
        options: conditionOptions(now),
      }) +
      U().textarea({
        label: "Notes",
        name: "note" + i,
        value: r.notes,
        rows: 1,
        placeholder: "What you saw, such as a small scuff by the door",
      }) +
      `<div class="rc-photos"><label class="rc-file"><span>${I("camera", 17)}Add photos</span><input type="file" name="photos${i}" accept="image/*" multiple></label><span class="rc-photo-count" data-photo-count></span></div>` +
      '<div class="rc-thumbs" data-thumbs></div></section>'
    );
  }
  function inspectForm(id, from = null) {
    const old = id ? get(id) : null;
    if (id && !old) return P().toast("That inspection is no longer here.");
    if (old?.completed) return inspectDetail(old);
    const source = old || from,
      inspectionId = old?.id || uid();
    // A correction starts as a copy of a finished inspection and is saved only when the owner saves it.
    const temp = source
      ? {
          title: old
            ? old.title || ""
            : (from.title || "Inspection") + " · follow-up",
          kind: source.kind || "Move-in",
          date: source.date || today(),
          responsibility: source.responsibility || "",
          expenseId: source.expenseId || "",
          due: old ? old.due || "" : "",
        }
      : {
          title: "",
          kind: likelyInspection(),
          date: today(),
          responsibility: "",
          expenseId: "",
          due: "",
        };
    if (!source) temp.title = inspectionTitle(temp.kind, temp.date);
    const key = "inspection-" + (old?.id || (from ? "from-" + from.id : "new")),
      keepKey = P().dataset() + "|" + (P().prop()?.id || "") + "|" + key,
      kept = unsaved.get(keepKey);
    const items = (
      kept?.map((r) => ({
        ...r.base,
        room: r.room,
        condition: r.condition,
        notes: r.notes,
        photos: r.photos.filter((p) => p.ref).map((p) => p.ref),
      })) ||
      source?.items ||
      usualRooms().map((room) => ({
        room,
        condition: "Not inspected",
        notes: "",
        photos: [],
      }))
    ).map((r) => ({ ...r, photos: [...(r.photos || [])] }));
    const urls = [],
      track = (url) => (urls.push(url), url);
    let rooms = [],
      reshaped = Boolean(kept),
      saved = false;
    const view = modal(
      "Inspection",
      '<form id="inspection-form" class="ui-stack rc"><p class="dialog-intro">Go room by room: tap a condition, then add a note and photos. You can save and finish later.</p>' +
        (kept
          ? U().note(
              "info",
              "<p>The rooms and photos you had not saved are still here.</p>",
            )
          : from
            ? U().note(
                "info",
                "<p>This starts as a copy of the finished inspection. The original stays locked.</p>",
              )
            : "") +
        U().seg({
          label: "What kind of inspection?",
          name: "kind",
          value: temp.kind,
          options: [
            ...inspectionTypes.map((k) => [k, inspectionLabel(k)]),
            ...(inspectionTypes.includes(temp.kind)
              ? []
              : [[temp.kind, temp.kind]]),
          ],
          help: "Move-in and move-out records are your evidence of the home’s condition.",
        }) +
        `<div class="ui-grid rc-level">${U().field({ label: "Date", name: "date", type: "date", value: temp.date, required: true })}${U().field({ label: "Name", name: "title", value: temp.title, required: true, help: source ? "" : "Filled in for you. Change it if you like.", attrs: 'autocomplete="off"' })}</div>` +
        U().more(
          "More options",
          U().field({
            label: "Inspected by",
            name: "responsibility",
            value: temp.responsibility,
          }) +
            U().field({
              label: "Follow up by",
              name: "due",
              type: "date",
              value: temp.due,
              help: "Adds a reminder to your to-do list.",
            }) +
            U().select({
              label: "Related expense",
              name: "expenseId",
              options: expenseChoices(),
              value: temp.expenseId,
              help: "If a repair from this inspection is already recorded in Money.",
            }),
          Boolean(temp.responsibility || temp.due || temp.expenseId),
        ) +
        `<h3 class="rc-section">Rooms</h3><div id="room-list" class="rc-rooms">${items.map(roomCard).join("")}</div>` +
        `<div><button type="button" id="room-add">${I("plus", 16)}Add another room</button></div>` +
        // The question takes the place of the buttons, so it appears where the owner just tapped.
        '<div class="rc-confirm" id="inspect-confirm" role="group" aria-labelledby="inspect-confirm-title" hidden><h3 id="inspect-confirm-title">Finish this inspection?</h3><p id="inspect-confirm-text"></p><div class="rc-confirm-actions"><button type="button" id="check-back">Go back</button><button type="button" id="check-complete" class="primary">Finish and lock</button></div></div>' +
        '<div class="ui-foot" id="inspect-foot"><button type="submit" value="draft" class="rc-plain">Save and finish later</button><button type="submit" value="complete">Finish inspection</button></div></form>',
      {
        wide: true,
        key,
        onClose() {
          urls.forEach((u) => URL.revokeObjectURL(u));
          const form = $("inspection-form");
          if (saved || !form) return void unsaved.delete(keepKey);
          /* Closed before saving: picked photos and added or removed rooms cannot be typed again,
             so they are kept for this session and put back when the inspection is reopened. */
          if (!reshaped && !rooms.some((r) => r.photos.some((p) => !p.ref)))
            return;
          const v = formValues(form);
          unsaved.set(
            keepKey,
            rooms.map((room, i) => ({
              base: room.base,
              room: v["room" + i] ?? "",
              condition: v["cond" + i] || "Not inspected",
              notes: v["note" + i] ?? "",
              photos: room.photos.map(({ file, ref }) => ({ file, ref })),
            })),
          );
        },
      },
    );
    const f = $("inspection-form"),
      list = $("room-list");
    openFilled(f);
    /* One entry per room card, in the same order as the room0, room1… field names. */
    rooms = [...list.querySelectorAll("[data-room]")].map((el, i) => ({
      el,
      base: items[i],
      photos: items[i].photos.map((ref) => ({ ref })),
    }));
    const roomOf = (node) => rooms.find((r) => r.el.contains(node));
    const count = (room) => {
      const n = room.photos.length;
      room.el.querySelector("[data-photo-count]").textContent = n
        ? plural(n, "photo")
        : "No photos yet. Take or choose as many as you need.";
    };
    const show = (entry) => {
      const holder = entry.el?.querySelector(".rc-thumb-img");
      if (!holder || !entry.url) return;
      const img = new Image();
      img.alt = entry.file?.name || entry.ref?.name || "Photo";
      img.onerror = () => (holder.innerHTML = I("camera", 22));
      img.src = entry.url;
      holder.replaceChildren(img);
    };
    const tile = (room, entry) => {
      const name = entry.file?.name || entry.ref?.name || "photo";
      const el = document.createElement("div");
      el.className = "rc-thumb";
      el.innerHTML = `<span class="rc-thumb-img">${I("camera", 22)}</span><button type="button" class="rc-thumb-x" aria-label="Remove ${E(name)}" title="Remove this photo"><span aria-hidden="true">${I("x", 14)}</span></button>`;
      el.querySelector("button").onclick = () => {
        room.photos.splice(room.photos.indexOf(entry), 1);
        el.remove();
        count(room);
        room.el.querySelector("input[type=file]").focus();
      };
      entry.el = el;
      room.el.querySelector("[data-thumbs]").append(el);
      show(entry);
    };
    /* Every pick adds to the room. Nothing is stored until the inspection is saved. */
    const addPhotos = (room, files) => {
      const note = room.el.querySelector(".ui-error");
      if (note) note.remove();
      const large = files.filter((x) => x.size > 32 * 1024 * 1024);
      for (const file of files) {
        if (
          large.includes(file) ||
          room.photos.some(
            (p) =>
              p.file &&
              p.file.name === file.name &&
              p.file.size === file.size &&
              p.file.lastModified === file.lastModified,
          )
        )
          continue;
        const entry = { file, url: track(URL.createObjectURL(file)) };
        room.photos.push(entry);
        tile(room, entry);
      }
      if (large.length)
        room.el
          .querySelector(".rc-photos")
          .insertAdjacentHTML(
            "afterend",
            `<p class="ui-error" role="alert">${E(plural(large.length, "photo is", "photos are"))} larger than 32 MB and could not be added.</p>`,
          );
      count(room);
    };
    const grow = (area) => {
      area.style.height = "auto";
      area.style.height = area.scrollHeight + 2 + "px";
    };
    const syncRooms = () =>
      rooms.forEach(
        (r) =>
          (r.el.querySelector("[data-room-remove]").hidden = rooms.length < 2),
      );
    for (const room of rooms) {
      room.photos.forEach((entry) => tile(room, entry));
      count(room);
    }
    kept?.forEach((r, i) =>
      addPhotos(
        rooms[i],
        r.photos.filter((p) => !p.ref && p.file).map((p) => p.file),
      ),
    );
    syncRooms();
    f.querySelectorAll('textarea[name^="note"]').forEach(grow);
    // Photos saved earlier are read back for their thumbnails. A missing one keeps its placeholder.
    (async () => {
      for (const entry of rooms.flatMap((room) => room.photos)) {
        if (entry.url || !entry.ref) continue;
        try {
          const blob = await view.file(entry.ref.hash);
          entry.url = track(URL.createObjectURL(blob));
          show(entry);
        } catch (e) {
          if (e?.name === "AbortError") return;
        }
      }
    })();
    /* The name follows the kind and date until the owner types their own. */
    const kindNow = () => new FormData(f).get("kind") || temp.kind;
    let auto = inspectionTitle(kindNow(), f.elements.date.value);
    const retitle = () => {
      const title = f.elements.title,
        mine = title.value.trim() && title.value !== auto;
      auto = inspectionTitle(kindNow(), f.elements.date.value);
      if (!mine) title.value = auto;
    };
    const unchecked = () =>
      rooms.filter(
        (_, i) =>
          (new FormData(f).get("cond" + i) || "Not inspected") ===
          "Not inspected",
      ).length;
    const confirmText = () => {
      const n = unchecked();
      $("inspect-confirm-text").textContent =
        (n
          ? n === 1
            ? "1 room is not checked yet. "
            : n + " rooms are not checked yet. "
          : "") +
        "Once you finish, this inspection is locked as a dated record. You can still add a correction later.";
    };
    const asking = (on) => {
      $("inspect-confirm").hidden = !on;
      $("inspect-foot").hidden = on;
    };
    f.addEventListener("change", (e) => {
      const el = e.target;
      if (el.type === "file" && el.name.startsWith("photos")) {
        addPhotos(roomOf(el), [...el.files]);
        el.value = "";
      } else if (el.name === "kind" || el.name === "date") retitle();
      if (!$("inspect-confirm").hidden) confirmText();
    });
    f.addEventListener("input", (e) => {
      if (e.target.matches('textarea[name^="note"]')) grow(e.target);
    });
    list.addEventListener("click", (e) => {
      const b = e.target.closest("[data-room-remove]");
      if (!b) return;
      const room = roomOf(b),
        i = rooms.indexOf(room);
      if (i < 0 || rooms.length < 2) return;
      const used =
        room.photos.length ||
        f.elements["note" + i].value.trim() ||
        (new FormData(f).get("cond" + i) || "Not inspected") !==
          "Not inspected";
      // A room with a condition, a note or photos asks once more before it goes.
      if (used && !b.dataset.armed) {
        b.dataset.armed = "1";
        b.textContent = "Tap again to remove";
        b.classList.add("ui-danger");
        b.onblur = () => {
          delete b.dataset.armed;
          b.textContent = "Remove";
          b.classList.remove("ui-danger");
        };
        return;
      }
      room.el.remove();
      rooms.splice(i, 1);
      reshaped = true;
      rooms.forEach((r, n) =>
        r.el
          .querySelectorAll("[name]")
          .forEach((c) => (c.name = c.name.replace(/\d+$/, String(n)))),
      );
      syncRooms();
      (rooms[i] || rooms[i - 1]).el.querySelector("input").focus();
      if (!$("inspect-confirm").hidden) confirmText();
    });
    $("room-add").onclick = () => {
      const base = {
          room: "",
          condition: "Not inspected",
          notes: "",
          photos: [],
        },
        holder = document.createElement("div");
      holder.innerHTML = roomCard(base, rooms.length);
      const room = { el: holder.firstElementChild, base, photos: [] };
      list.append(room.el);
      rooms.push(room);
      reshaped = true;
      count(room);
      syncRooms();
      room.el.querySelector("input").focus();
    };
    /* Photos are stored one after another when the inspection is saved, never at the moment they are picked. */
    const read = async () => {
      const v = formValues(f);
      Object.keys(temp).forEach((k) => (temp[k] = v[k] ?? temp[k]));
      const result = [];
      for (const [i, room] of rooms.entries()) {
        const input = f.elements["photos" + i];
        if (input?.files?.length) {
          addPhotos(room, [...input.files]);
          input.value = "";
        }
        for (const entry of [...room.photos]) {
          if (entry.ref) continue;
          const hash = await view.blob(entry.file);
          if (room.photos.some((p) => p.ref?.hash === hash)) {
            room.photos.splice(room.photos.indexOf(entry), 1);
            entry.el?.remove();
            continue;
          }
          entry.ref = {
            hash,
            name: entry.file.name,
            mime: entry.file.type,
            imported: new Date().toISOString(),
            sourceModified: entry.file.lastModified
              ? new Date(entry.file.lastModified).toISOString()
              : "",
            captured: "",
          };
        }
        count(room);
        result.push({
          ...room.base,
          room: v["room" + i] ?? "",
          condition: v["cond" + i] || "Not inspected",
          notes: v["note" + i] ?? "",
          photos: room.photos.map((p) => p.ref),
        });
      }
      return result;
    };
    /* "Follow up by" keeps one linked reminder on the to-do list, until the owner marks it done. */
    const followUp = (record) => {
      if (!record.due) return null;
      const taskId = "inspection-follow-up-" + record.id,
        prior = get(taskId);
      if (prior?.completed) return null;
      return {
        ...(prior || {}),
        type: "task",
        id: taskId,
        title: "Follow up: " + record.title,
        kind: prior?.kind || "Reminder",
        due: record.due,
        notes: prior?.notes ?? "Added from an inspection.",
        completed: false,
        inspectionId: record.id,
      };
    };
    const persist = async (complete) => {
      const rows = await read();
      view.check();
      const record = {
        ...(old || {}),
        ...temp,
        id: inspectionId,
        items: rows,
        completed: complete,
        immutable: complete,
        completedAt: complete ? new Date().toISOString() : "",
      };
      if (from) record.previousId = from.id;
      const reminder = followUp(record);
      if (reminder)
        await view.batch([{ ...record, type: "inspection" }, reminder]);
      else await view.save("inspection", record);
      saved = true;
      await view.finish(
        complete
          ? "Inspection finished and locked"
          : "Inspection saved. Finish it any time from Tasks.",
      );
    };
    const saveDraft = view.run(() => persist(false));
    f.onsubmit = (e) => {
      e.preventDefault();
      if (e.submitter?.value !== "complete") return saveDraft(e);
      confirmText();
      asking(true);
      $("check-complete").focus();
    };
    $("check-back").onclick = () => {
      asking(false);
      f.querySelector("button[value=complete]").focus();
    };
    $("check-complete").onclick = view.run(async () => {
      if (!f.reportValidity()) return;
      await persist(true);
    });
  }
  /* A finished room: its condition, note and photo thumbnails. Used by the record and by Compare. */
  function roomSummary(inspectionId, item, n) {
    return (
      `<div class="rc-room-line">${U().status(conditionTone(item.condition), conditionLabel(item.condition))}${item.notes ? `<span>${E(item.notes)}</span>` : ""}</div>` +
      ((item.photos || []).length
        ? `<div class="rc-thumbs" data-photos="${E(inspectionId)}" data-room="${n}"></div>`
        : "")
    );
  }
  /* Fills every [data-photos] box under root with thumbnails. A tap opens the photo just below. */
  function showPhotos(view, root, urls) {
    const loaded = new Map();
    const load = async (p) => {
      if (!loaded.has(p.hash)) {
        const blob = await view.file(p.hash),
          url = URL.createObjectURL(blob);
        urls.push(url);
        loaded.set(p.hash, { blob, url });
      }
      return loaded.get(p.hash);
    };
    const tiles = [];
    root.querySelectorAll("[data-photos]").forEach((box) => {
      const photos =
        get(box.dataset.photos)?.items?.[+box.dataset.room]?.photos || [];
      photos.forEach((p, j) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "rc-thumb rc-thumb--view";
        b.setAttribute("aria-expanded", "false");
        b.setAttribute(
          "aria-label",
          `Photo ${j + 1} of ${photos.length}: ${p.name}`,
        );
        b.innerHTML = `<span class="rc-thumb-img">${I("camera", 22)}</span>`;
        box.append(b);
        tiles.push({ b, p, box });
      });
    });
    const close = (keep) =>
      root.querySelectorAll(".rc-photo-full").forEach((full) => {
        if (full === keep) return;
        full.remove();
      });
    for (const { b, p, box } of tiles)
      b.onclick = view.run(async () => {
        const open = b.getAttribute("aria-expanded") === "true";
        close();
        tiles.forEach((t) => t.b.setAttribute("aria-expanded", "false"));
        if (open) return;
        let photo;
        try {
          photo = await load(p);
        } catch (e) {
          if (e?.name === "AbortError") throw e;
          throw Error(
            "This photo is not on this device. Restore a backup that includes it.",
          );
        }
        const full = document.createElement("div");
        full.className = "rc-photo-full";
        full.innerHTML = `<img alt="${E(p.name)}"><div class="actions rc-actions"><button type="button" data-photo-save>${I("download", 16)}Download</button><button type="button" data-photo-close>Close photo</button></div>`;
        full.querySelector("img").src = photo.url;
        full.querySelector("[data-photo-save]").onclick = () =>
          P().download(photo.blob, p.name);
        full.querySelector("[data-photo-close]").onclick = () => {
          full.remove();
          b.setAttribute("aria-expanded", "false");
          b.focus();
        };
        box.after(full);
        b.setAttribute("aria-expanded", "true");
      });
    (async () => {
      for (const { b, p } of tiles) {
        try {
          const { url } = await load(p);
          const img = new Image();
          img.alt = "";
          img.src = url;
          b.querySelector(".rc-thumb-img").replaceChildren(img);
        } catch (e) {
          if (e?.name === "AbortError") return;
        }
      }
    })();
  }
  function inspectDetail(r) {
    const urls = [],
      original = r.previousId ? get(r.previousId) : null,
      later = rec("inspection").filter((x) => x.previousId === r.id);
    const facts = [
      r.responsibility ? ["Inspected by", r.responsibility] : null,
      day(r.due) ? ["Follow up by", day(r.due)] : null,
    ].filter(Boolean);
    const view = modal(
      r.title,
      `<p class="rc-line">${E(inspectionFacts(r).join(" · "))} ${U().status("ok", "Finished")}</p>` +
        (facts.length
          ? `<dl class="rc-facts">${facts.map(([k, v]) => `<dt>${E(k)}</dt><dd>${E(v)}</dd>`).join("")}</dl>`
          : "") +
        `<div class="index-list" id="inspect-rooms">${(r.items || []).map((item, n) => `<div class="sub-card rc-room"><strong>${E(item.room)}</strong>${roomSummary(r.id, item, n)}</div>`).join("") || '<p class="rc-none">No rooms were recorded.</p>'}</div>` +
        '<p class="ui-help">This record is locked. To change or add something, add a correction. It is saved as a separate inspection linked to this one.</p>' +
        `<div class="actions rc-actions"><button type="button" id="rev-inspect" data-act="inspect-correct" data-id="${E(r.id)}">Add a correction or follow-up</button>${original ? btn("See the original inspection", "inspection", "tasks", "secondary", original.id) : ""}${later.map((x) => btn(x.completed ? "See the correction" : "Continue the correction", "inspection", "tasks", "secondary", x.id)).join("")}</div>`,
      {
        wide: true,
        self: { act: "inspection", id: r.id },
        onClose: () => urls.forEach((u) => URL.revokeObjectURL(u)),
      },
    );
    showPhotos(view, $("inspect-rooms"), urls);
  }
  function compare() {
    /* Oldest first. A correction sorts after the inspection it corrects. */
    const list = rec("inspection")
      .slice()
      .sort(
        (a, b) =>
          String(a.date).localeCompare(String(b.date)) ||
          (b.previousId === a.id ? -1 : a.previousId === b.id ? 1 : 0) ||
          String(a._updatedAt || "").localeCompare(String(b._updatedAt || "")),
      );
    if (list.length < 2)
      return modal(
        "Compare two inspections",
        '<p class="dialog-intro">You need two saved inspections to compare, for example move-in and move-out.</p>',
      );
    const before = list.find((r) => r.kind === "Move-in") || list[0],
      after = list
        .slice()
        .reverse()
        .find((r) => r.id !== before.id),
      urls = [];
    const options = list.map((r) => [
      r.id,
      [
        r.title,
        String(r.title || "").includes(day(r.date)) ? "" : day(r.date),
        r.completed ? "" : "in progress",
      ]
        .filter(Boolean)
        .join(" · "),
    ]);
    const view = modal(
      "Compare two inspections",
      '<p class="dialog-intro">See what changed between two dates, for example move-in and move-out.</p>' +
        `<div class="dialog-split"><div class="rc-side">${U().select({ label: "Before", name: "compare0", options, value: before.id })}<div id="side-0" class="rc-side-line"></div></div><div class="rc-side">${U().select({ label: "After", name: "compare1", options, value: after.id })}<div id="side-1" class="rc-side-line"></div></div></div>` +
        '<div id="compare-rooms" class="index-list"></div>',
      {
        wide: true,
        onClose: () => urls.forEach((u) => URL.revokeObjectURL(u)),
      },
    );
    const key = (name) => String(name || "").trim().toLowerCase();
    const draw = () => {
      const sides = [0, 1].map((v) =>
        get(view.body.querySelector("[name=compare" + v + "]").value),
      );
      sides.forEach((r, v) => {
        const photos = (r?.items || []).reduce(
          (n, i) => n + (i.photos || []).length,
          0,
        );
        $("side-" + v).innerHTML = r
          ? `<span>${E([inspectionLabel(r.kind), plural((r.items || []).length, "room"), photos ? plural(photos, "photo") : "no photos"].join(" · "))}</span>${r.completed ? U().status("ok", "Finished") : U().status("due", "In progress")}`
          : "";
      });
      if (!sides[0] || !sides[1] || sides[0].id === sides[1].id) {
        $("compare-rooms").innerHTML = U().note(
          "info",
          "<p>Choose two different inspections to compare.</p>",
        );
        return;
      }
      // Rooms are lined up by name. A name used twice lines up in the order it was recorded.
      const groups = sides.map((r) => {
        const byName = new Map();
        (r.items || []).forEach((item, n) =>
          byName.set(key(item.room), [
            ...(byName.get(key(item.room)) || []),
            { r, item, n },
          ]),
        );
        return byName;
      });
      const names = [
        ...new Set(
          sides.flatMap((r) => (r.items || []).map((i) => key(i.room))),
        ),
      ];
      const rows = names.flatMap((name) => {
        const a = groups[0].get(name) || [],
          b = groups[1].get(name) || [];
        return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => [
          a[i] || null,
          b[i] || null,
        ]);
      });
      $("compare-rooms").innerHTML =
        rows
          .map((pair) => {
            const changed =
              pair[0] &&
              pair[1] &&
              pair[0].item.condition !== pair[1].item.condition;
            return (
              `<div class="sub-card rc-compare"><div class="rc-compare-head"><strong>${E((pair[0] || pair[1]).item.room)}</strong>${changed ? U().status("due", "Changed") : ""}</div><div class="rc-compare-cols">` +
              pair
                .map(
                  (side, v) =>
                    `<div><span class="rc-compare-label">${v ? "After" : "Before"}</span>${side ? roomSummary(side.r.id, side.item, side.n) : '<p class="rc-none">Not recorded</p>'}</div>`,
                )
                .join("") +
              "</div></div>"
            );
          })
          .join("") || '<p class="rc-none">Neither inspection lists a room.</p>';
      showPhotos(view, $("compare-rooms"), urls);
    };
    view.body
      .querySelectorAll("[name^=compare]")
      .forEach((n) => (n.onchange = draw));
    draw();
  }

  /* ---------- Email to the tenant ---------- */
  const validAddress = (s) => /^[^\s@,;?&#\r\n]+@[^\s@,;?&#\r\n]+$/.test(s);
  /* The address used last for this tenant, otherwise the ones written into their lease. */
  function knownAddress(tenancyId) {
    const last = rec("communication")
      .filter((m) => m.to && (m.tenancyId || "") === (tenancyId || ""))
      .sort((a, b) =>
        String(b._updatedAt || b.planned || "").localeCompare(
          String(a._updatedAt || a.planned || ""),
        ),
      )[0];
    if (last) return last.to;
    const lease = rec("lease")
      .filter((l) => l.tenancyId === tenancyId && Array.isArray(l.tenants))
      .sort((a, b) =>
        String(b._updatedAt || "").localeCompare(String(a._updatedAt || "")),
      )[0];
    return (lease?.tenants || [])
      .map((t) => String(t?.email || "").trim())
      .filter(validAddress)
      .join(", ");
  }
  const greeting = (tenancy) => {
    const name = String(tenancy?.name || "").trim();
    return name && !/tenan|household|famil/i.test(name)
      ? "Hello " + name + ","
      : "Hello,";
  };
  /* The subject and message a starter fills in. "" is the blank starter. */
  function starter(name, tenancy) {
    const s = templates[name],
      hello = greeting(tenancy);
    if (!s) {
      const p = P().prop();
      return {
        subject: "About " + (p?.address || "your home"),
        body: hello + "\n\n\n\nThank you.",
      };
    }
    return {
      subject: s[0],
      body:
        hello +
        "\n\n" +
        s[1] +
        (s[1].startsWith("Thank you") ? "" : "\n\nThank you."),
    };
  }
  function compose(id = "", docId = "") {
    const m = id ? get(id) : null;
    if (id && !m) return P().toast("That email is no longer here.");
    const doc = docId ? get(docId) : null,
      ts = rec("tenancy"),
      index = library(),
      messageId = m?.id || uid();
    const attached = new Set((m?.attachments || []).map((a) => a.id));
    if (doc?.type === "document") attached.add(doc.id);
    /* A document handed over to email goes to the tenant it belongs to, never to whoever is listed first. */
    const docTenant = doc?.type === "document" && ts.some((t) => t.id === doc.tenancyId) ? doc.tenancyId : "";
    let tenancyId = m ? m.tenancyId || "" : docTenant || ts[0]?.id || "";
    const tenancy = () => ts.find((t) => t.id === tenancyId);
    // "Lease to sign" is the starting point only when a lease was just handed over to email.
    let template = m
      ? templates[m.template]
        ? m.template
        : ""
      : doc && ["Lease packet", "Draft lease", "Lease"].includes(kindOf(doc))
        ? "Lease signature request"
        : "";
    const first = starter(template, tenancy());
    const pool = index.heads.slice().sort(newestDoc);
    for (const a of attached) {
      const d = get(a);
      if (d && !pool.includes(d)) pool.push(d);
    }
    pool.sort((a, b) => attached.has(b.id) - attached.has(a.id));
    const limit = 5;
    const view = modal(
      "Email your tenant",
      '<form id="mail-form" class="ui-stack rc"><p class="dialog-intro">Property Manager prepares the email and opens it in your mail app. You press Send there.</p>' +
        (ts.length > 1
          ? U().select({
              label: "Tenant",
              name: "tenancyId",
              options: ts.map((t) => [t.id, t.name]),
              value: tenancyId || ts[0].id,
            })
          : `<input type="hidden" name="tenancyId" value="${E(tenancyId)}">`) +
        U().field({
          label: "To",
          name: "to",
          type: "email",
          value: m ? m.to : knownAddress(tenancyId),
          help: "Your tenant’s email address. Separate two addresses with a comma.",
          attrs: 'multiple autocomplete="email"',
        }) +
        U().seg({
          label: "Start from",
          name: "template",
          value: template,
          options: [
            ["", "Blank"],
            ...Object.keys(templates).map((k) => [k, templateLabels[k]]),
          ],
          help: "Pick one to fill in the subject and message.",
        }) +
        '<div id="mail-swap" hidden></div>' +
        U().field({
          label: "Subject",
          name: "subject",
          value: m?.subject ?? first.subject,
          required: true,
        }) +
        U().textarea({
          label: "Message",
          name: "body",
          value: m?.body ?? first.body,
          rows: 9,
        }) +
        `<fieldset class="ui-group rc-attachments" aria-describedby="attach-help"><legend>Attach documents <span class="ui-opt" id="attach-count"></span></legend><p class="ui-help" id="attach-help">Tick the files to send. The newest version of each file is listed.</p>` +
        (pool.length > limit
          ? '<div class="ui-field"><label for="attach-find">Find a document</label><input type="search" id="attach-find" placeholder="Type part of its name" autocomplete="off"></div>'
          : "") +
        `<div id="attach-list" class="rc-attach-list">${
          pool
            .map(
              (d) =>
                `<label class="rc-attach" data-find="${E([docName(d), d.filename, kindOf(d), d.tags].join(" ").toLowerCase())}"><input type="checkbox" name="attachment" value="${E(d.id)}"${attached.has(d.id) ? " checked" : ""}><span class="rc-attach-text"><b>${E(docName(d))}</b><small>${E(docLine(d))}${index.newer.has(d.id) ? " · earlier version" : ""}</small></span></label>`,
            )
            .join("") ||
          '<p class="rc-none">No documents yet. Add them under Documents and they will be listed here.</p>'
        }</div>` +
        '<p class="rc-none" id="attach-none" hidden>No document has that in its name.</p>' +
        (pool.length > limit
          ? `<div><button type="button" id="attach-all">Show all ${pool.length} documents</button></div>`
          : "") +
        "</fieldset>" +
        U().more(
          "More options",
          U().field({
            label: "Send on",
            name: "planned",
            type: "date",
            value: m?.planned || today(),
            help: "Leave as today to send now. Pick a later day and Home will remind you.",
          }),
          Boolean(m?.planned && m.planned > today()),
        ) +
        '<div class="ui-foot"><button type="submit" value="draft" class="rc-plain">Save as draft</button><button type="submit" value="ready">Review and send</button></div></form>',
      { key: "mail-" + (id || docId || "new") },
    );
    const f = $("mail-form"),
      rows = [...f.querySelectorAll(".rc-attach")];
    openFilled(f);
    /* Five documents are listed, plus any that are ticked or match the search box. */
    let showAll = false;
    const syncAttach = () => {
      const q = ($("attach-find")?.value || "").trim().toLowerCase();
      let ticked = 0,
        shown = 0;
      rows.forEach((row, i) => {
        const on = row.querySelector("input").checked;
        if (on) ticked++;
        const visible = q
          ? on || row.dataset.find.includes(q)
          : showAll || on || i < limit;
        row.hidden = !visible;
        if (visible) shown++;
      });
      $("attach-count").textContent = ticked
        ? "(" + ticked + " attached)"
        : "(none attached)";
      $("attach-none").hidden = !rows.length || shown > 0;
      if ($("attach-all")) $("attach-all").hidden = showAll || Boolean(q);
    };
    if ($("attach-find")) $("attach-find").oninput = syncAttach;
    if ($("attach-all"))
      $("attach-all").onclick = () => {
        showAll = true;
        syncAttach();
        rows[limit]?.querySelector("input").focus();
      };
    syncAttach();
    /* A starter fills the subject and message only while they still hold starter text.
       Text the owner typed is replaced only after they say so. */
    const starters = (t) =>
      ["", ...Object.keys(templates)].map((n) => starter(n, t));
    const untouched = (t) => {
      const all = starters(t),
        subject = f.elements.subject.value.trim(),
        body = f.elements.body.value.trim();
      return (
        (!subject || all.some((x) => x.subject === subject)) &&
        (!body || all.some((x) => x.body.trim() === body))
      );
    };
    const fill = (name) => {
      const text = starter(name, tenancy());
      f.elements.subject.value = text.subject;
      f.elements.body.value = text.body;
      template = name;
    };
    const swap = $("mail-swap");
    const settle = () => {
      swap.hidden = true;
      swap.innerHTML = "";
    };
    f.addEventListener("change", (e) => {
      const el = e.target;
      if (el.name === "attachment") syncAttach();
      else if (el.name === "tenancyId") {
        // A different tenant gets their own greeting and address, unless the owner already wrote their own.
        const was = tenancy(),
          fresh = untouched(was),
          to = f.elements.to;
        tenancyId = el.value;
        if (fresh) fill(template);
        if (!to.value.trim() || to.value === knownAddress(was?.id || ""))
          to.value = knownAddress(tenancyId);
      } else if (el.name === "template") {
        if (untouched(tenancy())) {
          settle();
          fill(el.value);
          return;
        }
        const wanted = el.value;
        swap.hidden = false;
        swap.innerHTML = U().note(
          "warn",
          `<p>Replace what you typed with the “${E(templateLabels[wanted] || "Blank")}” text?</p><div class="rc-confirm-actions"><button type="button" data-swap="keep">Keep my text</button><button type="button" data-swap="replace">Replace</button></div>`,
        );
        swap.querySelector('[data-swap="keep"]').onclick = () => {
          f.elements.template.value = template;
          settle();
          f.querySelector('[name="template"]:checked')?.focus();
        };
        swap.querySelector('[data-swap="replace"]').onclick = () => {
          fill(wanted);
          settle();
          f.elements.body.focus();
        };
      }
    });
    f.onsubmit = view.run(async (e) => {
      e.preventDefault();
      const ready = e.submitter?.value === "ready",
        v = formValues(f),
        refs = [...f.querySelectorAll("[name=attachment]:checked")]
          .map((c) => get(c.value))
          .filter(Boolean)
          .map((d) => ({
            id: d.id,
            hash: d.hash,
            name: d.name,
            mime: d.mime,
            version: d.version || 1,
          }));
      delete v.attachment;
      v.template = templates[v.template] ? v.template : "";
      if (ready && (!v.to || !v.body.trim()))
        throw Error("Add your tenant’s email address and a message first.");
      if (ready && !v.tenancyId)
        throw Error("Choose which tenant this email is for.");
      const saved = await view.save("communication", {
        ...(m || {}),
        id: messageId,
        ...v,
        attachments: refs,
        status: "Draft",
      });
      if (!ready) return view.finish("Draft saved");
      /* The email is saved now, so the words kept for an unfinished form are no longer needed. */
      P().forgetDraft?.();
      await view.refresh();
      message(saved.id);
    });
    if (!f.elements.to.value) f.elements.to.focus({ preventScroll: true });
  }
  async function copyText(text) {
    if (navigator.clipboard?.writeText)
      return navigator.clipboard.writeText(text);
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.className = "rc-sr";
    ($("dialog").open ? $("dialog") : document.body).append(area);
    area.select();
    const done = document.execCommand("copy");
    area.remove();
    if (!done)
      throw Error(
        "Copying is not available here. Select the message and copy it yourself.",
      );
  }
  /* On a phone or tablet the share sheet hands the email and its files to the mail app in one step.
     On a computer the mail app opens by itself and attachments are downloaded for the owner. */
  const shareSheetFirst = () => {
    try {
      return Boolean(
        window.matchMedia?.("(pointer: coarse)").matches &&
          navigator.canShare?.({
            files: [new File(["-"], "check.txt", { type: "text/plain" })],
          }),
      );
    } catch {
      return false;
    }
  };
  // The emails the owner has ticked as checked, until their text or attachments change.
  const checked = new Map();
  const mailContent = (m) =>
    JSON.stringify([
      m.to,
      m.subject,
      m.body,
      (m.attachments || []).map((a) => a.hash),
    ]);
  function message(id, hint = "") {
    let m = get(id);
    if (!m) return;
    const drafts = m.status === "Draft",
      ready = m.status === "Ready",
      handed = m.status === "Handed to mail app/exported",
      sent = m.status === "Sent confirmed by owner",
      before = drafts || ready;
    const refs = m.attachments || [],
      content = mailContent(m),
      share = typeof navigator.share === "function",
      shareFirst = before && share && refs.length > 0 && shareSheetFirst(),
      later = m.planned && m.planned > today(),
      incomplete = !m.to || !String(m.body || "").trim();
    const detail = sent
      ? m.sentAt
        ? "Sent " + localDay(m.sentAt)
        : ""
      : handed
        ? m.handoffAt
          ? "Opened " + localDay(m.handoffAt)
          : ""
        : later
          ? "Send on " + day(m.planned)
          : "";
    const openButton = (label, cls = "") =>
      `<button type="button" id="mail-open"${cls ? ` class="${cls}"` : ""}>${I("mail", 16)}${label}</button>`;
    const shareButton = (label, cls = "") =>
      `<button type="button" id="mail-share"${cls ? ` class="${cls}"` : ""}>${label}</button>`;
    const saveButton = refs.length
      ? '<button type="button" id="mail-download">Download attachments</button>'
      : "";
    const choice = (button, help) =>
      `<div class="rc-choice">${button}<p class="ui-help">${help}</p></div>`;
    /* Beside the main button: the other way to send, and Edit. The rest waits under More options. */
    const others =
      (handed ? openButton("Open again") : "") +
      (shareFirst
        ? openButton("Open in my mail app")
        : !sent && share
          ? shareButton(refs.length ? "Share with attachments" : "Share")
          : "") +
      (sent
        ? saveButton
        : `<button type="button" id="mail-edit" data-act="mail-edit" data-id="${E(m.id)}">Edit</button>`) +
      (drafts ? '<button type="button" id="mail-ready">Send later</button>' : "");
    const view = modal(
      sent
        ? "Email sent"
        : handed
          ? "Email opened in your mail app"
          : "Check before sending",
      `<p class="rc-line"><span id="mail-status">${mailChip(m)}</span> ${E(detail)}</p>` +
        (hint
          ? U().note(
              "info",
              "<p>If your mail app did not open, choose Copy the text under More options and paste it into a new email.</p>",
            )
          : "") +
        (before && incomplete
          ? U().note(
              "warn",
              "<p>This draft is not ready to send. Choose Edit to add an email address and a message.</p>",
            )
          : "") +
        `<dl class="rc-facts"><dt>To</dt><dd>${E(m.to) || '<span class="rc-none">No address yet</span>'}</dd><dt>Subject</dt><dd>${E(m.subject)}</dd></dl>` +
        `<div class="source-lines rc-mail-body">${E(m.body)}</div>` +
        `<div class="rc-block"><h3>Attachments</h3>${
          refs.length
            ? `<ul class="rc-files">${refs.map((a) => `<li>${I("file", 16)}<span>${E(a.name)}</span></li>`).join("")}</ul>` +
              U().more(
                "File details",
                refs
                  .map(
                    (a) =>
                      `<p class="rc-code">${E(a.name)} · version ${Number(a.version) || 1} · fingerprint ${E(String(a.hash).slice(0, 12))}…</p>`,
                  )
                  .join(""),
              )
            : '<p class="rc-none">No attachments.</p>'
        }</div>` +
        (before && !refs.length && /\battach/i.test(m.body || "")
          ? U().note(
              "warn",
              "<p>Your message mentions an attachment, but no document is attached.</p>",
            )
          : "") +
        (before
          ? `<div class="rc-check-box" id="mail-check"><label class="check-label"><input id="recipient-ok" type="checkbox"${checked.get(m.id) === content ? " checked" : ""}><span>I’ve checked the address, the message and the attachments.</span></label></div>`
          : "") +
        (handed
          ? '<p class="dialog-intro">Tell us once it has gone, so your record is right.</p>'
          : "") +
        (before
          ? `<div class="rc-send">${shareFirst ? shareButton("Share to my mail app, with attachments", "primary") : openButton("Open in my mail app", "primary")}</div>`
          : handed
            ? '<div class="rc-send"><button type="button" id="mail-sent" class="primary">I’ve sent it</button></div>'
            : "") +
        (others ? `<div class="actions rc-actions">${others}</div>` : "") +
        U().more(
          "More options",
          (sent
            ? ""
            : choice(
                '<button type="button" id="mail-copy">Copy the text</button>',
                "Paste it into an email yourself if your mail app does not open.",
              ) +
              (saveButton
                ? choice(
                    saveButton,
                    "Saves the attached files so you can add them to the email.",
                  )
                : "")) +
            (ready
              ? choice(
                  '<button type="button" id="mail-sent">I’ve sent it</button>',
                  "If you already sent this email another way.",
                )
              : "") +
            choice(
              `<button type="button" id="mail-calendar"${m.planned ? "" : " disabled"}>${I("calendar", 16)}Add to my calendar</button>`,
              m.planned
                ? "Saves a calendar file for " + E(day(m.planned)) + "."
                : "This email has no date. Choose Edit to add one.",
            ) +
            (sent || handed
              ? U().textarea({
                  label: "Notes about the reply",
                  name: "reply",
                  value: m.reply || "",
                  help: "For example what your tenant answered, and when.",
                }) +
                '<div><button type="button" id="reply-save">Save notes</button></div>'
              : ""),
          Boolean(m.reply || hint),
        ) +
        (before
          ? '<p class="ui-help">An email on its own is not formal legal notice. Notices the law requires are tracked in Leases.</p>'
          : ""),
      {
        key: "mail-review-" + id + "-" + (m._rev || m.status),
        self: { act: "message", id },
      },
    );
    /* One tick covers every way of sending, and stays while the email is unchanged. */
    const box = $("recipient-ok");
    if (box)
      box.onchange = () => {
        if (box.checked) checked.set(m.id, content);
        else checked.delete(m.id);
        $("mail-check").querySelector(".ui-error")?.remove();
      };
    const confirmed = () => {
      if (!box || box.checked) return true;
      if (!$("mail-check").querySelector(".ui-error"))
        $("mail-check").insertAdjacentHTML(
          "beforeend",
          '<p class="ui-error" role="alert">Tick the box to confirm you have checked the email.</p>',
        );
      box.focus();
      return false;
    };
    const sendable = () => {
      if (!m.to || !String(m.body || "").trim())
        throw Error("Add your tenant’s email address and a message first.");
      if (!m.tenancyId)
        throw Error("Choose Edit and pick which tenant this email is for.");
    };
    const recipients = () => {
      const list = String(m.to)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!list.length || list.some((s) => !validAddress(s)))
        throw Error("Check the email address. It does not look complete.");
      return list;
    };
    /* Pressing a send button on a draft means it is ready. */
    const markReady = async () => {
      if (m.status !== "Draft") return;
      m = await view.save("communication", { ...m, status: "Ready" });
      await view.refresh();
      if ($("mail-status")) $("mail-status").innerHTML = mailChip(m);
    };
    /* Attachments are read when the review opens, so a later tap on Share can go straight to the share sheet. */
    const attach = { files: null, error: null, loading: null };
    const attachments = async () => {
      if (!attach.loading)
        attach.loading = (async () => {
          const result = [];
          for (const r of refs) {
            let b = null;
            try {
              b = await view.file(r.hash);
            } catch (e) {
              if (e?.name === "AbortError") throw e;
            }
            if (!b)
              throw Error(
                "An attached file is not on this device. Restore a backup that includes it, or choose Edit and remove the attachment.",
              );
            result.push(new File([b], r.name, { type: r.mime || b.type }));
          }
          return result;
        })().then(
          (files) => (attach.files = files),
          (error) => (attach.error = error),
        );
      if (!attach.files && !attach.error) await attach.loading;
      if (attach.error) throw attach.error;
      return attach.files;
    };
    if (refs.length && share && !sent) attachments().catch(() => {});
    const saveFiles = async (files) => {
      if (files.length === 1) P().download(files[0], files[0].name);
      else
        P().download(
          await view.wait(() =>
            P().zip(
              files.map((file, i) => ({
                name: i + 1 + "-" + file.name.replace(/[\\/]/g, "_"),
                data: file,
              })),
            ),
          ),
          "email-attachments.zip",
        );
    };
    /* After the mail app has had its turn, one question settles what happened. */
    const ask = (note) => {
      const q = modal(
        "Did you send it?",
        `<p class="dialog-intro">Your mail app should now show the email, ready to send.${note ? " " + E(note) : ""}</p><div class="rc-answers"><button type="button" id="sent-yes" class="primary">Yes, I sent it</button><button type="button" id="handoff-ok">Not yet, it is open in my mail app</button><button type="button" id="mail-cancel">It did not open</button></div>`,
        { back: { act: "message", id: m.id } },
      );
      const opened = new Date().toISOString();
      $("sent-yes").onclick = q.run(async () => {
        await q.save("communication", {
          ...m,
          status: "Sent confirmed by owner",
          handoffAt: m.handoffAt || opened,
          sentAt: new Date().toISOString(),
        });
        await q.finish("Marked as sent");
      });
      $("handoff-ok").onclick = q.run(async () => {
        await q.save("communication", {
          ...m,
          status: "Handed to mail app/exported",
          handoffAt: opened,
        });
        await q.finish("Saved. Mark it as sent once it has gone.");
      });
      $("mail-cancel").onclick = q.run(() => message(m.id, "retry"));
    };
    if ($("mail-ready"))
      $("mail-ready").onclick = view.run(async () => {
        if (!confirmed()) return;
        sendable();
        await markReady();
        P().toast(
          later
            ? "Saved. Home will remind you on " + shortDay(m.planned) + "."
            : "Saved as ready to send",
        );
        message(m.id);
      });
    if ($("mail-download"))
      $("mail-download").onclick = view.run(async () => {
        const files = await attachments();
        view.check();
        await saveFiles(files);
      });
    if ($("mail-copy"))
      $("mail-copy").onclick = view.run(async () => {
        if (!confirmed()) return;
        await view.wait(() =>
          copyText("To: " + m.to + "\nSubject: " + m.subject + "\n\n" + m.body),
        );
        P().toast("Copied. Paste it into your email.");
      });
    if ($("mail-open"))
      $("mail-open").onclick = view.run(async () => {
        if (!confirmed()) return;
        sendable();
        const to = recipients(),
          files = refs.length ? await attachments() : null;
        view.check();
        await markReady();
        // The mail app cannot be handed files, so they are downloaded for the owner to attach.
        if (files) await saveFiles(files);
        const a = document.createElement("a");
        a.href =
          "mailto:" +
          to.map(encodeURIComponent).join(",") +
          "?subject=" +
          encodeURIComponent(m.subject) +
          "&body=" +
          encodeURIComponent(m.body);
        $("dialog").append(a);
        a.click();
        a.remove();
        ask(files ? "Attach the downloaded files before you send." : "");
      });
    if ($("mail-share"))
      $("mail-share").onclick = view.run(async () => {
        if (!confirmed()) return;
        sendable();
        const packet = {
          title: m.subject,
          text: "To: " + m.to + "\n\n" + m.body,
        };
        if (refs.length) {
          packet.files = attach.files || (await attachments());
          view.check();
          if (!navigator.canShare?.({ files: packet.files }))
            throw Error(
              "These files cannot be shared from this device. Choose Download attachments, then Open in my mail app.",
            );
        }
        try {
          await view.wait(() => navigator.share(packet));
        } catch (e) {
          if (e.name !== "AbortError") throw e;
          view.check();
          await markReady();
          P().toast("Sharing canceled. Nothing was sent.");
          return;
        }
        await markReady();
        ask("");
      });
    if ($("mail-sent"))
      $("mail-sent").onclick = view.run(async () => {
        if (!confirmed()) return;
        await view.save("communication", {
          ...m,
          status: "Sent confirmed by owner",
          sentAt: new Date().toISOString(),
        });
        await view.finish("Marked as sent");
      });
    if ($("reply-save"))
      $("reply-save").onclick = view.run(async () => {
        await view.save("communication", {
          ...m,
          reply: view.body.querySelector("[name=reply]").value,
        });
        await view.finish("Notes saved");
      });
    $("mail-calendar").onclick = view.run(() =>
      calendar(id, m.subject || "Email", m.planned, m.body),
    );
  }
  async function seed(p, t, date) {
    const at = (n) => P().addDays(date, n);
    const sampleFile = P().pdf("Juniper House maintenance estimate", [
      {
        heading: "Synthetic example",
        lines: [
          "Garden maintenance estimate for Juniper House.",
          "Work proposed: inspect irrigation lines and replace worn emitters.",
          "Prepared for demonstration use only. No actual payment is recorded by this file.",
        ],
      },
    ]);
    const hash = await Store.storeBlob("sample", sampleFile);
    const documentId = "sample-garden-estimate";
    return [
      {
        type: "document",
        id: documentId,
        name: "Garden maintenance estimate.pdf",
        filename: "Garden maintenance estimate.pdf",
        kind: "Invoice",
        mime: "application/pdf",
        hash,
        date: at(-3),
        size: sampleFile.size,
        version: 1,
        created: at(-3) + "T12:00:00Z",
        immutable: true,
      },
      {
        type: "task",
        id: "sample-inspection",
        title: "Schedule property inspection",
        kind: "Inspection",
        due: at(3),
        notes: "Coordinate a walk-through with the tenant.",
        completed: false,
      },
      {
        type: "task",
        id: "sample-service",
        title: "Review irrigation estimate",
        kind: "Maintenance",
        due: at(6),
        documentId,
        notes: "Review the garden maintenance estimate before scheduling work.",
        completed: false,
      },
      {
        type: "communication",
        id: "sample-email",
        to: "avery@example.invalid",
        subject: "Lease renewal",
        body: "Hello Avery,\n\nI would like to discuss the upcoming lease renewal. Please let me know a convenient time.\n\nThank you.",
        template: "Renewal",
        tenancyId: t.id,
        status: "Ready",
        planned: date,
        attachments: [],
      },
      {
        type: "inspection",
        id: "sample-checklist",
        title: "Move-in condition record",
        kind: "Move-in",
        date: t.start,
        completed: true,
        immutable: true,
        items: [
          {
            room: "Kitchen",
            condition: "Good",
            notes: "Cabinet doors and fixtures inspected.",
            photos: [],
          },
          {
            room: "Living room",
            condition: "Ordinary wear",
            notes: "Small scuff by entry.",
            photos: [],
          },
        ],
      },
    ].map((x) => ({ ...x, propertyId: p.id }));
  }
  function validate(records, hashes) {
    const map = new Map(records.map((r) => [r.id, r]));
    const validDate = (d) =>
      !d || (typeof d === "string" && Money.model.dateOK(d));
    function check(v, detail) {
      if (!v) throw Error("Workspace validation: " + detail + ".");
    }
    function checkRef(id, types, property) {
      if (!id) return;
      const r = map.get(id);
      check(
        r && types.includes(r.type) && (!property || r.propertyId === property),
        "a linked record is missing or belongs to another property",
      );
    }
    function checkFile(hash) {
      check(
        typeof hash === "string" &&
          /^[0-9a-f]{64}$/.test(hash) &&
          (!hashes || hashes.has(hash)),
        "an original file is missing",
      );
    }
    for (const r of records) {
      if (r.type === "property") {
        check(
          typeof r.name === "string" && r.name.trim(),
          "a property name is missing",
        );
        if (r.timezone) {
          try {
            new Intl.DateTimeFormat("en-US", { timeZone: r.timezone });
          } catch {
            throw Error("An imported property has an unknown time zone.");
          }
        }
      }
      if (r.type === "tenancy") {
        check(
          validDate(r.start) && validDate(r.nextDue) && validDate(r.end),
          "a tenancy date is invalid",
        );
        check(
          [r.rentCents, r.depositCents].every(
            (n) => n == null || (Number.isSafeInteger(n) && n >= 0),
          ),
          "a tenancy amount is invalid",
        );
        const changes = r.rentChanges || [];
        check(
          Array.isArray(changes) &&
            changes.every(
              (x) =>
                x.from &&
                validDate(x.from) &&
                Number.isSafeInteger(x.rentCents) &&
                x.rentCents > 0,
            ),
          "a scheduled rent change is invalid",
        );
      }
      if (r.type === "document") {
        check(
          typeof (r.name || r.filename) === "string",
          "a document name is missing",
        );
        checkFile(r.hash);
        checkRef(r.previousId, ["document"], r.propertyId);
        checkRef(
          r.transactionId,
          ["expense", "deposit", "payment", "writeoff"],
          null,
        );
      }
      if (r.type === "task") {
        check(
          typeof r.title === "string" && validDate(r.due),
          "a task title or date is invalid",
        );
        checkRef(r.documentId, ["document"], r.propertyId);
        checkRef(r.expenseId, ["expense"], null);
      }
      if (r.type === "inspection") {
        check(
          typeof r.title === "string" &&
            r.date &&
            validDate(r.date) &&
            Array.isArray(r.items),
          "an inspection is incomplete",
        );
        checkRef(r.previousId, ["inspection"], r.propertyId);
        checkRef(r.expenseId, ["expense"], null);
        for (const room of r.items) {
          check(
            typeof room.room === "string" && Array.isArray(room.photos || []),
            "a room entry is invalid",
          );
          for (const p of room.photos || []) checkFile(p.hash);
        }
      }
      if (r.type === "communication") {
        check(
          [
            "Draft",
            "Ready",
            "Handed to mail app/exported",
            "Sent confirmed by owner",
          ].includes(r.status) &&
            typeof r.subject === "string" &&
            typeof r.body === "string" &&
            validDate(r.planned),
          "an email record is invalid",
        );
        check(
          Array.isArray(r.attachments || []),
          "a message attachment list is invalid",
        );
        for (const a of r.attachments || []) {
          checkFile(a.hash);
          checkRef(a.id, ["document"], r.propertyId);
          check(
            map.get(a.id)?.hash === a.hash,
            "a message attachment no longer matches its archived version",
          );
        }
      }
    }
  }
  window.Work = {
    seed,
    validate,
    render: (page) => (page === "Documents" ? docs() : tasks()),
    document: documentView,
    /* Actions the shell passes on: from Home tiles, list rows, search, and buttons inside dialogs. */
    open(action, id) {
      const known = (found) =>
        found || P().toast("That is no longer here.");
      if (action === "import") return importFiles();
      if (action === "doc") return documentView(id);
      if (action === "doc-edit")
        return known(get(id)) && metadataForm(get(id));
      if (action === "doc-replace") return importFiles(id);
      if (action === "task-new") return taskForm();
      if (action === "task") return taskForm(id);
      if (action === "task-undo") return taskUndo(id);
      if (action === "inspect-new") return inspectForm();
      if (action === "inspection") return inspectForm(id);
      if (action === "inspect-correct")
        return known(get(id)) && inspectForm(null, get(id));
      if (action === "compare") return compare();
      if (action === "message") return message(id);
      if (action === "mail-edit") return compose(id);
      if (action === "compose") return compose("", id);
      if (action === "outbox") {
        filters.taskTab = "Outbox";
        P().navigate("Tasks", tabRoutes.Outbox);
        return;
      }
      throw Error("That action is not available here.");
    },
  };
})();
