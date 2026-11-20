"use strict";
(() => {
  const $ = (id) => document.getElementById(id),
    esc = (value) =>
      String(value ?? "").replace(
        /[&<>"']/g,
        (ch) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[ch],
      );
  const ws = ["Home", "Money", "Leases", "Documents", "Tasks"],
    // What each section is for: [short line for the menu, full line for Help].
    about = {
      Home: [
        "Today at a glance",
        "Today at a glance: rent, bills and anything that needs you.",
      ],
      Money: [
        "Rent, bills, deposits, taxes",
        "Record rent and expenses, track the deposit and get ready for tax time.",
      ],
      Leases: [
        "Write, sign and renew",
        "Write a California lease for a San Diego home, record the signed copy, and renew or amend it later.",
      ],
      Documents: [
        "Files, receipts, photos",
        "Keep receipts, photos, letters and other files in one place.",
      ],
      Tasks: [
        "To-dos, inspections, email",
        "Reminders, inspections and emails to your tenant.",
      ],
    },
    zones = [
      ["America/Los_Angeles", "Pacific"],
      ["America/Denver", "Mountain"],
      ["America/Phoenix", "Arizona"],
      ["America/Chicago", "Central"],
      ["America/New_York", "Eastern"],
      ["America/Anchorage", "Alaska"],
      ["Pacific/Honolulu", "Hawaii"],
    ],
    prefs = {
      get(k) {
        try {
          return localStorage.getItem("propertymanager." + k);
        } catch {
          return null;
        }
      },
      set(k, v) {
        try {
          localStorage.setItem("propertymanager." + k, v);
        } catch {}
      },
    };
  const state = {
    ds: prefs.get("dataset") === "owner" ? "owner" : "sample",
    page: "Home",
    route: "",
    items: [],
    propertyId: null,
    status: {},
    ready: false,
    offline: false,
    period: "",
    chartEnd: "",
    jumpOpen: false,
    scroll: {},
    drafts: new Map(),
    update: null,
    owners: [],
    setupDraft: false,
    query: "",
    helpInstall: false,
    updateNote: "",
  };
  let revTimer,
    activeReturn = null,
    activeMark = "",
    toastTimer,
    dialogKey = "",
    dialogClean = null,
    dialogTouched = false,
    dialogKind = "",
    dialogSelf = null,
    dialogBack = null,
    pendingBack = null;
  const uid = () =>
    crypto.randomUUID?.() ||
    Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) =>
      n.toString(16).padStart(8, "0"),
    ).join("-");
  const prop = () =>
    state.items.find(
      (x) => x.type === "property" && !x._deleted && x.id === state.propertyId,
    );
  const all = (type) =>
    state.items.filter((x) => !x._deleted && (!type || x.type === type));
  function records(type) {
    const rows = all(type).filter((x) =>
      type === "property"
        ? x.id === state.propertyId
        : !x.propertyId || x.propertyId === state.propertyId,
    );
    if (type !== "tenancy" || rows.length < 2) return rows;
    const now = today();
    const rank = (t) =>
      t.end && t.end < now ? 2 : t.start && t.start > now ? 1 : 0;
    return rows.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        String(b.start || "").localeCompare(String(a.start || "")),
    );
  }
  const get = (id) => state.items.find((x) => x.id === id && !x._deleted);
  const today = () => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: prop()?.timezone || "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const v = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    return v.year + "-" + v.month + "-" + v.day;
  };
  const fmt = (d, options = { month: "short", day: "numeric" }) => {
    const parsed = new Date(String(d || "").slice(0, 10) + "T12:00:00Z");
    return Number.isFinite(+parsed)
      ? new Intl.DateTimeFormat("en-US", {
          ...options,
          timeZone: "UTC",
        }).format(parsed)
      : "Date unknown";
  };
  const addDays = (date, n) => {
    const d = new Date(date + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const currency = (c) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: Number(c) % 100 ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(Number(c || 0) / 100);
  // Display helpers. Dates saved as YYYY-MM-DD go through fmt(); saved moments go through when().
  const money = (c) => currency(c).replace("-", "−");
  const longDate = (d) =>
    fmt(d, { month: "short", day: "numeric", year: "numeric" });
  const shortDate = (d) =>
    String(d || "").slice(0, 4) === today().slice(0, 4) ? fmt(d) : longDate(d);
  const monthName = (period) =>
    fmt(period + "-01", { month: "long", year: "numeric" });
  const shift = (period, n) => {
    const d = new Date(period + "-01T12:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + n);
    return d.toISOString().slice(0, 7);
  };
  const periods = () =>
    Array.from({ length: 24 }, (_, j) => shift(today().slice(0, 7), -j));
  const curPeriod = () => state.period || today().slice(0, 7);
  function when(stamp) {
    const d = new Date(stamp),
      now = new Date();
    if (!stamp || !Number.isFinite(+d)) return "";
    const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
    const days = Math.round((midnight(now) - midnight(d)) / 864e5);
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
    });
  }
  /* Read a typed dollar amount into cents. Blank is 0. Accepts "3200", "3,200.50" and "$3,200". */
  function dollars(text, label) {
    const raw = String(text ?? "").replace(/[$,\s]/g, "");
    if (!raw) return 0;
    if (!/^\d{1,8}(\.\d{1,2})?$/.test(raw))
      throw Error(label + " should be a number, for example 1850 or 1850.50.");
    const [whole, part = ""] = raw.split(".");
    return Number(whole) * 100 + Number(part.padEnd(2, "0"));
  }
  /* A short message. The optional second argument adds one button: { label, act, id } runs a
     PM.action; { label, onAction } (or action / onClick) runs the given function. */
  function toast(msg, action) {
    clearTimeout(toastTimer);
    const t = $("toast"),
      run = [action?.onAction, action?.onClick, action?.action].find(
        (f) => typeof f === "function",
      ),
      hide = () => {
        clearTimeout(toastTimer);
        t.className = "";
        toastTimer = setTimeout(() => (t.textContent = ""), 250);
      };
    t.textContent = msg;
    if (action?.label && (action.act || run)) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = action.label;
      if (action.act) {
        b.dataset.act = action.act;
        if (action.id) b.dataset.id = action.id;
      }
      b.addEventListener("click", () => {
        hide();
        if (!action.act) Promise.resolve().then(run).catch(error);
      });
      t.append(b);
    }
    t.className = "show";
    toastTimer = setTimeout(hide, t.lastElementChild ? 9000 : 5200);
  }
  function error(e) {
    const msg =
      e?.name === "QuotaExceededError"
        ? "This device is out of storage space. Free some space or make a backup, then try again."
        : e?.message || String(e);
    if ($("dialog").open) {
      let p = $("dialog-error");
      if (!p) {
        p = document.createElement("p");
        p.id = "dialog-error";
        p.className = "error";
        p.setAttribute("role", "alert");
        $("dialog-body").prepend(p);
      }
      p.textContent = msg;
      p.scrollIntoView({ block: "nearest" });
    } else toast(msg);
  }
  function field(label, name, type = "text", value = "", extra = "") {
    return `<label class="field">${esc(label)}<input type="${esc(type)}" name="${esc(name)}" value="${esc(value)}" ${extra}></label>`;
  }
  function renderIcons(root = document) {
    root
      .querySelectorAll("i[data-icon]")
      .forEach((e) => (e.innerHTML = ico(e.dataset.icon)));
  }
  /* Redraw a piece of the chrome only when it changed, so focus and hover are not lost. */
  const drawn = new WeakMap();
  function setHTML(el, html) {
    if (!el || drawn.get(el) === html) return;
    el.innerHTML = html;
    drawn.set(el, html);
  }
  /* A selector that finds the same control again after its page has been drawn again. */
  function mark(el) {
    if (!el || el === document.body || !el.getAttribute) return "";
    if (el.id) return "#" + CSS.escape(el.id);
    const parts = ["data-act", "data-nav", "data-money", "data-lease", "data-id"]
      .filter((a) => el.hasAttribute(a))
      .map((a) => `[${a}="${CSS.escape(el.getAttribute(a))}"]`);
    return parts.length ? el.tagName.toLowerCase() + parts.join("") : "";
  }
  function captureDraft() {
    const bs = $("dialog-body");
    const values = [
      ...bs.querySelectorAll("input[name],select[name],textarea[name]"),
    ]
      .filter(
        (e) =>
          e.name &&
          !["password", "file"].includes(e.type) &&
          !e.hasAttribute("data-secret") &&
          !/password/.test(e.getAttribute("autocomplete") || ""),
      )
      .map((e) => ({ name: e.name, value: e.value, checked: e.checked }));
    if (values.length && dialogKey) state.drafts.set(dialogKey, values);
  }
  function close() {
    if (dialogKey) state.drafts.delete(dialogKey);
    if (dialogClean) dialogClean();
    dialogClean = null;
    dialogKey = "";
    dialogKind = "";
    dialogSelf = dialogBack = pendingBack = null;
    dialogTouched = false;
    if ($("dialog").open) $("dialog").close();
    const target = activeReturn?.isConnected
      ? activeReturn
      : activeMark
        ? document.querySelector(activeMark)
        : null;
    target?.focus?.({ preventScroll: true });
    activeReturn = null;
    activeMark = "";
  }
  /* Close without saving. What was typed is kept for this session so the form can be reopened. */
  function dismiss() {
    const key = dialogKey,
      typed = dialogTouched;
    if (typed) captureDraft();
    dialogKey = "";
    close();
    if (typed && key && state.drafts.has(key))
      toast("Kept what you typed. Reopen to finish.");
  }
  /* options: wide, key, onClose (existing); back = { act, id } shows a Back button;
     self = { act, id } says how to reopen this dialog, so a dialog opened from inside it can go back. */
  function modal(title, html, options = {}) {
    if (dialogClean) dialogClean();
    dialogClean =
      typeof options?.onClose === "function" ? options.onClose : null;
    const d = $("dialog"),
      wasOpen = d.open;
    if (!wasOpen) {
      activeReturn = document.activeElement;
      activeMark = mark(activeReturn);
    }
    const key =
      state.ds + "|" + state.propertyId + "|" + (options?.key || title);
    if (!wasOpen || key !== dialogKey) dialogTouched = false;
    dialogKey = key;
    let back = options?.back;
    if (back === undefined) {
      const self = options?.self;
      if (pendingBack && self && pendingBack.act === self.act)
        back = dialogBack;
      else back = pendingBack || (wasOpen && !self ? dialogBack : null);
    }
    pendingBack = null;
    dialogBack = back || null;
    dialogSelf = options?.self || null;
    dialogKind = options?.kind || "";
    $("dialog-back").hidden = !dialogBack;
    $("dialog-title").textContent = title;
    $("dialog-body").innerHTML = html;
    d.className = options?.wide || options === "wide" ? "wide" : "";
    renderIcons(d);
    const saved = state.drafts.get(dialogKey);
    if (saved) {
      const pool = [...saved];
      for (const entry of $("dialog-body").querySelectorAll(
        "input[name],select[name],textarea[name]",
      )) {
        if (entry.type === "file" || entry.type === "password") continue;
        const checkable = entry.type === "checkbox" || entry.type === "radio";
        const i = pool.findIndex(
          (s) =>
            s.name === entry.name && (!checkable || s.value === entry.value),
        );
        if (i < 0) continue;
        const prior = pool.splice(i, 1)[0];
        if (checkable) entry.checked = prior.checked;
        else entry.value = prior.value;
      }
    }
    if (!d.open) d.showModal();
    d.scrollTop = 0;
    $("dialog-close").focus({ preventScroll: true });
    return $("dialog-body");
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = String(name).replace(/[\\/:*?"<>|]/g, "_");
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }
  let refreshTicket = 0;
  async function reload() {
    const ds = state.ds,
      ticket = ++refreshTicket;
    const [loaded, status] = await Promise.all([
      Store.list(ds, true),
      Store.status(ds),
    ]);
    if (ds !== state.ds || ticket !== refreshTicket) return;
    state.items = loaded;
    if (!prop()) {
      state.propertyId =
        all("property").find((x) => x.id === prefs.get("property." + state.ds))
          ?.id ||
        all("property")[0]?.id ||
        null;
    }
    state.status = status;
  }
  /* While the sample is open, remember whether the owner already has a rental or an unfinished
     setup, so the sample banner and the first-run screen can offer the right next step. */
  async function loadOwners() {
    if (state.ds !== "sample") {
      state.owners = [];
      state.setupDraft = all("setupdraft").length > 0;
      return;
    }
    const rows = (await Store.list("owner")).filter((x) => !x._deleted);
    state.owners = rows.filter((x) => x.type === "property");
    state.setupDraft = rows.some((x) => x.type === "setupdraft");
  }
  async function batch(items) {
    const ds = state.ds;
    const committed = await Store.save(
      ds,
      items.map((i) => ({
        ...i,
        id: i.id || uid(),
        propertyId:
          i.type === "property"
            ? i.propertyId
            : (i.propertyId ?? state.propertyId),
      })),
    );
    if (ds === state.ds) {
      const m = new Map(state.items.map((x) => [x.id, x]));
      committed.forEach((x) => m.set(x.id, x));
      state.items = [...m.values()];
      clearTimeout(revTimer);
      revTimer = setTimeout(
        () =>
          Store.status(ds)
            .then((s) => {
              if (ds === state.ds) {
                state.status = s;
                rail();
              }
            })
            .catch(error),
        120,
      );
    }
    return committed;
  }
  async function save(type, obj) {
    return (await batch([{ ...obj, type }]))[0];
  }
  async function refresh() {
    await reload();
    render();
  }
  /* The part of the address after "#<section>/". Sections use it for their own pages. */
  function parseHash() {
    const raw = location.hash.replace(/^#/, ""),
      cut = raw.indexOf("/"),
      head = (cut < 0 ? raw : raw.slice(0, cut)).toLowerCase(),
      page = ws.find((n) => n.toLowerCase() === head);
    return {
      page: page || "Home",
      rest: page && cut >= 0 ? raw.slice(cut + 1) : "",
    };
  }
  function route() {
    const at = parseHash();
    return at.page === state.page ? at.rest : "";
  }
  function setRoute(rest = "", options = {}) {
    const clean = String(rest ?? "").replace(/^\/+/, ""),
      hash = "#" + state.page.toLowerCase() + (clean ? "/" + clean : "");
    state.route = clean;
    if (location.hash === hash || (!clean && !location.hash && state.page === "Home"))
      return;
    history[options?.replace ? "replaceState" : "pushState"](null, "", hash);
  }
  const PM = (window.PM = {
    chargeVersions: (tenancyId) =>
      state.items.filter(
        (r) =>
          r.type === "charge" &&
          r.propertyId === state.propertyId &&
          r.tenancyId === tenancyId,
      ),
    records,
    all,
    get,
    prop,
    dataset: () => state.ds,
    save,
    batch,
    blob: (b) => Store.storeBlob(state.ds, b),
    file: (h) => Store.getBlob(state.ds, h),
    today,
    uid,
    esc,
    currency,
    modal,
    close,
    /* Drop the words kept for the open form, for a form that saved its work without closing. */
    forgetDraft() {
      if (dialogKey) state.drafts.delete(dialogKey);
      dialogTouched = false;
    },
    toast,
    refresh,
    el: $,
    content: () => $("content"),
    download,
    pdf: (...a) => Files.pdf(...a),
    zip: (...a) => Files.zip(...a),
    field,
    openDoc: (id) => Work.document(id),
    ico,
    fmt,
    addDays,
    error,
    navigate: (name, rest) =>
      go(name, { rest: typeof rest === "string" ? rest : "" }),
    route,
    setRoute,
    action: act,
    ui: globalThis.UI,
  });
  /* How safe the records are, in plain words. storage.js provides the wording when it can. */
  function backupInfo() {
    const s = state.status || {};
    if (s.summary?.headline) return s.summary;
    try {
      if (typeof Store.describe === "function")
        return Store.describe(s, { dataset: state.ds });
    } catch {}
    if (state.ds === "sample")
      return {
        kind: "muted",
        headline: "Sample property",
        short: "Sample property",
        needsAction: false,
      };
    const done = Boolean(s.lastBackup);
    return {
      kind: done ? "ok" : "due",
      headline: done ? "Backed up" : "Not backed up yet",
      short: done ? "Last backup " + when(s.lastBackup) : "Not backed up yet",
      detail: done ? "" : "Your records exist only on this device.",
      needsAction: !done && all().length > 0,
      action: "backup",
      actionLabel: "Back up now",
    };
  }
  const offlineLine = () =>
    state.offline
      ? "Offline ready"
      : location.protocol === "file:"
        ? "Opened from a file on this computer"
        : "Not saved for offline use yet";
  const statusLine = () =>
    offlineLine() +
    " · " +
    (state.ds === "sample"
      ? "Sample data, nothing here needs a backup"
      : "Saved on this device · " + backupInfo().short);
  function rail() {
    const count = records("task").filter((t) => !t.completed).length,
      p = prop(),
      sample = state.ds === "sample";
    const btn = (name, side) => {
      const on = state.page === name,
        off = !p && name !== "Home";
      return `<button data-nav="${name}" class="${on ? "active" : ""}"${on ? ' aria-current="page"' : ""}${off ? " disabled" : ""} title="${esc(off ? "Set up your rental first" : about[name][0])}">${ico(name.toLowerCase(), 19)}<span class="nav-text"><span>${name}</span>${side ? `<small aria-hidden="true">${about[name][0]}</small>` : ""}</span>${side && name === "Tasks" && count ? `<span class="count">${count}</span>` : ""}</button>`;
    };
    setHTML(
      document.querySelector(".side-nav"),
      ws.map((n) => btn(n, true)).join(""),
    );
    setHTML(
      document.querySelector(".bottom-nav"),
      ws.map((n) => btn(n, false)).join(""),
    );
    $("selected-property").textContent = p?.name || "Add my rental";
    $("sample-tag").hidden = !(sample && p);
    document
      .querySelector(".property-switch")
      .setAttribute(
        "aria-label",
        (p ? p.name + (sample ? " (sample). " : ". ") : "") + "Switch rental",
      );
    const b = backupInfo();
    setHTML(
      $("rail-backup"),
      `<i class="backup-dot ${esc(b.kind || "")}"></i><span><strong>Backup &amp; sync</strong><small>${esc(b.short || b.headline || "")}</small></span>`,
    );
    $("rail-backup").dataset.act = "storage";
    const n = attention().length,
      dot = $("notice-dot");
    dot.hidden = !n;
    dot.textContent = n > 9 ? "9+" : String(n);
    dot.parentElement.setAttribute(
      "aria-label",
      n
        ? `Needs attention: ${n} ${n === 1 ? "item" : "items"}`
        : "Needs attention: nothing right now",
    );
    const banner = $("sample-banner");
    banner.hidden = !(sample && p);
    setHTML(
      banner,
      sample && p
        ? `<p><strong><span class="banner-long">This is a sample rental with made-up data.</span><span class="banner-short">Sample data.</span></strong> Nothing here is yours.</p><div>${
            state.owners.length
              ? '<button type="button" class="primary" data-act="my-rental">Go to my rental</button>'
              : `<button type="button" class="primary" data-act="start-setup">${state.setupDraft ? "Finish setting up my rental" : "Set up my rental"}</button>`
          }</div>`
        : "",
    );
  }
  // The same words the Tasks page uses for each kind of task.
  const taskKind = (kind) =>
    ({ Maintenance: "Repair", Inspection: "Inspection visit" })[kind] ||
    kind ||
    "Reminder";
  /* Everything that is due soon or waiting, overdue first. */
  function attention() {
    const date = today(),
      soon = addDays(date, 30),
      out = [];
    for (const t of records("task")) {
      if (t.completed || !t.due || t.due > soon) continue;
      const late = t.due < date;
      out.push({
        id: t.id,
        title: t.title || "Task",
        sub: `${taskKind(t.kind)} · ${late ? "was due " : "due "}${shortDate(t.due)}`,
        icon:
          t.kind === "Maintenance"
            ? "tools"
            : t.kind === "Inspection"
              ? "tasks"
              : "calendar",
        action: "task",
        date: t.due,
        overdue: late,
      });
    }
    for (const m of records("communication")) {
      if (m.status !== "Ready" || !(m.planned <= date)) continue;
      out.push({
        id: m.id,
        title: m.subject || "Email to your tenant",
        sub: "Email ready to send",
        icon: "mail",
        action: "message",
        date: m.planned || date,
        cta: "Review",
      });
    }
    if (prop()) {
      try {
        const m = Money.home(),
          charges = records("charge"),
          paid = ["payment", "deposit", "writeoff"]
            .flatMap((type) => records(type))
            .filter((t) => t.date <= date),
          left = Money.model.balances(charges, paid),
          unpaid = charges
            .filter((c) => left.get(c.id) > 0)
            .sort((a, b) => a.date.localeCompare(b.date)),
          late = unpaid.filter((c) => c.date < date),
          next = unpaid.find((c) => c.date >= date && c.date <= soon),
          who = (c) => get(c.tenancyId)?.name || "";
        if (late.length)
          out.push({
            id: late[0].id,
            title:
              "Rent is overdue · " +
              money(late.reduce((sum, c) => sum + left.get(c.id), 0)),
            sub:
              late.length === 1
                ? `${fmt(late[0].date, { month: "long" })} rent, due ${shortDate(late[0].date)}`
                : `${late.length} months unpaid, oldest due ${shortDate(late[0].date)}`,
            icon: "money",
            action: "pay-rent",
            date: late[0].date,
            overdue: true,
            cta: "Record payment",
          });
        if (next)
          out.push({
            id: next.id,
            title: `Rent due ${shortDate(next.date)} · ${money(left.get(next.id))}`,
            sub: who(next) ? "From " + who(next) : "Rent due soon",
            icon: "money",
            action: "pay-rent",
            date: next.date,
            cta: "Record payment",
          });
        if (m.credit > 0)
          out.push({
            id: "",
            title: "Payment not yet applied to a month · " + money(m.credit),
            sub: "Choose which month it pays",
            icon: "money",
            action: "credit",
            date,
            cta: "Choose",
          });
      } catch (e) {
        console.warn("Rent reminders unavailable", e);
      }
      const waiting = records("document").filter((d) => d.receiptInbox);
      if (waiting.length)
        out.push({
          id: waiting[0].id,
          title:
            waiting.length === 1
              ? "1 receipt waiting to be entered"
              : waiting.length + " receipts waiting to be entered",
          sub: "Snapped, but not yet saved as an expense",
          icon: "receipt",
          action: "inbox",
          date,
          cta: "Finish",
        });
      /* A lease that is final but not signed by everyone is waiting on the owner. */
      if (typeof globalThis.LeasePackets?.statusFor === "function")
        for (const t of records("tenancy")) {
          let s = null;
          try {
            s = LeasePackets.statusFor(t.id);
          } catch (e) {
            console.warn("Lease reminders unavailable", e);
          }
          if (!s?.pendingPacketId || !["ready", "partly-signed"].includes(s.state))
            continue;
          const label = String(s.label || "Ready to sign");
          out.push({
            id: s.pendingPacketId,
            title: s.activePacketId
              ? label
              : "Lease " + label.charAt(0).toLowerCase() + label.slice(1),
            sub: t.name
              ? "For " + t.name
              : "Record the signed copy when it comes back",
            icon: "leases",
            action: "packet",
            date,
            cta: "Finish signing",
          });
        }
      const b = state.ds === "owner" ? backupInfo() : null;
      if (b?.needsAction)
        out.push({
          id: "",
          title: b.headline,
          sub: b.detail || "Your records exist only on this device.",
          icon: "backup",
          action: b.action || "backup",
          date,
          cta: b.actionLabel || "Back up now",
        });
    }
    return out.sort(
      (a, b) =>
        Number(Boolean(b.overdue)) - Number(Boolean(a.overdue)) ||
        a.date.localeCompare(b.date),
    );
  }
  function heading(title, desc, button = "") {
    return `<div class="workspace-heading"><div><h1>${esc(title)}</h1>${desc ? `<p>${esc(desc)}</p>` : ""}</div>${button}</div>`;
  }
  PM.heading = heading;
  function button(label, action, icon = "plus", cls = "primary", id = "") {
    return `<button type="button" class="${cls}" data-act="${esc(action)}"${id ? ` data-id="${esc(id)}"` : ""}>${ico(icon, 17)}${esc(label)}</button>`;
  }
  PM.button = button;
  function row(r) {
    return `<button type="button" class="attention-row" data-act="${esc(r.action)}" data-id="${esc(r.id)}"><span class="row-icon${r.overdue ? " tint-amber" : ""}">${ico(r.icon)}</span><span class="row-text"><strong>${esc(r.title)}</strong><small>${esc(r.sub)}</small></span>${r.cta ? `<span class="row-cta">${esc(r.cta)}</span>` : ico("chevron", 15)}</button>`;
  }
  function choice(title, desc, act, icon, id = "", current = false) {
    return `<button type="button" class="choice-row${current ? " is-current" : ""}" data-act="${esc(act)}" data-id="${esc(id)}"${current ? ' aria-current="true"' : ""}><span class="row-icon">${ico(icon)}</span><span class="row-text"><strong>${esc(title)}</strong><small>${esc(desc)}</small></span>${ico(current ? "check" : "chevron", current ? 18 : 15)}</button>`;
  }
  function metric(title, amount, foot, action, id = "") {
    return `<button type="button" class="metric" data-act="${esc(action)}"${id ? ` data-id="${esc(id)}"` : ""}><span class="metric-head">${esc(title)}</span><strong>${money(amount)}</strong><span class="metric-foot">${foot}</span><span class="metric-go">${ico("chevron", 15)}</span></button>`;
  }
  /* ---- Tenants and rent, in words ---- */
  const tenantName = (t) =>
    t?.name && t.name !== "Existing tenancy" ? t.name : "Tenant";
  function rentOn(t, date) {
    let rent = t?.rentCents || 0;
    for (const c of [...(t?.rentChanges || [])].sort((a, b) =>
      a.from.localeCompare(b.from),
    ))
      if (c.from <= date) rent = c.rentCents;
    return rent;
  }
  function tenantStatus(t) {
    const now = today();
    if (t.end && t.end < now) return "Moved out " + shortDate(t.end);
    if (t.start && t.start > now) return "Moves in " + shortDate(t.start);
    return "Current tenant";
  }
  const moneyTitle = (r) =>
    r.type === "payment"
      ? r.reverses || r.amount < 0
        ? "Rent returned to the tenant"
        : "Rent payment"
      : r.type === "expense"
        ? r.vendor || "Expense"
        : r.type === "writeoff"
          ? "Unpaid rent forgiven"
          : "Security deposit";
  /* ---- Home ---- */
  function heroCard(p) {
    const now = today(),
      t = records("tenancy")[0],
      gone = Boolean(t?.end && t.end < now),
      rent = t && !gone ? rentOn(t, now) : 0,
      next = t && !gone ? (t.rentChanges || []).find((c) => c.from > now) : null;
    const who = !t
      ? "No tenant added yet"
      : gone
        ? `Vacant. ${tenantName(t)} moved out ${shortDate(t.end)}`
        : t.start && t.start > now
          ? `${tenantName(t)} moves in ${shortDate(t.start)}`
          : tenantName(t) +
            (t.start
              ? ", since " + fmt(t.start, { month: "short", year: "numeric" })
              : "");
    const rentLine = rent
      ? money(rent) +
        " a month" +
        (next
          ? `, then ${money(next.rentCents)} from ${shortDate(next.from)}`
          : "")
      : t && !gone
        ? "Not set yet"
        : "";
    return `<section class="property-hero${state.ds === "sample" ? " is-sample" : ""}" aria-label="This rental"><div class="hero-main"><h2 class="hero-title">${esc(p.name)}</h2><p class="hero-location">${ico("pin", 15)}<span>${esc([p.address, p.city].filter(Boolean).join(", ") || "Address not added yet")}</span></p><dl class="hero-facts"><div><dt>Tenant</dt><dd>${esc(who)}</dd></div>${rentLine ? `<div><dt>Rent</dt><dd>${esc(rentLine)}</dd></div>` : ""}</dl></div><div class="hero-actions"><button type="button" class="hero-btn" data-act="property">Rental details</button>${
      t && !gone
        ? `<button type="button" class="hero-btn" data-act="rent-change">${rent ? "Change rent" : "Set the rent"}</button>`
        : '<button type="button" class="hero-btn" data-act="tenant-add">Add a tenant</button>'
    }</div></section>`;
  }
  /* Three first steps, offered after a rental has been set up until they are done or hidden. */
  function stepsCard(p) {
    if (state.ds !== "owner" || prefs.get("steps." + p.id) !== "1") return "";
    const steps = [
      [
        "payment",
        "",
        "Record a rent payment",
        "When rent comes in",
        records("payment").length > 0,
      ],
      [
        "",
        "Leases",
        "Add the lease",
        "Write one or keep the signed copy",
        records("lease").length + records("leasePacket").length > 0,
      ],
      [
        "backup",
        "",
        "Make a backup",
        "A copy only you can open",
        Boolean(state.status.lastBackup),
      ],
    ];
    if (steps.every((s) => s[4])) return "";
    return `<section class="panel steps-card" aria-labelledby="steps-title"><div class="section-head"><h2 id="steps-title">Next steps</h2><button type="button" class="text-btn" data-act="steps-hide">Hide</button></div><div class="steps-list">${steps
      .map(
        ([a, nav, name, hint, done], i) =>
          `<button type="button" class="step-tile${done ? " is-done" : ""}" ${nav ? `data-nav="${nav}"` : `data-act="${a}"`}><span class="step-mark">${done ? ico("check", 15) : i + 1}</span><span class="row-text"><strong>${name}</strong><small>${done ? "Done" : hint}</small></span></button>`,
      )
      .join("")}</div></section>`;
  }
  function monthCard() {
    const list = periods(),
      now = list[0],
      period = curPeriod(),
      m = Money.home(period),
      bucket = m.monthly.find((x) => x.month === period) || {
        income: 0,
        expenses: 0,
      },
      paid = m.charged > 0 && m.received === m.charged,
      charges = records("charge").filter((c) => c.period === period),
      label = monthName(period),
      status = paid
        ? UI.status("ok", "Paid in full")
        : m.outstanding
          ? UI.status("due", money(m.outstanding) + " still due")
          : m.charged
            ? UI.status("muted", "Settled")
            : UI.status("muted", "No rent due");
    const rentAct =
      charges.length === 1
        ? ["activity", charges[0].id]
        : charges.length
          ? ["rent", ""]
          : ["month", period + "|in"];
    return `<section class="panel" id="home-month" aria-labelledby="home-month-title"><div class="section-head"><h2 id="home-month-title">${period === now ? `This month <span class="meta">${label}</span>` : label}</h2><div class="month-stepper">${period === now ? "" : '<button type="button" class="text-btn" data-act="month-now">This month</button>'}<button type="button" class="icon-button" data-act="month-prev" aria-label="Previous month"${period === list.at(-1) ? " disabled" : ""}>${ico("back", 17)}</button><button type="button" class="icon-button" data-act="month-next" aria-label="Next month"${period === now ? " disabled" : ""}>${ico("chevron", 17)}</button></div></div><div class="stats-grid">${metric("Rent collected", m.received, status, rentAct[0], rentAct[1])}${metric("Expenses", bucket.expenses, "Paid out in " + fmt(period + "-01", { month: "long" }), "month", period + "|out")}${metric("Net income", bucket.income - bucket.expenses, "After expenses", "month", period + "|all")}</div><details class="ui-more month-jump"${state.jumpOpen ? " open" : ""}><summary>Jump to another month</summary><div class="ui-more-body">${UI.select(
      {
        label: "Month",
        name: "period",
        id: "home-period",
        value: period,
        options: list.map((v) => [v, monthName(v)]),
      },
    )}</div></details></section>`;
  }
  function attentionCard() {
    const at = attention();
    return `<section class="panel" id="home-attention" aria-labelledby="home-attention-title"><div class="section-head"><h2 id="home-attention-title">Needs attention${at.length ? ` <span class="count-tag">${at.length}</span>` : ""}</h2>${at.length > 3 ? `<button type="button" class="text-btn" data-act="attention">View all${ico("chevron", 14)}</button>` : ""}</div><div class="attention-list">${
      at.length
        ? at.slice(0, 3).map(row).join("")
        : `<p class="calm-empty">${ico("check", 18)}Nothing needs your attention.</p>`
    }</div></section>`;
  }
  const quick = [
    ["expense", "receipt", "Add expense", "A bill you paid"],
    ["receipt", "camera", "Snap a receipt", "Photo now, details later"],
    ["create", "leases", "Create lease", "California and San Diego"],
    ["cpa", "chart", "Tax packet", "For your accountant"],
    ["import", "documents", "Add document", "Lease, letter or photo"],
    ["task-new", "calendar", "Add reminder", "A to-do with a date"],
    ["inspect-new", "tasks", "Start inspection", "Room-by-room checklist"],
    ["compose", "mail", "Email tenant", "Write it here, then send"],
  ];
  function quickActions() {
    return `<section aria-labelledby="home-quick-title"><div class="overview-toolbar"><h2 id="home-quick-title">Quick actions</h2></div><div class="short-actions">${quick
      .map(
        ([a, i, name, hint]) =>
          `<button type="button" class="action-tile" data-act="${a}" aria-labelledby="qa-${a}" aria-describedby="qa-${a}-hint"><span class="action-icon">${ico(i)}</span><span class="action-name" id="qa-${a}">${name}</span><span class="action-hint" id="qa-${a}-hint">${hint}</span></button>`,
      )
      .join("")}</div></section>`;
  }
  function chartCard() {
    const now = today().slice(0, 7),
      end = state.chartEnd || now,
      period = curPeriod(),
      list = Money.home(end).monthly.slice(-6),
      maxValue = Math.max(
        10000,
        ...list.flatMap((x) => [x.income, x.expenses].map(Math.abs)),
      ),
      step = Math.pow(10, Math.floor(Math.log10(maxValue))),
      max = Math.ceil(maxValue / step) * step,
      picked = list.find((x) => x.month === period);
    const axisVal = (n) =>
      n >= 100000
        ? "$" + (n / 100000).toFixed(n % 100000 ? 1 : 0) + "k"
        : currency(Math.round(n));
    const said = (x) =>
      `${monthName(x.month)}: income ${money(x.income)}, expenses ${money(x.expenses)}`;
    const bars = list
      .map(
        (x) =>
          `<button type="button" class="bar-group" data-act="month-pick" data-id="${esc(x.month)}" aria-pressed="${x.month === period}" aria-label="${esc(said(x))}" title="${esc(said(x))}"><span class="bars"><i style="height:${Math.min(100, (Math.abs(x.income) / max) * 100)}%"></i><i style="height:${Math.min(100, (Math.abs(x.expenses) / max) * 100)}%"></i></span><small>${fmt(x.month + "-01", { month: "short" })}</small></button>`,
      )
      .join("");
    return `<section class="panel" id="home-chart" aria-labelledby="home-chart-title"><div class="section-head"><h2 id="home-chart-title">Income &amp; expenses</h2><div class="legend"><span><i></i>Income</span><span><i class="exp"></i>Expenses</span></div></div><div class="chart-area"><div class="axis" aria-hidden="true"><span>${axisVal(max)}</span><span>${axisVal(max * 0.75)}</span><span>${axisVal(max * 0.5)}</span><span>${axisVal(max * 0.25)}</span><span>$0</span></div><div class="chart-plot">${bars}</div></div><div class="chart-note"><span>${
      picked
        ? esc(said(picked))
        : `Showing the six months to ${esc(monthName(end))}`
    }</span><button type="button" class="text-btn" data-act="month" data-id="${esc(period)}|all">See details${ico("chevron", 14)}</button></div></section>`;
  }
  function activityCard() {
    const rows = Money.home()
      .recent.slice(0, 4)
      .map((a) => {
        const held =
          a.type === "deposit" && !a.signedAmount ? get(a.id)?.amount : 0;
        return `<button type="button" class="activity-row" data-act="activity" data-id="${esc(a.id)}"><span class="row-icon">${ico(a.signedAmount < 0 ? "receipt" : a.type === "deposit" ? "shield" : "money")}</span><span class="row-text"><strong>${esc(a.title)}</strong><small>${shortDate(a.date)} · ${esc(a.category || a.type)}</small></span><span class="amount${a.signedAmount > 0 ? " positive" : ""}">${held ? money(Math.abs(held)) + " held" : (a.signedAmount > 0 ? "+" : "") + money(a.signedAmount)}</span></button>`;
      })
      .join("");
    return `<section class="panel" id="home-activity" aria-labelledby="home-activity-title"><div class="section-head"><h2 id="home-activity-title">Recent activity</h2><button type="button" class="text-btn" data-nav="Money">See all in Money${ico("chevron", 14)}</button></div>${
      rows ||
      `<p class="calm-empty">${ico("money", 18)}Rent and expenses you record will show up here.</p>`
    }</section>`;
  }
  function homeFoot() {
    const b = state.ds === "owner" ? backupInfo() : null;
    return `<div class="home-foot">${ico("shield")}<span id="home-status">${esc(statusLine())}</span>${
      b
        ? b.needsAction && b.action
          ? `<button type="button" class="text-btn" data-act="${esc(b.action)}">${esc(b.actionLabel || "Back up now")}</button>`
          : '<button type="button" class="text-btn" data-act="storage">Backup &amp; sync</button>'
        : ""
    }</div>`;
  }
  function wireHome() {
    const pick = $("home-period"),
      jump = document.querySelector(".month-jump");
    if (pick) pick.onchange = () => setPeriod(pick.value, "#home-period");
    if (jump) jump.ontoggle = () => (state.jumpOpen = jump.open);
  }
  function home() {
    const p = prop(),
      jump = document.querySelector(".month-jump");
    if (!p) return onboarding();
    if (jump) state.jumpOpen = jump.open;
    $("content").innerHTML =
      `<div class="page-heading"><div><div class="eyebrow">${fmt(today(), { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</div><h1>Property overview</h1><p class="page-sub">Rent, bills and to-dos for this rental.</p></div>${button("Record rent", "payment")}</div>` +
      heroCard(p) +
      stepsCard(p) +
      `<div class="two-col">${monthCard()}${attentionCard()}</div>` +
      quickActions() +
      `<div class="two-col">${chartCard()}${activityCard()}</div>` +
      homeFoot();
    wireHome();
  }
  /* Show another month in "This month" and the chart without redrawing the rest of Home. */
  function setPeriod(period, focus) {
    const list = periods(),
      now = list[0];
    if (!list.includes(period)) period = now;
    state.period = period === now ? "" : period;
    const end = state.chartEnd || now;
    if (period > end) state.chartEnd = period === now ? "" : period;
    else if (period < shift(end, -5)) {
      const to = shift(period, 5);
      state.chartEnd = to >= now ? "" : to;
    }
    if (state.page !== "Home" || !prop()) return;
    if (!$("home-month") || !$("home-chart")) return home();
    state.jumpOpen = Boolean(document.querySelector(".month-jump")?.open);
    $("home-month").outerHTML = monthCard();
    $("home-chart").outerHTML = chartCard();
    wireHome();
    const next = [...$("content").querySelectorAll(focus)].find(
      (el) => !el.disabled,
    );
    (next || $("home-month").querySelector("button:not(:disabled)"))?.focus({
      preventScroll: true,
    });
  }
  function onboarding() {
    const card = (act, icon, title, text, primary) =>
      `<button type="button" class="welcome-card${primary ? " is-primary" : ""}" data-act="${act}"><span class="row-icon">${ico(icon)}</span><span class="row-text"><strong>${title}</strong><small>${text}</small></span>${ico("chevron", 16)}</button>`;
    $("content").innerHTML =
      `<div class="welcome"><h1>Welcome. Let’s set up your rental.</h1><p class="page-sub">Everything you enter stays on this device.</p><div class="welcome-cards">${card("setup", "home", state.setupDraft ? "Finish setting up my rental" : "Set up my rental", "Enter your property, tenant and rent. It takes about 2 minutes.", true)}${card("restore", "backup", "Restore from a backup", "Bring back records saved from this or another device.")}${card("sample", "sample", "Look around the sample", "Practice with made-up data. Nothing there affects your records.")}</div></div>`;
  }
  function render() {
    const focused = $("content").contains(document.activeElement)
      ? mark(document.activeElement)
      : "";
    if (!prop()) state.page = "Home";
    rail();
    document.title = state.page + " · Property Manager";
    if (!prop() || state.page === "Home") home();
    else if (state.page === "Money") Money.render();
    else if (state.page === "Leases") Leases.render();
    else Work.render(state.page);
    renderIcons($("content"));
    if (focused && !$("dialog").open)
      $("content").querySelector(focused)?.focus({ preventScroll: true });
  }
  const scrollKey = () => state.ds + "#" + state.page + "/" + state.route;
  /* options: rest (the part after "#<section>/"), push: false to leave history alone, replace. */
  function go(name, options = {}) {
    if (!ws.includes(name)) return;
    if (!prop()) name = "Home";
    if ($("dialog").open) dismiss();
    const rest =
      typeof options.rest === "string" ? options.rest.replace(/^\/+/, "") : "",
      hash = "#" + name.toLowerCase() + (rest ? "/" + rest : "");
    state.scroll[scrollKey()] = window.scrollY;
    state.page = name;
    state.route = rest;
    if (options.push !== false && location.hash !== hash)
      history[options.replace ? "replaceState" : "pushState"](null, "", hash);
    render();
    window.scrollTo(0, state.scroll[scrollKey()] || 0);
    $("content").focus({ preventScroll: true });
  }
  async function properties() {
    const sample = state.ds === "sample",
      mine = sample
        ? (await Store.list("owner")).filter(
            (p) => p.type === "property" && !p._deleted,
          )
        : all("property"),
      demo = sample
        ? prop()?.name
        : (await Store.list("sample")).find(
            (p) => p.type === "property" && !p._deleted,
          )?.name;
    modal(
      "Your rentals",
      `<p class="dialog-intro">Choose which rental to work on.</p>${mine
        .map((p) =>
          choice(
            p.name,
            [p.address, p.city].filter(Boolean).join(", ") || "Your rental",
            sample ? "owner-property" : "select-property",
            "home",
            p.id,
            !sample && p.id === state.propertyId,
          ),
        )
        .join(
          "",
        )}${choice(demo || "Juniper House", "Sample with made-up data", "sample", "sample", "", sample)}${choice(mine.length ? "Add another rental" : "Add my rental", "Enter a property, tenant and rent", "setup", "plus")}${choice("Restore from a backup", "Bring back records saved from this or another device", "owner-restore", "backup")}`,
      { self: { act: "properties" } },
    );
  }
  async function switchTo(ds, id) {
    close();
    state.ds = ds;
    state.propertyId = id || null;
    state.period = state.chartEnd = "";
    state.scroll = {};
    prefs.set("dataset", ds);
    if (id) prefs.set("property." + ds, id);
    await reload();
    if (ds === "sample") await refreshSample();
    if (prop()) await Money.ensure();
    await reload();
    await loadOwners();
    go("Home", { replace: true });
  }
  function property() {
    const p = prop();
    if (!p) return setup();
    const now = today(),
      tenancies = records("tenancy"),
      where =
        [p.address, p.city, p.county && p.county !== p.city ? p.county + " County" : "", p.state]
          .filter(Boolean)
          .join(", ") || "Address not added yet";
    modal(
      p.name,
      `<p class="dialog-intro">Where this rental is and who rents it.</p><h3>Property</h3><div class="detail-row"><p>${esc(where)}${state.ds === "sample" ? ' <span class="sample-tag">Sample</span>' : ""}</p><button type="button" data-act="property-edit">${ico("edit", 16)}Edit</button></div><h3>Tenants</h3>${
        tenancies
          .map((t) => {
            const rent = rentOn(t, now);
            return choice(
              tenantName(t),
              tenantStatus(t) +
                (rent && !(t.end && t.end < now)
                  ? ", " + money(rent) + " a month"
                  : ""),
              "edit-property",
              "user",
              t.id,
            );
          })
          .join("") || '<p class="meta">No tenant added yet.</p>'
      }<div class="actions">${button("Add a new tenant", "new-household", "plus", "secondary")}${button("Leases", "tenancy", "leases", "secondary")}${button("Switch rental", "properties", "building", "secondary")}</div>`,
      { self: { act: "property" } },
    );
  }
  const zoneField = (value) =>
    UI.select({
      label: "Time zone",
      name: "timezone",
      value: value || zones[0][0],
      help: "Used to decide when rent is due or late.",
      options: [
        ...zones.map(([v, l]) => [v, l + " time"]),
        ...(value && !zones.some(([v]) => v === value) ? [[value, value]] : []),
      ],
    });
  function validZone(value) {
    const zone = value || zones[0][0];
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
    } catch {
      throw Error("Choose a time zone from the list.");
    }
    return zone;
  }
  /* Name and address of the rental. Tenants and rent have their own form. */
  function propertyForm() {
    const p = prop(),
      scope = state.ds;
    if (!p) return setup();
    modal(
      "Property details",
      `<form id="property-form" class="ui-stack" novalidate><p class="dialog-intro">The name and address used across the app and on leases.</p>${UI.field({ label: "Name for this rental", name: "name", value: p.name, required: true, attrs: 'maxlength="100" autocomplete="off"' })}${UI.field({ label: "Street address", name: "address", value: p.address, help: "Appears on leases and notices.", attrs: 'autocomplete="off"' })}${UI.more("More options", UI.field({ label: "City", name: "city", value: p.city }) + UI.field({ label: "County", name: "county", value: p.county }) + zoneField(p.timezone))}<div class="ui-foot"><button type="submit">Save</button></div></form>`,
      { key: "property-" + p.id },
    );
    const form = $("property-form");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const submit = e.submitter || form.querySelector("[type=submit]");
      if (form.dataset.busy) return;
      form.dataset.busy = "saving";
      submit.disabled = true;
      try {
        const v = Object.fromEntries(new FormData(form)),
          name = (v.name || "").trim();
        if (!name) throw Error("Give this rental a name.");
        const timezone = validZone(v.timezone);
        if (state.ds !== scope || prop()?.id !== p.id || !form.isConnected)
          throw Error("This form is out of date. Close it and open it again.");
        await batch([
          {
            ...p,
            name,
            address: (v.address || "").trim(),
            city: (v.city || "").trim(),
            county: (v.county || "").trim(),
            timezone,
          },
        ]);
        if (state.ds !== scope || prop()?.id !== p.id) return;
        state.drafts.delete(dialogKey);
        await refresh();
        toast("Property details saved");
        property();
      } catch (err) {
        error(err);
      } finally {
        delete form.dataset.busy;
        submit.disabled = false;
      }
    };
  }
  /* One tenant: name, dates and rent. options.fresh adds a new tenant; options.rent opens "Change the rent". */
  function tenantForm(tenancyId, options = {}) {
    const p = prop(),
      scope = state.ds;
    if (!p) return setup();
    const fresh = Boolean(options.fresh),
      t = fresh ? {} : get(tenancyId) || records("tenancy")[0] || {};
    if (!fresh && !t.id) return tenantForm(null, { fresh: true });
    if (t.id && t.propertyId !== p.id)
      throw Error("That tenant belongs to another rental. Switch rentals first.");
    const now = today(),
      hasCharges = Boolean(t.id && PM.chargeVersions(t.id).length),
      changes = [...(t.rentChanges || [])].sort((a, b) =>
        a.from.localeCompare(b.from),
      ),
      inEffect = changes.filter((c) => c.from <= now).at(-1),
      nextDue = hasCharges
        ? records("charge")
            .filter((c) => c.tenancyId === t.id && c.date >= now)
            .map((c) => c.date)
            .sort()[0] || ""
        : "",
      lastOut = fresh
        ? records("tenancy")
            .map((x) => x.end)
            .filter(Boolean)
            .sort()
            .at(-1)
        : "",
      held = t.id
        ? records("deposit")
            .filter((d) => d.tenancyId === t.id && d.date <= now)
            .reduce((sum, d) => sum + d.amount, 0)
        : 0;
    const who = UI.field({
        label: "Tenant name(s)",
        name: "household",
        value: t.name,
        required: true,
        attrs: 'maxlength="160" autocomplete="off"',
      }),
      moveIn = UI.field({
        label: "Move-in date",
        name: "start",
        type: "date",
        value: fresh ? (lastOut ? addDays(lastOut, 1) : "") : t.start,
      }),
      moveOut = UI.field({
        label: "Move-out date",
        name: "end",
        type: "date",
        value: t.end,
        help: fresh
          ? "Only if it is already known."
          : "Leave blank while the tenant lives there. Rent charges after this date are removed.",
      }),
      firstRent =
        UI.money({
          label: "Monthly rent",
          name: "rent",
          value: t.rentCents ? t.rentCents / 100 : "",
          help: fresh ? "Leave blank to add it later." : "",
        }) +
        UI.field({
          label: "Track rent starting",
          name: "from",
          type: "date",
          value: t.nextDue,
          help: "Rent is tracked from this date on. Earlier months are left out.",
        });
    const body = fresh
      ? `<p class="dialog-intro">Start a new tenant at this rental. Earlier tenants and their records stay available.</p>${who}${moveIn}${firstRent}${UI.money({ label: "Security deposit received", name: "deposit", help: "Recorded as held from today." })}${UI.more("More options", moveOut)}`
      : `<p class="dialog-intro">Who rents this rental, their dates and their rent.</p>${who}${moveIn}${moveOut}${
          hasCharges
            ? `<dl class="fact-list"><div><dt>Current rent</dt><dd>${money(rentOn(t, now))} a month since ${longDate(inEffect?.from || t.nextDue)}</dd></div>${changes
                .filter((c) => c.from > now)
                .map(
                  (c) =>
                    `<div><dt>Scheduled change</dt><dd>${money(c.rentCents)} a month from ${longDate(c.from)}</dd></div>`,
                )
                .join(
                  "",
                )}<div><dt>Security deposit held</dt><dd>${money(held)}</dd><button type="button" class="text-btn" data-act="deposits" data-leave>See it in Money${ico("chevron", 14)}</button></div></dl><details class="ui-more" id="rent-change"${options.rent ? " open" : ""}><summary>Change the rent</summary><div class="ui-more-body">${UI.money({ label: "New monthly rent", name: "rent" })}${UI.field({ label: "Starts on", name: "from", type: "date", value: nextDue, help: "Today or later. Months already charged keep their rent.", attrs: `min="${now}"` })}${
                changes.length
                  ? `<p class="ui-help">Earlier changes: ${changes.map((c) => `${esc(longDate(c.from))}, ${money(c.rentCents)}${c.reason ? " (" + esc(c.reason) + ")" : ""}`).join("; ")}.</p>`
                  : ""
              }</div></details><div id="reason-block" class="ui-stack" hidden>${UI.field({ label: "Why is it changing?", name: "reason", help: "For your records.", attrs: 'maxlength="200" autocomplete="off"' })}<div class="preset-row" role="group" aria-label="Common reasons">${["Lease renewal", "Rent increase notice", "Tenant moved out"].map((x) => `<button type="button" data-reason="${x}">${x}</button>`).join("")}</div></div>`
            : firstRent
        }`;
    modal(
      fresh ? "Add a new tenant" : "Tenant & rent",
      `<form id="rental-details" class="ui-stack" novalidate>${body}<div id="terms-preview" aria-live="polite"></div><div class="ui-foot"><button type="submit">${fresh ? "Add tenant" : "Save rental details"}</button></div></form>`,
      { key: "rental-" + (t.id || p.id + "-new") },
    );
    const form = $("rental-details"),
      submitBtn = form.querySelector("[type=submit]"),
      el = (name) => form.elements[name];
    const commit = async (items) => {
      if (state.ds !== scope || prop()?.id !== p.id || !form.isConnected)
        throw Error("This form is out of date. Close it and open it again.");
      await batch(items);
      if (state.ds !== scope || prop()?.id !== p.id) return;
      await Money.ensure();
      close();
      await refresh();
      toast(fresh ? "Tenant added" : "Changes saved");
    };
    let previewed = false,
      prepared = null,
      fromTouched = Boolean(el("from")?.value);
    const reset = () => {
      previewed = false;
      prepared = null;
      $("terms-preview").replaceChildren();
      submitBtn.textContent = fresh ? "Add tenant" : "Save rental details";
    };
    // Show the reason only when the rent or the move-out date is changing.
    const sync = () => {
      const block = $("reason-block");
      if (block)
        block.hidden = !(
          el("rent").value.trim() || (el("end").value || "") !== (t.end || "")
        );
      if (!hasCharges && !fromTouched && el("from"))
        el("from").value = el("rent").value.trim()
          ? el("start").value || now.slice(0, 7) + "-01"
          : "";
    };
    if (el("from"))
      el("from").addEventListener("input", () => (fromTouched = true));
    form.oninput = () => {
      reset();
      sync();
    };
    form.onclick = (e) => {
      const preset = e.target.closest("[data-reason]");
      if (!preset) return;
      el("reason").value = preset.dataset.reason;
      dialogTouched = true;
      reset();
    };
    sync();
    if (options.rent && hasCharges) el("rent").focus({ preventScroll: true });
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (form.dataset.busy) return;
      form.dataset.busy = "saving";
      submitBtn.disabled = true;
      try {
        if (previewed && prepared) {
          await commit(prepared);
          return;
        }
        const v = Object.fromEntries(new FormData(form)),
          name = (v.household || "").trim(),
          reason = (v.reason || "").trim(),
          rentTyped = (v.rent || "").trim(),
          rent = dollars(v.rent, hasCharges ? "New monthly rent" : "Monthly rent");
        if (!name) throw Error("Enter the tenant’s name.");
        if (v.start && v.end && v.end < v.start)
          throw Error("The move-out date cannot be before the move-in date.");
        if (rentTyped && !rent)
          throw Error("The monthly rent must be more than zero.");
        const updated = {
          ...t,
          id: t.id || uid(),
          type: "tenancy",
          propertyId: p.id,
          unitId: t.unitId || records("unit")[0]?.id || "",
          name,
          start: v.start || "",
          end: v.end || "",
        };
        if (hasCharges) {
          if (rent) {
            if (!v.from) throw Error("Choose the date the new rent starts.");
            if (v.from < now)
              throw Error("A rent change must start today or later.");
            if (!reason)
              throw Error(
                "Add a short reason for the rent change, for your records.",
              );
            if (changes.some((x) => x.from === v.from))
              throw Error(
                "A rent change already starts on that date. Choose another date.",
              );
            updated.rentChanges = [
              ...changes,
              { from: v.from, rentCents: rent, reason },
            ].sort((a, b) => a.from.localeCompare(b.from));
          }
        } else {
          if (Boolean(rent) !== Boolean(v.from))
            throw Error(
              "To track rent, enter both the monthly rent and the first due date, or leave both blank for now.",
            );
          if (rent) {
            updated.rentCents = rent;
            updated.nextDue = v.from;
          }
        }
        if (fresh) {
          updated.depositCents = dollars(v.deposit, "Security deposit");
          updated.depositDate = now;
        }
        const changedSchedule =
          hasCharges && (Boolean(rent) || (v.end || "") !== (t.end || ""));
        if (changedSchedule && !reason)
          throw Error(
            "Add a short reason for the move-out date change, for your records.",
          );
        const terms = changedSchedule
          ? Money.termChanges(t, updated, {
              from: rent ? v.from : "",
              reason,
            })
          : [];
        const items = [updated, ...terms];
        if (changedSchedule) {
          const list =
            terms.find((x) => x.type === "scheduleAdjustment")?.changes || [];
          const said = (c) => {
            const month = monthName(c.period);
            return c.action === "canceled"
              ? `${month} rent charge will be removed`
              : c.action === "reinstated"
                ? `${month} rent charge of ${money(c.newAmount)} will be added back`
                : c.action === "repriced"
                  ? `${month} rent goes from ${money(c.oldAmount)} to ${money(c.newAmount)}`
                  : `${month} rent charge of ${money(c.newAmount)} will be added`;
          };
          $("terms-preview").innerHTML = UI.note(
            "info",
            `<p><strong>Here is what will change</strong></p>${rent ? `<p>Rent becomes ${money(rent)} a month from ${esc(longDate(v.from))}.</p>` : ""}${
              list.length
                ? `<ul>${list.map((c) => `<li>${esc(said(c))}</li>`).join("")}</ul>`
                : "<p>No rent charge already on the books changes.</p>"
            }<p>Choose Confirm schedule change to save it.</p>`,
          );
          prepared = items;
          previewed = true;
          submitBtn.textContent = "Confirm schedule change";
          $("terms-preview").scrollIntoView({ block: "nearest" });
          return;
        }
        await commit(items);
      } catch (err) {
        error(err);
      } finally {
        delete form.dataset.busy;
        submitBtn.disabled = false;
      }
    };
  }
  async function setup() {
    const ds = "owner",
      saved =
        (await Store.list(ds)).find(
          (x) => x.type === "setupdraft" && !x._deleted,
        ) || {},
      d = saved.form || {},
      first = today().slice(0, 7) + "-01";
    modal(
      "Set up my rental",
      `<form id="setup-form" class="ui-stack" novalidate><p class="dialog-intro">Enter what you know now. You can change any of this later.</p><section class="form-part"><h3>The property</h3>${UI.field({ label: "Name for this rental", name: "name", value: d.name, required: true, help: "Just for you, for example Maple Street house.", attrs: 'maxlength="100" autocomplete="off"' })}${UI.field({ label: "Street address", name: "address", value: d.address, help: "Appears on leases and notices.", attrs: 'autocomplete="off"' })}</section><section class="form-part"><h3>The tenant</h3>${UI.field({ label: "Tenant name(s)", name: "household", value: d.household, help: "Who rents it now. Leave blank if it is vacant.", attrs: 'maxlength="160" autocomplete="off"' })}${UI.field({ label: "Move-in date", name: "start", type: "date", value: d.start, help: "An estimate is fine." })}</section><section class="form-part"><h3>Rent and deposit</h3>${UI.money({ label: "Monthly rent", name: "rent", value: d.rent, help: "Leave blank to add it later." })}${UI.field({ label: "Track rent starting", name: "nextDue", type: "date", value: d.nextDue, help: "Rent is tracked from this date on. Earlier months are left out." })}<div id="setup-catchup" class="ui-wide" aria-live="polite"></div>${UI.money({ label: "Security deposit you hold", name: "deposit", value: d.deposit, help: "What you are holding today. Leave blank if none." })}</section>${UI.more("More options", UI.field({ label: "City", name: "city", value: d.city ?? "San Diego", help: "Mailing city." }) + UI.field({ label: "County", name: "county", value: d.county ?? "San Diego" }) + UI.field({ label: "Deposit amount is as of", name: "depositDate", type: "date", value: d.depositDate || today(), help: "Usually today." }) + zoneField(d.timezone) + '<p class="ui-help"><strong>State:</strong> California. This app prepares California leases.</p>')}<div class="ui-foot"><button type="button" class="ui-quiet ui-foot-start" id="save-setup">Finish later</button><button type="submit">Save my rental</button></div></form>`,
      { key: "setup" },
    );
    const f = $("setup-form"),
      rent = f.elements.rent,
      due = f.elements.nextDue;
    const values = () => Object.fromEntries(new FormData(f));
    let dueTouched = Boolean(due.value);
    // Offer this month as the first rent to track once a rent is typed, and say what an old date means.
    const sync = () => {
      if (!dueTouched) due.value = rent.value.trim() ? first : "";
      const back = due.value
        ? (+first.slice(0, 4) - +due.value.slice(0, 4)) * 12 +
          +first.slice(5, 7) -
          +due.value.slice(5, 7)
        : 0;
      setHTML(
        $("setup-catchup"),
        back >= 2
          ? UI.note(
              "warn",
              `<p>That starts ${back} months back. Each of those months will show as unpaid until you record its payment.</p>`,
            )
          : "",
      );
    };
    due.addEventListener("input", () => (dueTouched = true));
    f.addEventListener("input", sync);
    sync();
    $("save-setup").onclick = async () => {
      try {
        await Store.save(ds, [
          {
            ...saved,
            type: "setupdraft",
            id: saved.id || uid(),
            form: values(),
          },
        ]);
        state.setupDraft = true;
        close();
        if (state.ds === "owner") await reload();
        render();
        toast("Saved for later. Choose Set up my rental to finish.");
      } catch (err) {
        error(err);
      }
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      if (f.dataset.saving) return;
      const submit = e.submitter || f.querySelector("[type=submit]");
      try {
        const v = values(),
          name = (v.name || "").trim(),
          tenant = (v.household || "").trim();
        if (!name)
          throw Error(
            "Give your rental a name, for example Maple Street house.",
          );
        const timezone = validZone(v.timezone),
          rentCents = dollars(v.rent, "Monthly rent"),
          depositCents = dollars(v.deposit, "Security deposit");
        if ((v.rent || "").trim() && !rentCents)
          throw Error(
            "The monthly rent must be more than zero. Leave it blank to add it later.",
          );
        if (Boolean(rentCents) !== Boolean(v.nextDue))
          throw Error(
            "To track rent, enter both the monthly rent and the first due date, or leave both blank for now.",
          );
        const id = uid(),
          unitId = uid(),
          items = [
            {
              type: "property",
              id,
              name,
              address: (v.address || "").trim(),
              city: (v.city || "").trim(),
              county: (v.county || "").trim(),
              state: "CA",
              timezone,
            },
            {
              type: "unit",
              id: unitId,
              propertyId: id,
              name: "Residential unit",
            },
          ];
        // A vacant rental has no tenant yet; one can be added later from Rental details.
        if (tenant || v.start || rentCents || depositCents)
          items.push({
            type: "tenancy",
            id: uid(),
            unitId,
            propertyId: id,
            name: tenant || "Tenant",
            rentCents,
            depositCents,
            depositDate: v.depositDate || today(),
            start: v.start || "",
            nextDue: v.nextDue || "",
          });
        if (saved.id) items.push({ ...saved, _deleted: true });
        f.dataset.saving = "true";
        submit.disabled = true;
        try {
          await Store.save(ds, items);
        } finally {
          delete f.dataset.saving;
          submit.disabled = false;
        }
        prefs.set("steps." + id, "1");
        await switchTo(ds, id);
        toast("Your rental is saved");
      } catch (err) {
        error(err);
      }
    };
  }
  function settings() {
    const sample = state.ds === "sample",
      b = backupInfo();
    modal(
      "Settings",
      `<p class="dialog-intro">Your rentals, backups and how the app is installed.</p><h3>My rental</h3>${choice("My rentals", "Switch rental, add one, or open the sample", "properties", "building")}<h3>Backup</h3>${sample ? '<p class="meta">Backups work on your own records, not on the sample.</p>' : ""}${choice("Back up now", "Save a password-protected copy of everything" + (sample ? "" : ". " + (b.short || b.headline)), "backup", "backup")}${choice("Restore from a backup", "Replace what is on this device with a backup file", "restore", "download")}${choice("Combine with another device", "Bring in changes made on your other phone or computer", "merge", "documents")}${choice("Backup & sync", "Backup status, storage used and what changed", "storage", "shield")}<h3>Advanced</h3>${choice("GitHub sync", "Keep an encrypted copy in a private GitHub repository" + (sample ? ". This opens your own records" : ""), "github-sync", "backup")}${choice("California and San Diego legal sources", "The laws the lease builder uses", "rules", "leases")}${choice("Install and use offline", "Works without internet: " + (state.offline ? "yes" : "not yet"), "install", "download")}<h3>Help</h3>${choice("Help", "What each section is for and where your records are kept", "help", "help")}`,
      { self: { act: "settings" } },
    );
  }
  function offlineStatus() {
    if (state.offline) return "Offline ready. The app opens without internet.";
    if (location.protocol === "file:")
      return "Opened from a file on this computer. To use it on a phone or offline, open the app’s web address instead.";
    return state.offlineStatus || "Checking the offline copy…";
  }
  function help(options = {}) {
    if (options.install !== undefined) state.helpInstall = options.install;
    const open = Boolean(state.helpInstall);
    modal(
      "Help",
      `<p class="dialog-intro">What each part of the app is for.</p><dl class="help-list">${ws.map((n) => `<div><span class="row-icon">${ico(n.toLowerCase())}</span><dt>${n}</dt><dd>${about[n][1]}</dd></div>`).join("")}</dl><h3>Where are my records?</h3><p>Saved in this browser on this device. Nothing is uploaded unless you back up or sync.${state.ds === "sample" ? " You are looking at the sample rental now. Its data is made up." : ""}</p><div class="actions">${button("Backup & sync", "storage", "backup", "secondary")}</div><details class="ui-more" id="help-install"${open ? " open" : ""}><summary>Install and use offline</summary><div class="ui-more-body"><p><strong>${esc(offlineStatus())}</strong></p><ol><li>Open this app’s web address in Chrome or Edge on a computer, or in Safari on an iPhone, while you are online.</li><li>On a computer, choose the Install icon in the address bar. On an iPhone, tap Share, then Add to Home Screen.</li><li>Open the installed app once and wait until Home says Offline ready. After that it opens without internet.</li></ol><div class="actions"><button type="button" id="update-check">Check for updates</button>${!state.offline && state.worker ? '<button type="button" id="repair-cache">Fix offline copy</button>' : ""}${state.update ? '<button type="button" class="primary" id="apply-update">Update now</button>' : ""}</div><p id="update-note" class="meta" aria-live="polite">${esc(state.updateNote)}</p></div></details>`,
      {
        kind: "help",
        self: { act: "help" },
        ...(options.redraw ? { back: dialogBack } : {}),
      },
    );
    $("help-install").ontoggle = () =>
      (state.helpInstall = $("help-install").open);
    if ($("repair-cache"))
      $("repair-cache").onclick = () => {
        state.offlineStatus = "Fixing the offline copy…";
        verifyWorker(state.worker, "repair-cache");
        help({ redraw: true });
      };
    $("update-check").onclick = async () => {
      const note = (text) => {
        state.updateNote = text;
        if ($("update-note")) $("update-note").textContent = text;
      };
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (!reg)
          return note(
            "Updates arrive when the app is opened from its web address, not from a file.",
          );
        note("Checking…");
        await reg.update();
        if (reg.waiting) state.update = reg.waiting;
        state.updateNote = state.update
          ? "An update is ready. Choose Update now."
          : "You have the latest version.";
        if (dialogKind === "help") help({ redraw: true });
      } catch {
        note("Could not check just now. Connect to the internet and try again.");
      }
    };
    if ($("apply-update")) $("apply-update").onclick = applyUpdate;
  }
  function applyUpdate() {
    if (!state.update) return;
    state.update.postMessage("activate-update");
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => location.reload(),
      { once: true },
    );
  }
  /* One search result, in words: title, a line of detail, icon and the action that opens it. */
  function found(r) {
    const on = (d) => (d ? longDate(d) : "");
    const join = (...parts) => parts.filter(Boolean).join(" · ");
    switch (r.type) {
      case "payment":
        return [
          moneyTitle(r) + " · " + money(Math.abs(r.amount)),
          join(on(r.date), get(r.tenancyId)?.name),
          "money",
          "activity",
        ];
      case "charge":
        return [
          `Rent due · ${monthName(r.period)} · ${money(r.amount)}`,
          "Due " + on(r.date),
          "calendar",
          "activity",
        ];
      case "expense":
        return [
          moneyTitle(r) + " · " + money(r.amount),
          join("Expense", on(r.date)),
          "receipt",
          "activity",
        ];
      case "deposit":
        return [
          "Security deposit · " + money(Math.abs(r.amount)),
          on(r.date),
          "shield",
          "activity",
        ];
      case "document":
        return [
          r.name || r.filename || "Document",
          join("Document", on(r.date)),
          "file",
          "doc",
        ];
      case "task":
        return [
          r.title || "Task",
          join(r.completed ? "Task, done" : "Task", r.due && "due " + on(r.due)),
          "tasks",
          "task",
        ];
      case "inspection":
        return [
          r.title || "Inspection",
          join("Inspection", on(r.date)),
          "tasks",
          "inspection",
        ];
      case "communication":
        return [
          r.subject || "Email",
          join("Email", on(r.planned || r.date)),
          "mail",
          "message",
        ];
      case "lease":
        return [
          r.name || r.title || "Lease",
          join("Lease", on(r.date)),
          "leases",
          "lease",
        ];
      case "tenancy":
        return [
          tenantName(r),
          join("Tenant", tenantStatus(r)),
          "user",
          "tenant-edit",
        ];
    }
    return null;
  }
  function search() {
    modal(
      "Search",
      '<div class="ui-field"><label for="global-search">Search this rental</label><p class="ui-help" id="global-search-help">Finds payments, expenses, documents, tasks, emails, leases and tenants.</p><input id="global-search" type="search" autocomplete="off" placeholder="Name, amount, date or file name" aria-describedby="global-search-help"></div><div id="search-results" aria-live="polite"></div>',
      { self: { act: "search" } },
    );
    const input = $("global-search");
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      state.query = input.value;
      if (!q) return $("search-results").replaceChildren();
      const hits = records()
        .map((r) => ({ r, d: found(r) }))
        .filter(
          ({ r, d }) =>
            d &&
            [
              d[0],
              d[1],
              r.name,
              r.filename,
              r.title,
              r.date,
              r.subject,
              r.vendor,
              r.purpose,
              r.kind,
              r.period,
              r.category,
              r.notes,
              r.tags,
              Number.isFinite(r.amount) ? (r.amount / 100).toFixed(2) : "",
            ]
              .join(" ")
              .toLowerCase()
              .includes(q),
        )
        .sort((a, b) =>
          String(b.r.date || b.r.due || "").localeCompare(
            String(a.r.date || a.r.due || ""),
          ),
        );
      $("search-results").innerHTML =
        hits
          .slice(0, 35)
          .map(({ r, d }) => choice(d[0], d[1], d[3], d[2], r.id))
          .join("") +
        (hits.length > 35
          ? '<p class="meta">Showing the first 35. Keep typing to narrow it down.</p>'
          : hits.length
            ? ""
            : '<p class="meta">Nothing matches that. Try a name, an amount or a month.</p>');
    };
    input.value = state.query;
    input.oninput = draw;
    draw();
    input.focus();
    input.select();
  }
  function attentionDialog() {
    const list = attention(),
      late = list.filter((x) => x.overdue),
      soon = list.filter((x) => !x.overdue);
    modal(
      "Needs attention",
      `<p class="dialog-intro">What is overdue, due in the next 30 days, or waiting for you.</p>${
        list.length
          ? (late.length
              ? `<h3>Overdue</h3>${late.map(row).join("")}`
              : "") +
            (soon.length
              ? `<h3>Coming up</h3>${soon.map(row).join("")}`
              : "")
          : `<p class="calm-empty">${ico("check", 18)}Nothing needs your attention.</p>`
      }`,
      { self: { act: "attention" } },
    );
  }
  async function act(a, id) {
    if (a === "properties") return properties();
    if (a === "setup" || a === "start-setup") return setup();
    if (a === "my-rental")
      return switchTo("owner", prefs.get("property.owner") || undefined);
    if (a === "sample" || a === "owner-property" || a === "select-property")
      return switchTo(
        a === "sample" ? "sample" : a === "owner-property" ? "owner" : state.ds,
        id,
      );
    // "sync-now" is the one-click reminder: it also starts the sync when the access key is saved.
    if (a === "github-sync" || a === "sync-now") {
      if (state.ds !== "owner") await switchTo("owner");
      return Store.panel("github-sync", { start: a === "sync-now" });
    }
    if (a === "owner-restore") {
      if (state.ds !== "owner") await switchTo("owner");
      return Store.panel("restore");
    }
    if (a === "settings") return settings();
    if (a === "help") return help();
    if (a === "install") return help({ install: true });
    if (a === "update-now") return applyUpdate();
    if (a === "search") return search();
    if (a === "property") return property();
    if (a === "property-edit") return propertyForm();
    if (a === "edit-property" || a === "tenant-edit") return tenantForm(id);
    if (a === "rent-change") return tenantForm(id, { rent: true });
    if (a === "new-household" || a === "tenant-add")
      return tenantForm(null, { fresh: true });
    if (a === "tenancy")
      return id ? Leases.open("household", id) : go("Leases");
    if (a === "attention") return attentionDialog();
    if (a === "pay-rent") return Money.open("payment", id || undefined);
    if (a === "month-prev" || a === "month-next")
      return setPeriod(
        shift(curPeriod(), a === "month-prev" ? -1 : 1),
        `[data-act="${a}"]`,
      );
    if (a === "month-now") return setPeriod("", '[data-act="month-prev"]');
    if (a === "month-pick")
      return setPeriod(id, `[data-act="month-pick"][data-id="${id}"]`);
    if (a === "steps-hide") {
      prefs.set("steps." + state.propertyId, "0");
      return render();
    }
    if (["backup", "restore", "merge", "storage", "history"].includes(a)) {
      // A backup file holds the owner's own records, so these never act on the sample by surprise.
      if (
        state.ds === "sample" &&
        (a === "restore" ||
          a === "merge" ||
          (a === "backup" && state.owners.length))
      )
        await switchTo("owner");
      return Store.panel(a);
    }
    if (["create", "lease", "packet", "rules", "depositReturn"].includes(a))
      return Leases.open(a, id || undefined);
    if (
      [
        "payment",
        "expense",
        "receipt",
        "inbox",
        "cpa",
        "rent",
        "deposits",
        "credit",
        "activity",
        "income",
        "expenses",
      ].includes(a)
    )
      return Money.open(a, id || undefined);
    if (a === "arrears") return Money.open("arrears");
    if (a === "month" || a === "periodExpenses")
      return month(
        (id || curPeriod()) + (a === "periodExpenses" ? "|out" : ""),
      );
    return Work.open(a, id);
  }
  function monthlyRecords(p) {
    const rows = ["payment", "expense", "deposit", "writeoff"]
      .flatMap((type) => all(type))
      .filter(
        (r) =>
          r.date?.slice(0, 7) === p &&
          (p !== today().slice(0, 7) || r.date <= today()) &&
          (r.propertyId === state.propertyId ||
            r.splits?.some((s) => s.propertyId === state.propertyId)),
      );
    return rows.sort((a, b) => b.date.localeCompare(a.date));
  }
  /* One month in detail. key is "YYYY-MM" or "YYYY-MM|in", "|out", "|all". */
  function month(key) {
    const [raw, show = "all"] = String(key || "").split("|"),
      p = /^\d{4}-\d{2}$/.test(raw) ? raw : curPeriod(),
      m = Money.home(p),
      r = m.monthly.find((b) => b.month === p) || { income: 0, expenses: 0 },
      rows = monthlyRecords(p).map((a) => ({
        a,
        v: Money.model.classification(a, state.propertyId),
      })),
      counted = rows.filter(({ v }) => v.income || v.expenses),
      other = rows.filter(({ v }) => !v.income && !v.expenses),
      shown = counted.filter(({ v }) =>
        show === "in" ? v.income : show === "out" ? v.expenses : true,
      );
    const line = ({ a, v }) => {
      const net = v.income - v.expenses,
        cat =
          a.type === "expense"
            ? Money.model.categories[a.splits?.[0]?.category]?.[0] || "Expense"
            : a.type === "payment"
              ? "Rent"
              : a.type === "deposit"
                ? "Security deposit"
                : "Adjustment";
      return `<button type="button" class="activity-row" data-act="activity" data-id="${esc(a.id)}"><span class="row-icon">${ico(a.type === "expense" ? "receipt" : a.type === "deposit" ? "shield" : "money")}</span><span class="row-text"><strong>${esc(moneyTitle(a))}</strong><small>${shortDate(a.date)} · ${esc(cat)}</small></span><span class="amount${net > 0 ? " positive" : ""}">${net ? (net > 0 ? "+" : "") + money(net) : money(Math.abs(a.amount || 0))}</span></button>`;
    };
    const pill = (value, label) =>
      `<button type="button" data-act="month" data-id="${p}|${value}" aria-pressed="${show === value}">${label}</button>`;
    const box = (label, amount) =>
      `<div class="sub-card"><small>${label}</small><strong>${money(amount)}</strong></div>`;
    modal(
      monthName(p),
      `<p class="dialog-intro">Money in and out of this rental for the month.</p><div class="index-list is-three">${box("Money in", r.income)}${box("Money out", r.expenses)}${box("Net income", r.income - r.expenses)}</div><h3>What makes up these numbers</h3><div class="filter-pills" role="group" aria-label="Show">${pill("all", "Everything")}${pill("in", "Money in")}${pill("out", "Money out")}</div>${
        shown.map(line).join("") ||
        '<p class="meta">Nothing recorded this month.</p>'
      }${
        other.length && show === "all"
          ? `<h3>Also this month</h3><p class="meta">Recorded, but neither income nor an expense.</p>${other.map(line).join("")}`
          : ""
      }`,
      { self: { act: "month", id: p + "|" + show } },
    );
  }
  async function seed() {
    if ((await Store.list("sample")).some((x) => x.type === "property")) return;
    const d = today(),
      first = d.slice(0, 7) + "-01",
      start = new Date(first + "T12:00:00Z");
    start.setUTCMonth(start.getUTCMonth() - 11);
    const st = start.toISOString().slice(0, 10);
    const p = {
        id: "sample-juniper",
        type: "property",
        name: "Juniper House",
        city: "San Diego",
        county: "San Diego",
        state: "CA",
        timezone: "America/Los_Angeles",
        address: "184 Juniper Lane (fictional)",
      },
      t = {
        id: "sample-household",
        propertyId: p.id,
        type: "tenancy",
        name: "Avery Morgan",
        rentCents: 320000,
        depositCents: 320000,
        start: st,
        nextDue: st,
      };
    const docs = await Work.seed(p, t, d);
    const leases =
      typeof Leases.seed === "function" ? await Leases.seed(p, t, d) : [];
    await Store.save("sample", [
      p,
      t,
      { id: "sample-unit", type: "unit", propertyId: p.id, name: "Main house" },
      ...Money.seed(p, t, d),
      ...docs,
      ...leases,
    ]);
  }
  /* The sample is seeded once. In each later month, add that month's made-up rent payment and
     expense, so the sample never shows months of unpaid rent. Entries a visitor made are kept. */
  async function refreshSample() {
    const rows = await Store.list("sample", true),
      live = rows.filter((x) => !x._deleted),
      p = live.find((x) => x.id === "sample-juniper"),
      t = live.find((x) => x.id === "sample-household");
    if (!p || !t) return;
    const now = today(),
      have = new Set(rows.map((x) => x.id)),
      charges = new Map(
        live.filter((x) => x.type === "charge").map((x) => [x.id, x]),
      ),
      settled = new Set(
        live.flatMap((x) => (x.allocations || []).map((a) => a.chargeId)),
      ),
      fresh = [];
    for (const r of Money.seed(p, t, now)) {
      if (have.has(r.id) || !(r.date <= now)) continue;
      if (r.type === "expense") fresh.push(r);
      if (r.type !== "payment") continue;
      const charge = charges.get(r.allocations?.[0]?.chargeId);
      if (!charge || settled.has(charge.id)) continue;
      fresh.push({
        ...r,
        date: charge.date,
        amount: charge.amount,
        allocations: [{ chargeId: charge.id, amount: charge.amount }],
      });
    }
    if (fresh.length) await Store.save("sample", fresh);
  }
  function verifyWorker(worker, command = "verify-cache") {
    if (!worker) return;
    state.worker = worker;
    const c = new MessageChannel();
    c.port1.onmessage = (e) => {
      state.offline = e.data?.ready === true;
      state.offlineStatus = state.offline
        ? ""
        : "The offline copy is incomplete. Connect to the internet, then choose Fix offline copy.";
      if ($("home-status")) $("home-status").textContent = statusLine();
      if ($("dialog").open && dialogKind === "help") help({ redraw: true });
      c.port1.close();
    };
    worker.postMessage(command, [c.port2]);
  }
  async function service() {
    if (
      !("serviceWorker" in navigator) ||
      !["https:", "http:"].includes(location.protocol)
    ) {
      state.offlineStatus =
        "This browser cannot keep the app for offline use. Open the app’s web address in Chrome, Edge or Safari.";
      return;
    }
    try {
      const reg = await navigator.serviceWorker.register("./sw.js");
      navigator.serviceWorker.addEventListener("message", (e) => {
        if (e.data?.type === "update-blocked") toast(e.data.message);
      });
      const check = verifyWorker;
      if (reg.waiting) state.update = reg.waiting;
      const installState = () => {
        const w = reg.installing;
        w?.addEventListener("statechange", () => {
          if (w.state === "redundant") {
            state.offlineStatus =
              "The offline copy did not finish downloading. Connect to the internet, then choose Check for updates.";
            if ($("dialog").open && dialogKind === "help")
              help({ redraw: true });
          }
          if (w.state === "installed" && navigator.serviceWorker.controller) {
            state.update = w;
            state.updateNote = "An update is ready. Choose Update now.";
            toast("An update is ready.", {
              act: "update-now",
              label: "Update now",
            });
          }
        });
      };
      reg.onupdatefound = installState;
      installState();
      check((await navigator.serviceWorker.ready).active);
    } catch (e) {
      state.offlineStatus =
        "The app could not be saved for offline use. Check your internet connection and try again.";
      console.warn("Offline installation unavailable", e);
    }
  }
  async function boot() {
    document.querySelector(".brand-logo").innerHTML = brandmark;
    renderIcons();
    $("dialog-close").onclick = dismiss;
    $("dialog-back").onclick = () => {
      const back = dialogBack;
      if (!back) return;
      if (dialogTouched) captureDraft();
      Promise.resolve(act(back.act, back.id)).catch(error);
    };
    $("dialog").oncancel = (e) => {
      e.preventDefault();
      dismiss();
    };
    for (const type of ["input", "change"])
      $("dialog-body").addEventListener(type, () => {
        dialogTouched = true;
        $("dialog-error")?.remove();
      });
    document.addEventListener("click", (e) => {
      const n = e.target.closest("[data-nav],[data-act]");
      if (!n) return;
      const inside = Boolean(n.closest("#dialog"));
      if (inside && dialogTouched && n.hasAttribute("data-leave"))
        captureDraft();
      if (n.dataset.nav) return go(n.dataset.nav);
      pendingBack = inside ? dialogSelf : null;
      Promise.resolve(act(n.dataset.act, n.dataset.id))
        .catch(error)
        .finally(() => (pendingBack = null));
    });
    document.addEventListener("keydown", (e) => {
      if (
        e.key === "/" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !$("dialog").open &&
        !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)
      ) {
        e.preventDefault();
        search();
      }
    });
    window.addEventListener("popstate", () => {
      const at = parseHash();
      go(at.page, { rest: at.rest, push: false });
    });
    window.addEventListener("hashchange", () => {
      const at = parseHash();
      if (at.page !== state.page || at.rest !== state.route)
        go(at.page, { rest: at.rest, push: false });
    });
    window.addEventListener("unhandledrejection", (e) => {
      error(e.reason);
    });
    try {
      await Store.init();
      await seed();
      await reload();
      if (state.ds === "sample") await refreshSample();
      if (prop()) await Money.ensure();
      await reload();
      await loadOwners();
      const at = parseHash();
      state.page = prop() ? at.page : "Home";
      state.route = prop() ? at.rest : "";
      state.ready = true;
      render();
      service();
    } catch (e) {
      $("content").innerHTML =
        `<section class="panel"><h1>We could not open your records</h1><p class="error">${esc(e.message)}</p><p>Allow this site to store data, close any other Property Manager tabs, then try again. Your records are still on this device.</p><button type="button" id="retry-open">Try again</button></section>`;
      $("retry-open").onclick = () => location.reload();
      console.error(e);
    }
  }
  boot();
})();
