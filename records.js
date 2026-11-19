"use strict";
(() => {
  const P = () => window.PM,
    $ = (id) => document.getElementById(id),
    E = (x) => P().esc(x),
    I = (...a) => window.ico(...a),
    get = (id) => P().get(id),
    rec = (t) => P().records(t),
    today = () => P().today(),
    uid = () => P().uid(),
    field = (...a) => P().field(...a),
    btn = (...a) => P().button(...a);
  // A pending read, save or OS share must belong to the dialog that started it.
  function modal(title, html, options = {}) {
    const dataset = P().dataset(),
      propertyId = P().prop()?.id;
    let open = true,
      busy = false;
    const body = P().modal(title, html, {
      ...options,
      onClose() {
        open = false;
        options.onClose?.();
      },
    });
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
      async finish(msg) {
        try {
          await wait(() => P().refresh());
        } catch (error) {
          if (!current()) return;
          P().close();
          P().toast(msg + ". Reopen this workspace to refresh its list.");
          return;
        }
        P().close();
        P().toast(msg);
      },
    };
  }
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
  const templates = {
    "Lease signature request": [
      "Lease packet for review",
      "Please review the attached lease packet. Please let me know if you have questions before signing.",
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
  const filters = {
    docQuery: "",
    kind: "All types",
    taskTab: "Tasks",
    taskFilter: "Open",
  };
  const typed = (type, data) => ({ type, ...data }),
    opt = (v, sel, label = v) =>
      `<option value="${E(v)}" ${v === sel ? "selected" : ""}>${E(label)}</option>`;
  function select(label, name, entries, value) {
    return `<label class="field">${E(label)}<select name="${E(name)}">${entries.map((e) => (Array.isArray(e) ? opt(e[0], value, e[1]) : opt(e, value))).join("")}</select></label>`;
  }
  function textArea(label, name, value = "") {
    return `<label class="field">${E(label)}<textarea name="${E(name)}">${E(value)}</textarea></label>`;
  }
  function formValues(form) {
    return Object.fromEntries(new FormData(form));
  }
  function actRow(action, id, icon, title, sub, end = "") {
    return `<button class="doc-row" data-act="${E(action)}" data-id="${E(id)}"><span class="row-icon">${I(icon)}</span><span class="row-text"><strong>${E(title)}</strong><small>${E(sub)}</small></span>${end || I("chevron", 15)}</button>`;
  }
  function metadata(r) {
    return [
      r.kind || r.category || "Document",
      r.date,
      r.version > 1 ? "Version " + r.version : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  function docs() {
    const root = P().content();
    root.innerHTML =
      P().heading(
        "Documents",
        "Original files, receipts, and retained agreements.",
        btn("Import files", "import", "plus"),
      ) +
      `<div class="filter-bar"><input type="search" id="vault-search" aria-label="Search documents" placeholder="Search by filename, type, or tag" value="${E(filters.docQuery)}"><select id="vault-kind" aria-label="Document type">${["All types", ...kinds].map((x) => opt(x, filters.kind)).join("")}</select></div><div id="vault-list" class="panel list-panel"></div>`;
    const draw = () => {
      const f = rec("document")
        .filter(
          (d) =>
            (filters.kind === "All types" ||
              (d.kind || d.category) === filters.kind) &&
            [d.name, d.filename, d.notes, d.tags, d.kind, d.date, d.sourcePath]
              .join(" ")
              .toLowerCase()
              .includes(filters.docQuery.toLowerCase()),
        )
        .sort((a, b) =>
          String(b.created || b.date).localeCompare(
            String(a.created || a.date),
          ),
        );
      $("vault-list").innerHTML =
        f
          .map((d) =>
            actRow(
              "doc",
              d.id,
              d.kind === "Receipt" ? "receipt" : "file",
              d.name || d.filename,
              metadata(d),
            ),
          )
          .join("") ||
        '<div class="empty"><h3>No matching files</h3><p>Import an original or change the filters.</p></div>';
    };
    $("vault-search").oninput = (e) => {
      filters.docQuery = e.target.value;
      draw();
    };
    $("vault-kind").onchange = (e) => {
      filters.kind = e.target.value;
      draw();
    };
    draw();
  }
  const formatOf = (name) => {
    const x = name.toLowerCase().split(".").pop();
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
        heic: "image/heic",
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
  async function documentView(id) {
    const d = get(id);
    if (!d) return P().toast("Document unavailable");
    const loading = modal(
      "Opening original",
      '<p role="status">Reading the retained file…</p>',
    );
    return loading.run(async () => {
      const blob = await loading.file(d.hash);
      if (!blob)
        throw Error(
          "Document bytes are missing. Restore a backup containing this original.",
        );
      const associated = [
        ...new Set(
          [
            d.transactionId,
            ...["payment", "expense", "deposit"]
              .flatMap((t) => rec(t))
              .filter((t) => t.attachments?.includes(d.id))
              .map((t) => t.id),
          ].filter(Boolean),
        ),
      ];
      const mime = d.mime || blob.type || formatOf(d.name);
      const safe = new Blob([blob], { type: mime });
      const textPreview = ["text/plain", "text/csv"].includes(mime)
        ? await loading.wait(() => blob.slice(0, 65536).text())
        : null;
      const url = URL.createObjectURL(safe);
      let preview =
        '<p class="notice">Download the original to open it in a compatible application.</p>';
      if (safeImage(mime))
        preview = `<img class="preview-img" src="${url}" alt="Preview of ${E(d.name)}">`;
      else if (mime === "application/pdf")
        preview = `<iframe class="preview-frame" sandbox title="PDF document preview" src="${url}"></iframe>`;
      else if (["text/plain", "text/csv"].includes(mime))
        preview = `<pre class="source-lines">${E(textPreview)}</pre>`;
      modal(
        d.name || d.filename,
        `<div class="meta">${E(metadata(d))}</div><div class="actions"><button class="primary" id="doc-download">${I("download", 16)}Download original</button><button id="doc-version">Add version</button><button id="doc-review">Review metadata</button></div><div style="margin-top:14px">${preview}</div><details><summary>Original file &amp; integrity</summary><p>Original name: ${E(d.filename || d.name)}<br>Imported or generated: ${E(d.created || d._updatedAt)}<br>Available source path: ${E(d.sourcePath || "Unavailable")}<br>File size: ${Math.ceil(blob.size / 1024)} KB<br>SHA-256: ${E(d.hash)}</p>${d.previousId ? btn("View preceding version", "doc", "file", "secondary", d.previousId) : ""}${associated.map((t) => btn("View linked " + (get(t)?.type || "transaction"), "activity", "money", "secondary", t)).join("")}</details>`,
        { wide: true, onClose: () => URL.revokeObjectURL(url) },
      );
      $("doc-download").onclick = () =>
        P().download(safe, d.filename || d.name);
      $("doc-version").onclick = () => importFiles(id);
      $("doc-review").onclick = () => metadataForm(d);
    })();
  }
  function metadataForm(d) {
    const f = `<form id="doc-meta" class="stack">${select("Document type", "kind", kinds, d.kind || d.category)}${field("Relevant date", "date", "date", d.date)}${field("Expiration date", "expiry", "date", d.expiry)}${field("Tags", "tags", "text", d.tags)}${textArea("Review notes", "notes", d.notes)}<p class="meta">Metadata review creates a linked version with the same original bytes.</p><button type="submit">Save reviewed version</button></form>`;
    const view = modal("Review document metadata", f, {
      key: "doc-metadata-" + d.id,
    });
    const versionId = uid();
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
      await view.finish("Reviewed version saved");
    });
  }
  function importFiles(previousId = "") {
    const prior = previousId ? get(previousId) : null;
    const view = modal(
      prior ? "Add document version" : "Import originals",
      `<p>Choose files to review. The vault retains their original bytes and filenames.</p><div class="stack"><label class="field">Select files<input type="file" id="import-files" ${prior ? "" : "multiple"}></label>${!prior && "webkitdirectory" in document.createElement("input") ? '<label class="field">Or choose a folder<input type="file" id="import-folder" webkitdirectory multiple></label>' : ""}<div id="import-review"></div></div>`,
      { wide: true, key: "document-import-" + (prior?.id || "new") },
    );
    const begin = async (files) => {
      if (!files.length) return;
      const out = $("import-review");
      if (files.length > 400)
        throw Error(
          "Review a maximum of 400 files at a time. Select a smaller group.",
        );
      out.textContent = "Checking files and hashes…";
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
          kind: prior?.kind || (safeImage(mime) ? "Photo" : "Other"),
        });
      }
      out.innerHTML = `<form class="stack" id="commit-docs"><h3>Review ${prepared.length} selected file${prepared.length === 1 ? "" : "s"}</h3><p class="meta">Dates and associations are optional. Office and unsupported formats are retained for download. Review originals manually.</p>${prepared.map((r, i) => `<div class="sub-card"><label class="check-label"><input type="checkbox" name="use${i}" ${r.oversize ? "disabled" : r.duplicate && !prior ? "" : "checked"}><strong>${E(r.f.name)}</strong></label><p class="meta">${E(r.f.webkitRelativePath || r.f.name)} · ${Math.ceil(r.f.size / 1024)} KB · ${r.oversize ? "Exceeds 32 MiB limit" : r.duplicate ? "Identical file already seen" : r.mime === "application/octet-stream" ? "Storage only" : "New original"}</p>${r.oversize ? "" : `<div class="form-grid">${select("Type", "kind" + i, kinds, r.kind)}${field("Relevant date", "date" + i, "date", "")}${select("Tenancy link", "tenancy" + i, [["", "Property only"], ...rec("tenancy").map((t) => [t.id, t.name])], prior?.tenancyId || "")}${select("Financial record", "tx" + i, [["", "No transaction link"], ...["expense", "payment", "deposit"].flatMap((t) => rec(t)).map((t) => [t.id, (t.vendor || t.title || t.type) + " · " + t.date + " · " + P().currency(t.amount || 0)])], prior?.transactionId || "")}</div>`}</div>`).join("")}<button type="submit">Import reviewed files</button></form>`;
      $("commit-docs").onsubmit = view.run(async (e) => {
        e.preventDefault();
        const f = e.target,
          v = formValues(f),
          items = [];
        const submit = f.querySelector("[type=submit]");
        submit.disabled = true;
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
              tenancyId: v["tenancy" + i],
              transactionId: v["tx" + i],
              previousId: prior?.id || "",
              version: (prior?.version || 0) + 1,
              immutable: true,
            });
          }
          if (!items.length)
            throw Error("Select at least one file for import.");
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
            items.length +
              " original file" +
              (items.length === 1 ? "" : "s") +
              " saved",
          );
        } finally {
          submit.disabled = false;
        }
      });
    };
    $("import-files").onchange = view.run((e) => begin([...e.target.files]));
    if ($("import-folder"))
      $("import-folder").onchange = view.run((e) => begin([...e.target.files]));
  }
  function tasks() {
    const root = P().content(),
      tab = filters.taskTab;
    root.innerHTML =
      P().heading(
        "Tasks",
        "Plan maintenance, document inspections, and manage correspondence.",
        tab === "Outbox"
          ? btn("Compose email", "compose", "mail")
          : tab === "Inspections"
            ? btn("Start inspection", "inspect-new", "plus")
            : btn("Add task", "task-new", "plus"),
      ) +
      `<div class="tabs" role="group" aria-label="Task views">${["Tasks", "Inspections", "Outbox"].map((n) => `<button data-task-tab="${n}" class="${tab === n ? "active" : ""}" aria-pressed="${tab === n}">${n}</button>`).join("")}</div>` +
      (tab === "Tasks"
        ? `<div class="filter-bar"><label class="field">Show<select id="task-filter">${["Open", "Completed", "All tasks"].map((n) => opt(n, filters.taskFilter)).join("")}</select></label></div><div id="task-list" class="panel list-panel"></div>`
        : tab === "Inspections"
          ? `<div class="actions">${btn("Compare inspections", "compare", "list", "secondary")}</div><div class="panel list-panel">${
              rec("inspection")
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((r) =>
                  actRow(
                    "inspection",
                    r.id,
                    "tasks",
                    r.title,
                    [
                      r.date,
                      r.completed ? "Completed snapshot" : "In progress",
                    ].join(" · "),
                  ),
                )
                .join("") ||
              '<div class="empty"><h3>No inspections yet</h3><p>Start with a room-by-room condition checklist.</p></div>'
            }</div>`
          : `<div class="panel list-panel">${
              rec("communication")
                .sort((a, b) =>
                  String(b.planned).localeCompare(String(a.planned)),
                )
                .map((r) =>
                  actRow(
                    "message",
                    r.id,
                    "mail",
                    r.subject || "Untitled message",
                    `${r.status} · ${r.to || "Recipient needed"} · ${r.planned || "Unscheduled"}`,
                  ),
                )
                .join("") ||
              '<div class="empty"><h3>Your outbox is clear</h3><p>Compose and save a message here, including while offline.</p></div>'
            }</div>`);
    root.querySelectorAll("[data-task-tab]").forEach(
      (b) =>
        (b.onclick = () => {
          filters.taskTab = b.dataset.taskTab;
          tasks();
        }),
    );
    if (tab === "Tasks") {
      const draw = () => {
        $("task-list").innerHTML =
          rec("task")
            .filter(
              (t) =>
                filters.taskFilter === "All tasks" ||
                Boolean(t.completed) === (filters.taskFilter === "Completed"),
            )
            .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"))
            .map((r) =>
              actRow(
                "task",
                r.id,
                r.kind === "Maintenance"
                  ? "tools"
                  : r.kind === "Inspection"
                    ? "tasks"
                    : "calendar",
                r.title,
                [
                  r.kind,
                  r.due ? "Due " + P().fmt(r.due) : "No due date",
                  r.completed ? "Completed" : "Open",
                ].join(" · "),
              ),
            )
            .join("") ||
          '<div class="empty"><h3>No matching tasks</h3><p>Add a task or change the status filter.</p></div>';
      };
      $("task-filter").onchange = (e) => {
        filters.taskFilter = e.target.value;
        draw();
      };
      draw();
    }
  }
  function taskForm(id) {
    const t = id ? get(id) : { id: uid() },
      docs = rec("document"),
      expenses = rec("expense");
    const view = modal(
      id ? "Task details" : "Add task",
      `<form id="task-form" class="stack">${field("Task name", "title", "text", t.title, 'required maxlength="160"')}<div class="form-grid">${select("Type", "kind", categories, t.kind || "Maintenance")}${field("Due date", "due", "date", t.due || today())}${field("Responsible person or vendor", "vendor", "text", t.vendor)}${field("Estimate ($)", "estimate", "number", t.estimate, 'min="0" step=".01"')}${select("Linked invoice or evidence", "documentId", [["", "None"], ...docs.map((d) => [d.id, d.name])], t.documentId)}${select("Linked existing expense", "expenseId", [["", "None"], ...expenses.map((x) => [x.id, x.vendor + " · " + P().currency(x.amount)])], t.expenseId)}</div>${textArea("Notes", "notes", t.notes)}<div class="actions end">${id ? `<button type="button" id="ics">Calendar file</button><button type="button" id="toggle-task">${t.completed ? "Reopen" : "Mark complete"}</button>` : ""}<button type="submit">Save task</button></div></form>`,
      { key: "task-" + (id || "new") },
    );
    const f = $("task-form");
    f.onsubmit = view.run(async (e) => {
      e.preventDefault();
      await view.save("task", { ...t, ...formValues(f) });
      await view.finish("Task saved");
    });
    if (id) {
      $("toggle-task").onclick = view.run(async () => {
        const a = await view.save("task", {
          ...t,
          ...formValues(f),
          completed: !t.completed,
        });
        await view.refresh();
        const confirmation = modal(
          a.completed ? "Task completed" : "Task reopened",
          `<p>${E(t.title)}</p><div class="actions"><button id="task-undo">Undo change</button><button id="task-done" class="primary">Done</button></div>`,
        );
        $("task-undo").onclick = confirmation.run(async () => {
          await confirmation.save("task", { ...a, completed: !!t.completed });
          await confirmation.finish("Previous status restored");
        });
        $("task-done").onclick = P().close;
      });
      $("ics").onclick = () => calendar(t.id, t.title, t.due, t.notes);
    }
  }
  function calendar(id, title, date, notes) {
    if (!date) throw Error("Add a date before exporting a reminder.");
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
      "rental-reminder.ics",
    );
  }
  const inspectionTypes = [
    "Move-in",
    "Preliminary move-out",
    "Move-out",
    "Periodic inspection",
    "Maintenance",
  ];
  const condition = [
    "Not inspected",
    "Good",
    "Ordinary wear",
    "Damage",
    "Needs repair",
    "Disputed",
  ];
  function inspectForm(id) {
    const old = id ? get(id) : null;
    const inspectionId = old?.id || uid();
    if (old?.completed) return inspectDetail(old);
    const defaults = [
      "Entry & living areas",
      "Kitchen & appliances",
      "Bathrooms",
      "Bedrooms",
      "Exterior & grounds",
    ];
    let items = (
      old?.items ||
      defaults.map((room) => ({
        room,
        condition: "Not inspected",
        notes: "",
        photos: [],
      }))
    ).map((r) => ({ ...r, photos: [...(r.photos || [])] }));
    let temp = {
      title: old?.title || "",
      kind: old?.kind || "Move-in",
      date: old?.date || today(),
      responsibility: old?.responsibility || "",
      expenseId: old?.expenseId || "",
      due: old?.due || "",
    };
    const show = () => {
      const view = modal(
        "Inspection checklist",
        `<form id="inspection-form" class="stack"><div class="form-grid">${field("Inspection title", "title", "text", temp.title, "required")}${select("Checklist", "kind", inspectionTypes, temp.kind)}${field("Inspection date", "date", "date", temp.date, "required")}${field("Responsible person", "responsibility", "text", temp.responsibility)}${select("Related invoice expense", "expenseId", [["", "None"], ...rec("expense").map((e) => [e.id, e.vendor || e.purpose || e.date])], temp.expenseId)}${field("Follow-up due date", "due", "date", temp.due)}</div><div id="room-list">${items.map((r, i) => `<div class="sub-card" style="margin:8px 0"><div class="form-grid">${field("Room or item", "room" + i, "text", r.room, "required")}${select("Condition", "cond" + i, condition, r.condition)}</div>${textArea("Findings", "note" + i, r.notes)}<label class="field">Attach photos<input type="file" name="photos${i}" accept="image/*" multiple></label><small>${r.photos.length} retained photo(s)</small></div>`).join("")}</div><button type="button" id="room-add">Add room or item</button><div class="actions end"><button type="submit" value="draft">Save progress</button><button type="submit" value="complete">Complete inspection</button></div></form>`,
        { wide: true, key: "inspection-" + (old?.id || "new") },
      );
      const f = $("inspection-form");
      const read = async () => {
        const v = formValues(f);
        Object.keys(temp).forEach((k) => (temp[k] = v[k]));
        for (const [i, r] of items.entries()) {
          r.room = v["room" + i];
          r.condition = v["cond" + i];
          r.notes = v["note" + i];
          const files = [...f.elements["photos" + i].files];
          for (const file of files) {
            const hash = await view.blob(file);
            if (!r.photos.some((d) => d.hash === hash))
              r.photos.push({
                hash,
                name: file.name,
                mime: file.type,
                imported: new Date().toISOString(),
                sourceModified: file.lastModified
                  ? new Date(file.lastModified).toISOString()
                  : "",
                captured: "",
              });
          }
        }
      };
      $("room-add").onclick = view.run(async () => {
        await read();
        view.check();
        items.push({
          room: "",
          notes: "",
          condition: "Not inspected",
          photos: [],
        });
        show();
      });
      f.onsubmit = view.run(async (e) => {
        e.preventDefault();
        const complete = e.submitter?.value === "complete";
        await read();
        view.check();
        const persist = async (origin) => {
          await origin.save("inspection", {
            ...(old || {}),
            ...temp,
            id: inspectionId,
            items,
            completed: complete,
            immutable: complete,
            completedAt: complete ? new Date().toISOString() : "",
          });
          await origin.finish(
            complete
              ? "Inspection snapshot saved"
              : "Inspection progress saved",
          );
        };
        if (complete) {
          const confirmation = modal(
            "Complete this inspection?",
            `<p>${items.filter((x) => x.condition === "Not inspected").length} item(s) are marked not inspected. Completion retains this version and its evidence.</p><div class="actions"><button id="check-back">Back to checklist</button><button id="check-complete" class="primary">Save completed snapshot</button></div>`,
          );
          $("check-back").onclick = confirmation.run(show);
          $("check-complete").onclick = confirmation.run(() =>
            persist(confirmation),
          );
        } else await persist(view);
      });
    };
    show();
  }
  function inspectionLines(r) {
    return (r.items || [])
      .map(
        (i, n) =>
          `<div class="sub-card"><strong>${E(i.room)}</strong><p>${E(i.condition)}${i.notes ? " · " + E(i.notes) : ""}</p>${(i.photos || []).map((p, j) => `<button data-inspect-photo="${E(r.id)}" data-room="${n}" data-photo="${j}">${I("camera", 15)}${E(p.name)}</button>`).join("")}</div>`,
      )
      .join("");
  }
  function bindPhotos(view) {
    document.querySelectorAll("[data-inspect-photo]").forEach(
      (b) =>
        (b.onclick = view.run(async () => {
          const p = get(b.dataset.inspectPhoto).items[+b.dataset.room].photos[
            +b.dataset.photo
          ];
          const blob = await view.file(p.hash);
          if (blob) P().download(blob, p.name);
          else throw Error("Original image unavailable");
        })),
    );
  }
  function inspectDetail(r) {
    const view = modal(
      r.title,
      `<p>${E(r.kind)} · ${E(r.date)} · Completed snapshot</p><div class="index-list">${inspectionLines(r)}</div><div class="actions"><button id="rev-inspect">Create revision</button></div>`,
      { wide: true },
    );
    bindPhotos(view);
    const revisionId = uid();
    $("rev-inspect").onclick = view.run(async () => {
      const n = await view.save("inspection", {
        id: revisionId,
        title: r.title + " · revision",
        kind: r.kind,
        date: r.date,
        items: r.items,
        previousId: r.id,
        completed: false,
        responsibility: r.responsibility || "",
        expenseId: r.expenseId || "",
        due: r.due || "",
      });
      inspectForm(n.id);
    });
  }
  function compare() {
    const a = rec("inspection");
    if (a.length < 2)
      return modal(
        "Compare inspections",
        "<p>Save at least two inspections for this property to compare findings and original photos.</p>",
      );
    const view = modal(
      "Compare inspections",
      `<div class="dialog-split">${[0, 1]
        .map(
          (v) =>
            `<div>${select(
              v ? "Later inspection" : "Earlier inspection",
              "compare" + v,
              a.map((r) => [r.id, r.title + " · " + r.date]),
              a[v].id,
            )}<div id="side-${v}" class="index-list"></div></div>`,
        )
        .join("")}</div>`,
      { wide: true },
    );
    const draw = () => {
      [0, 1].forEach((v) => {
        $("side-" + v).innerHTML = inspectionLines(
          get(document.querySelector("[name=compare" + v + "]").value),
        );
      });
      bindPhotos(view);
    };
    document
      .querySelectorAll("[name^=compare]")
      .forEach((n) => (n.onchange = draw));
    draw();
  }
  function compose(id = "", docId = "") {
    const m = id ? get(id) : null,
      ds = rec("document"),
      ts = rec("tenancy");
    const current = m?.template || "Lease signature request";
    const attached = (m?.attachments || []).map((a) => a.id);
    const messageId = m?.id || uid();
    if (docId) attached.push(docId);
    const view = modal(
      "Compose tenant email",
      `<form id="mail-form" class="stack"><div class="form-grid">${select("Template", "template", Object.keys(templates), current)}${select("Tenancy", "tenancyId", [["", "Select tenancy"], ...ts.map((t) => [t.id, t.name])], m?.tenancyId || ts[0]?.id || "")}${field("To (email address)", "to", "email", m?.to, "multiple")}${field("Planned date", "planned", "date", m?.planned || today())}</div>${field("Subject", "subject", "text", m?.subject ?? templates[current][0], "required")}${textArea("Message", "body", m?.body ?? templates[current][1])}<details ${docId ? "open" : ""}><summary>Attachment versions (${attached.length} selected)</summary>${ds.map((d) => `<label class="check-label"><input type="checkbox" name="attachment" value="${E(d.id)}" ${attached.includes(d.id) ? "checked" : ""}>${E(d.name)} · v${d.version || 1}</label>`).join("") || "<p>Import documents to attach them here.</p>"}</details><div class="actions end"><button type="submit" value="draft">Save draft</button><button type="submit" value="ready">Review for outbox</button></div></form>`,
      { key: "mail-" + (id || docId || "new") },
    );
    const f = $("mail-form");
    f.elements.template.onchange = (e) => {
      const s = templates[e.target.value];
      f.elements.subject.value = s[0];
      f.elements.body.value = s[1];
    };
    f.onsubmit = view.run(async (e) => {
      e.preventDefault();
      const ready = e.submitter?.value === "ready",
        v = formValues(f),
        refs = [...f.querySelectorAll("[name=attachment]:checked")]
          .map((c) => get(c.value))
          .map((d) => ({
            id: d.id,
            hash: d.hash,
            name: d.name,
            mime: d.mime,
            version: d.version || 1,
          }));
      delete v.attachment;
      if (ready && (!v.to || !v.body.trim() || !v.tenancyId))
        throw Error(
          "Confirm the tenancy, recipient, and message before queueing.",
        );
      const saved = await view.save("communication", {
        ...(m || {}),
        id: messageId,
        ...v,
        attachments: refs,
        status: "Draft",
      });
      if (ready) message(saved.id, true);
      else await view.finish("Email draft saved");
    });
  }
  function message(id, review = false) {
    const m = get(id);
    if (!m) return;
    const drafts = m.status === "Draft",
      ready = m.status === "Ready",
      handed = m.status === "Handed to mail app/exported",
      sent = m.status === "Sent confirmed by owner";
    const refs = m.attachments || [];
    const view = modal(
      "Email review",
      `<p><span class="badge">${E(m.status)}</span></p><p><strong>To</strong> ${E(m.to || "Recipient needed")}<br><strong>Planned</strong> ${E(m.planned || "Unscheduled")}<br><strong>Subject</strong> ${E(m.subject)}</p><div class="source-lines">${E(m.body)}</div><h3>Exact attachment versions</h3>${refs.map((a) => `<p>${E(a.name)} · v${a.version || 1} · ${E(a.hash.slice(0, 12))}…</p>`).join("") || "<p>No attachments.</p>"}${!sent ? '<label class="check-label"><input id="recipient-ok" type="checkbox">I checked the recipient, text, and attachments.</label>' : ""}<div class="actions">${drafts || ready ? '<button id="mail-edit">Edit draft</button>' : ""}${drafts ? '<button id="mail-ready" class="primary">Mark ready</button>' : ""}${ready ? '<button id="mail-open" class="primary">Open email draft</button><button id="mail-copy">Copy email draft</button>' : ""}${ready && navigator.share ? '<button id="mail-share">Share packet</button>' : ""}${refs.length ? '<button id="mail-download">Download attachments</button>' : ""}${ready || handed ? '<button id="mail-sent">Confirm actually sent</button>' : ""}<button id="mail-calendar">Calendar reminder</button></div>${sent || handed ? `<p class="meta">${E(m.handoffAt || "")} ${E(m.sentAt || "")}</p>${textArea("Reply or follow-up notes", "reply", m.reply || "")}<button id="reply-save">Save reply notes</button>` : ""}<p class="meta">Email handoff starts a draft. Add downloaded attachments in your mail app. Required legal service and signature evidence are tracked separately.</p>`,
      { key: "mail-review-" + id + "-" + (m._rev || m.status) },
    );
    const confirm = () => {
      if (!$("recipient-ok")?.checked)
        throw Error("Check the recipient confirmation before handoff.");
    };
    const advance = async (origin, status, extra = {}) => {
      const saved = await origin.save("communication", {
        ...m,
        ...extra,
        status,
      });
      await origin.refresh();
      message(saved.id);
    };
    const files = async () => {
      const result = [];
      for (const r of refs) {
        const b = await view.file(r.hash);
        if (!b)
          throw Error(
            "A selected attachment is missing. Restore its original before sharing.",
          );
        result.push(new File([b], r.name, { type: r.mime || b.type }));
      }
      return result;
    };
    if ($("mail-ready"))
      $("mail-ready").onclick = view.run(async () => {
        confirm();
        if (!m.to || !m.body || !m.tenancyId)
          throw Error(
            "Edit the draft and provide a recipient, tenancy, and body.",
          );
        await advance(view, "Ready");
      });
    if ($("mail-edit")) $("mail-edit").onclick = () => compose(id);
    if ($("mail-download"))
      $("mail-download").onclick = view.run(async () => {
        const ff = await files();
        view.check();
        if (ff.length === 1) P().download(ff[0], ff[0].name);
        else
          P().download(
            await view.wait(() =>
              P().zip(
                ff.map((f, i) => ({
                  name: i + 1 + "-" + f.name.replace(/[\\/]/g, "_"),
                  data: f,
                })),
              ),
            ),
            "email-attachments.zip",
          );
      });
    if ($("mail-copy"))
      $("mail-copy").onclick = view.run(async () => {
        confirm();
        await view.wait(() =>
          navigator.clipboard.writeText(
            "To: " + m.to + "\nSubject: " + m.subject + "\n\n" + m.body,
          ),
        );
        P().toast("Draft copied. Send status unchanged.");
      });
    if ($("mail-open"))
      $("mail-open").onclick = view.run(() => {
        confirm();
        const recipients = m.to
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (
          recipients.some((s) => !/^[^\s@,;?&#\r\n]+@[^\s@,;?&#\r\n]+$/.test(s))
        )
          throw Error("Review the recipient addresses.");
        const a = document.createElement("a");
        a.href =
          "mailto:" +
          recipients.map(encodeURIComponent).join(",") +
          "?subject=" +
          encodeURIComponent(m.subject) +
          "&body=" +
          encodeURIComponent(m.body);
        a.click();
        const handoff = modal(
          "Confirm mail handoff",
          '<p>Did your mail app open the draft? If you canceled, keep the message ready.</p><div class="actions"><button id="mail-cancel">Keep ready</button><button id="handoff-ok" class="primary">Confirm draft opened</button></div>',
        );
        $("mail-cancel").onclick = handoff.run(() => message(id));
        $("handoff-ok").onclick = handoff.run(() =>
          advance(handoff, "Handed to mail app/exported", {
            handoffAt: new Date().toISOString(),
          }),
        );
      });
    if ($("mail-share"))
      $("mail-share").onclick = view.run(async () => {
        confirm();
        const packet = {
          title: m.subject,
          text: "To: " + m.to + "\n\n" + m.body,
        };
        if (refs.length) {
          packet.files = await files();
          view.check();
          if (!navigator.canShare?.({ files: packet.files }))
            throw Error(
              "File sharing is unavailable here. Use Download attachments and Open email draft.",
            );
        }
        try {
          await view.wait(() => navigator.share(packet));
          await advance(view, "Handed to mail app/exported", {
            handoffAt: new Date().toISOString(),
          });
        } catch (e) {
          if (e.name === "AbortError") {
            view.check();
            P().toast("Share canceled. Message remains ready.");
            return;
          }
          throw e;
        }
      });
    if ($("mail-sent"))
      $("mail-sent").onclick = view.run(() => {
        confirm();
        const confirmation = modal(
          "Confirm actual sending",
          `<p>Confirm that you sent “${E(m.subject)}” to ${E(m.to)} from your mail application.</p><div class="actions"><button id="sent-no">Back</button><button id="sent-yes" class="primary">I sent this message</button></div>`,
        );
        $("sent-no").onclick = confirmation.run(() => message(id));
        $("sent-yes").onclick = confirmation.run(() =>
          advance(confirmation, "Sent confirmed by owner", {
            sentAt: new Date().toISOString(),
          }),
        );
      });
    if ($("reply-save"))
      $("reply-save").onclick = view.run(async () => {
        await view.save("communication", {
          ...m,
          reply: document.querySelector("[name=reply]").value,
        });
        await view.finish("Reply notes saved");
      });
    $("mail-calendar").onclick = () =>
      calendar(id, m.subject, m.planned, m.body);
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
        notes: "Coordinate a walk-through with the household.",
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
        subject: "Review renewal email",
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
    open(action, id) {
      if (action === "import") return importFiles();
      if (action === "doc") return documentView(id);
      if (action === "task" || action === "task-new") return taskForm(id);
      if (action === "inspect-new" || action === "inspection")
        return inspectForm(id);
      if (action === "compare") return compare();
      if (action === "message") return message(id);
      if (action === "compose") return compose("", id);
      if (action === "outbox") {
        filters.taskTab = "Outbox";
        P().navigate("Tasks");
        return;
      }
      throw Error("That workspace action is unavailable.");
    },
  };
})();
