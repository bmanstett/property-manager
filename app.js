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
    items: [],
    propertyId: null,
    status: {},
    ready: false,
    offline: false,
    period: "",
    scroll: {},
    drafts: new Map(),
    update: null,
  };
  let revTimer,
    activeReturn = null,
    toastTimer,
    dialogKey = "",
    dialogClean = null;
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
  function toast(msg) {
    clearTimeout(toastTimer);
    $("toast").textContent = msg;
    $("toast").className = "show";
    toastTimer = setTimeout(() => ($("toast").className = ""), 5200);
  }
  function error(e) {
    const msg =
      e?.name === "QuotaExceededError"
        ? "Storage is full. Export a backup or free device space, then retry."
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
  function captureDraft() {
    const bs = $("dialog-body");
    const values = [
      ...bs.querySelectorAll("input[name],select[name],textarea[name]"),
    ]
      .filter((e) => !["password", "file"].includes(e.type))
      .map((e) => ({ name: e.name, value: e.value, checked: e.checked }));
    if (values.length && dialogKey) state.drafts.set(dialogKey, values);
  }
  function close() {
    if (dialogKey) state.drafts.delete(dialogKey);
    if (dialogClean) dialogClean();
    dialogClean = null;
    dialogKey = "";
    if ($("dialog").open) $("dialog").close();
    activeReturn?.focus?.({ preventScroll: true });
    activeReturn = null;
  }
  function dismiss() {
    captureDraft();
    const key = dialogKey;
    dialogKey = "";
    close();
    dialogKey = "";
    if (key && state.drafts.has(key))
      toast("Form kept for this session. Reopen it to continue.");
  }
  function modal(title, html, options = {}) {
    if (dialogClean) dialogClean();
    dialogClean =
      typeof options?.onClose === "function" ? options.onClose : null;
    const d = $("dialog");
    if (!d.open) activeReturn = document.activeElement;
    dialogKey =
      state.ds + "|" + state.propertyId + "|" + (options?.key || title);
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
    navigate: go,
    action: act,
  });
  function rail() {
    const count = records("task").filter((t) => !t.completed).length;
    const btn = (name, side) =>
      `<button data-nav="${name}" class="${state.page === name ? "active" : ""}" ${state.page === name ? 'aria-current="page"' : ""}>${ico(name.toLowerCase(), 19)}<span>${name}</span>${side && name === "Tasks" && count ? `<span class="count">${count}</span>` : ""}</button>`;
    document.querySelector(".side-nav").innerHTML = ws
      .map((n) => btn(n, true))
      .join("");
    document.querySelector(".bottom-nav").innerHTML = ws
      .map((n) => btn(n, false))
      .join("");
    $("selected-property").textContent = prop()?.name || "Choose property";
    const status = state.status;
    $("rail-backup").innerHTML =
      `${ico("backup", 20)}<span><strong>Backup &amp; transfer</strong><small>${status.lastBackup ? "Last confirmed " + fmt(status.lastBackup) : "No confirmed backup"}</small></span>`;
    $("rail-backup").dataset.act = "storage";
    $("notice-dot").hidden = !attention().length;
  }
  function attention() {
    const date = today();
    const tasks = records("task")
      .filter((t) => !t.completed && t.due && t.due <= addDays(date, 30))
      .map((t) => ({
        id: t.id,
        title: t.title,
        sub: `${t.kind || "Reminder"} · ${t.due < date ? "Overdue · " : ""}${fmt(t.due)}`,
        icon:
          t.kind === "Maintenance"
            ? "tools"
            : t.kind === "Inspection"
              ? "tasks"
              : "calendar",
        tint: t.kind === "Inspection" ? "amber" : "blue",
        action: "task",
        date: t.due,
      }));
    const msgs = records("communication")
      .filter((m) => m.status === "Ready" && m.planned <= date)
      .map((m) => ({
        id: m.id,
        title: m.subject,
        sub: "Outbox · Ready for handoff",
        icon: "mail",
        tint: "lilac",
        action: "message",
        date: m.planned,
      }));
    const m = prop() ? Money.home() : null;
    const next =
      m?.dueDate && m.dueDate <= addDays(date, 30)
        ? [
            {
              id: "",
              title:
                m.dueDate < date
                  ? "Review outstanding rent"
                  : "Upcoming rent due",
              sub: "Rent obligation · " + fmt(m.dueDate),
              icon: "money",
              tint: "sage",
              action: m.pastDue ? "arrears" : "rent",
              date: m.dueDate,
            },
          ]
        : [];
    return [...tasks, ...msgs, ...next].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
  }
  function heading(title, desc, button = "") {
    return `<div class="workspace-heading"><div><h1>${esc(title)}</h1>${desc ? `<p>${esc(desc)}</p>` : ""}</div>${button}</div>`;
  }
  PM.heading = heading;
  function button(label, action, icon = "plus", cls = "primary", id = "") {
    return `<button class="${cls}" data-act="${esc(action)}"${id ? ` data-id="${esc(id)}"` : ""}>${ico(icon, 17)}${esc(label)}</button>`;
  }
  PM.button = button;
  function row(r) {
    return `<button class="attention-row" data-act="${esc(r.action)}" data-id="${esc(r.id)}"><span class="row-icon tint-${esc(r.tint)}">${ico(r.icon)}</span><span class="row-text"><strong>${esc(r.title)}</strong><small>${esc(r.sub)}</small></span>${ico("chevron", 15)}</button>`;
  }
  function metric(title, amount, foot, icon, tint, action) {
    return `<button class="metric" data-act="${action}"><span class="metric-head"><span class="metric-icon tint-${tint}">${ico(icon)}</span>${esc(title)}</span><strong>${currency(amount)}</strong><span class="metric-foot">${foot}</span></button>`;
  }
  function home() {
    const p = prop();
    if (!p) return onboarding();
    const period = state.period || today().slice(0, 7),
      d = period + "-01",
      m = Money.home(period),
      at = attention(),
      t = records("tenancy")[0];
    const monthLabel = fmt(d, { month: "long" });
    const list = m.monthly.slice(-6),
      maxValue = Math.max(
        10000,
        ...list.flatMap((x) => [x.income, x.expenses].map(Math.abs)),
      ),
      step = Math.pow(10, Math.floor(Math.log10(maxValue))),
      max = Math.ceil(maxValue / step) * step;
    const axisVal = (n) =>
      n >= 100000
        ? "$" + (n / 100000).toFixed(n % 100000 ? 1 : 0) + "k"
        : currency(Math.round(n));
    const chart = list
      .map(
        (x) =>
          `<button class="bar-group" data-act="month" data-id="${esc(x.month)}" aria-label="${esc(x.month)} income ${currency(x.income)}, expenses ${currency(x.expenses)}"><span class="bars"><i style="height:${Math.min(100, (Math.abs(x.income) / max) * 100)}%"></i><i style="height:${Math.min(100, (Math.abs(x.expenses) / max) * 100)}%"></i></span><small>${fmt(x.month + "-01", { month: "short" })}</small></button>`,
      )
      .join("");
    const opts = Array.from({ length: 24 }, (_, j) => {
      const day = new Date(today().slice(0, 7) + "-01T12:00:00Z");
      day.setUTCMonth(day.getUTCMonth() - j);
      return day.toISOString().slice(0, 7);
    });
    const moneyMonth = m.monthly.find((x) => x.month === period) || {
      income: 0,
      expenses: 0,
    };
    const paid = m.charged > 0 && m.received === m.charged;
    const amountPaid = m.received;
    $("content").innerHTML =
      `<div class="page-heading"><div><div class="eyebrow">${fmt(today(), { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</div><h1>Property overview</h1></div>${button("Record payment", "payment")}</div>
<section class="property-hero"><div><div class="hero-label">${ico("home", 14)} Selected property</div><h2 class="hero-title">${esc(p.name)}</h2><div class="hero-location">${ico("pin")}${esc([p.city, p.state === "CA" ? "California" : p.state].filter(Boolean).join(", ") || p.address || "Location awaiting review")}</div><div class="hero-pills">${t ? `<span><b></b> ${t.end && t.end < today() ? "Past tenancy" : t.start && t.start <= today() ? "Active tenancy" : "Existing tenancy"}</span>` : ""}${state.ds === "sample" ? "<span>Sample property</span>" : ""}</div></div><button class="hero-open" data-act="property" aria-label="View property details">${ico("up", 16)}</button></section>
<div class="overview-toolbar"><h2>Financial snapshot</h2><label class="period-select">${ico("calendar", 15)}<select id="home-period" aria-label="Financial snapshot month">${opts.map((v) => `<option value="${v}" ${period === v ? "selected" : ""}>${fmt(v + "-01", { month: "long", year: "numeric" })}</option>`).join("")}</select>${ico("drop")}</label></div><div class="stats-grid">${metric("Rent collected", amountPaid, `<span class="status-chip ${paid ? "" : "amber"}">${ico(paid ? "check" : "clock", 11)}${paid ? "Paid in full" : m.outstanding ? currency(m.outstanding) + " due" : m.charged ? "Adjusted" : "No charges"}</span>`, "money", "sage", "rent")}${metric("Expenses", moneyMonth.expenses, `Paid in ${esc(monthLabel)}`, "receipt", "amber", "periodExpenses")}${metric("Net income", moneyMonth.income - moneyMonth.expenses, `Income less expenses`, "uptrend", "blue", "month")}</div>
<div class="two-col"><section class="panel"><div class="section-head"><h2>Income &amp; expenses</h2><span class="meta">Last ${list.length} months</span></div><div class="legend"><span><i></i>Income</span><span><i class="exp"></i>Expenses</span></div><div class="chart-area"><div class="axis"><span>${axisVal(max)}</span><span>${axisVal(max * 0.75)}</span><span>${axisVal(max * 0.5)}</span><span>${axisVal(max * 0.25)}</span><span>$0</span></div><div class="chart-plot">${chart}</div></div></section><section class="panel"><div class="section-head"><h2>Needs attention <span class="count-tag">${at.length}</span></h2><button class="text-btn" data-act="attention">View all ${ico("chevron")}</button></div><div class="attention-list">${at.length ? at.slice(0, 3).map(row).join("") : '<p class="empty">No tasks or correspondence due in the next 30 days.</p>'}</div></section></div>
<div class="overview-toolbar"><h2>Quick actions</h2></div><div class="short-actions">${[
        ["expense", "receipt", "Add expense", "amber"],
        ["receipt", "camera", "Photograph receipt", "blue"],
        ["create", "leases", "Create lease", "sage"],
        ["cpa", "chart", "Prepare CPA packet", "lilac"],
      ]
        .map(
          ([a, i, l, c]) =>
            `<button class="action-tile" data-act="${a}"><span class="action-icon tint-${c}">${ico(i)}</span>${l}</button>`,
        )
        .join("")}</div>
<section class="panel" style="margin-top:18px"><div class="section-head"><h2>Recent activity</h2><button class="text-btn" data-nav="Money">View ledger ${ico("chevron")}</button></div>${
        m.recent
          .slice(0, 4)
          .map(
            (a) =>
              `<button class="activity-row" data-act="activity" data-id="${esc(a.id)}"><span class="row-icon ${a.signedAmount < 0 ? "tint-amber" : ""}">${ico(a.signedAmount < 0 ? "receipt" : "money")}</span><span class="row-text"><strong>${esc(a.title)}</strong><small>${fmt(a.date)} · ${esc(a.category || a.type)}</small></span><span class="amount ${a.signedAmount >= 0 ? "positive" : ""}">${a.signedAmount > 0 ? "+" : ""}${currency(a.signedAmount)}</span></button>`,
          )
          .join("") ||
        '<p class="empty">Your recorded transactions will appear here.</p>'
      }</section><div class="home-foot">${ico("shield")}<span>${state.offline ? "Offline ready" : location.protocol === "file:" ? "Local file preview · Install from HTTPS for offline launch" : "Device storage"} · ${state.ds === "sample" ? "Exploring sample records" : "Owner records on this device"}</span><button class="text-btn" data-act="storage">${state.status.lastBackup ? "Backup details" : "No confirmed backup"}</button></div>`;
    $("home-period").onchange = (e) => {
      state.period = e.target.value;
      home();
    };
  }
  function onboarding() {
    $("content").innerHTML =
      heading(
        "Your rental workspace",
        "Start with the property and tenancy details you already know.",
      ) +
      `<section class="panel stack">${button("Set up my rental", "setup", "home")}${button("Restore or transfer my existing records", "restore", "backup", "secondary")}${button("Explore a sample property", "sample", "sample", "secondary")}</section>`;
  }
  function render() {
    rail();
    document.title = state.page + " · Property Manager";
    if (!prop() || state.page === "Home") home();
    else if (state.page === "Money") Money.render();
    else if (state.page === "Leases") Leases.render();
    else Work.render(state.page);
    renderIcons($("content"));
  }
  function go(name, update = true) {
    if (!ws.includes(name)) return;
    if ($("dialog").open) dismiss();
    state.scroll[state.ds + state.page] = window.scrollY;
    state.page = name;
    if (update && location.hash !== "#" + name.toLowerCase())
      history.pushState(null, "", "#" + name.toLowerCase());
    render();
    window.scrollTo(0, state.scroll[state.ds + name] || 0);
    $("content").focus({ preventScroll: true });
  }
  function choice(title, desc, act, icon, id = "") {
    return `<button class="choice-row" data-act="${esc(act)}" data-id="${esc(id)}"><span class="row-icon">${ico(icon)}</span><span class="row-text"><strong>${esc(title)}</strong><small>${esc(desc)}</small></span>${ico("chevron", 15)}</button>`;
  }
  async function properties() {
    const owners = await Store.list("owner");
    modal(
      "Choose property",
      `${all("property")
        .map((p) =>
          choice(
            p.name,
            state.ds === "sample"
              ? "Sample dataset"
              : p.address || "Owner dataset",
            "select-property",
            "home",
            p.id,
          ),
        )
        .join("")}${
        state.ds === "sample"
          ? owners
              .filter((p) => p.type === "property" && !p._deleted)
              .map((p) =>
                choice(p.name, "Owner dataset", "owner-property", "home", p.id),
              )
              .join("")
          : choice(
              "Explore a sample property",
              "Open the separate demonstration dataset",
              "sample",
              "sample",
            )
      }${choice("Set up my rental", "Create an owner property and existing tenancy", "setup", "plus")}${choice("Restore or transfer my existing records", "Open the owner dataset and select an encrypted file", "owner-restore", "backup")}`,
    );
  }
  async function switchTo(ds, id) {
    close();
    state.ds = ds;
    state.propertyId = id || null;
    state.period = "";
    state.scroll = {};
    prefs.set("dataset", ds);
    if (id) prefs.set("property." + ds, id);
    await reload();
    if (prop()) await Money.ensure();
    await reload();
    go("Home", false);
  }
  function householdStatus(t) {
    if (t.end && t.end < today()) return "Ended " + fmt(t.end);
    if (t.start && t.start > today()) return "Starts " + fmt(t.start);
    return "Current tenancy";
  }
  async function editProperty(tenancyId, fresh = false) {
    const p = prop(),
      scope = state.ds,
      t = fresh ? {} : get(tenancyId) || records("tenancy")[0] || {};
    if (t.id && t.propertyId !== p.id)
      throw Error("Choose a household at the active property.");
    const hasCharges = Boolean(t.id && PM.chargeVersions(t.id).length);
    const existing = (t.rentChanges || [])
      .map(
        (x) =>
          `<p>${esc(x.from)} · ${currency(x.rentCents)} · ${esc(x.reason)}</p>`,
      )
      .join("");
    modal(
      fresh ? "Add a tenancy" : "Property & rental terms",
      `<form id="rental-details" class="stack">
    ${fresh ? "<p>Create a separate household and rent schedule for this property. Previous households and their records stay available.</p>" : ""}
    <div class="form-grid">${field("Property name", "name", "text", p.name, "required")}${field("Street address", "address", "text", p.address)}${field("Mailing city", "city", "text", p.city)}${field("County", "county", "text", p.county)}${field("Time zone", "timezone", "text", p.timezone || "America/Los_Angeles", "required")}${field("Household or tenancy name", "household", "text", t.name, "required")}${field("Tenancy start", "start", "date", t.start)}${field("Tenancy end, if confirmed", "end", "date", t.end)}</div>
    <details ${fresh ? "open" : ""}><summary>Rent schedule</summary><p>${hasCharges ? "Supply the amount and effective date from the reviewed agreement. You can inspect affected future obligations before saving." : "Set the first monthly rent obligation to track for this household."}</p>${existing}
    <div class="form-grid">${field(hasCharges ? "Revised monthly rent ($)" : "Monthly rent ($)", "rent", "number", hasCharges ? "" : t.rentCents ? t.rentCents / 100 : "", 'min=".01" max="99999999" step=".01"')}${field(hasCharges ? "Effective date" : "First charge to track", "from", "date", hasCharges ? "" : t.nextDue)}${fresh ? field("Opening refundable deposit held ($)", "deposit", "number", "", 'min="0" max="99999999" step=".01"') : ""}</div></details>
    ${hasCharges ? field("Reason for a schedule or end-date change", "reason", "text", "", 'placeholder="Executed renewal, amendment, or possession returned"') : ""}
    <div id="terms-preview" aria-live="polite"></div><button type="submit">Save rental details</button></form>`,
      { key: "rental-" + (t.id || p.id + "-new") },
    );
    const form = $("rental-details");
    const commit = async (items) => {
      if (state.ds !== scope || prop()?.id !== p.id || !form.isConnected)
        throw Error("Reopen the original property to apply these changes.");
      await batch(items);
      if (state.ds !== scope || prop()?.id !== p.id) return;
      await Money.ensure();
      close();
      await refresh();
      toast("Property and rental terms saved");
    };
    let previewed = false,
      prepared = null;
    form.oninput = () => {
      previewed = false;
      prepared = null;
      $("terms-preview").replaceChildren();
      form.querySelector("[type=submit]").textContent = "Save rental details";
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const submit = e.submitter;
      if (form.dataset.busy) return;
      form.dataset.busy = "saving";
      if (submit) submit.disabled = true;
      try {
        if (previewed && prepared) {
          await commit(prepared);
          return;
        }
        const v = Object.fromEntries(new FormData(form));
        new Intl.DateTimeFormat("en-US", { timeZone: v.timezone }).format(
          new Date(),
        );
        if (v.start && v.end && v.end < v.start)
          throw Error("Tenancy end must follow the start date.");
        if (Boolean(v.rent) !== Boolean(v.from))
          throw Error(
            "Enter a rent amount and first applicable date together.",
          );
        if (!v.name.trim() || !v.household.trim())
          throw Error("Enter a property and household name.");
        const updated = {
          ...t,
          id: t.id || uid(),
          type: "tenancy",
          propertyId: p.id,
          unitId: t.unitId || records("unit")[0]?.id || "",
          name: v.household.trim(),
          start: v.start,
          end: v.end,
        };
        if (v.rent) {
          const amount = Money.model.cents(v.rent, true);
          if (hasCharges) {
            if (!v.reason?.trim())
              throw Error(
                "Describe the executed agreement supporting this rent change.",
              );
            if ((t.rentChanges || []).some((x) => x.from === v.from))
              throw Error("There is already a rent change on this date.");
            updated.rentChanges = [
              ...(t.rentChanges || []),
              { from: v.from, rentCents: amount, reason: v.reason.trim() },
            ].sort((a, b) => a.from.localeCompare(b.from));
          } else {
            updated.rentCents = amount;
            updated.nextDue = v.from;
          }
        }
        if (fresh) {
          updated.depositCents = v.deposit ? Money.model.cents(v.deposit) : 0;
          updated.depositDate = today();
        }
        const property = {
          ...p,
          name: v.name.trim(),
          address: v.address,
          city: v.city,
          county: v.county,
          timezone: v.timezone,
        };
        const changedSchedule =
          hasCharges && (Boolean(v.rent) || (v.end || "") !== (t.end || ""));
        if (changedSchedule && !v.reason?.trim())
          throw Error(
            "Record the reason for changing the rent schedule or end date.",
          );
        const changes = changedSchedule
          ? Money.termChanges(t, updated, {
              from: v.from || "",
              reason: v.reason.trim(),
            })
          : [];
        const items = [property, updated, ...changes];
        if (changedSchedule) {
          const charges = changes.filter((x) => x.type === "charge");
          $("terms-preview").innerHTML =
            `<div class="notice"><strong>Review schedule change</strong><p>${esc(v.reason)}. ${charges.length} existing obligation(s) affected.</p>${charges.map((x) => `<p>${esc(x.period)} · ${x._deleted ? "Cancel expected charge" : currency(x.amount) + " expected"}</p>`).join("")}</div>`;
          prepared = items;
          previewed = true;
          submit.textContent = "Confirm schedule change";
          return;
        }
        await commit(items);
      } finally {
        delete form.dataset.busy;
        if (submit) submit.disabled = false;
      }
    };
  }
  function property() {
    const p = prop(),
      tenancies = records("tenancy");
    modal(
      p.name,
      `<p>${esc([p.address, p.city, p.county, p.state].filter(Boolean).join(", "))}</p><p class="meta">${esc(p.timezone || "America/Los_Angeles")} · ${state.ds === "sample" ? "Sample dataset" : "Owner dataset"}</p><h3>Tenancies</h3>${tenancies.map((t) => choice(t.name, householdStatus(t), "edit-property", "home", t.id)).join("") || "<p>No households recorded.</p>"}<div class="actions">${button("Add a tenancy", "new-household", "plus", "secondary")}${button("Lease history", "tenancy", "leases", "secondary")}${button("Choose property", "properties", "building", "secondary")}</div>`,
    );
  }
  async function setup() {
    const ds = "owner",
      saved =
        (await Store.list(ds)).find(
          (x) => x.type === "setupdraft" && !x._deleted,
        ) || {},
      d = saved.form || {};
    modal(
      "Set up my rental",
      `<form id="setup-form" class="stack"><p>Enter what you know. Rent starts with the first charge you choose to track.</p><div class="form-grid">${field("Property name", "name", "text", d.name, 'required maxlength="100"')}${field("Street address", "address", "text", d.address)}${field("Mailing city", "city", "text", d.city)}${field("County", "county", "text", d.county)}${field("State", "state", "text", "California", "readonly")}${field("Property time zone", "timezone", "text", d.timezone || "America/Los_Angeles", "required")}${field("Existing tenancy or household name", "household", "text", d.household, 'placeholder="Can be added later"')}${field("Tenancy start, if known", "start", "date", d.start)}${field("Monthly rent ($)", "rent", "number", d.rent, 'min="0" max="99999999" step=".01"')}${field("First charge to track", "nextDue", "date", d.nextDue)}${field("Opening refundable deposit held ($)", "deposit", "number", d.deposit, 'min="0" max="99999999" step=".01"')}${field("Deposit balance as of", "depositDate", "date", d.depositDate || today())}</div><div class="notice">The opening deposit is a liability. Enter historical rent payments separately. Mailing city and county will need boundary review during lease preparation.</div><div class="actions end"><button type="button" id="save-setup">Save setup draft</button><button type="submit">Create rental workspace</button></div></form>`,
    );
    const f = $("setup-form");
    const values = () => Object.fromEntries(new FormData(f));
    $("save-setup").onclick = async () => {
      await Store.save(ds, [
        {
          ...saved,
          type: "setupdraft",
          id: saved.id || uid(),
          form: values(),
        },
      ]);
      close();
      toast("Setup draft saved");
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const v = values();
      new Intl.DateTimeFormat("en-US", { timeZone: v.timezone }).format(
        new Date(),
      );
      if ((v.rent && !v.nextDue) || (!v.rent && v.nextDue))
        return error(
          new Error(
            "Enter both monthly rent and first charge date, or leave both for later.",
          ),
        );
      const id = uid(),
        unitId = uid(),
        tId = uid(),
        money = (s) => {
          if (!s) return 0;
          const [a, b = ""] = s.split(".");
          return Number(a) * 100 + Number((b + "00").slice(0, 2));
        };
      const items = [
        {
          type: "property",
          id,
          name: v.name.trim(),
          address: v.address,
          city: v.city,
          county: v.county,
          state: "CA",
          timezone: v.timezone,
        },
        { type: "unit", id: unitId, propertyId: id, name: "Residential unit" },
        {
          type: "tenancy",
          id: tId,
          unitId,
          propertyId: id,
          name: v.household.trim() || "Existing tenancy",
          rentCents: money(v.rent),
          depositCents: money(v.deposit),
          depositDate: v.depositDate || today(),
          start: v.start,
          nextDue: v.nextDue,
        },
      ];
      if (saved.id) items.push({ ...saved, _deleted: true });
      if (f.dataset.saving) return;
      f.dataset.saving = "true";
      e.submitter.disabled = true;
      try {
        await Store.save(ds, items);
      } finally {
        delete f.dataset.saving;
        e.submitter.disabled = false;
      }
      await switchTo(ds, id);
      toast("Rental workspace saved");
    };
  }
  function settings() {
    const s = state.status;
    modal(
      "Workspace settings",
      `<p class="meta">${state.ds === "sample" ? "Sample property" : "Owner records"} · ${esc(prop()?.name || "No property selected")}</p>${choice("Properties & setup", "Choose a property, set up a rental, or explore the sample", "properties", "building")}${choice("Encrypted backup", s.lastBackup ? "Last confirmed " + fmt(s.lastBackup) : "No backup confirmed", "backup", "backup")}${choice("Restore backup", "Validate a complete encrypted file before replacement", "restore", "download")}${choice("Merge device changes", "Review cross-device conflicts and apply compatible records", "merge", "documents")}${choice("GitHub sync", "Sync your owner records with an encrypted snapshot in a private repository", "github-sync", "backup")}${choice("Storage & history", "Review device storage, conflicts, and changes", "storage", "shield")}${choice("Installed legal sources", "Review rule versions and import updates", "rules", "leases")}${choice("Installation & offline access", state.offline ? "Offline ready" : "Check installation state", "help", "help")}`,
    );
  }
  function help() {
    modal(
      "Installation & offline access",
      `<p><strong>${state.offline ? "Offline ready" : location.protocol === "file:" ? "Local file preview" : state.offlineStatus || "Checking local installation"}</strong></p><ol><li>Open the same trusted HTTPS address in Edge or Chrome on Windows, or Safari on iPhone. Connect once to cache the application.</li><li>Windows: use the address-bar Install icon or the browser’s Apps menu. On iPhone: tap Share, Add to Home Screen, then Add.</li><li>Open the installed app and wait for <b>Offline ready</b>. Try a cold launch in airplane mode before relying on it away from Wi-Fi.</li></ol><p>Private records stay in this browser’s IndexedDB. Each device and origin has its own records. Use encrypted transfer to change devices or hosting addresses.</p><p>Live records rely on device protection. Backup files require their own password. Keep a restore-tested copy outside browser storage.</p><div class="actions">${button("Storage health", "storage", "shield", "secondary")}<button id="update-check">Check for app update</button>${!state.offline && state.worker ? '<button id="repair-cache">Repair offline installation</button>' : ""}${state.update ? '<button id="apply-update">Apply available update</button>' : ""}</div>`,
    );
    if ($("repair-cache"))
      $("repair-cache").onclick = () => {
        state.offlineStatus = "Repairing cached files…";
        verifyWorker(state.worker, "repair-cache");
        help();
      };
    $("update-check").onclick = async () => {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (!reg)
        return error(
          new Error(
            "Open the app from HTTPS or localhost to install service-worker updates.",
          ),
        );
      await reg.update();
      toast(
        reg.waiting
          ? "Update ready. Reopen installation settings."
          : "Update check requested",
      );
    };
    if ($("apply-update"))
      $("apply-update").onclick = () => {
        state.update.postMessage("activate-update");
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => location.reload(),
          { once: true },
        );
      };
  }
  function search() {
    modal(
      "Search workspace",
      '<label class="field">Search records<input id="global-search" type="search" placeholder="Name, date, vendor, filename…"></label><div id="search-results"></div>',
    );
    const input = $("global-search"),
      types = {
        task: "task",
        inspection: "inspection",
        communication: "message",
        document: "doc",
        payment: "activity",
        expense: "activity",
        deposit: "activity",
        charge: "activity",
        lease: "lease",
        tenancy: "tenancy",
      };
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      const vals = records()
        .filter(
          (r) =>
            types[r.type] &&
            [
              r.name,
              r.filename,
              r.title,
              r.date,
              r.subject,
              r.vendor,
              r.purpose,
              r.kind,
              r.type,
              r.period,
              r.category,
              r.notes,
              r.tags,
            ]
              .join(" ")
              .toLowerCase()
              .includes(q),
        )
        .slice(0, 35);
      $("search-results").innerHTML =
        vals
          .map((r) =>
            choice(
              r.name || r.title || r.subject || r.vendor || r.purpose || r.type,
              r.type + (r.date ? " · " + r.date : ""),
              types[r.type],
              r.type === "document"
                ? "file"
                : r.type === "task"
                  ? "tasks"
                  : "list",
              r.id,
            ),
          )
          .join("") || '<p class="empty">No matching records.</p>';
    };
    draw();
    input.oninput = draw;
    input.focus();
  }
  async function act(a, id) {
    if (a === "properties") return properties();
    if (a === "setup") return setup();
    if (a === "sample" || a === "owner-property" || a === "select-property")
      return switchTo(
        a === "sample" ? "sample" : a === "owner-property" ? "owner" : state.ds,
        id,
      );
    if (a === "github-sync") {
      if (state.ds !== "owner") await switchTo("owner");
      return Store.panel("github-sync");
    }
    if (a === "owner-restore") {
      await switchTo("owner");
      return Store.panel("restore");
    }
    if (a === "settings") return settings();
    if (a === "help") return help();
    if (a === "search") return search();
    if (a === "property") return property();
    if (a === "edit-property") return editProperty(id);
    if (a === "new-household") return editProperty(null, true);
    if (a === "tenancy")
      return id ? Leases.open("household", id) : go("Leases");
    if (a === "attention")
      return modal(
        "Needs attention",
        attention().map(row).join("") ||
          "<p>Nothing due in the next 30 days.</p>",
      );
    if (["backup", "restore", "merge", "storage", "history"].includes(a))
      return Store.panel(a);
    if (["create", "lease", "rules", "depositReturn"].includes(a))
      return Leases.open(a, id || undefined);
    if (
      [
        "payment",
        "expense",
        "receipt",
        "cpa",
        "rent",
        "deposits",
        "credit",
        "activity",
        "income",
        "expenses",
      ].includes(a)
    ) {
      if (a === "rent" && state.period && state.period !== today().slice(0, 7))
        return month(state.period);
      return Money.open(a, id || undefined);
    }
    if (a === "arrears") return Money.open("arrears");
    if (a === "month" || a === "periodExpenses")
      return month(id || state.period || today().slice(0, 7));
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
  function month(p) {
    const m = Money.home(p),
      r = m.monthly.find((b) => b.month === p) || { income: 0, expenses: 0 };
    modal(
      fmt(p + "-01", { month: "long", year: "numeric" }),
      `<div class="index-list"><div class="sub-card">Operating income <strong>${currency(r.income)}</strong></div><div class="sub-card">Operating expenses <strong>${currency(r.expenses)}</strong></div><div class="sub-card">Net income <strong>${currency(r.income - r.expenses)}</strong></div></div><h3>Underlying records</h3>${
        monthlyRecords(p)
          .map((a) => {
            const v = Money.model.classification(a, state.propertyId);
            return choice(
              a.title || a.vendor || a.purpose || a.type,
              a.date +
                " · Income " +
                currency(v.income) +
                " · Expense " +
                currency(v.expenses),
              "activity",
              "list",
              a.id,
            );
          })
          .join("") || "<p>No posted records in this month.</p>"
      }`,
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
  function verifyWorker(worker, command = "verify-cache") {
    if (!worker) return;
    state.worker = worker;
    const c = new MessageChannel();
    c.port1.onmessage = (e) => {
      state.offline = e.data?.ready === true;
      state.offlineStatus = state.offline
        ? "Offline ready"
        : "Offline files incomplete. Reconnect and repair.";
      if (state.ready && state.page === "Home" && !$("dialog").open) home();
      if (
        $("dialog").open &&
        $("dialog-title").textContent === "Installation & offline access"
      )
        help();
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
        "Install from HTTPS in a browser with service worker support.";
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
              "Installation incomplete. Reconnect, then check for an update.";
            if (
              $("dialog").open &&
              $("dialog-title").textContent === "Installation & offline access"
            )
              help();
          }
          if (w.state === "installed" && navigator.serviceWorker.controller) {
            state.update = w;
            toast("Application update available in Settings");
          }
        });
      };
      reg.onupdatefound = installState;
      installState();
      check((await navigator.serviceWorker.ready).active);
    } catch (e) {
      state.offlineStatus =
        "Offline installation unavailable. Check the connection and installation address.";
      console.warn("Offline installation unavailable", e);
    }
  }
  async function boot() {
    document.querySelector(".brand-logo").innerHTML = brandmark;
    renderIcons();
    $("dialog-close").onclick = dismiss;
    $("dialog").oncancel = (e) => {
      e.preventDefault();
      dismiss();
    };
    document.addEventListener("click", (e) => {
      const n = e.target.closest("[data-nav],[data-act]");
      if (!n) return;
      if (n.dataset.nav) go(n.dataset.nav);
      else Promise.resolve(act(n.dataset.act, n.dataset.id)).catch(error);
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
    window.addEventListener("popstate", () =>
      go(
        ws.find((n) => "#" + n.toLowerCase() === location.hash) || "Home",
        false,
      ),
    );
    window.addEventListener("unhandledrejection", (e) => {
      error(e.reason);
    });
    try {
      await Store.init();
      await seed();
      await reload();
      if (prop()) await Money.ensure();
      await reload();
      state.page =
        ws.find((n) => "#" + n.toLowerCase() === location.hash) || "Home";
      state.ready = true;
      render();
      service();
    } catch (e) {
      $("content").innerHTML =
        `<section class="panel"><h1>Workspace couldn’t open</h1><p class="error">${esc(e.message)}</p><p>Allow site storage, close any older open version, then reload. Existing records remain on this device.</p><button id="retry-open">Retry opening workspace</button></section>`;
      $("retry-open").onclick = () => location.reload();
      console.error(e);
    }
  }
  boot();
})();
