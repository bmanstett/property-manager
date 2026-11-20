/* Finalized leases: the folder of files to sign, who has signed, each tenant's active lease, earlier
   versions, the move-out deposit helper, and the checks run on lease records in a backup.
   Exposes globalThis.LeasePackets. Screens are built with the UI kit (ui.js) and styled in
   lease-sign.css. Legal wording comes only from LeaseLaw and LeaseDocument. */
(() => {
  "use strict";
  const TEMPLATE = "CA-SD residential lease 2.0";
  const MIB = 1024 * 1024,
    MAX_FILE = 32 * MIB,
    MAX_FOLDER = 31.5 * MIB;
  const SIGNED_KIND = "Executed lease"; // the type Documents uses for a signed copy
  const UPLOADS = { "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png" };
  const LEGACY_STATUS = ["Required", "Not applicable", "More information needed", "Review needed"];
  const ITEM_STATES = ["included", "attached", "not-needed", "needs-answer", "attention", "reminder"];

  const pm = () => globalThis.PM;
  const law = () => globalThis.LeaseLaw;
  const writer = () => globalThis.LeaseDocument;
  const kit = () => globalThis.UI;
  const uid = () => pm().uid();
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const filled = (v) => String(v ?? "").trim() !== "";
  const clean = (v) => String(v ?? "").trim().replace(/\s+/g, " ");
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const ico = (name, size = 18) => (typeof pm()?.ico === "function" ? pm().ico(name, size) : "");

  /* ---------- Small pure helpers (also used by the tests) ---------- */
  const isDate = (v) =>
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v + "T12:00:00Z")) &&
    new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v;
  function plusDays(when, days) {
    if (!isDate(when)) return "";
    const t = new Date(when + "T12:00:00Z");
    t.setUTCDate(t.getUTCDate() + days);
    return t.toISOString().slice(0, 10);
  }
  const daysBetween = (from, to) => Math.round((Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) / 86400000);
  const dateText = (iso, month) =>
    isDate(iso) ? new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month, day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
  const longDate = (iso) => dateText(iso, "long");
  const shortDate = (iso) => dateText(iso, "short");
  /* The calendar day of a saved timestamp, in the rental's own time zone. */
  function stampDay(stamp) {
    const t = new Date(stamp);
    if (!stamp || !Number.isFinite(+t)) return "";
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: pm()?.prop?.()?.timezone || "America/Los_Angeles",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(t);
      const v = Object.fromEntries(parts.map((x) => [x.type, x.value]));
      return v.year + "-" + v.month + "-" + v.day;
    } catch {
      return String(stamp).slice(0, 10);
    }
  }
  /* Dollars typed by the owner, as whole cents; null when it is not an amount. */
  function cents(v) {
    const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(String(v ?? "").trim());
    return m ? Number(m[1]) * 100 + Number((m[2] || "").padEnd(2, "0")) : null;
  }
  const dollars = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (v) => (cents(v) === null ? "" : dollars(cents(v)));
  function listNames(names) {
    const n = names.filter(Boolean);
    return n.length < 3 ? n.join(" and ") : n.slice(0, -1).join(", ") + " and " + n[n.length - 1];
  }
  function safeName(n) {
    const name =
      String(n || "Document")
        .normalize("NFC")
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
        .replace(/^\.+/, "")
        .trim() || "Document";
    const letters = Array.from(name);
    if (letters.length <= 110) return name;
    const extension = name.match(/\.[a-z0-9]{1,10}$/i)?.[0] || "";
    return letters.slice(0, 110 - extension.length).join("") + extension;
  }
  const withoutExtension = (name) => String(name || "").replace(/\.[a-z0-9]{1,5}$/i, "");
  /* What a file really is, from its first bytes. */
  async function sniff(file) {
    const b = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const starts = (...sig) => sig.every((v, i) => b[i] === v);
    if (starts(37, 80, 68, 70, 45)) return "application/pdf";
    if (starts(255, 216, 255)) return "image/jpeg";
    if (starts(137, 80, 78, 71, 13, 10, 26, 10)) return "image/png";
    return "";
  }
  async function sha256(buffer) {
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  /* The bytes of a file that ships with the app, or null when it cannot be read. A page opened from a file
     on the computer is not allowed to read the files next to it, but it may load scripts, so there the
     bytes come from the file's script copy (legal-assets/<name>.pdf.js, written by build-static.cjs).
     The caller checks the bytes against the reviewed hash before using them, whichever way they came. */
  const fromFile = () => globalThis.location?.protocol === "file:";
  const REPLACE_FOLDER = "Replace the app’s folder on this computer with a complete copy of the app, then try again.";
  async function bundled(file) {
    if (!fromFile()) {
      const response = await fetch(file).catch(() => null);
      return response?.ok ? response.arrayBuffer().catch(() => null) : null;
    }
    const held = (globalThis.PM_BUNDLED = globalThis.PM_BUNDLED || {});
    const script = document.createElement("script");
    const loaded = await new Promise((resolve) => {
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      script.src = file + ".js";
      document.head.append(script);
    });
    script.remove();
    const text = held[file];
    delete held[file];
    if (!loaded || typeof text !== "string") return null;
    try {
      const raw = atob(text),
        bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      return bytes.buffer;
    } catch {
      return null;
    }
  }
  /* Signers as the earlier lease tool stored them: the landlord line, then one line per adult tenant. */
  function legacySigners(f) {
    return [["Landlord or agent", f?.landlord], ...String(f?.adults || "").split(/\r?\n/).map((n) => ["Tenant", n])]
      .filter(([, v]) => filled(v))
      .map(([role, n], i) => ({ id: "signer-" + i, name: String(n).trim(), role }));
  }
  /* The names a current record must list as signers: whoever signs for the landlord, then each tenant, then a
     co-signer when that clause is on. The same order as LeaseDocument.signers. */
  function signerNames(facts, tenants, clauses) {
    const f = facts || {};
    const first = f.signer === "manager" && filled(f.manager) ? clean(f.manager) : clean(f.landlord);
    const guarantor = clauses?.guarantor;
    const cosigner = guarantor?.on === true && filled(guarantor.opts?.name) ? clean(guarantor.opts.name) : "";
    return [first, ...(Array.isArray(tenants) ? tenants : []).map((t) => clean(t?.name)), cosigner].filter(Boolean);
  }
  const signable = (packet) => packet?.mode === "final" || packet?.mode === "reviewed";
  const evidenceFor = (packet, signatures) =>
    (signatures || []).filter((s) => s.packetId === packet.id && (packet.signers || []).some((x) => x.id === s.signerId));
  /* Where signing stands. `events` are the signature records for this lease. */
  function signState(packet, events) {
    const signers = Array.isArray(packet?.signers) ? packet.signers : [];
    const signed = new Map((events || []).map((e) => [e.signerId, e]));
    const missing = signers.filter((s) => !signed.has(s.id));
    const done = signers.length - missing.length;
    const state = !signable(packet) ? "draft" : signers.length && !missing.length ? "signed" : done ? "partly" : "ready";
    const label =
      state === "draft" ? "Earlier draft" : state === "signed" ? "Signed" : state === "partly" ? "Signed by " + done + " of " + signers.length : "Ready to sign";
    return { state, done, total: signers.length, missing, signed, label };
  }
  /* A deduction counts only when it is a documented item with an amount, a description and a receipt. */
  function itemReady(x) {
    return x.classification === "Documented deductible item" && x.amountCents > 0 && x.basis && x.evidence?.length;
  }
  const isAmendment = (packet) => packet?.facts?.kind === "Amendment";
  const isMonthly = (packet) => packet?.facts?.kind === "Month to month";
  function termText(f) {
    const start = isDate(f?.termStart) ? f.termStart : isDate(f?.start) ? f.start : "";
    if (f?.kind === "Month to month") return "Month to month" + (start ? ", starting " + longDate(start) : "");
    if (start && isDate(f?.end)) return longDate(start) + " through " + longDate(f.end);
    return start ? "Starting " + longDate(start) : "";
  }
  /* Reminders added to Tasks once everyone has signed. */
  function reminders(packet, signedDate, today) {
    const f = packet?.facts || {},
      out = [];
    const amendment = isAmendment(packet);
    const add = (key, title, due, notes) => out.push({ key, id: "lease-" + key + "-" + packet.id, title, due, notes });
    if (isDate(signedDate)) {
      const due = plusDays(signedDate, 15);
      add(
        "copy",
        amendment ? "Give each tenant a copy of the signed amendment" : "Give each tenant a copy of the signed lease",
        due < today ? today : due,
        amendment ? "" : "California gives you 15 days after the tenant signs.",
      );
    }
    if (!amendment && !isMonthly(packet) && isDate(f.end) && f.end >= today) {
      const due = plusDays(f.end, -90);
      add("renewal", "Lease ends: decide on renewal", due < today ? today : due, "The lease term ends " + longDate(f.end) + ".");
    }
    const moveIn = isDate(f.start) ? f.start : isDate(f.termStart) ? f.termStart : "";
    if (!amendment && f.kind !== "Renewal" && moveIn && moveIn >= today)
      add("photos", "Take move-in photos", moveIn, "Photograph the home right before or at move-in, so its condition is on record.");
    return out;
  }

  /* ---------- Safety: one save at a time, always into the rental it started in ---------- */
  let chain = Promise.resolve();
  function serial(task) {
    const run = chain.then(task, task);
    chain = run.catch(() => {});
    return run;
  }
  function openScope() {
    const p = pm(),
      dataset = p.dataset(),
      propertyId = p.prop()?.id;
    if (!propertyId) throw Error("Set up a rental first.");
    const here = () => {
      if (p.dataset() !== dataset || p.prop()?.id !== propertyId)
        throw Error("You switched to a different rental while this was saving, so nothing more was changed. Go back to the first rental and try again.");
      return p;
    };
    return {
      propertyId,
      here,
      blob: (b) => here().blob(b),
      file: (hash) => here().file(hash),
      async batch(items) {
        selfCheck(items);
        return here().batch(items);
      },
    };
  }
  /* Never write a lease record that a later restore would refuse. */
  function selfCheck(items) {
    const merged = new Map(pm().all().map((r) => [r.id, r]));
    for (const item of items) merged.set(item.id, { ...(merged.get(item.id) || {}), ...item });
    try {
      validateImport([...merged.values()], undefined, new Set(items.map((i) => i.id)));
    } catch (e) {
      throw Error("This could not be saved safely, so nothing was changed. " + (e?.message || ""));
    }
  }
  async function storedDoc(scope, blob, name, kind, tenancyId, more = {}) {
    return {
      type: "document",
      id: uid(),
      propertyId: scope.propertyId,
      tenancyId: tenancyId || "",
      hash: await scope.blob(blob),
      size: blob.size,
      mime: blob.type,
      name,
      filename: name,
      kind,
      date: pm().today(),
      created: new Date().toISOString(),
      version: 1,
      immutable: true,
      ...more,
    };
  }
  /* The owner's upload as a blob of its real type; plain-word errors name the form field. */
  class FormError extends Error {
    constructor(field, message) {
      super(message);
      this.field = field;
    }
  }
  async function signedUpload(file, field, what) {
    if (!(file instanceof Blob) || !file.size) throw new FormError(field, "Choose the " + what + " first.");
    if (file.size > MAX_FILE) throw new FormError(field, "That file is larger than 32 MB. Choose a smaller scan or photo.");
    const type = await sniff(file);
    if (!type) throw new FormError(field, "That file is not a PDF, JPEG or PNG. Scan or photograph the pages and choose that file.");
    return new Blob([file], { type });
  }

  /* ---------- Finalizing: the lease, its handouts and attachments, in one folder ---------- */
  function buildFile(lease, draft) {
    const doc = writer().build(lease, { draft, today: pm().today() });
    try {
      return { blob: globalThis.Files.pdfDoc(doc), html: false };
    } catch (e) {
      if (e?.code !== "PDF_TEXT_UNSUPPORTED") throw e;
      return { blob: new Blob([globalThis.Files.htmlDoc(doc, { standalone: true })], { type: "text/html" }), html: true };
    }
  }
  async function draft(lease) {
    if (!lease?.facts) throw Error("Open the lease in the builder first.");
    const made = buildFile(lease, true);
    return { blob: made.blob, name: safeName(lease.name || writer().title(lease)) + " (draft)" + (made.html ? ".html" : ".pdf"), html: made.html };
  }
  function readMe(lease, packet, leasePath, analysis, today) {
    const f = lease.facts || {},
      D = writer(),
      thing = f.kind === "Amendment" ? "amendment" : "lease";
    const needed = analysis.items.filter((i) => i.state === "attention");
    const after = analysis.items.filter((i) => i.kind === "todo" && i.state === "included");
    const later = analysis.items.filter((i) => i.kind === "todo" && i.state === "reminder");
    return (
      "﻿" +
      [
        packet.name,
        D.title(lease) + (D.address(f) ? " for " + D.address(f) : ""),
        "Prepared " + longDate(today) + ".",
        "",
        "BEFORE ANYONE SIGNS",
        "Give each tenant a copy of everything in this folder:",
        "  1. " + leasePath + " (the " + thing + ")",
        ...packet.attachments.map((a, i) => "  " + (i + 2) + ". " + a.path),
        ...(needed.length ? ["", "ALSO NEEDED FROM YOU BEFORE SIGNING", ...needed.map((i) => "  - " + i.title + ": " + i.summary)] : []),
        "",
        "SIGNING",
        "Each person signs and dates the " + thing + ":",
        ...packet.signers.map((s) => "  - " + s.name + " (" + s.role + ")"),
        "",
        "AFTER SIGNING",
        "  - In Property Manager, open Leases and record the signed " + thing + ".",
        ...(after.length ? after.map((i) => "  - " + i.summary) : ["  - Give each tenant a copy of the signed " + thing + "."]),
        ...(later.length ? ["", "ALSO FOR YOU TO DO (NOT PART OF THE " + thing.toUpperCase() + ")", ...later.map((i) => "  - " + i.title + ": " + i.summary)] : []),
        "",
        "This " + thing + " follows California and City of San Diego requirements as reviewed on " + longDate(law().reviewed) + ".",
        "It is not legal advice. For anything unusual, have an attorney look it over.",
        "",
      ].join("\r\n")
    );
  }
  function finalize(lease) {
    return serial(async () => {
      const p = pm(),
        scope = openScope(),
        today = p.today(),
        D = writer();
      if (!lease || typeof lease !== "object" || !lease.id || lease.schema !== 2 || !lease.facts || typeof lease.facts !== "object")
        throw Error("Open this lease in the builder and finish it there first.");
      if (lease.propertyId && lease.propertyId !== scope.propertyId)
        throw Error("This lease belongs to a different rental. Switch to that rental, then make it final.");
      const missing = D.missing(lease, today);
      if (missing.length)
        throw Error(
          missing.length === 1
            ? "One thing is still needed before this lease can be final. " + missing[0].label
            : missing.length + " things are still needed before this lease can be final. The first: " + missing[0].label,
        );
      if (lease.reviewedInputs !== true) throw Error("Before making it final, confirm that you have read the whole lease and the terms are right.");

      const f = lease.facts,
        amendment = f.kind === "Amendment",
        analysis = law().analyze(lease, today),
        made = buildFile(lease, false),
        packetId = uid(),
        when = new Date().toISOString(),
        title = D.title(lease),
        name = clean(lease.name) || title,
        base = safeName(name);
      let tenancyId = lease.tenancyId || "",
        tenancy = null;
      const linked = tenancyId ? p.get(tenancyId) : null;
      if (!linked || linked.type !== "tenancy" || linked.propertyId !== scope.propertyId) {
        tenancy = {
          type: "tenancy",
          id: uid(),
          propertyId: scope.propertyId,
          unitId: p.records("unit")[0]?.id || "",
          name: listNames(D.tenants(lease).map((t) => t.name)) || "Tenant",
          start: isDate(f.start) ? f.start : isDate(f.termStart) ? f.termStart : "",
        };
        tenancyId = tenancy.id;
      }

      const entries = [],
        copies = [],
        attachments = [];
      let size = 0;
      const add = (path, blob) => {
        size += blob.size;
        if (size > MAX_FOLDER)
          throw Error("Together these files are larger than 32 MB, the most this app can keep in one folder. Remove or shrink an attachment and try again.");
        entries.push({ name: path, data: blob });
      };
      const leasePath = made.html ? "Lease.html" : "Lease.pdf";
      const leaseFile = await storedDoc(scope, made.blob, base + (made.html ? ".html" : ".pdf"), amendment ? "Amendment" : "Lease", tenancyId, { packetId });
      add(leasePath, made.blob);

      for (const handout of analysis.attachments) {
        const bytes = await bundled(handout.path);
        if (!bytes)
          throw Error(
            "A booklet that goes with this lease could not be opened: " + handout.name + ". " +
              (fromFile() ? "The app’s folder on this computer is missing a file. " + REPLACE_FOLDER : "Connect to the internet once so the app can finish installing, then try again."),
          );
        const head = String.fromCharCode(...new Uint8Array(bytes.slice(0, 5)));
        if (head !== "%PDF-" || (await sha256(bytes)) !== handout.hash)
          throw Error("The copy of this booklet on your device is damaged: " + handout.name + ". " + (fromFile() ? REPLACE_FOLDER : "Reload the app to repair it, then try again."));
        const blob = new Blob([bytes], { type: "application/pdf" });
        const path = "handouts/" + safeName(handout.name) + ".pdf";
        const copy = await storedDoc(scope, blob, safeName(handout.name) + ".pdf", "Disclosure", tenancyId, { packetId, source: "Bundled handout" });
        add(path, blob);
        copies.push(copy);
        attachments.push({ id: copy.id, sourceId: "", hash: copy.hash, name: copy.name, path });
      }
      for (const [i, docId] of [...new Set(Array.isArray(lease.attachments) ? lease.attachments : [])].entries()) {
        const original = p.get(docId);
        if (!original || original.type !== "document" || !original.hash || (original.propertyId && original.propertyId !== scope.propertyId))
          throw Error("One of your attachments is no longer in Documents. Go back to the Review step and choose your attachments again.");
        const stored = await scope.file(original.hash);
        if (!(stored instanceof Blob)) throw Error("The file for one of your attachments is missing from this device: " + (original.name || "attachment") + ".");
        const label = original.name || original.filename || "Attachment";
        const blob = new Blob([stored], { type: original.mime || stored.type || "application/octet-stream" });
        const path = "attachments/" + String(i + 1).padStart(2, "0") + "-" + safeName(label);
        const copy = await storedDoc(scope, blob, label, original.kind || "Other", tenancyId, { packetId, sourceId: original.id });
        add(path, blob);
        copies.push(copy);
        attachments.push({ id: copy.id, sourceId: original.id, hash: copy.hash, name: copy.name, path });
      }

      const packet = {
        type: "leasePacket",
        schema: 2,
        id: packetId,
        immutable: true,
        propertyId: scope.propertyId,
        tenancyId,
        leaseId: lease.id,
        parentPacket: lease.parentPacket || "",
        name,
        mode: "final",
        generated: when,
        lawVersion: law().version,
        packageVersion: law().version,
        template: TEMPLATE,
        facts: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v == null ? "" : String(v)])),
        tenants: clone(Array.isArray(lease.tenants) ? lease.tenants : []),
        clauses: clone(lease.clauses || {}),
        customClauses: clone(Array.isArray(lease.customClauses) ? lease.customClauses : []),
        review: analysis.items.map((i) => ({ id: i.id, title: i.title, kind: i.kind, status: i.state, summary: i.summary || "", why: i.why || "", cite: i.cite || "" })),
        signers: D.signers(lease),
        attachments,
        worksheetId: leaseFile.id,
        contractId: leaseFile.id,
        archiveId: "",
        archiveHash: "",
      };
      add("READ ME FIRST.txt", new Blob([readMe(lease, packet, leasePath, analysis, today)], { type: "text/plain" }));
      const archive = await storedDoc(scope, await globalThis.Files.zip(entries), base + " (everything to sign).zip", amendment ? "Amendment" : "Lease", tenancyId, { packetId });
      packet.archiveId = archive.id;
      packet.archiveHash = archive.hash;
      const saved = await scope.batch([
        ...(tenancy ? [tenancy] : []),
        leaseFile,
        ...copies,
        archive,
        packet,
        { ...lease, type: "lease", propertyId: scope.propertyId, tenancyId, lawVersion: law().version, finalPacket: packetId },
      ]);
      return saved.find((r) => r.id === packetId) || packet;
    });
  }

  /* ---------- Where each lease stands ---------- */
  const newestFirst = (a, b) => String(b.generated || "").localeCompare(String(a.generated || ""));
  const operativeFor = (tenancyId) => (tenancyId ? pm().records("operativeLease").find((o) => o.tenancyId === tenancyId) || null : null);
  const mainDocId = (packet) => (packet.mode === "draft" ? packet.worksheetId : packet.contractId || packet.worksheetId);
  const uploaded = (packet) => packet.schema === 2 && packet.mode === "reviewed";
  function docTitle(packet) {
    if (packet.mode === "draft") return "Draft worksheet";
    if (uploaded(packet)) return "Signed lease on file";
    const kind = packet.facts?.kind;
    return kind === "Amendment" ? "Lease Amendment" : kind === "Renewal" ? "Lease Renewal Agreement" : kind === "Month to month" ? "Month-to-Month Rental Agreement" : "Residential Lease Agreement";
  }
  function addressOf(packet) {
    const f = packet.facts || {};
    return packet.schema === 2 && writer()?.address ? writer().address(f) : clean(f.premises);
  }
  function tenantNames(packet) {
    return packet.schema === 2
      ? (packet.tenants || []).map((t) => clean(t?.name)).filter(Boolean)
      : String(packet.facts?.adults || "").split(/\r?\n/).map(clean).filter(Boolean);
  }
  /* The label for a lease that is in force. */
  function activeLabel(packet, tenancy, today) {
    const f = packet.facts || {};
    const start = isDate(f.termStart) ? f.termStart : isDate(f.start) ? f.start : "";
    const end = isMonthly(packet) || !isDate(f.end) ? "" : f.end;
    if (tenancy?.end && tenancy.end < today) return { ended: true, label: "Ended " + longDate(tenancy.end), detail: "The tenant has moved out." };
    if (isAmendment(packet)) return { label: "Signed amendment on file", detail: "" };
    if (start && start > today) return { label: "Starts " + longDate(start), detail: end ? "Signed. Runs through " + longDate(end) + "." : "Signed. Month to month." };
    if (end && end < today) return { label: "Month to month since " + longDate(plusDays(end, 1)), detail: "The fixed term ended " + longDate(end) + "." };
    if (end) return { label: "Active until " + longDate(end), detail: "" };
    return { label: start ? "Month to month since " + longDate(start) : "Active lease", detail: "" };
  }
  function standing(packet) {
    const p = pm(),
      today = p.today();
    const events = evidenceFor(packet, p.records("signature"));
    const sign = signState(packet, events);
    const tenancy = packet.tenancyId ? p.get(packet.tenancyId) || null : null;
    const op = operativeFor(packet.tenancyId);
    const execution =
      p
        .records("execution")
        .filter((e) => e.packetId === packet.id)
        .sort((a, b) => String(b.confirmed || "").localeCompare(String(a.confirmed || "")))[0] || null;
    const latest = events.slice().sort((a, b) => String(b.signedDate).localeCompare(String(a.signedDate)))[0];
    const info = { sign, events, tenancy, op, execution, signedDocId: execution?.signedDoc || latest?.documentId || "" };
    if (op && op.packetId === packet.id) {
      const live = activeLabel(packet, tenancy, today);
      info.role = live.ended ? "ended" : "active";
      info.chip = live.ended ? ["muted", "Ended"] : ["ok", "Active lease"];
      info.line = live.label + "." + (live.detail ? " " + live.detail : "");
      info.signedDocId = op.signedDoc || info.signedDocId;
    } else if (op && (op.amendments || []).includes(packet.id)) {
      info.role = "amendment";
      info.chip = ["ok", "Signed amendment"];
      info.line = "This amendment is part of the active lease.";
    } else if (execution) {
      info.role = "replaced";
      info.chip = ["muted", "Earlier lease"];
      info.line = "A newer lease has replaced this one. It stays here for your records.";
    } else if (sign.state === "draft") {
      info.role = "draft";
      info.chip = ["muted", "Earlier draft"];
      info.line = "Made " + longDate(stampDay(packet.generated)) + " with the earlier lease tool.";
    } else if (sign.state === "signed") {
      info.role = "signed";
      info.chip = ["due", "Signed"];
      info.line = "Everyone has signed. Make it the active lease below.";
    } else {
      info.role = "open";
      info.chip = ["due", sign.label];
      info.line =
        sign.state === "partly"
          ? "Still to sign: " + listNames(sign.missing.map((s) => s.name)) + "."
          : "Made final " + longDate(stampDay(packet.generated)) + ". Nothing is signed yet.";
    }
    return info;
  }
  function statusFor(tenancyId) {
    const p = pm(),
      today = p.today(),
      tenancy = p.get(tenancyId) || null;
    const result = { state: "none", label: "No lease on file", detail: "", packetId: "", signedDocId: "", starts: "", ends: "", rent: "", activePacketId: "", pendingPacketId: "" };
    if (!tenancyId) return result;
    const packets = p.records("leasePacket").filter((x) => x.tenancyId === tenancyId && signable(x)).sort(newestFirst);
    const op = operativeFor(tenancyId);
    const active = op ? p.get(op.packetId) || null : null;
    const executions = p.records("execution").filter((e) => e.tenancyId === tenancyId);
    const settled = new Set(executions.map((e) => e.packetId));
    const lastConfirmed = executions.map((e) => String(e.confirmed || "")).sort().pop() || "";
    const newest = packets.find((x) => !settled.has(x.id));
    const pending = newest && (!lastConfirmed || String(newest.generated || "") > lastConfirmed) ? newest : null;
    const describe = (packet) => {
      const f = packet.facts || {};
      result.starts = isDate(f.termStart) ? f.termStart : isDate(f.start) ? f.start : "";
      result.ends = isMonthly(packet) || !isDate(f.end) ? "" : f.end;
      result.rent = cents(f.rent) === null ? "" : String(f.rent).trim();
    };
    if (active) {
      const live = activeLabel(active, tenancy, today);
      result.state = live.ended ? "ended" : "active";
      result.label = live.label;
      const changes = (op.amendments || []).length;
      result.detail = [live.detail, changes ? changes + (changes === 1 ? " amendment" : " amendments") + " on file." : ""].filter(Boolean).join(" ");
      result.packetId = result.activePacketId = active.id;
      result.signedDocId = op.signedDoc || "";
      describe(active);
    }
    if (pending) {
      const sign = signState(pending, evidenceFor(pending, p.records("signature")));
      const what = isAmendment(pending) ? "Amendment" : pending.facts?.kind === "Renewal" ? "Renewal" : "Lease";
      result.detail = active
        ? "Current lease: " + result.label.charAt(0).toLowerCase() + result.label.slice(1) + "."
        : sign.state === "partly"
          ? "Still to sign: " + listNames(sign.missing.map((s) => s.name)) + "."
          : sign.state === "signed"
            ? "Open it to make it the active lease."
            : "Give it to your tenant, then record the signed copy.";
      result.state = sign.state === "ready" ? "ready" : "partly-signed";
      result.label = active ? what + (sign.state === "ready" ? " ready to sign" : " signed by " + sign.done + " of " + sign.total) : sign.state === "ready" ? "Ready to sign" : "Signed by " + sign.done + " of " + sign.total;
      result.packetId = result.pendingPacketId = pending.id;
      if (!active) describe(pending);
    }
    return result;
  }
  function history() {
    const p = pm(),
      shown = new Set();
    for (const t of p.records("tenancy")) {
      const s = statusFor(t.id);
      [s.activePacketId, s.pendingPacketId].forEach((id) => id && shown.add(id));
    }
    return p
      .records("leasePacket")
      .filter((x) => !shown.has(x.id))
      .sort(newestFirst)
      .map((x) => {
        const info = standing(x);
        const label =
          info.role === "amendment"
            ? "Signed amendment"
            : info.role === "replaced"
              ? "Earlier lease"
              : info.role === "draft"
                ? "Earlier draft"
                : info.role === "signed"
                  ? "Signed"
                  : info.sign.state === "partly"
                    ? info.sign.label
                    : "Not signed";
        return { id: x.id, name: x.name || docTitle(x), generated: x.generated || "", mode: x.mode, label, date: shortDate(stampDay(x.generated)), tenancyId: x.tenancyId || "", tenant: p.get(x.tenancyId)?.name || "" };
      });
  }
  function depositReturns() {
    const p = pm();
    return p.records("depositReturn").map((r) => ({
      id: r.id,
      label: p.get(r.tenancyId)?.name || "Tenant",
      detail: r.delivered ? "Refund sent " + longDate(r.delivered) : r.deadline ? "Refund due by " + longDate(r.deadline) : "Move-out date not set",
    }));
  }

  /* ---------- The lease page ---------- */
  const onLeases = () => String(globalThis.location?.hash || "").toLowerCase().startsWith("#leases");
  const shown = (id) => Boolean(pm().content()?.querySelector('.lp-page[data-packet-id="' + CSS.escape(id) + '"]'));
  function goHome() {
    const p = pm();
    if (typeof p.setRoute === "function") return p.navigate("Leases", "");
    p.navigate("Leases");
  }
  function goPacket(id) {
    const p = pm();
    if (typeof p.setRoute === "function") p.navigate("Leases", "packet/" + id);
    if (!shown(id)) page(id);
    focusTop();
  }
  function focusTop() {
    const h = pm().content()?.querySelector(".lp-page h1");
    globalThis.scrollTo?.(0, 0);
    h?.focus({ preventScroll: true });
  }
  /* Redraw after a save. The Leases screen usually does it; this covers the times it does not. */
  async function refreshPage(id) {
    const mine = shown(id);
    await pm().refresh();
    if (!mine) return; // the owner moved on while it was saving
    if (!shown(id) && onLeases()) page(id);
    if (shown(id)) focusTop();
  }
  /* A button on this page. Its id lets the shell return the focus to it after a dialog closes or
     the page is drawn again. `label` is trusted markup. */
  function btn(action, ref, label, options = {}) {
    const key = options.key || ref;
    return `<button type="button" id="${esc("lp-" + action + (key ? "-" + key : ""))}"${options.cls ? ` class="${options.cls}"` : ""} data-packet="${esc(action)}"${ref ? ` data-ref="${esc(ref)}"` : ""}${options.name ? ` aria-label="${esc(options.name)}"` : ""}>${label}</button>`;
  }
  const backLink = () => btn("home", "", `${ico("chevron", 16)}<span>All leases</span>`, { cls: "lp-back ui-quiet" });
  const zipButton = (packet) =>
    pm().get(packet.archiveId)?.mime === "application/zip" ? btn("zip", packet.id, `${ico("download", 17)}Download everything (ZIP)`) : "";
  /* One row in a list of next steps: the whole row is the button. `attrs` is trusted markup. */
  const choice = (attrs, title, text) =>
    `<li><button type="button" class="lp-choice" ${attrs}><span class="lp-choice-text"><b>${esc(title)}</b><small>${esc(text)}</small></span>${ico("chevron", 16)}</button></li>`;
  function fileRow(doc, title, meta) {
    const icon = `<span class="lp-file-icon" aria-hidden="true">${ico("file", 20)}</span>`;
    if (!doc) return `<li class="lp-file">${icon}<span class="lp-file-text"><b>${esc(title)}</b><small>This file is not on this device. Restore a backup that has it.</small></span></li>`;
    const save = doc.mime === "text/html" || doc.mime === "application/zip";
    return `<li class="lp-file">${icon}<span class="lp-file-text"><b>${esc(title)}</b>${meta ? `<small>${esc(meta)}</small>` : ""}</span>${btn(save ? "download" : "open", doc.id, save ? "Download" : "Open", { name: (save ? "Download " : "Open ") + title })}</li>`;
  }
  function fileRows(packet) {
    const p = pm();
    const main = p.get(mainDocId(packet));
    const booklets = new Map(Object.values(law()?.handouts || {}).map((h) => [h.hash, h]));
    const kind = main?.mime === "text/html" ? "Web page" : main?.mime === "application/pdf" ? "PDF" : main ? "Photo" : "";
    const rows = [fileRow(main, packet.mode === "draft" ? "The draft" : isAmendment(packet) ? "The amendment" : "The lease", kind)];
    for (const a of packet.attachments || []) {
      if (a.id === packet.contractId) continue;
      const known = booklets.get(a.hash);
      const mine = /^(attachments|exhibits)\//.test(a.path || "");
      rows.push(fileRow(p.get(a.id), known ? known.name : withoutExtension(a.name), known ? "Booklet · " + known.pages + " pages" : mine ? "Your attachment" : "Booklet"));
    }
    return `<ul class="lp-files">${rows.join("")}</ul>`;
  }
  function keyFacts(packet, info) {
    const f = packet.facts || {},
      rows = [],
      names = tenantNames(packet);
    if (names.length) rows.push([names.length > 1 ? "Tenants" : "Tenant", listNames(names)]);
    if (filled(f.landlord)) rows.push(["Landlord", clean(f.landlord)]);
    if (isAmendment(packet)) {
      if (isDate(f.termStart)) rows.push(["Takes effect", longDate(f.termStart)]);
    } else {
      if (termText(f)) rows.push(["Term", termText(f)]);
      if (cents(f.rent) !== null) rows.push(["Rent", money(f.rent) + " a month"]);
      if (cents(f.deposit) !== null) rows.push(["Security deposit", cents(f.deposit) === 0 ? "None" : money(f.deposit)]);
    }
    const last = info.events.map((e) => e.signedDate).filter(isDate).sort().pop();
    if (uploaded(packet)) rows.push(["Added here", longDate(stampDay(packet.generated))]);
    else if (last && info.sign.state === "signed") rows.push(["Signed", longDate(last)]);
    return `<dl class="lp-facts">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;
  }
  function signedRows(packet, info) {
    return (packet.signers || [])
      .filter((s) => info.sign.signed.has(s.id))
      .map((s) => {
        const e = info.sign.signed.get(s.id);
        return `<li class="lp-file"><span class="lp-file-icon lp-done" aria-hidden="true">${ico("check", 18)}</span><span class="lp-file-text"><b>${esc(s.name)}</b><small>${esc(s.role)}${uploaded(packet) ? "" : " · signed " + esc(shortDate(e.signedDate))}</small></span>${btn("open", e.documentId, "Open", { key: "by-" + s.id, name: "Open the copy signed by " + s.name })}</li>`;
      })
      .join("");
  }
  function signForm(packet, info) {
    const U = kit(),
      today = pm().today(),
      thing = isAmendment(packet) ? "amendment" : "lease";
    const rest = info.sign.missing;
    const recorded = signedRows(packet, info);
    return (
      (recorded ? `<ul class="lp-files" aria-label="Already recorded">${recorded}</ul>` : "") +
      `<form id="lp-sign" class="ui-stack lp-form" data-ref="${esc(packet.id)}" novalidate>` +
      U.field({ label: "Signed copy", name: "document", type: "file", help: "A scan or a clear photo of the signed " + thing + ". PDF, JPEG or PNG.", attrs: 'accept="application/pdf,image/jpeg,image/png"' }) +
      U.field({ label: "Date signed", name: "signedDate", type: "date", value: today, attrs: 'max="' + esc(today) + '"' }) +
      U.chips({
        label: recorded ? "Who signed this copy" : "Who signed",
        name: "signers",
        options: rest.map((s) => [s.id, s.name + " (" + s.role + ")"]),
        values: rest.map((s) => s.id),
        help: rest.length > 1 ? "Untick anyone who has not signed yet. You can add their copy later." : "",
      }) +
      `<p class="lp-error" role="alert" hidden></p><div class="lp-actions"><button type="submit" class="primary">Save signed ${thing}</button></div></form>`
    );
  }
  function checklist(packet, info) {
    const U = kit(),
      p = pm(),
      today = p.today(),
      amendment = isAmendment(packet),
      thing = amendment ? "amendment" : "lease";
    const main = p.get(mainDocId(packet));
    const web = main?.mime === "text/html";
    const needed = (packet.review || []).filter((r) => r.status === "attention");
    const coming = reminders(packet, today, today);
    const extras = (packet.attachments || []).some((a) => a.id !== packet.contractId);
    const zip = zipButton(packet);
    const step = (n, title, body) =>
      `<li class="lp-card lp-step"><span class="lp-num" aria-hidden="true">${n}</span><div class="lp-step-body"><h2>${esc(title)}</h2>${body}</div></li>`;
    const one =
      `<p class="lp-help">${extras ? "Your tenant should have a copy of each of these before anyone signs." : "Your tenant should have a copy to read before anyone signs."}</p>` +
      fileRows(packet) +
      (web ? U.note("info", "<p>This lease uses characters the PDF writer cannot draw, so it is saved as a web page. Open it and choose Print, then Save as PDF.</p>") : "") +
      (needed.length
        ? U.note("warn", "<p><b>Also needed from you before signing</b></p>" + needed.map((r) => `<p>${esc(r.title)}: ${esc(r.summary || r.why || "")}</p>`).join(""))
        : "") +
      (zip ? `<div class="lp-actions">${zip}</div>` : "");
    const two =
      `<p class="lp-help">Everyone signs and dates the ${thing}: ${esc(listNames((packet.signers || []).map((s) => s.name)))}. Print it to sign by hand, or email it to your tenant.</p>` +
      `<div class="lp-actions">${main ? btn("print", packet.id, ico("file", 17) + (web ? "Download the " + thing : "Print the " + thing)) : ""}${p.get(packet.archiveId) ? btn("email", packet.id, ico("mail", 17) + "Email the " + thing) : ""}</div>`;
    const three =
      info.role === "signed"
        ? `<p class="lp-help">Everyone has signed.</p><ul class="lp-files">${signedRows(packet, info)}</ul><div class="lp-actions">${btn("activate", packet.id, "Make this the active lease", { cls: "primary" })}</div>`
        : `<p class="lp-help">When the signed pages come back, save a copy here. Once everyone has signed, this becomes ${amendment ? "part of your active lease" : "your active lease"}.</p>` + signForm(packet, info);
    const four =
      `<p class="lp-help">When everyone has signed, these reminders are added to Tasks for you.</p><ul class="lp-list">` +
      coming.map((r) => `<li><b>${esc(r.title)}</b><small>${r.key === "copy" ? "Within 15 days of signing" : esc(longDate(r.due))}</small></li>`).join("") +
      "</ul>";
    return (
      `<ol class="lp-steps">` +
      step(1, amendment && !extras ? "Give this to your tenant before signing" : "Give these to your tenant before signing", one) +
      step(2, "Sign", two) +
      step(3, "Record the signed " + thing, three) +
      step(4, "Afterwards", four) +
      "</ol>" +
      (packet.schema === 2
        ? `<section class="lp-card lp-aside"><div><h2>Need to change something?</h2><p class="lp-help">Start a new draft with the same answers. This version stays in your history.</p></div><button type="button" data-lease="revise" data-ref="${esc(packet.id)}">Make changes</button></section>`
        : "")
    );
  }
  function rentCard(packet, tenancy) {
    const want = cents(packet.facts?.rent);
    if (!tenancy || isAmendment(packet)) return "";
    const tracked = isDate(tenancy.nextDue) && tenancy.rentCents > 0;
    if (!tracked)
      return `<section class="lp-card lp-aside"><div><h2>Rent is not being tracked yet</h2><p class="lp-help">Turn on rent tracking to see what is due and what has been paid.</p></div>${btn("track", tenancy.id, "Track rent for this lease")}</section>`;
    const rates = [tenancy.rentCents, ...(tenancy.rentChanges || []).map((c) => c.rentCents)];
    if (want && !rates.includes(want))
      return `<section class="lp-card lp-aside"><div><h2>The rent has changed</h2><p class="lp-help">This lease sets the rent at ${esc(dollars(want))} a month. Rent tracking is using a different amount.</p></div>${btn("track", tenancy.id, "Update rent tracking")}</section>`;
    return "";
  }
  function taskRows(packet) {
    const tasks = pm()
      .records("task")
      .filter((t) => t.packetId === packet.id)
      .sort((a, b) => String(a.due || "").localeCompare(String(b.due || "")));
    if (!tasks.length) return "";
    return (
      `<section class="lp-card"><h2>Reminders</h2><ul class="lp-list">` +
      tasks.map((t) => `<li><b>${esc(t.title)}</b><small>${t.completed ? "Done" : "Due " + esc(longDate(t.due))}</small></li>`).join("") +
      `</ul><div class="lp-actions">${btn("tasks", "", "Open Tasks")}</div></section>`
    );
  }
  function settled(packet, info) {
    const U = kit(),
      p = pm();
    const copy = p.get(info.signedDocId);
    const others = [...new Set(info.events.map((e) => e.documentId))].filter((id) => id && id !== info.signedDocId);
    const live = info.role === "active" || info.role === "ended";
    const heading = info.role === "amendment" ? "Signed amendment" : info.role === "replaced" ? "Earlier lease" : info.role === "ended" ? "Lease on file" : "Your active lease";
    let html =
      `<section class="lp-card"><h2>${heading}</h2>${keyFacts(packet, info)}<div class="lp-actions">` +
      (copy ? btn("open", copy.id, ico("file", 17) + "Open signed copy", { cls: "primary", key: "signed-copy" }) : "") +
      zipButton(packet) +
      "</div>" +
      (others.length && !uploaded(packet) ? U.more("Each person’s signed copy", `<ul class="lp-files">${signedRows(packet, info)}</ul>`) : "") +
      "</section>";
    if (info.role === "active") html += rentCard(packet, info.tenancy);
    if (!live) {
      const current = info.op ? p.get(info.op.packetId) : null;
      if (current)
        html += `<section class="lp-card lp-aside"><div><h2>${info.role === "amendment" ? "The lease it changes" : "The lease in force now"}</h2><p class="lp-help">${esc(current.name || docTitle(current))}</p></div>${btn("view", current.id, "View lease")}</section>`;
    } else {
      const changes = (info.op.amendments || []).map((id) => p.get(id)).filter(Boolean);
      const lease = (action) => `data-lease="${action}" data-ref="${esc(action === "newFor" ? packet.tenancyId : packet.id)}"`;
      html +=
        `<section class="lp-card"><h2>When something changes</h2><ul class="lp-choices">` +
        (packet.schema === 2
          ? (info.role === "active" ? choice(lease("renew"), "Renew", "The term is ending and your tenant is staying.") + choice(lease("amend"), "Amend", "One part is changing, such as the rent or who lives there.") : "") +
            (uploaded(packet) ? "" : choice(lease("revise"), "Make changes", "Something in this lease is wrong and needs to be signed again."))
          : choice(lease("newFor"), "Create a lease", "This one came from the earlier lease tool. To renew or change it, write a new one.")) +
        choice(`id="${esc("lp-deposit-" + packet.tenancyId)}" data-packet="deposit" data-ref="${esc(packet.tenancyId)}"`, "Return the deposit", "Your tenant is moving out.") +
        "</ul></section>";
      if (changes.length)
        html +=
          `<section class="lp-card"><h2>Amendments</h2><ul class="lp-files">` +
          changes.map((c) => `<li class="lp-file"><span class="lp-file-icon" aria-hidden="true">${ico("file", 20)}</span><span class="lp-file-text"><b>${esc(c.name || "Lease Amendment")}</b><small>${isDate(c.facts?.termStart) ? "Takes effect " + esc(longDate(c.facts.termStart)) : ""}</small></span>${btn("view", c.id, "View", { name: "View " + (c.name || "amendment") })}</li>`).join("") +
          "</ul></section>";
    }
    html += taskRows(packet);
    if (!uploaded(packet)) html += `<section class="lp-card lp-fold">${U.more(isAmendment(packet) ? "What your tenant received" : "What your tenant received with the lease", fileRows(packet))}</section>`;
    return html;
  }
  function oldDraft(packet) {
    return (
      `<section class="lp-card"><h2>An earlier draft</h2><p class="lp-help">This worksheet came from the earlier lease tool. It is kept for your records and cannot be signed here. To write a lease you can sign, create a new one.</p>` +
      fileRows(packet) +
      `<div class="lp-actions"><button type="button" class="primary" data-lease="${packet.tenancyId ? "newFor" : "create"}" data-ref="${esc(packet.tenancyId || "")}">Create a lease</button>${zipButton(packet)}</div></section>`
    );
  }
  function page(packetId) {
    const p = pm(),
      root = p.content();
    if (!root) return;
    const packet = packetId ? p.get(packetId) : null;
    if (!packet || packet.type !== "leasePacket" || packet.propertyId !== p.prop()?.id) {
      root.innerHTML = `<section class="lp-page">${backLink()}${kit().empty({ icon: "leases", title: "That lease is not here", text: "It may belong to a different rental. Go back to Leases to see the ones for this rental." })}</section>`;
      return;
    }
    const info = standing(packet);
    const parent = packet.parentPacket ? p.get(packet.parentPacket) : null;
    const kind = docTitle(packet),
      where = addressOf(packet);
    root.innerHTML =
      `<section class="lp-page" data-packet-id="${esc(packet.id)}">${backLink()}` +
      `<header class="lp-head"><div class="lp-head-text"><h1 tabindex="-1">${esc(packet.name || kind)}</h1><p class="lp-sub">${esc([kind, where].filter(Boolean).join(" · "))}</p></div>${kit().status(info.chip[0], info.chip[1])}</header>` +
      `<p class="lp-state">${esc(info.line)}</p>` +
      (parent && (info.role === "open" || info.role === "signed")
        ? `<div class="lp-actions">${btn("view", parent.id, isAmendment(packet) ? "See the lease it changes" : packet.facts?.kind === "Renewal" ? "See the lease it renews" : "See the version it came from", { cls: "ui-quiet" })}</div>`
        : "") +
      (info.role === "draft" ? oldDraft(packet) : info.role === "open" || info.role === "signed" ? checklist(packet, info) : settled(packet, info)) +
      "</section>";
  }

  /* ---------- Recording signatures ---------- */
  function fieldProblem(form, e) {
    form.querySelectorAll(".ui-error").forEach((n) => n.remove());
    form.querySelectorAll(".is-invalid").forEach((n) => n.classList.remove("is-invalid"));
    form.querySelectorAll("[aria-invalid]").forEach((n) => n.removeAttribute("aria-invalid"));
    const box = form.querySelector(".lp-error");
    if (box) box.hidden = true;
    if (!e) return;
    const named = e.field ? form.elements.namedItem(e.field) : null;
    const control = named && typeof named.length === "number" && !named.tagName ? named[0] : named;
    if (control) {
      const holder = control.closest(".ui-field, .ui-group") || control.parentElement;
      holder.classList.add("is-invalid");
      control.setAttribute("aria-invalid", "true");
      const note = document.createElement("p");
      note.className = "ui-error";
      note.setAttribute("role", "alert");
      note.textContent = e.message;
      holder.append(note);
      for (let d = control.closest("details"); d; d = d.parentElement?.closest("details")) d.open = true;
      control.focus();
      note.scrollIntoView({ block: "nearest" });
      return;
    }
    const text = e.field
      ? e.message
      : e?.name === "QuotaExceededError"
        ? "This device is out of storage space, so nothing was saved. Your entries are still here. Free some space and try again."
        : "That did not save. Your entries are still here. " + (e?.message || "Try again.");
    if (!box) return pm().error(Error(text));
    box.textContent = text;
    box.hidden = false;
    box.scrollIntoView({ block: "nearest" });
  }
  /* The earliest day a tenant signed: the 15 days for giving the tenant a copy run from then. */
  function tenantSigned(packet, dates) {
    return (packet.signers || [])
      .filter((x) => x.role === "Tenant")
      .map((x) => dates.get(x.id))
      .filter(isDate)
      .sort()[0];
  }
  /* Everything that changes when the last signature is in: the active lease and its reminders. */
  function activation(packet, signedDocId, signedDate, today, copyFrom = signedDate) {
    const p = pm();
    const f = packet.facts || {};
    const effective = isDate(f.termStart) ? f.termStart : isDate(f.start) ? f.start : signedDate;
    const execution = {
      type: "execution",
      id: uid(),
      immutable: true,
      propertyId: packet.propertyId,
      tenancyId: packet.tenancyId,
      packetId: packet.id,
      signedDoc: signedDocId,
      effective,
      signedDate,
      basis: "Every signer was recorded on the signed copy.",
      confirmed: new Date().toISOString(),
    };
    const previous = operativeFor(packet.tenancyId);
    const base = previous ? p.get(previous.packetId) : null;
    let op;
    if (isAmendment(packet) && previous && base)
      op = { ...previous, amendments: [...new Set([...(previous.amendments || []), packet.id])] };
    else
      op = {
        ...(previous || {}),
        id: previous?.id || "operative-" + packet.tenancyId,
        type: "operativeLease",
        propertyId: packet.propertyId,
        tenancyId: packet.tenancyId,
        packetId: packet.id,
        signedDoc: signedDocId,
        effective,
        executionId: execution.id,
        amendments: [],
      };
    const tasks = reminders(packet, copyFrom || signedDate, today)
      .filter((r) => !p.get(r.id))
      .map((r) => ({ type: "task", id: r.id, propertyId: packet.propertyId, tenancyId: packet.tenancyId, title: r.title, kind: "Reminder", due: r.due, notes: r.notes, completed: false, packetId: packet.id }));
    return [execution, op, ...tasks];
  }
  function signatureRecord(packet, signerId, documentId, signedDate, basis) {
    return {
      type: "signature",
      id: "sig-" + packet.id + "-" + signerId,
      immutable: true,
      propertyId: packet.propertyId,
      tenancyId: packet.tenancyId,
      packetId: packet.id,
      packetHash: packet.archiveHash,
      signerId,
      documentId,
      certificateId: "",
      signedDate,
      method: "Signed copy saved by the owner",
      basis,
    };
  }
  function saveSigned(form) {
    return serial(async () => {
      const p = pm(),
        scope = openScope(),
        today = p.today();
      const packet = p.get(form.dataset.ref);
      if (!packet || !signable(packet) || packet.propertyId !== scope.propertyId) throw Error("This lease is no longer open here. Go back to Leases and open it again.");
      const blob = await signedUpload(form.elements.document.files[0], "document", "signed copy");
      const signedDate = form.elements.signedDate.value;
      if (!isDate(signedDate)) throw new FormError("signedDate", "Enter the date it was signed.");
      if (signedDate > today) throw new FormError("signedDate", "The signing date cannot be in the future.");
      const ticked = [...form.querySelectorAll('input[name="signers"]:checked')].map((i) => i.value);
      if (!ticked.length) throw new FormError("signers", "Tick at least one person who signed this copy.");
      const before = signState(packet, evidenceFor(packet, p.records("signature")));
      if (ticked.some((id) => before.signed.has(id) || !packet.signers.some((s) => s.id === id)))
        throw Error("This list changed since the page opened. Reload the page and try again.");
      const everyone = ticked.length === packet.signers.length;
      const who = packet.signers.filter((s) => ticked.includes(s.id)).map((s) => s.name);
      const name = safeName((packet.name || "Lease") + (everyone ? " (signed)" : " (signed by " + listNames(who) + ")")) + UPLOADS[blob.type];
      const doc = await storedDoc(scope, blob, name, SIGNED_KIND, packet.tenancyId, { packetId: packet.id, originalName: form.elements.document.files[0].name || "" });
      const signatures = ticked.map((id) => signatureRecord(packet, id, doc.id, signedDate, "Recorded with the signed copy on " + today + "."));
      const complete = before.missing.every((s) => ticked.includes(s.id));
      const dates = new Map([...[...before.signed].map(([id, e]) => [id, e.signedDate]), ...ticked.map((id) => [id, signedDate])]);
      await scope.batch([doc, ...signatures, ...(complete ? activation(packet, doc.id, signedDate, today, tenantSigned(packet, dates)) : [])]);
      const left = before.missing.filter((s) => !ticked.includes(s.id)).map((s) => s.name);
      await refreshPage(packet.id);
      p.toast(complete ? (isAmendment(packet) ? "Signed amendment saved. It is now part of the active lease." : "Signed lease saved. This is now the active lease.") : "Saved. Still to sign: " + listNames(left) + ".");
    });
  }
  /* A lease from the earlier tool that already has every signature but was never made active. */
  function activate(packetId) {
    return serial(async () => {
      const p = pm(),
        scope = openScope(),
        today = p.today();
      const packet = p.get(packetId);
      const events = packet ? evidenceFor(packet, p.records("signature")) : [];
      if (!packet || signState(packet, events).state !== "signed") throw Error("Record everyone’s signed copy first.");
      const latest = events.slice().sort((a, b) => String(b.signedDate).localeCompare(String(a.signedDate)))[0];
      const original = p.get(latest.documentId);
      const stored = original?.hash ? await scope.file(original.hash) : null;
      if (!(stored instanceof Blob)) throw Error("The signed copy is missing from this device. Restore a backup that has it.");
      const copy = await storedDoc(scope, new Blob([stored], { type: original.mime || stored.type }), original.name || "Signed lease", SIGNED_KIND, packet.tenancyId, { packetId: packet.id, sourceId: original.id });
      await scope.batch([copy, ...activation(packet, copy.id, latest.signedDate, today, tenantSigned(packet, new Map(events.map((e) => [e.signerId, e.signedDate]))))]);
      await refreshPage(packet.id);
      p.toast("This is now the active lease.");
    });
  }

  /* ---------- Page buttons ---------- */
  async function fileOf(docId) {
    const d = docId ? pm().get(docId) : null;
    const blob = d?.hash ? await pm().file(d.hash) : null;
    if (!(blob instanceof Blob)) throw Error("This file is not on this device. Restore a backup that has it.");
    return { doc: d, blob };
  }
  async function download(docId) {
    const { doc, blob } = await fileOf(docId);
    pm().download(blob, doc.filename || doc.name || "Lease");
  }
  /* Open the lease in its own tab so the browser's print button is right there. The tab is opened
     at once, while the click still counts, and filled when the file has been read. */
  async function printLease(packetId) {
    const packet = pm().get(packetId);
    const main = packet ? pm().get(mainDocId(packet)) : null;
    if (!main) throw Error("This file is not on this device. Restore a backup that has it.");
    if (main.mime !== "application/pdf") {
      await download(main.id);
      pm().toast("Downloaded. Open the file and choose Print.");
      return;
    }
    let tab = null;
    try {
      tab = globalThis.open("", "_blank");
    } catch {}
    try {
      const { blob } = await fileOf(main.id);
      if (!tab || tab.closed) {
        pm().download(blob, main.filename || main.name);
        pm().toast("Downloaded. Open the file and print it from there.");
        return;
      }
      const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      tab.location.replace(url);
      setTimeout(() => URL.revokeObjectURL(url), 600000);
    } catch (e) {
      tab?.close();
      throw e;
    }
  }
  function act(action, ref) {
    const p = pm();
    switch (action) {
      case "home":
        return goHome();
      case "view":
        return goPacket(ref);
      case "open":
        return p.openDoc(ref);
      case "download":
        return download(ref);
      case "zip":
        return download(p.get(ref)?.archiveId);
      case "print":
        return printLease(ref);
      case "email":
        return globalThis.Work.open("compose", p.get(ref)?.archiveId);
      case "track":
        return p.action("edit-property", ref);
      case "tasks":
        return p.navigate("Tasks");
      case "activate":
        return activate(ref);
      case "deposit":
        return showReturn("", ref);
      case "close":
        return closeDialog();
      case "deduct":
        return addDeduction();
      case "undeduct":
        return removeDeduction(Number(ref));
      case "return-pdf":
        return returnPDF();
    }
  }

  /* ---------- Add a lease I already have ---------- */
  function lastLandlord() {
    const p = pm();
    const newest = (rows, stamp) => rows.slice().sort((a, b) => String(b[stamp] || "").localeCompare(String(a[stamp] || "")));
    for (const r of [...newest(p.records("leasePacket"), "generated"), ...newest(p.records("lease"), "_updatedAt")]) if (filled(r.facts?.landlord)) return clean(r.facts.landlord);
    return "";
  }
  const rentOf = (t) => (t?.rentCents > 0 ? (t.rentCents / 100).toFixed(2) : "");
  function addExisting(tenancyId) {
    const p = pm(),
      U = kit();
    if (!p.prop()) {
      p.toast("Set up a rental first.");
      return;
    }
    const tenants = p.records("tenancy");
    const chosen = tenants.some((t) => t.id === tenancyId) ? tenancyId : tenants.length === 1 ? tenants[0].id : "";
    const t = chosen ? p.get(chosen) : null;
    const auto = 'data-lp-auto="1"';
    p.modal(
      "Add a lease I already have",
      `<form id="lp-existing" class="ui-stack lp-dialog" novalidate><p class="dialog-intro lp-lead">Keep a signed lease on file, so you can open it, renew it or amend it later.</p>` +
        (tenants.length ? U.seg({ label: "Which tenant is this lease for?", name: "tenancyId", value: chosen, options: [...tenants.map((x) => [x.id, x.name || "Tenant"]), ["new", "A new tenant"]] }) : "") +
        U.field({ label: "Signed lease", name: "document", type: "file", help: "A scan or a clear photo of the signed lease. PDF, JPEG or PNG.", attrs: 'accept="application/pdf,image/jpeg,image/png"' }) +
        `<div class="ui-grid">` +
        U.field({ label: "Landlord name", name: "landlord", value: lastLandlord(), help: "As it appears on the lease.", attrs: 'maxlength="200" autocomplete="off"' }) +
        U.textarea({ label: "Tenant names", name: "tenants", value: t?.name || "", rows: 2, wide: false, help: "Everyone who signed as a tenant, one name per line.", attrs: 'maxlength="1200" ' + auto }) +
        "</div>" +
        U.seg({ label: "Lease type", name: "kind", value: "Fixed term", options: [["Fixed term", "Ends on a set date"], ["Month to month", "Month to month"]] }) +
        `<div class="ui-grid">` +
        U.field({ label: "Start date", name: "start", type: "date", value: isDate(t?.start) ? t.start : "", attrs: auto }) +
        `<div data-lp-fixed>${U.field({ label: "End date", name: "end", type: "date" })}</div>` +
        U.money({ label: "Monthly rent", name: "rent", value: rentOf(t), attrs: auto }) +
        "</div>" +
        `<div id="lp-existing-note" hidden></div><p class="lp-error" role="alert" hidden></p><div class="ui-foot"><button type="button" class="ui-quiet" data-packet="close">Cancel</button><button type="submit" class="primary">Save lease</button></div></form>`,
      { key: "lease-existing" },
    );
    const form = document.getElementById("lp-existing");
    // Anything the owner already typed in an earlier visit to this form is theirs, not a prefill.
    for (const el of form.querySelectorAll("[data-lp-auto]")) if (el.value !== el.defaultValue) el.removeAttribute("data-lp-auto");
    existingChanged(form);
  }
  function existingChanged(form, changed) {
    const p = pm(),
      choice = form.elements.tenancyId?.value || "";
    form.querySelector("[data-lp-fixed]").hidden = form.elements.kind.value === "Month to month";
    if (changed?.name === "tenancyId") {
      const t = choice && choice !== "new" ? p.get(choice) : null;
      const fill = { tenants: t?.name || "", start: isDate(t?.start) ? t.start : "", rent: rentOf(t) };
      for (const [name, value] of Object.entries(fill)) {
        const el = form.elements[name];
        if (el.hasAttribute("data-lp-auto")) el.value = value;
      }
    } else if (changed?.hasAttribute?.("data-lp-auto")) changed.removeAttribute("data-lp-auto");
    const current = choice && choice !== "new" ? operativeFor(choice) : null;
    const note = form.querySelector("#lp-existing-note");
    note.hidden = !current;
    note.innerHTML = current
      ? kit().note("info", "<p>This tenant already has an active lease on file. Saving makes this one the active lease. The other stays in your history.</p>")
      : "";
  }
  function saveExisting(form) {
    return serial(async () => {
      const p = pm(),
        scope = openScope(),
        today = p.today(),
        v = kit().read(form);
      const tenantsHere = p.records("tenancy");
      let tenancyId = tenantsHere.length ? v.tenancyId : "new";
      if (!tenancyId) throw new FormError("tenancyId", "Choose which tenant this lease is for.");
      if (tenancyId !== "new" && !tenantsHere.some((t) => t.id === tenancyId)) throw Error("That tenant is no longer here. Close this and try again.");
      const blob = await signedUpload(form.elements.document.files[0], "document", "signed lease");
      const landlord = clean(v.landlord);
      if (!landlord) throw new FormError("landlord", "Enter the landlord’s name as it appears on the lease.");
      const names = String(v.tenants || "").split(/\r?\n/).map(clean).filter(Boolean);
      if (!names.length) throw new FormError("tenants", "Enter at least one tenant’s name.");
      if (names.length > 12) throw new FormError("tenants", "List up to 12 tenants, one name per line.");
      const fixed = v.kind !== "Month to month";
      if (!isDate(v.start)) throw new FormError("start", "Enter the date the lease started.");
      if (fixed && !isDate(v.end)) throw new FormError("end", "Enter the date the lease ends, or choose Month to month.");
      if (fixed && v.end <= v.start) throw new FormError("end", "The end date must be after the start date.");
      if (!(cents(v.rent) > 0)) throw new FormError("rent", "Enter the monthly rent, like 3200 or 3200.00.");

      const prop = p.prop(),
        packetId = uid(),
        when = new Date().toISOString();
      let tenancy = null;
      if (tenancyId === "new") {
        tenancy = { type: "tenancy", id: uid(), propertyId: scope.propertyId, unitId: p.records("unit")[0]?.id || "", name: listNames(names), start: v.start };
        tenancyId = tenancy.id;
      }
      const facts = {
        premises: clean(prop.address || prop.name),
        city: clean(prop.city),
        landlord,
        kind: fixed ? "Fixed term" : "Month to month",
        start: v.start,
        termStart: v.start,
        end: fixed ? v.end : "",
        rent: String(v.rent).trim(),
      };
      const tenants = names.map((name) => ({ id: uid(), name, email: "", phone: "" }));
      const signers = [landlord, ...names].map((name, i) => ({ id: "signer-" + i, name, role: i ? "Tenant" : "Landlord" }));
      const name = "Lease – " + listNames(names);
      const doc = await storedDoc(scope, blob, safeName(name + " (signed)") + UPLOADS[blob.type], SIGNED_KIND, tenancyId, { packetId, originalName: form.elements.document.files[0].name || "" });
      const packet = {
        type: "leasePacket",
        schema: 2,
        id: packetId,
        immutable: true,
        propertyId: scope.propertyId,
        tenancyId,
        leaseId: "",
        parentPacket: "",
        name,
        mode: "reviewed",
        generated: when,
        lawVersion: "",
        packageVersion: "",
        template: "Signed lease added by the owner",
        facts,
        tenants,
        clauses: {},
        customClauses: [],
        review: [],
        signers,
        attachments: [],
        worksheetId: doc.id,
        contractId: doc.id,
        archiveId: doc.id,
        archiveHash: doc.hash,
      };
      const signedDate = v.start < today ? v.start : today;
      const signatures = signers.map((s) => signatureRecord(packet, s.id, doc.id, signedDate, "Added by the owner as a lease signed outside this app."));
      const rest = activation(packet, doc.id, signedDate, today).filter((r) => r.type !== "task" || r.id === "lease-renewal-" + packetId);
      rest[0].basis = "Signed lease added by the owner.";
      await scope.batch([...(tenancy ? [tenancy] : []), doc, packet, ...signatures, ...rest]);
      p.close();
      await p.refresh();
      p.toast("Lease saved. It is now the active lease for " + (tenancy?.name || p.get(tenancyId)?.name || "this tenant") + ".");
    });
  }

  /* ---------- Moving out: return the deposit ---------- */
  const depositFields = ["tenancyId", "possession", "vacated", "inspection", "inspectionDate", "rightsNotice", "method", "consent", "statementMethod", "delivered", "deliveryProof", "deductionType", "deductionBasis", "deductionAmount", "electronic", "adults", "funds", "tenantReply", "photoNotes", "estimate", "finalDocs", "followup", "ledgerRef"];
  const ITEM_KINDS = [
    ["Documented deductible item", "A deduction"],
    ["Ordinary wear", "Normal wear, not charged"],
    ["Missing evidence", "No receipt yet"],
    ["Disputed", "Tenant disagrees"],
  ];
  const kept = new Map(); // forms closed without saving, kept for this session
  let returning = null, // the deposit form that is open
    discard = false;
  function closeDialog() {
    discard = true;
    pm().close();
  }
  function showReturn(id, tenancyId) {
    const p = pm();
    if (!p.prop()) {
      p.toast("Set up a rental first.");
      return;
    }
    const stored = id ? p.get(id) : null;
    if (id && (!stored || stored.type !== "depositReturn" || stored.propertyId !== p.prop().id)) throw Error("That deposit record is no longer here.");
    const tenants = p.records("tenancy");
    const key = p.dataset() + "|" + p.prop().id + "|" + (id || "new");
    const before = kept.get(key);
    kept.delete(key);
    let state, docs;
    if (before && (stored ? before.state._rev === stored._rev : !tenancyId || before.state.tenancyId === tenancyId)) ({ state, docs } = before);
    else {
      const first = tenants.some((t) => t.id === tenancyId) ? tenancyId : tenants[0]?.id || "";
      state = stored ? clone(stored) : { id: uid(), type: "depositReturn", propertyId: p.prop().id, tenancyId: first, items: [], evidence: [], funds: depositOf(p.get(first)) };
      docs = [];
    }
    state.items = Array.isArray(state.items) ? state.items : [];
    state.deductionType = state.deductionType || ITEM_KINDS[0][0];
    returning = { key, state, docs, fresh: !stored, saved: false };
    discard = false;
    drawReturn();
  }
  const depositOf = (t) => (t?.depositCents > 0 ? (t.depositCents / 100).toFixed(2) : "");
  function deadlineHtml(s, today) {
    if (!isDate(s.vacated))
      return `<p class="lp-deadline-label">Refund deadline</p><p class="lp-deadline-date">21 days after move-out</p><p class="lp-deadline-help">Enter the move-out date to see the exact day.</p>`;
    const due = plusDays(s.vacated, 21),
      left = daysBetween(today, due);
    const status = isDate(s.delivered)
      ? "Sent " + longDate(s.delivered) + "."
      : left < 0
        ? "That was " + -left + (left === -1 ? " day" : " days") + " ago. Send it as soon as you can."
        : left === 0
          ? "That is today."
          : left + (left === 1 ? " day" : " days") + " from today.";
    return `<p class="lp-deadline-label">Send the refund and the itemized statement by</p><p class="lp-deadline-date">${esc(longDate(due))}</p><p class="lp-deadline-help">${esc(status)} California allows 21 days after the tenant moves out.</p>`;
  }
  function itemsHtml(s) {
    const p = pm();
    if (!s.items.length) return `<li class="lp-item lp-item--empty">No deductions. The whole deposit goes back.</li>`;
    const nameOf = (id) => returning.docs.find((d) => d.id === id)?.name || p.get(id)?.name || "File";
    return s.items
      .map((x, i) => {
        const counted = itemReady(x);
        const label = ITEM_KINDS.find(([v]) => v === x.classification)?.[1] || x.classification;
        const proof = (x.evidence || []).map(nameOf).join(", ");
        return `<li class="lp-item"><span class="lp-item-text"><b>${esc(x.basis)}</b><small>${esc(counted ? proof : [label, proof].filter(Boolean).join(" · "))}</small></span><span class="lp-item-amount${counted ? "" : " lp-item-amount--off"}">${esc(dollars(x.amountCents || 0))}</span><button type="button" class="ui-quiet" data-packet="undeduct" data-ref="${i}" aria-label="Remove ${esc(x.basis)}">Remove</button></li>`;
      })
      .join("");
  }
  function totalsHtml(s) {
    const held = cents(s.funds),
      total = s.items.filter(itemReady).reduce((a, x) => a + x.amountCents, 0);
    const row = (k, v, strong) => `<div${strong ? ' class="lp-total"' : ""}><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`;
    return (
      `<dl class="lp-totals-list">` +
      row("Deposit you are holding", held === null ? "Not entered" : dollars(held)) +
      row("Deductions", total ? "− " + dollars(total) : dollars(0)) +
      row("Refund to your tenant", held === null ? "Enter the deposit above" : held - total < 0 ? "Deductions are more than the deposit" : dollars(held - total), true) +
      "</dl>"
    );
  }
  function drawReturn() {
    const p = pm(),
      U = kit(),
      s = returning.state,
      today = p.today();
    const tenants = p.records("tenancy");
    const who = p.get(s.tenancyId);
    const docs = p.records("document").filter((d) => d.hash && d.mime !== "application/zip" && d.mime !== "text/html");
    const date = (label, name, help) => U.field({ label, name, type: "date", value: isDate(s[name]) ? s[name] : "", help, attrs: 'max="' + esc(today) + '"' });
    const tenantField =
      tenants.length > 1
        ? U.seg({ label: "Who moved out?", name: "tenancyId", value: s.tenancyId, options: tenants.map((t) => [t.id, t.name || "Tenant"]) })
        : `<input type="hidden" name="tenancyId" value="${esc(s.tenancyId)}"><p class="lp-read"><span>Tenant</span><b>${esc(who?.name || "No tenant yet")}</b></p>`;
    const body =
      `<form id="lp-deposit" class="ui-stack lp-dialog" novalidate><p class="dialog-intro lp-lead">Work out the refund and keep a record of what you sent and when.</p>` +
      tenantField +
      `<div class="ui-grid">` +
      date("Date they moved out", "vacated", "The 21 days start on this date.") +
      U.money({ label: "Deposit you are holding", name: "funds", value: s.funds || "", help: "The full deposit, before anything is taken out.", attrs: returning.fresh ? 'data-lp-auto="1"' : "" }) +
      "</div>" +
      `<div class="lp-deadline" id="lp-deadline" aria-live="polite">${deadlineHtml(s, today)}</div>` +
      `<section class="lp-section"><h3>Deductions</h3><p class="lp-help">List anything you are keeping from the deposit. Each one needs a receipt, invoice or photo.</p><ul class="lp-items" id="lp-items">${itemsHtml(s)}</ul>` +
      `<fieldset class="lp-add"><legend>Add a deduction</legend><div class="ui-grid">` +
      U.field({ label: "What is it for?", name: "deductionBasis", value: s.deductionBasis || "", placeholder: "Carpet cleaning, invoice 1042", attrs: 'maxlength="500"' }) +
      U.money({ label: "Amount", name: "deductionAmount", value: s.deductionAmount || "" }) +
      "</div>" +
      U.field({ label: "Receipt, invoice or photo", name: "evidenceFile", type: "file", wide: true, attrs: 'accept="application/pdf,image/jpeg,image/png"' }) +
      U.more(
        "More choices for this item",
        U.seg({ label: "What kind of item is it?", name: "deductionType", value: s.deductionType, options: ITEM_KINDS, help: "Only a deduction comes out of the deposit. The others are notes for your records." }) +
          (docs.length ? U.chips({ label: "Use a file already in Documents", name: "evidence", options: docs.slice(0, 60).map((d) => [d.id, d.name || d.filename || "File"]), values: s.evidence || [] }) : ""),
        s.deductionType !== ITEM_KINDS[0][0] || Boolean((s.evidence || []).length),
      ) +
      `<div class="lp-actions">${btn("deduct", "", ico("plus", 17) + "Add deduction")}</div></fieldset></section>` +
      `<div class="lp-totals" id="lp-totals" aria-live="polite">${totalsHtml(s)}</div>` +
      U.more(
        "Inspection before move-out",
        `<p class="lp-help">Before move-out, tell your tenant in writing that they can ask for an inspection, so they have a chance to fix things first.</p><div class="ui-grid">` +
          date("Date you told them in writing", "rightsNotice") +
          date("Inspection date", "inspectionDate") +
          "</div>" +
          U.seg({ label: "Did your tenant want an inspection?", name: "inspection", value: s.inspection || "", options: [["Requested", "Yes, they asked"], ["Declined", "No"], ["Completed", "Done"], ["Exception under review", "Not sure"]] }),
      ) +
      U.more(
        "Photos and unfinished repairs",
        `<div class="ui-grid">` +
          date("Date you got the home back", "possession") +
          date("Date you got the final invoice", "finalDocs") +
          "</div>" +
          U.textarea({ label: "Photos you took", name: "photoNotes", value: s.photoNotes || "", rows: 2, help: "California asks for photos when you get the home back, before any repairs or cleaning, and again after the work." }) +
          U.textarea({ label: "Estimate for work not finished yet", name: "estimate", value: s.estimate || "", rows: 2 }) +
          date("Date you sent the final statement", "followup"),
      ) +
      U.more(
        "How you sent it",
        U.seg({ label: "How did you return the money?", name: "method", value: s.method || "", options: [["First-class mail check", "Check by mail"], ["Personal delivery", "Handed over in person"], ["Electronic transfer", "Electronic transfer"], ["Written alternative", "Another way agreed in writing"]] }) +
          U.seg({ label: "How did you send the itemized statement?", name: "statementMethod", value: s.statementMethod || "", options: [["First-class mail", "Mail"], ["Personal delivery", "In person"], ["Mutually agreed email", "Email we agreed on"], ["Other agreed method", "Another agreed way"]] }) +
          `<div class="ui-grid">` +
          date("Date you sent it", "delivered") +
          U.field({ label: "Adult tenants on the lease", name: "adults", type: "number", value: s.adults || "", help: "With more than one, send one check payable to all of them unless everyone agreed otherwise in writing.", attrs: 'min="1" max="100" inputmode="numeric"' }) +
          "</div>" +
          U.textarea({ label: "Proof it was sent", name: "deliveryProof", value: s.deliveryProof || "", rows: 2, help: "For example, a certificate of mailing or your tenant’s reply." }) +
          U.seg({ label: "Did your tenant pay the deposit or rent electronically?", name: "electronic", value: s.electronic || "", options: [["No", "No"], ["Yes", "Yes"]], help: "If so, the refund goes back electronically to the account they name in writing, unless you both agree in writing on another way." }) +
          U.textarea({ label: "Written agreements about the refund", name: "consent", value: s.consent || "", rows: 2 }) +
          U.textarea({ label: "What your tenant said back", name: "tenantReply", value: s.tenantReply || "", rows: 2 }) +
          U.field({ label: "Note for your own records", name: "ledgerRef", value: s.ledgerRef || "", wide: true }),
        Boolean(s.delivered),
      ) +
      `<div class="lp-aside lp-summary"><p class="lp-help">A printable summary of everything entered here, for your files.</p>${btn("return-pdf", "", ico("download", 17) + "Download summary (PDF)")}</div>` +
      `<p class="lp-error" role="alert" hidden></p><div class="ui-foot"><button type="button" class="ui-quiet" data-packet="close">Cancel</button><button type="submit" class="primary">Save</button></div></form>`;
    const open = returning;
    p.modal("Moving out: return the deposit", body, {
      wide: true,
      key: "deposit-return-" + (open.fresh ? "new" : s.id),
      onClose() {
        if (returning !== open) return;
        collectDeposit();
        if (!open.saved && !discard) kept.set(open.key, { state: open.state, docs: open.docs });
        returning = null;
      },
    });
    collectDeposit();
    refreshReturn();
  }
  const depositForm = () => (typeof document === "undefined" ? null : document.getElementById("lp-deposit"));
  function collectDeposit() {
    const form = depositForm();
    if (!form || !returning) return;
    const v = kit().read(form),
      s = returning.state;
    depositFields.forEach((k) => {
      if (k in v) s[k] = v[k];
    });
    s.evidence = String(v.evidence || "").split(",").filter(Boolean);
    s.deadline = plusDays(s.vacated, 21);
  }
  function refreshReturn() {
    const form = depositForm();
    if (!form || !returning) return;
    form.querySelector("#lp-deadline").innerHTML = deadlineHtml(returning.state, pm().today());
    form.querySelector("#lp-deadline").classList.toggle("lp-deadline--due", isDate(returning.state.vacated) && !isDate(returning.state.delivered));
    form.querySelector("#lp-items").innerHTML = itemsHtml(returning.state);
    form.querySelector("#lp-totals").innerHTML = totalsHtml(returning.state);
  }
  async function addDeduction() {
    const form = depositForm();
    if (!form || !returning) return;
    collectDeposit();
    fieldProblem(form, null);
    const s = returning.state,
      amount = cents(s.deductionAmount),
      file = form.elements.evidenceFile.files[0];
    try {
      if (!filled(s.deductionBasis)) throw new FormError("deductionBasis", "Say what the deduction is for.");
      if (amount === null) throw new FormError("deductionAmount", "Enter the amount, like 180 or 180.00.");
      const deduct = s.deductionType === "Documented deductible item";
      if (deduct && !amount) throw new FormError("deductionAmount", "Enter an amount above zero.");
      if (deduct && !file && !s.evidence.length) throw new FormError("evidenceFile", "Add a receipt, invoice or photo, so this deduction is backed up.");
      const evidence = [...s.evidence];
      if (file) {
        const scope = openScope();
        const blob = await signedUpload(file, "evidenceFile", "file");
        const doc = await storedDoc(scope, blob, safeName(file.name || "Receipt" + UPLOADS[blob.type]), blob.type === "application/pdf" ? "Receipt" : "Photo", s.tenancyId);
        returning.docs.push(doc);
        evidence.unshift(doc.id);
      }
      s.items.push({ id: uid(), classification: s.deductionType, basis: s.deductionBasis, amountCents: amount, evidence });
    } catch (e) {
      fieldProblem(form, e);
      return;
    }
    s.evidence = [];
    s.deductionBasis = "";
    s.deductionAmount = "";
    s.deductionType = ITEM_KINDS[0][0];
    form.elements.deductionBasis.value = "";
    form.elements.deductionAmount.value = "";
    form.elements.evidenceFile.value = "";
    form.querySelectorAll('input[name="evidence"]').forEach((i) => (i.checked = false));
    form.querySelectorAll('input[name="deductionType"]').forEach((i) => (i.checked = i.value === s.deductionType));
    refreshReturn();
    form.elements.deductionBasis.focus();
  }
  function removeDeduction(index) {
    const form = depositForm();
    if (!form || !returning) return;
    collectDeposit();
    const [gone] = returning.state.items.splice(index, 1);
    const used = new Set(returning.state.items.flatMap((x) => x.evidence || []));
    if (gone) returning.docs = returning.docs.filter((d) => used.has(d.id));
    refreshReturn();
    (form.querySelector('[data-packet="undeduct"]') || form.elements.deductionBasis).focus();
  }
  function validateReturn() {
    collectDeposit();
    const s = returning.state,
      today = pm().today();
    if (!s.tenancyId) throw new FormError("tenancyId", "Choose who moved out.");
    if (s.funds && cents(s.funds) === null) throw new FormError("funds", "Enter the deposit in dollars, like 3200 or 3200.00.");
    const total = s.items.filter(itemReady).reduce((a, x) => a + x.amountCents, 0),
      held = cents(s.funds);
    if (held !== null && total > held) throw new FormError("funds", "The deductions add up to more than the deposit you are holding.");
    if (s.delivered && (!s.deliveryProof || !s.method || !s.statementMethod || held === null))
      throw new FormError(
        !s.method ? "method" : !s.statementMethod ? "statementMethod" : !s.deliveryProof ? "deliveryProof" : "funds",
        "To record that you sent it, also fill in how you returned the money, how you sent the statement, proof it was sent, and the deposit amount.",
      );
    for (const k of ["delivered", "vacated", "possession"]) if (s[k] > today) throw new FormError(k, "This date is in the future. Use the real date, or leave it empty until it happens.");
    if (s.deductionBasis || s.deductionAmount) throw new FormError("deductionBasis", "You started a deduction but did not add it. Choose Add deduction, or clear these boxes.");
  }
  function returnPDF() {
    const form = depositForm();
    if (!form || !returning) return;
    fieldProblem(form, null);
    try {
      validateReturn();
    } catch (e) {
      fieldProblem(form, e);
      return;
    }
    const p = pm(),
      s = returning.state,
      t = s.items.filter(itemReady).reduce((a, x) => a + x.amountCents, 0),
      h = cents(s.funds);
    const nameOf = (i) => returning.docs.find((d) => d.id === i)?.name || p.get(i)?.name || i;
    const sections = [
      {
        heading: "Return record",
        lines: [
          "Household: " + (p.get(s.tenancyId)?.name || "Unknown"),
          "Actual possession returned: " + (s.possession || "Pending"),
          "Vacated: " + (s.vacated || "Pending"),
          "21-day target: " + (s.deadline || "Pending"),
          "Inspection rights: " + (s.rightsNotice || "Pending"),
          "Inspection: " + (s.inspection || "Pending"),
        ],
      },
      {
        heading: "Itemization",
        lines: [
          ...s.items.map((x) => x.basis + " / " + x.classification + " / " + p.currency(x.amountCents) + " / " + x.evidence.map(nameOf).join(", ")),
          "Beginning deposit: " + (h === null ? "Unconfirmed" : p.currency(h)),
          "Documented deductions: " + p.currency(t),
          "Balance: " + (h === null ? "Unconfirmed" : p.currency(h - t)),
        ],
      },
      {
        heading: "Delivery and outstanding details",
        lines: [
          s.method || "Refund method pending",
          s.statementMethod || "Statement method pending",
          s.delivered || "Actual delivery pending",
          s.deliveryProof || "Proof pending",
          s.tenantReply || "No dispute recorded",
          s.estimate || "No estimate recorded",
          s.finalDocs ? "Final invoice or completion: " + s.finalDocs + " / 14-day follow-up target: " + plusDays(s.finalDocs, 14) : "",
        ],
      },
    ];
    let file;
    try {
      file = p.pdf("Deposit return worksheet", sections);
    } catch (e) {
      if (e?.code !== "PDF_TEXT_UNSUPPORTED") throw e;
      throw Error("This summary has a letter or symbol the PDF writer cannot draw, such as an accented letter in a name, so the PDF was not made. Everything you entered is still here.");
    }
    p.download(file, "deposit-return-worksheet.pdf");
  }
  function saveReturn(form) {
    return serial(async () => {
      const p = pm(),
        scope = openScope(),
        open = returning;
      if (!open) return;
      validateReturn();
      const s = open.state;
      const used = new Set(s.items.flatMap((x) => x.evidence || []));
      const record = { ...s, deductionType: "", deductionBasis: "", deductionAmount: "", evidence: [], propertyId: scope.propertyId };
      const taskId = "deposit-return-" + s.id,
        old = p.get(taskId),
        who = p.get(s.tenancyId)?.name;
      const changed = [...open.docs.filter((d) => used.has(d.id)).map((d) => ({ ...d, tenancyId: s.tenancyId })), record];
      if (s.deadline || old)
        changed.push({
          ...old,
          id: taskId,
          type: "task",
          propertyId: scope.propertyId,
          tenancyId: s.tenancyId,
          title: who ? "Return the deposit to " + who : "Return the deposit",
          kind: "Reminder",
          due: s.deadline || "",
          completed: Boolean(s.delivered),
          depositReturnId: s.id,
        });
      await scope.batch(changed);
      open.saved = true;
      kept.delete(open.key);
      p.close();
      await p.refresh();
      p.toast("Deposit return saved. Record the refund itself in Money.");
    });
  }

  /* ---------- Checks on lease records in a backup ---------- */
  function validateImport(records, hashes, only) {
    const index = new Map(records.map((r) => [r.id, r]));
    const checkedSigners = new Set(),
      checkedPackages = new Set();
    const check = (ok, why) => {
      if (!ok) throw Error("The lease records in this file do not fit together. " + why);
    };
    const text = (v, max) => typeof v === "string" && v.length <= max;
    const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
    const simple = (v, max) => v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || text(v, max);
    function ref(id, type, owner) {
      const found = index.get(id);
      check(found && found.type === type && !found._deleted && (!owner || found.propertyId === owner.propertyId), "A linked " + (type === "leasePacket" ? "lease" : type) + " record is missing or belongs to a different rental.");
      return found;
    }
    function documentRef(id, owner, hash) {
      const d = ref(id, "document", owner);
      check(typeof d.hash === "string" && /^[a-f0-9]{64}$/.test(d.hash) && (!hashes || hashes.has(d.hash)) && (!hash || d.hash === hash), "A saved file is missing or is not the file the lease points to.");
      return d;
    }
    /* Rule sets from the earlier lease tool are kept but never shown, so only their shape is checked. */
    function checkPackage(pkg) {
      if (checkedPackages.has(pkg)) return;
      check(
        plain(pkg) &&
          text(pkg.version, 200) &&
          pkg.version.trim() &&
          Array.isArray(pkg.rules) &&
          pkg.rules.length <= 150 &&
          pkg.rules.every((r) => plain(r) && text(r.id, 200) && text(r.title, 1000) && [r.url, r.reference].every((u) => u == null || u === "" || (text(u, 2000) && /^https:\/\//i.test(u)))),
        "A saved rule set from the earlier lease tool is damaged.",
      );
      checkedPackages.add(pkg);
    }
    function legacyFacts(record) {
      check(plain(record.facts) && Object.values(record.facts).every((x) => typeof x === "string" || x === null), "The answers saved with a lease must be text.");
      if (Object.hasOwn(record, "customClauses")) {
        const clauses = record.customClauses;
        check(
          Array.isArray(clauses) &&
            clauses.every((c) => c && typeof c.id === "string" && /^[a-f0-9-]{16,64}$/i.test(c.id) && typeof c.title === "string" && typeof c.text === "string") &&
            new Set(clauses.map((c) => c.id)).size === clauses.length,
          "One of the owner’s own clauses is damaged or repeated.",
        );
        if (record.type === "leasePacket" && record.mode === "reviewed")
          check(
            clauses.every((c) => filled(c.text) && typeof record.clauseReferences?.[c.id] === "string" && filled(record.clauseReferences[c.id])),
            "A reviewed clause has lost its place in the contract.",
          );
      }
    }
    /* The parts a current draft and a finished lease share. A finished lease must have all of them
       as text. A draft is still being edited, so a part may be absent and the check is on shape and
       size rather than on every value. */
    function draftParts(r, strict) {
      const value = strict ? (x) => text(x, 100000) : (x) => simple(x, 100000);
      const present = (x) => strict || x !== undefined;
      check(plain(r.facts) && Object.keys(r.facts).length <= 600 && Object.values(r.facts).every(value), "The answers saved with a lease must be short text.");
      if (present(r.tenants))
        check(
          Array.isArray(r.tenants) && r.tenants.length <= 100 && r.tenants.every((t) => plain(t) && text(t.name ?? "", 1000) && Object.values(t).every((x) => simple(x, 1000))),
          "The list of tenants on a lease is damaged.",
        );
      if (present(r.clauses))
        check(
          plain(r.clauses) &&
            Object.keys(r.clauses).length <= 400 &&
            Object.values(r.clauses).every((c) => plain(c) && (c.on === undefined || typeof c.on === "boolean") && (c.opts === undefined || (plain(c.opts) && Object.values(c.opts).every((x) => simple(x, 20000))))),
          "The clause choices on a lease are damaged.",
        );
      if (present(r.customClauses))
        check(
          Array.isArray(r.customClauses) &&
            r.customClauses.length <= 500 &&
            r.customClauses.every((c) => plain(c) && text(c.id, 80) && c.id && text(c.title ?? "", 2000) && text(c.text ?? "", 100000)) &&
            new Set(r.customClauses.map((c) => c.id)).size === r.customClauses.length,
          "One of the owner’s own clauses is damaged or repeated.",
        );
    }
    const safePath = (path) => typeof path === "string" && !/[\\:\u0000-\u001f]/.test(path) && !path.startsWith("/") && path.split("/").every((x) => x && x !== "." && x !== "..");
    const sameSigners = (stored, names) => stored.length === names.length && stored.every((s, i) => plain(s) && s.id === "signer-" + i && s.name === names[i] && text(s.role, 200) && s.role);

    const signaturesFor = new Map();
    for (const r of records)
      if (r.type === "signature" && !r._deleted) {
        if (!signaturesFor.has(r.packetId)) signaturesFor.set(r.packetId, []);
        signaturesFor.get(r.packetId).push(r);
      }
    const fullySigned = (packet) => signState(packet, evidenceFor(packet, signaturesFor.get(packet.id) || [])).state === "signed";
    const types = ["lease", "leasePacket", "legalPackage", "signature", "execution", "operativeLease", "depositReturn"];

    for (const r of records) {
      if (!types.includes(r.type) || r._deleted || (only && !only.has(r.id))) continue;
      ref(r.propertyId, "property");
      if (r.tenancyId) ref(r.tenancyId, "tenancy", r);
      if (r.type === "legalPackage") {
        checkPackage(r.package);
        check(r.immutable && r.installed && r.reviewer && r.basis, "A saved rule set from the earlier lease tool has lost its review note.");
      }
      if (r.type === "lease") {
        check(r.schema === undefined || r.schema === 2, "A lease draft was made by a newer version of this app.");
        const stepOk = (v) => Number.isInteger(v) && v >= 0 && v <= 5;
        if (r.schema === 2) {
          draftParts(r, false);
          check(
            (r.step === undefined || stepOk(r.step)) && (r.attachments === undefined || (Array.isArray(r.attachments) && r.attachments.length <= 200)) && [r.name, r.lawVersion].every((x) => x === undefined || text(x, 1000)),
            "A lease draft is damaged.",
          );
          if (r.finalPacket) ref(r.finalPacket, "leasePacket", r);
        } else {
          check(stepOk(r.step) && Array.isArray(r.attachments), "A lease draft is damaged.");
          legacyFacts(r);
          checkPackage(r.package);
          if (r.facts.attorneyDoc) documentRef(r.facts.attorneyDoc, r);
        }
        (r.attachments || []).forEach((i) => documentRef(i, r));
        if (r.parentPacket) ref(r.parentPacket, "leasePacket", r);
      }
      if (r.type === "leasePacket") {
        const modern = r.schema === 2;
        check(r.schema === undefined || modern, "A lease was made by a newer version of this app.");
        check(
          r.immutable === true && (modern ? ["final", "reviewed"] : ["draft", "reviewed"]).includes(r.mode) && isDate(String(r.generated).slice(0, 10)) && Array.isArray(r.attachments) && Array.isArray(r.review) && Array.isArray(r.signers),
          "A finished lease has lost its date or its list of files.",
        );
        if (modern) {
          draftParts(r, true);
          check(text(r.lawVersion, 200) && r.packageVersion === r.lawVersion && text(r.template, 200) && text(r.name ?? "", 1000), "A finished lease has lost the version of the rules it was written under.");
          check(r.review.length <= 300 && r.review.every((o) => plain(o) && text(o.id, 200) && o.id && text(o.title, 1000) && ITEM_STATES.includes(o.status)), "The list of what the law required for a lease is damaged.");
          check(sameSigners(r.signers, signerNames(r.facts, r.tenants, r.clauses)) && r.signers.length >= 2 && r.tenancyId, "The people who sign a lease do not match the lease itself.");
          if (r.leaseId) {
            const draftRecord = index.get(r.leaseId);
            check(!draftRecord || (draftRecord.type === "lease" && draftRecord.propertyId === r.propertyId), "A finished lease points to a draft from a different rental.");
          }
        } else {
          legacyFacts(r);
          checkPackage(r.package);
          check(r.packageVersion === r.package.version, "A lease and the rule set saved with it disagree.");
          check(r.review.every((o) => r.package.rules.some((a) => a.id === o?.id) && LEGACY_STATUS.includes(o.status)), "The review saved with an earlier lease is damaged.");
          const draftRecord = index.get(r.leaseId);
          check(!draftRecord || (draftRecord.type === "lease" && !draftRecord._deleted && draftRecord.propertyId === r.propertyId), "A finished lease points to a draft from a different rental.");
          const expected = legacySigners(r.facts);
          check(r.signers.length === expected.length && r.signers.every((a, i) => a && a.id === expected[i].id && a.name === expected[i].name && a.role === expected[i].role), "The people who sign a lease do not match the lease itself.");
        }
        if (r.parentPacket) ref(r.parentPacket, "leasePacket", r);
        const archive = documentRef(r.archiveId, r, r.archiveHash),
          worksheet = documentRef(r.worksheetId, r);
        const own = modern && r.mode === "reviewed";
        check(
          archive.immutable && worksheet.immutable && (own ? Object.hasOwn(UPLOADS, worksheet.mime) : ["application/pdf", "text/html"].includes(worksheet.mime)) && archive.packetId === r.id && worksheet.packetId === r.id,
          "A finished lease does not match the files saved with it.",
        );
        r.attachments.forEach((a) => {
          check(a && safePath(a.path), "A file saved with a lease has an unsafe name.");
          documentRef(a.id, r, a.hash);
          if (a.sourceId) documentRef(a.sourceId, r);
        });
        if (modern) check(r.contractId === r.worksheetId && (r.mode === "final" || (r.archiveId === r.contractId && !r.attachments.length)), "A finished lease does not match the files saved with it.");
        else if (r.mode === "reviewed") {
          const contract = documentRef(r.contractId, r);
          check(contract.mime === "application/pdf" && r.attachments.some((a) => a.id === contract.id && a.hash === contract.hash) && r.signers.length >= 2 && r.tenancyId, "An earlier lease has lost its contract, its tenant or its signers.");
        }
      }
      if (r.type === "signature") {
        const p = ref(r.packetId, "leasePacket", r),
          s = String(p.id) + "|" + r.signerId;
        check(
          !checkedSigners.has(s) && signable(p) && r.immutable && r.tenancyId === p.tenancyId && r.packetHash === p.archiveHash && p.signers.some((a) => a.id === r.signerId) && isDate(r.signedDate) && r.method && r.basis,
          "A signature does not belong to one signer on its lease.",
        );
        checkedSigners.add(s);
        check(documentRef(r.documentId, r).packetId === p.id, "A signed copy is filed under a different lease.");
        if (r.certificateId) check(documentRef(r.certificateId, r).packetId === p.id, "A signing certificate is filed under a different lease.");
      }
      if (r.type === "depositReturn") {
        check(Array.isArray(r.items) && r.items.every((x) => x && Number.isSafeInteger(x.amountCents) && x.amountCents >= 0 && Array.isArray(x.evidence)), "A deposit return has a damaged list of deductions.");
        r.items.forEach((x) => x.evidence.forEach((i) => documentRef(i, r)));
        if (r.deadline) check(r.deadline === plusDays(r.vacated, 21), "A deposit return has a deadline that does not match its move-out date.");
      }
    }
    for (const r of records) {
      if (!["execution", "operativeLease"].includes(r.type) || r._deleted || (only && !only.has(r.id))) continue;
      const s = ref(r.packetId, "leasePacket", r);
      check(r.tenancyId === s.tenancyId && fullySigned(s), "A lease is marked as signed without every signature.");
      check(documentRef(r.signedDoc, r).kind === SIGNED_KIND, "The signed copy of a lease is missing.");
      if (r.type === "execution") check(r.immutable && r.basis && isDate(r.effective), "The record of a signed lease is incomplete.");
      else {
        const e = ref(r.executionId, "execution", r);
        check(e.tenancyId === s.tenancyId, "An active lease and its signing record name different tenants.");
        for (const k of r.amendments || []) check(ref(k, "leasePacket", r).tenancyId === s.tenancyId, "An amendment belongs to a different tenant.");
      }
    }
  }

  /* ---------- Events ---------- */
  let busy = false;
  async function run(control, work, form) {
    if (busy) return;
    busy = true;
    if (control) {
      control.disabled = true;
      control.setAttribute("aria-busy", "true");
    }
    try {
      if (form) fieldProblem(form, null);
      await work();
    } catch (e) {
      if (form?.isConnected) fieldProblem(form, e);
      else pm().error(e);
    } finally {
      busy = false;
      if (control) {
        control.disabled = false;
        control.removeAttribute("aria-busy");
      }
    }
  }
  if (typeof document !== "undefined") {
    document.addEventListener("click", (e) => {
      const b = e.target.closest?.("[data-packet]");
      if (!b) return;
      e.preventDefault();
      run(b, () => act(b.dataset.packet, b.dataset.ref || ""));
    });
    document.addEventListener("submit", (e) => {
      const form = e.target;
      const save = { "lp-sign": saveSigned, "lp-existing": saveExisting, "lp-deposit": saveReturn }[form.id];
      if (!save) return;
      e.preventDefault();
      run(e.submitter || form.querySelector('[type="submit"]'), () => save(form), form);
    });
    const changed = (e) => {
      const form = e.target.closest?.("form");
      if (!form) return;
      if (form.id === "lp-existing") existingChanged(form, e.target);
      if (form.id === "lp-deposit" && returning) {
        if (e.target.name === "tenancyId" && form.elements.funds.hasAttribute("data-lp-auto")) form.elements.funds.value = depositOf(pm().get(e.target.value));
        else if (e.target.name === "funds") e.target.removeAttribute("data-lp-auto");
        collectDeposit();
        refreshReturn();
      }
    };
    document.addEventListener("input", changed);
    document.addEventListener("change", changed);
    // Enter in the "add a deduction" boxes adds the deduction instead of saving the whole form.
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || !e.target.matches?.(".lp-add input:not([type=file]):not([type=checkbox])")) return;
      e.preventDefault();
      run(null, addDeduction);
    });
  }

  globalThis.LeasePackets = Object.freeze({
    finalize,
    draft,
    page,
    statusFor,
    history,
    addExisting,
    depositReturn: (id) => showReturn(id || ""),
    depositReturns,
    validateImport,
    domain: Object.freeze({ signState, plusDays, cents, itemReady, isDate, safeName, sniff, legacySigners, signerNames, reminders, termText, listNames }),
  });
})();
