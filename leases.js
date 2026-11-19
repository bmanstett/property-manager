(() => {
  "use strict";
  const R = globalThis.LeaseRules;
  const pm = () => globalThis.PM;
  const all = (t) => pm().records(t);
  const esc = (v) => pm().esc(String(v ?? ""));
  const blank = (v) => String(v ?? "").trim() === "";
  const date = () => pm().today();
  const id = () => pm().uid();
  const read = (i) => (i ? pm().get(i) : null);
  const current = () => pm().prop();
  const $ = (s) => document.querySelector(s);
  const stepNames = [
    "Property",
    "People",
    "Terms",
    "Disclosures",
    "Review",
    "Packet",
  ];
  const kinds = ["Fixed term", "Month to month", "Renewal", "Amendment"];
  const draftTemplate = "PM residential worksheet 1.2";
  const sharedFields = {
    property: [
      "jurisdiction",
      "propertyType",
      "ownerType",
      "ownerOccupied",
      "regulated",
      "titleSeparate",
      "exemptionNotice",
      "populationChange",
      "capCoverage",
      "causeCoverage",
      "sdCoverage",
      "smallOwner",
    ],
    disclosures: [
      "leadExemption",
      "applianceException",
      "ownFridge",
      "internet",
      "periodic",
      "service",
      "higherDeposit",
      "electronic",
      "pest",
      "flood",
      "hazards",
      "smoking",
      "sharedMeter",
      "language",
      "fee",
      "accommodation",
      "econsent",
      "rentChange",
    ],
  };
  let session = null,
    rulePreview = null,
    paused = null,
    depositState = null;
  let operationScope = null;
  function scoped() {
    const p = pm();
    if (
      operationScope &&
      (p.dataset() !== operationScope.dataset ||
        p.prop()?.id !== operationScope.propertyId)
    )
      throw Error(
        "The active rental changed. Reopen the original rental to continue.",
      );
    return p;
  }
  function shortDate(s) {
    return s
      ? new Date(s.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        })
      : "Unknown";
  }
  function coversCurrentTopics(pkg) {
    const ids = new Set(pkg.rules.map((r) => r.id));
    return R.base.rules.every((r) => ids.has(r.id));
  }
  function currentPackage() {
    const packages = all("legalPackage")
      .filter((x) =>
        x.package?.format === R.base.format && coversCurrentTopics(x.package),
      )
      .sort((a, b) => String(b.installed).localeCompare(String(a.installed)));
    return packages[0]?.package || R.base;
  }
  function btn(op, label, primary = false, record = "") {
    return (
      '<button class="ls-btn' +
      (primary ? " ls-primary" : "") +
      '" type="button" data-lease="' +
      esc(op) +
      '" data-ref="' +
      esc(record) +
      '">' +
      esc(label) +
      "</button>"
    );
  }
  const tag = (txt, kind = "") =>
    '<span class="ls-tag ' + esc(kind) + '">' + esc(txt) + "</span>";
  const msg = (t) => '<p class="ls-note">' + esc(t) + "</p>";
  const field = (label, n, v = "", type = "text", extra = "") =>
    '<label class="ls-field"><span>' +
    esc(label) +
    '</span><input type="' +
    type +
    '" name="' +
    esc(n) +
    '" value="' +
    esc(v) +
    '" ' +
    extra +
    "></label>";
  const area = (label, n, v = "", extra = "") =>
    '<label class="ls-field"><span>' +
    esc(label) +
    '</span><textarea rows="2" name="' +
    esc(n) +
    '" ' +
    extra +
    ">" +
    esc(v) +
    "</textarea></label>";
  const choice = (label, n, v, options, placeholder = "Choose when known") =>
    '<label class="ls-field"><span>' +
    esc(label) +
    '</span><select name="' +
    esc(n) +
    '"><option value="">' +
    esc(placeholder) +
    "</option>" +
    options
      .map((o) => {
        const [key, name] = Array.isArray(o) ? o : [o, o];
        return (
          '<option value="' +
          esc(key) +
          '" ' +
          (key === v ? "selected" : "") +
          ">" +
          esc(name) +
          "</option>"
        );
      })
      .join("") +
    "</select></label>";
  const selectFact = (k, f) => choice(R.fields[k][0], k, f[k], R.fields[k][1]);
  const group = (...items) =>
    '<div class="ls-grid">' + items.join("") + "</div>";
  const detail = (title, body, open = false) =>
    '<details class="ls-details" ' +
    (open ? "open" : "") +
    "><summary>" +
    esc(title) +
    "</summary><div>" +
    body +
    "</div></details>";
  const heading = (title, sub = "") =>
    '<header class="ls-sub"><h3>' +
    esc(title) +
    "</h3>" +
    (sub ? msg(sub) : "") +
    "</header>";
  const docs = () => all("document").filter((d) => d.hash);
  const docOptions = () => docs().map((d) => [d.id, d.name]);
  const tenantOptions = () =>
    all("tenancy").map((t) => [t.id, t.name || "Household"]);
  function checkList(n, opts, ids = []) {
    return (
      '<div class="ls-checklist">' +
      (opts.length
        ? opts
            .map(
              ([v, l]) =>
                '<label><input type="checkbox" name="' +
                esc(n) +
                '" value="' +
                esc(v) +
                '" ' +
                (ids.includes(v) ? "checked" : "") +
                "><span>" +
                esc(l) +
                "</span></label>",
            )
            .join("")
        : msg("Import files in Documents to link them here.")) +
      "</div>"
    );
  }
  function dialog(title, html) {
    pm().modal(
      title,
      '<div class="ls-modal">' +
        html +
        '<p class="ls-error" id="ls-error" role="alert" hidden></p></div>',
      {
        wide: true,
        key:
          "lease-" +
          (session?.id || "register") +
          "-" +
          title +
          "-" +
          (session?.step ?? ""),
      },
    );
  }
  function fail(e) {
    const el = $("#ls-error");
    if (el) {
      el.hidden = false;
      el.textContent = e.message || String(e);
    } else pm().toast(e.message || String(e));
  }
  function row(op, head, sub, status, record) {
    return (
      '<button type="button" class="ls-row" data-lease="' +
      esc(op) +
      '" data-ref="' +
      esc(record || "") +
      '"><span class="ls-file" aria-hidden="true">≡</span><span class="ls-rowtext"><b>' +
      esc(head) +
      "</b><small>" +
      esc(sub) +
      "</small></span>" +
      tag(status) +
      '<span aria-hidden="true">›</span></button>'
    );
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function starter(p, t = {}, d = date()) {
    return {
      id: id(),
      type: "lease",
      propertyId: p.id,
      tenancyId: t.id || "",
      name: "Residential lease",
      step: 0,
      template: draftTemplate,
      package: clone(currentPackage()),
      facts: {
        premises: p.address || p.name,
        city: p.city || "",
        county: p.county || "",
        state: p.state || "CA",
        start: t.start || "",
        rent: Number.isSafeInteger(t.rentCents)
          ? (t.rentCents / 100).toFixed(2)
          : "",
        agreementDate: d,
        kind: "Fixed term",
      },
      attachments: [],
      customClauses: [],
      reviewedInputs: false,
    };
  }
  function seed(p, t, d) {
    return [
      {
        id: "sample-renewal-" + p.id,
        type: "lease",
        propertyId: p.id,
        tenancyId: t.id,
        name: "Lease renewal",
        step: 1,
        template: draftTemplate,
        package: clone(R.base),
        facts: {
          kind: "Renewal",
          premises: p.address || p.name,
          city: p.city || "",
          county: p.county || "",
          state: "CA",
          start: t.start || "",
          rent: (t.rentCents / 100).toFixed(2),
          agreementDate: d,
        },
        attachments: [],
        reviewedInputs: false,
      },
    ];
  }
  function signers(f) {
    return [
      ["Landlord or agent", f.landlord],
      ...String(f.adults || "")
        .split(/\r?\n/)
        .map((n) => ["Tenant", n]),
    ]
      .filter(([, v]) => !blank(v))
      .map(([role, n], i) => ({ id: "signer-" + i, name: n.trim(), role }));
  }
  function evidence(snap) {
    return all("signature").filter(
      (s) =>
        s.packetId === snap.id &&
        snap.signers?.some((person) => s.signerId === person.id),
    );
  }
  function sigState(snap, events = evidence(snap)) {
    if (snap.mode !== "reviewed") return "Draft packet";
    const needed = snap.signers || [],
      seen = new Set(events.map((e) => e.signerId));
    const n = needed.filter((s) => seen.has(s.id)).length;
    return needed.length && n === needed.length
      ? "Fully signed"
      : n
        ? "Partially signed"
        : "Awaiting signatures";
  }
  function render() {
    const p = current();
    if (!p) {
      pm().content().innerHTML =
        '<section class="ls-page"><h1>Leases</h1>' +
        msg("Set up a rental to start a lease.") +
        "</section>";
      return;
    }
    const drafts = all("lease"),
      packets = all("leasePacket"),
      returns = all("depositReturn");
    pm().content().innerHTML =
      '<section class="ls-page"><div class="ls-top"><div><h1>Leases</h1><p>Agreements, disclosures and signatures for your property.</p></div>' +
      btn("create", "Create lease", true) +
      '</div><div class="ls-columns"><div><section class="ls-card">' +
      heading("Tenancies") +
      (all("tenancy").length
        ? all("tenancy")
            .map((t) => {
              const operative = all("operativeLease").find(
                (o) => o.tenancyId === t.id,
              );
              return row(
                "household",
                t.name || "Household",
                t.start ? "Since " + shortDate(t.start) : "Start date pending",
                operative ? "Executed lease on file" : "View record",
                t.id,
              );
            })
            .join("")
        : msg("Set up a tenancy to link an agreement.")) +
      '</section><section class="ls-card">' +
      heading("Draft agreements") +
      (drafts.length
        ? drafts
            .map((d) =>
              row(
                "lease",
                d.name || "Residential lease",
                d.facts?.premises || p.name,
                stepNames[d.step || 0],
                d.id,
              ),
            )
            .join("")
        : msg(
            "Start with the property details you know. You can return to a draft at any stage.",
          )) +
      '</section><section class="ls-card">' +
      heading("Packet history") +
      (packets.length
        ? packets
            .slice()
            .reverse()
            .map((s) =>
              row(
                "packet",
                s.name,
                shortDate(s.generated) + " · " + (s.packageVersion || ""),
                sigState(s),
                s.id,
              ),
            )
            .join("")
        : msg("Generated packets and returned signatures appear here.")) +
      '</section></div><div><section class="ls-card">' +
      heading("California rule package") +
      "<p><b>" +
      esc(currentPackage().version) +
      "</b></p>" +
      msg("Sources reviewed " + shortDate(currentPackage().verified)) +
      btn("rules", "View rules & updates") +
      '</section><section class="ls-card">' +
      heading("Deposit return") +
      msg(
        "Document possession, inspection rights, deductions and return delivery.",
      ) +
      btn("depositReturn", "Start return record") +
      returns
        .map((t) =>
          row(
            "depositReturn",
            "Return worksheet",
            t.deadline
              ? "Due " + shortDate(t.deadline)
              : "Possession date pending",
            t.delivered ? "Delivery recorded" : "In progress",
            t.id,
          ),
        )
        .join("") +
      "</section></div></div></section>";
  }
  function household(key) {
    const t = read(key);
    if (!t) return;
    const op = all("operativeLease").find((o) => o.tenancyId === key),
      snaps = all("leasePacket").filter((s) => s.tenancyId === key);
    dialog(
      t.name || "Tenancy",
      heading("Current executed agreement") +
        (op && read(op.signedDoc)
          ? row(
              "document",
              read(op.signedDoc).name,
              shortDate(op.effective),
              "Open signed copy",
              op.signedDoc,
            )
          : msg("No signed copy has been designated as operative.")) +
        heading("Agreements and amendments") +
        snaps
          .map((s) =>
            row("packet", s.name, shortDate(s.generated), sigState(s), s.id),
          )
          .join("") +
        btn("newFor", "Prepare agreement", true, key),
    );
  }
  function openDraft(key, mode, tenancyId) {
    const p = current();
    if (!p) {
      pm().toast("Set up a rental first.");
      return;
    }
    const saved = key ? read(key) : null;
    const resume =
      paused &&
      paused.dataset === pm().dataset() &&
      paused.propertyId === p.id &&
      (!key || (paused.draft.id === key && saved?._rev === paused.draft._rev)) &&
      mode !== "amend" &&
      !tenancyId;
    session = resume
      ? clone(paused.draft)
      : key
        ? saved && clone(saved)
        : starter(
            p,
            all("tenancy").find((t) => t.id === tenancyId) ||
              all("tenancy")[0] ||
              {},
          );
    if (!session || session.type !== "lease")
      throw Error("This draft is unavailable.");
    session.customClauses ??= [];
    session.template = draftTemplate;
    drawWizard();
  }
  function amend(key) {
    const s = read(key);
    session = starter(current(), read(s.tenancyId) || {});
    session.facts = {
      ...clone(s.facts),
      kind: "Amendment",
      agreementDate: date(),
      changeText: "",
      attorneyDoc: "",
      attorneyName: "",
      attorneyDate: "",
      attorneyScope: "",
      rights: "",
    };
    session.customClauses = clone(s.customClauses || []);
    session.name = "Amendment to " + s.name;
    session.parentPacket = s.id;
    session.reviewedInputs = false;
    drawWizard();
  }
  function capture() {
    const form = $("#ls-wizard");
    if (!form || !session) return;
    const data = new FormData(form);
    for (const [k, v] of data) {
      if (k === "tenancyId" || k === "name") session[k] = String(v).trim();
      else if (
        !k.startsWith("clause.") &&
        !["attachments", "reviewedInputs", "rights"].includes(k)
      )
        session.facts[k] = String(v).trim();
    }
    if (session.step === 2) {
      for (const clause of session.customClauses) {
        clause.title = data.get("clause." + clause.id + ".title") ?? clause.title;
        clause.text = data.get("clause." + clause.id + ".text") ?? clause.text;
      }
    }
    if (session.step === 3) {
      session.attachments = data.getAll("attachments");
      session.facts.rights = data.has("rights") ? "Yes" : "";
    }
    if (session.step === 4) session.reviewedInputs = data.has("reviewedInputs");
    paused = {
      propertyId: session.propertyId,
      dataset: pm().dataset(),
      draft: clone(session),
    };
  }
  function inputProblems(s) {
    const f = s.facts;
    const problems = [];
    for (const [key, label, step] of [
      ["firstOccupancy", "First certificate of occupancy", 0],
      ["agreementDate", "Agreement date", 2],
      ["start", "Original tenancy start", 2],
      ["termStart", "Term start", 2],
      ["end", "Term end", 2],
      ["depositWhen", "Security demand date", 2],
      ["attorneyDate", "Attorney review date", 3],
    ]) {
      if (f[key] && !R.isDate(f[key]))
        problems.push([step, label + " must be a valid calendar date."]);
    }
    if (
      f.kind !== "Month to month" && f.end &&
      [f.start, f.termStart].some((start) => start && f.end < start)
    )
      problems.push([2, "The term end precedes the original tenancy start or this term’s start."]);
    if (
      f.built &&
      (!/^\d{4}$/.test(f.built) || Number(f.built) < 1600 || Number(f.built) > Number(date().slice(0, 4)))
    )
      problems.push([0, "Confirm a completed construction year between 1600 and the current year."]);
    if (f.dueDay && !/^(?:[1-9]|[12]\d|3[01])$/.test(f.dueDay))
      problems.push([2, "Enter a whole rent due day from 1 through 31."]);
    for (const k of ["rent", "deposit"])
      if (
        f[k] &&
        (!/^\d{1,9}(?:\.\d{1,2})?$/.test(f[k]) ||
          (k === "rent" && Number(f[k]) <= 0))
      )
        problems.push([2, "Enter " + k + " in dollars with up to two decimal places."]);
    return problems;
  }
  function validRange(s, step) {
    const problem = inputProblems(s).find(([where]) => step === undefined || step === where);
    if (problem) throw Error(problem[1]);
  }
  async function saveDraft(stay = false, target) {
    capture();
    validRange(session, session.step);
    const old = session.step;
    if (target !== undefined) session.step = target;
    try {
      const stored = await pm().save("lease", session);
      session = clone(stored || session);
      paused = null;
    } catch (e) {
      session.step = old;
      throw e;
    }
    if (stay) {
      drawWizard();
      return;
    }
    pm().close();
    pm().refresh();
    pm().toast("Lease draft saved.");
  }
  function propertyStep(f) {
    return (
      heading(
        "Property and applicability",
        "Values copied from setup are starting points. Confirm the facts against your own records.",
      ) +
      group(
        field("Draft name", "name", session.name),
        choice("Agreement type", "kind", f.kind, kinds),
        choice(
          "Linked tenancy",
          "tenancyId",
          session.tenancyId,
          tenantOptions(),
        ),
        field("Premises and unit", "premises", f.premises),
        field("State", "state", f.state),
        field("County", "county", f.county),
        field("City or county location", "city", f.city),
        selectFact("jurisdiction", f),
        field(
          "Boundary map or parcel source",
          "boundarySource",
          f.boundarySource,
        ),
        field(
          "Year built",
          "built",
          f.built,
          "number",
          'min="1600" max="' + date().slice(0, 4) + '"',
        ),
        field(
          "First certificate of occupancy",
          "firstOccupancy",
          f.firstOccupancy,
          "date",
        ),
      ) +
      detail(
        "Ownership and tenant protections",
        group(
          ...sharedFields.property
            .filter((k) => k !== "jurisdiction")
            .map((k) => selectFact(k, f)),
          area("Evidence for rent-cap determination", "capBasis", f.capBasis),
          area(
            "Evidence for just-cause determination",
            "causeBasis",
            f.causeBasis,
          ),
          area("Local review and city exemptions", "sdBasis", f.sdBasis),
        ),
      )
    );
  }
  function peopleStep(f) {
    return (
      heading(
        "Parties and occupants",
        "Enter each adult tenant on a separate line. An occupant is a signer only if also listed as an adult tenant.",
      ) +
      group(
        field("Landlord or authorized agent signer", "landlord", f.landlord),
        area(
          "Notice recipient, physical address and phone",
          "noticeContact",
          f.noticeContact,
        ),
        area("Adult tenant signers, one per line", "adults", f.adults),
        area("Other occupants, if any", "occupants", f.occupants),
      ) +
      area(
        "Other landlord or agent identity and authority",
        "identity",
        f.identity,
      )
    );
  }
  function clauseEditor(clauses) {
    return (
      heading("Additional clauses", "Enter the wording you want reviewed for this tenancy. Each clause needs a location in the final reviewed agreement or an attached exhibit.") +
      clauses.map((c, i) =>
        '<fieldset class="ls-item"><legend>Clause ' + (i + 1) + '</legend>' +
        field("Clause title (optional)", "clause." + c.id + ".title", c.title) +
        area("Clause wording", "clause." + c.id + ".text", c.text) +
        '<div class="ls-actions">' +
        (i > 0 ? btn("clauseUp", "Move up", false, c.id) : "") +
        (i < clauses.length - 1 ? btn("clauseDown", "Move down", false, c.id) : "") +
        btn("clauseRemove", "Remove clause", false, c.id) + "</div></fieldset>"
      ).join("") +
      btn("clauseAdd", "Add clause")
    );
  }
  function editClause(action, key) {
    capture();
    const clauses = session.customClauses;
    const i = clauses.findIndex((c) => c.id === key);
    if (action === "clauseAdd") {
      key = id();
      clauses.push({ id: key, title: "", text: "" });
    } else if (i >= 0) {
      if (action === "clauseRemove") clauses.splice(i, 1);
      else {
        const j = i + (action === "clauseUp" ? -1 : 1);
        if (j >= 0 && j < clauses.length)
          [clauses[i], clauses[j]] = [clauses[j], clauses[i]];
      }
    }
    session.reviewedInputs = false;
    drawWizard();
    capture();
    const focus =
      $("#ls-wizard").elements.namedItem("clause." + key + ".title") ||
      $('[data-lease="clauseAdd"]');
    focus?.focus();
  }
  function clauseHeading(c, i) {
    return "Additional clause " + (i + 1) + (c.title.trim() ? " — " + c.title.trim() : "");
  }
  function clauseSections(d) {
    return (d.customClauses || []).map((c, i) => ({
      heading: clauseHeading(c, i),
      lines: [c.text || "[clause wording pending]"],
    }));
  }
  function termsStep(f) {
    return (
      heading("Dates and financial terms") +
      group(
        field(
          "Agreement or amendment date",
          "agreementDate",
          f.agreementDate,
          "date",
        ),
        field("Original tenancy start", "start", f.start, "date"),
        field("This term begins", "termStart", f.termStart, "date"),
        ...(f.kind === "Month to month" ? [] : [field("This term ends", "end", f.end, "date")]),
        field(
          "Monthly rent ($)",
          "rent",
          f.rent,
          "text",
          'inputmode="decimal"',
        ),
        field(
          "Due day of month",
          "dueDay",
          f.dueDay,
          "number",
          'min="1" max="31"',
        ),
        field(
          "Total refundable security ($)",
          "deposit",
          f.deposit,
          "text",
          'inputmode="decimal"',
        ),
        field(
          "Date security demanded or collected",
          "depositWhen",
          f.depositWhen,
          "date",
        ),
        area("Payment methods and instructions", "methods", f.methods),
        area("Utility responsibilities", "utilities", f.utilities),
        area("Appliances and responsibility", "appliances", f.appliances),
        area("Parking and storage", "parking", f.parking),
        area("Pets and accommodations", "pets", f.pets),
        area("Maintenance responsibilities", "maintenance", f.maintenance),
      ) +
      (f.kind === "Amendment"
        ? area(
            "Provisions being amended and effective date",
            "changeText",
            f.changeText,
          )
        : "") +
      clauseEditor(session.customClauses || [])
    );
  }
  function disclosureStep(f) {
    return (
      heading(
        "Rules and disclosures",
        "Choose “No” only for a condition you have checked. Unanswered facts stay open for review.",
      ) +
      group(...[
        ...sharedFields.disclosures,
        ...Object.keys(R.fields).filter((k) => !sharedFields.property.includes(k) && !sharedFields.disclosures.includes(k)),
      ].map((k) => selectFact(k, f))) +
      area("How tenants should report suspected bed bugs", "bedbugContact", f.bedbugContact) +
      area(
        "Other property rules and disclosure details",
        "rulesText",
        f.rulesText,
      ) +
      detail(
        "Attach reviewed disclosures and exhibits",
        checkList("attachments", docOptions(), session.attachments || []),
        true,
      ) +
      detail(
        "Attorney-reviewed agreement",
        msg(
          "Select the completed, reviewed agreement PDF and record its scope. The exact PDF becomes the agreement in a reviewed packet.",
        ) +
          choice(
            "Completed agreement PDF",
            "attorneyDoc",
            f.attorneyDoc,
            docs()
              .filter((d) => d.mime === "application/pdf")
              .map((d) => [d.id, d.name]),
          ) +
          group(
            field("Reviewing attorney", "attorneyName", f.attorneyName),
            field("Review date", "attorneyDate", f.attorneyDate, "date"),
          ) +
          area(
            "Advice reference, jurisdiction, version and resolved issues",
            "attorneyScope",
            f.attorneyScope,
          ) +
          checkList(
            "rights",
            [
              [
                "yes",
                "I have authority to use this document for this tenancy.",
              ],
            ],
            f.rights === "Yes" ? ["yes"] : [],
          ),
      )
    );
  }
  function outcomes(d) {
    return (d.package || R.base).rules.map((r) => ({
      ...R.evaluate(r, d.facts),
      rule: r,
    }));
  }
  function issues(d) {
    const f = d.facts,
      missing = inputProblems(d).map(([, why]) => why);
    if (!coversCurrentTopics(d.package))
      missing.push("Update this draft’s rule package to review the additional California requirements.");
    (d.customClauses || []).forEach((c, i) => {
      if (blank(c.text)) missing.push("Wording for additional clause " + (i + 1));
    });
    for (const [key, label] of Object.entries({
      premises: "Premises",
      state: "State",
      landlord: "Landlord signer",
      adults: "Adult tenant signers",
      agreementDate: "Agreement date",
      start: "Original tenancy start",
      termStart: "Term start",
      rent: "Rent",
      dueDay: "Rent due day",
      methods: "Payment methods",
      deposit: "Deposit amount, including zero",
      noticeContact: "Notice contact",
    }))
      if (blank(f[key])) missing.push(label);
    if (f.kind === "Fixed term" && !f.end) missing.push("Fixed-term end date");
    if (f.kind === "Amendment" && !f.changeText)
      missing.push("Amendment terms");
    if (!d.tenancyId) missing.push("Linked tenancy");
    if (!["CA", "CALIFORNIA"].includes(String(f.state).toUpperCase().trim()))
      missing.push("California jurisdiction required");
    if (!d.reviewedInputs) missing.push("Owner review of commercial terms");
    const needs = outcomes(d).filter((x) => x.status === R.unknown);
    missing.push(...needs.map((x) => x.title + " — " + x.why));
    return missing;
  }
  const assetsFor = (d, mode = "draft") =>
    outcomes(d)
      .filter((x) => x.status === R.required)
      .flatMap((x) => R.attached[x.id] || [])
      .filter((asset) => mode === "draft" || !asset.draftOnly);
  function sections(d) {
    const f = d.facts,
      show = (label, k) => label + " — " + (f[k] || "Unconfirmed");
    const rows = outcomes(d),
      included = [
        ...assetsFor(d).map((a) => a.name),
        ...(d.attachments || []).map(
          (i) => read(i)?.name || "Unavailable attachment",
        ),
      ],
      people = signers(f).map((v) => v.role + " — " + v.name);
    const adults = String(f.adults || "[adult tenants pending]")
      .split(/\r?\n/)
      .filter(Boolean)
      .join(", ");
    const opening =
      (f.landlord || "[landlord or agent pending]") + " and " + adults;
    const terms =
      f.kind === "Amendment"
        ? opening +
          " propose the following changes to their agreement for " +
          (f.premises || "[premises pending]") +
          "."
        : opening +
          " agree to the residential rental of " +
          (f.premises || "[premises pending]") +
          " beginning " +
          (f.termStart || "[term start pending]") +
          ".";
    const duration =
      f.kind === "Month to month"
        ? "The tenancy continues monthly."
        : f.kind === "Fixed term"
          ? "The fixed term ends " + (f.end || "[end date pending]") + "."
          : f.kind === "Renewal"
            ? "The renewal covers the term shown below."
            : "The provisions identified below are the proposed amendments.";
    const pay =
      "Monthly rent is " +
      (f.rent ? "$" + f.rent : "[amount pending]") +
      ", payable on day " +
      (f.dueDay || "[pending]") +
      " of the month using " +
      (f.methods || "[payment instructions pending]") +
      ".";
    return [
      {
        heading: "Draft for review",
        lines: [
          "Residential agreement · " +
            (f.kind || "Type unconfirmed") +
            ". Review the exact statutory notices and all open issues before execution.",
          "Template " + d.template + " | Package " + d.package.version,
        ],
      },
      {
        heading: "Agreement",
        lines: [
          terms,
          duration,
          ...(f.kind === "Amendment"
            ? [f.changeText || "[amendment terms pending]"]
            : [
                pay,
                "Refundable security: " +
                  (f.deposit ? "$" + f.deposit : "[amount pending]") +
                  ".",
              ]),
        ],
      },
      {
        heading: "Parties and premises",
        lines: [
          show("Landlord / agent", "landlord"),
          show("Notices", "noticeContact"),
          ...(f.identity ? [show("Other landlord or agent identity and authority", "identity")] : []),
          show("Adult tenants", "adults"),
          show("Additional occupants", "occupants"),
          show("Address", "premises"),
        ],
      },
      {
        heading: "Dates and consideration",
        lines: [
          show("Type", "kind"),
          show("Agreement date", "agreementDate"),
          show("Original tenancy start", "start"),
          show("Term starts", "termStart"),
          ...(f.kind === "Month to month" ? [] : [show("Term ends", "end")]),
          show("Monthly rent ($)", "rent"),
          show("Due day", "dueDay"),
          show("Refundable security ($)", "deposit"),
          ...(f.depositWhen ? [show("Security demand or collection date", "depositWhen")] : []),
          show("Payment methods", "methods"),
        ],
      },
      {
        heading: "Premises and responsibilities",
        lines: [
          show("Utilities", "utilities"),
          show("Appliances", "appliances"),
          show("Parking", "parking"),
          show("Pets and accommodations", "pets"),
          show("Maintenance", "maintenance"),
          show("Other rules", "rulesText"),
          ...(f.kind === "Amendment"
            ? [show("Amended provisions", "changeText")]
            : []),
        ],
      },
      ...clauseSections(d),
      ...globalThis.LeaseNotices.sections(d, rows),
      {
        heading: "Disclosure and source review",
        lines: rows.map(
          (x) => x.status + " — " + x.title + " / " + x.rule.section,
        ),
      },
      {
        heading: "Items to resolve",
        lines: [
          ...issues(d),
          ...rows
            .filter((x) => x.status === R.review)
            .map((x) => x.title + " — " + x.why),
        ],
      },
      {
        heading: "Attachments",
        lines: included.length
          ? included
          : ["No exhibits included in this draft."],
      },
      {
        heading: "Required signers for reviewed agreement",
        lines: people.length ? people : ["Signer identities are unconfirmed."],
        keepTogether: true,
      },
    ];
  }
  function htmlPreview(d) {
    return htmlPaper(d.name || "Residential agreement", sections(d));
  }
  function htmlPaper(title, rows) {
    return (
      '<article class="ls-paper"><div class="ls-paper-mark">PROPERTY MANAGER</div><h2>' +
      esc(title) +
      "</h2>" +
      rows
        .map(
          (s) =>
            (s.bodySize === 12 ? '<section style="font-size:12pt">' : "<section>") +
            '<h3 dir="auto">' +
            esc(s.heading) +
            "</h3>" +
            s.lines.map((l) => '<p dir="auto">' + esc(l) + "</p>").join("") +
            "</section>",
        )
        .join("") +
      "</article>"
    );
  }
  function reviewStep(d) {
    const o = outcomes(d);
    return (
      heading(
        "Review agreement",
        d.package.version +
          " · Sources checked " +
          shortDate(d.package.verified),
      ) +
      group(
        ...[
          "Required",
          "More information needed",
          "Review needed",
          "Not applicable",
        ].map(
          (label) =>
            '<div class="ls-tally"><strong>' +
            o.filter((x) => x.status === label).length +
            "</strong><small>" +
            label +
            "</small></div>",
        ),
      ) +
      btn("preview", "Read draft preview") +
      detail(
        "Applicability and sources",
        o
          .map(
            (x) =>
              '<section class="ls-source">' +
              tag(x.status) +
              "<b>" +
              esc(x.title) +
              "</b><p>" +
              esc(x.why) +
              "</p>" +
              sourceLink(x.rule) +
              "</section>",
          )
          .join(""),
        true,
      ) +
      checkList(
        "reviewedInputs",
        [
          [
            "yes",
            "I reviewed the parties, dates, rent and other commercial terms.",
          ],
        ],
        d.reviewedInputs ? ["yes"] : [],
      )
    );
  }
  function sourceLink(r) {
    return R.trusted(r.url)
      ? '<a href="' +
          esc(r.url) +
          '" target="_blank" rel="noopener noreferrer">' +
          esc(r.section) +
          "</a>"
      : "";
  }
  function packetStep(d) {
    const missing = issues(d);
    return (
      heading("Document packet", d.name) +
      (coversCurrentTopics(d.package) ? "" : btn("updateDraftRules", "Update draft rules", true)) +
      msg(
        "The draft packet includes the printable agreement, source review and selected attachments. Text supported by the embedded font also exports as a PDF.",
      ) +
      detail(
        "Review checklist",
        missing.length
          ? "<ul>" +
              missing.map((x) => "<li>" + esc(x) + "</li>").join("") +
              "</ul>"
          : msg(
              "Input checks completed. Applicable law and precise documents still require review.",
            ),
        true,
      ) +
      btn("generate", "Generate draft packet", true) +
      btn("preview", "Read preview") +
      detail(
        "Use a completed attorney-reviewed agreement",
        msg(
          "Review all open legal issues with counsel, record their disposition and attach the completed agreement PDF under Disclosures. A signed version is tracked after return.",
        ) + btn("finalize", "Review and freeze packet"),
      )
    );
  }
  function drawWizard() {
    const d = session,
      i = Math.max(0, Math.min(5, d.step || 0)),
      f = d.facts;
    d.step = i;
    const body = [
      () => propertyStep(f),
      () => peopleStep(f),
      () => termsStep(f),
      () => disclosureStep(f),
      () => reviewStep(d),
      () => packetStep(d),
    ][i]();
    const live =
      i < 4
        ? '<details class="ls-details"><summary>Live agreement preview</summary><div id="ls-live">' +
          htmlPreview(d) +
          "</div></details>" +
          btn("preview", "Open full preview")
        : "";
    dialog(
      d.name || "Prepare lease",
      '<form id="ls-wizard"><nav class="ls-steps" aria-label="Lease preparation">' +
        stepNames
          .map(
            (n, j) =>
              '<button type="button" data-lease="step" data-ref="' +
              j +
              '" ' +
              (j === i ? 'aria-current="step"' : "") +
              ">" +
              esc(n) +
              "</button>",
          )
          .join("") +
        "</nav>" +
        body +
        live +
        '<div class="ls-footer">' +
        btn("save", "Save & close") +
        (i ? btn("step", "Back", false, i - 1) : "") +
        (i < 5 ? btn("step", "Save & continue", true, i + 1) : "") +
        "</div></form>",
    );
  }
  function preview() {
    capture();
    dialog(
      "Agreement preview",
      btn("backWizard", "Back to agreement") +
        btn("print", "Print/Save as PDF") +
        htmlPreview(session),
    );
  }
  function safeName(n) {
    const name = String(n || "Document")
      .normalize("NFC")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
      .replace(/^\.+/, "") || "Document";
    const letters = Array.from(name);
    if (letters.length <= 110) return name;
    const extension = name.match(/\.[a-z0-9]{1,10}$/i)?.[0] || "";
    return letters.slice(0, 110 - extension.length).join("") + extension;
  }
  function htmlFile(title, rows) {
    return (
      '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\';style-src \'unsafe-inline\'"><title>' +
      esc(title) +
      "</title><style>@page{size:letter;margin:.75in}body{margin:2em auto;max-width:44em;font:12pt/1.5 Georgia,serif;color:#203b34;padding:0 1em}h1,h2,h3{break-after:avoid}p{white-space:pre-line;overflow-wrap:anywhere}section{margin-top:1.5em}h3{border-bottom:1px solid #aaa}.ls-paper-mark{font:10pt system-ui;letter-spacing:.15em}</style>" +
      htmlPaper(title, rows) +
      "</html>"
    );
  }
  function finalCheck() {
    capture();
    const d = session,
      f = d.facts,
      items = issues(d);
    const contract = read(f.attorneyDoc);
    if (!contract || contract.mime !== "application/pdf" || !contract.hash)
      items.push("Completed agreement PDF");
    if (
      blank(f.attorneyName) ||
      !R.isDate(f.attorneyDate) ||
      f.attorneyDate > date() ||
      blank(f.attorneyScope) ||
      f.rights !== "Yes"
    )
      items.push("Documented attorney review date, scope and use rights");
    if (
      new Set(signers(f).map((x) => x.name.toLocaleLowerCase())).size !==
      signers(f).length
    )
      items.push("Distinct names or identifying suffixes for each signer");
    if (items.length) {
      dialog(
        "Complete the agreement review",
        msg(
          "Complete these items before freezing an attorney-reviewed packet.",
        ) +
          "<ul>" +
          items.map((x) => "<li>" + esc(x) + "</li>").join("") +
          "</ul>" +
          btn("backWizard", "Return to agreement"),
      );
      return;
    }
    const rows = outcomes(d).filter(
      (x) => x.status === R.review || x.status === R.required,
    );
    dialog(
      "Confirm reviewed packet",
      msg(
        "Check the specific contract, source findings and all required attachments with the reviewing attorney. Document the clause, exhibit or applicable exception for each item.",
      ) +
        heading(contract.name, "SHA-256 " + contract.hash) +
        '<form id="ls-final">' +
        ((d.customClauses || []).length
          ? heading("Confirm the additional clauses", "Locate each clause in the completed agreement or a selected exhibit. The reviewed packet retains those documents exactly as supplied.") +
            d.customClauses.map((c, i) =>
              '<section class="ls-source"><b>' + esc(clauseHeading(c, i)) + "</b><p>" +
              esc(c.text).replace(/\r?\n/g, "<br>") + "</p>" +
              area("Page, section or exhibit containing this clause", "clause." + c.id, "", 'required maxlength="1500"') +
              "</section>"
            ).join("")
          : "") +
        (rows.some((r) => r.id === "lead" && r.status === R.required)
          ? msg("Identify the completed lead disclosure and any available reports in the contract or selected exhibits. The bundled English pamphlet accompanies the reviewed documents.")
          : "") +
        rows
          .map((x) =>
            area(
              x.title + " · " + x.status,
              x.id,
              d.resolutions?.[x.id] || "",
              'required maxlength="1500"',
            ),
          )
          .join("") +
        checkList("confirmed", [
          [
            "yes",
            "The reviewed contract and referenced exhibits contain the final agreed terms and required disclosures for this tenancy.",
          ],
        ]) +
        btn("backWizard", "Back") +
        '<button class="ls-btn ls-primary">Freeze reviewed packet</button></form>',
    );
  }
  async function storedDoc(blob, name, kind, d, more = {}) {
    return {
      type: "document",
      id: id(),
      propertyId: d.propertyId,
      tenancyId: d.tenancyId,
      hash: await scoped().blob(blob),
      size: blob.size,
      mime: blob.type,
      name,
      originalName: name,
      kind,
      date: date(),
      created: new Date().toISOString(),
      immutable: true,
      ...more,
    };
  }
  async function generate(mode, resolutions, clauseReferences = {}) {
    const d = session;
    capture();
    validRange(d);
    const when = new Date().toISOString(),
      packetId = id(),
      s = d.facts,
      docMap = [],
      files = [],
      newDocs = [];
    let size = 0;
    function add(n, b) {
      size += b.size;
      if (size > 31.5 * 1024 * 1024)
        throw Error(
          "This packet exceeds the 32 MiB stored-file limit. Use smaller exhibits or share large evidence separately.",
        );
      files.push({ name: n, data: b });
    }
    for (const [index, docId] of [
      ...new Set([
        ...(mode === "reviewed" ? [s.attorneyDoc] : []),
        ...(d.attachments || []),
      ]),
    ].entries()) {
      const doc = read(docId);
      if (!doc?.hash)
        throw Error(
          "An attached document is missing. Review the disclosure list.",
        );
      const b = await scoped().file(doc.hash);
      if (!(b instanceof Blob))
        throw Error("The original attachment is unavailable.");
      const path =
        mode === "reviewed" && s.attorneyDoc === docId
          ? "agreement/" + safeName(doc.name)
          : "exhibits/" +
            String(index + 1).padStart(2, "0") +
            "-" +
            safeName(doc.name);
      const copy = await storedDoc(
        b,
        doc.name,
        doc.kind || "Lease exhibit",
        d,
        { sourceId: doc.id, packetId },
      );
      add(path, b);
      newDocs.push(copy);
      docMap.push({
        id: copy.id,
        sourceId: doc.id,
        hash: copy.hash,
        name: copy.name,
        path,
      });
    }
    for (const a of assetsFor(d, mode)) {
      const res = await fetch(a.path);
      if (!res.ok)
        throw Error(
          "A bundled disclosure is unavailable. Finish offline installation and retry.",
        );
      const b = await res.blob();
      if ((await b.slice(0, 5).text()) !== "%PDF-")
        throw Error("The installed disclosure is invalid.");
      const name = a.path.split("/").pop(),
        copy = await storedDoc(
          new Blob([b], { type: "application/pdf" }),
          name,
          "Disclosure",
          d,
          { source: "Bundled public disclosure", packetId },
        );
      if (a.hash && copy.hash !== a.hash)
        throw Error("The installed disclosure differs from its published copy. Refresh the app and retry.");
      add("disclosures/" + name, b);
      newDocs.push(copy);
      docMap.push({
        id: copy.id,
        hash: copy.hash,
        name: copy.name,
        path: "disclosures/" + name,
      });
    }
    const review = outcomes(d);
    const title = mode === "reviewed" ? "Packet review record" : "Draft residential agreement";
    const worksheetRows = mode === "reviewed"
          ? [
              {
                heading: "Attorney-reviewed agreement",
                lines: [
                  d.name,
                  "Contract file: " + read(s.attorneyDoc).name,
                  "Attorney: " + s.attorneyName,
                  "Review date: " + s.attorneyDate,
                  "Scope: " + s.attorneyScope,
                  "Package: " + d.package.version,
                ],
              },
              {
                heading: "Reviewed clauses and exhibits",
                lines: review
                  .filter((x) => resolutions[x.id])
                  .map((x) => x.title + " — " + resolutions[x.id]),
              },
              ...(d.customClauses || []).map((c, i) => ({
                heading: clauseHeading(c, i),
                lines: [c.text, "Reviewed contract or exhibit location — " + clauseReferences[c.id]],
              })),
              {
                heading: "Required signers",
                lines: signers(s).map((p) => p.name + " — " + p.role),
              },
            ]
          : sections(d);
    let worksheet;
    const printable = () => new Blob(
      [htmlFile(mode === "reviewed" ? title : d.name || title, worksheetRows)],
      {type: "text/html"},
    );
    try {
      worksheet = pm().pdf(title, worksheetRows);
    } catch (error) {
      if (error.code !== "PDF_TEXT_UNSUPPORTED") throw error;
      worksheet = printable();
    }
    const isPdf = worksheet.type === "application/pdf";
    const form = await storedDoc(
      worksheet,
      (mode === "reviewed" ? title : safeName(d.name) + " — draft") +
        (isPdf ? ".pdf" : ".html"),
      mode === "reviewed" ? "Review record" : "Draft lease",
      d,
      { packetId },
    );
    newDocs.push(form);
    if (mode === "draft") {
      if (isPdf) add("review/" + safeName(form.name), worksheet);
      add("review/printable-draft.html", isPdf ? printable() : worksheet);
    }
    const packet = {
      type: "leasePacket",
      id: packetId,
      immutable: true,
      propertyId: d.propertyId,
      tenancyId: d.tenancyId,
      leaseId: d.id,
      parentPacket: d.parentPacket || "",
      name: d.name,
      mode,
      generated: when,
      packageVersion: d.package.version,
      template: d.template,
      package: clone(d.package),
      facts: clone(s),
      customClauses: clone(d.customClauses || []),
      clauseReferences,
      review: review.map(({ rule, ...o }) => o),
      resolutions: resolutions || {},
      signers: signers(s),
      attachments: docMap,
      worksheetId: form.id,
      contractId: mode === "reviewed" ? s.attorneyDoc : null,
    };
    if (mode === "reviewed")
      packet.contractId = docMap.find((a) => a.sourceId === s.attorneyDoc).id;
    add(
      "review/inclusion-checklist.txt",
      new Blob(
        [
          [
            mode === "draft" ? "DRAFT FOR REVIEW" : "REVIEWED PACKET",
            d.name,
            d.package.version,
            when,
            "",
            ...docMap.map(
              (a) => "Included: " + a.path + " | SHA-256 " + a.hash,
            ),
            ...(mode === "draft"
              ? review.map((r) => r.status + " | " + r.title + " | " + r.why)
              : []),
          ].join("\n"),
        ],
        { type: "text/plain" },
      ),
    );
    const zip = await pm().zip(files),
      archive = await storedDoc(
        zip,
        safeName(d.name) +
          " — " +
          (mode === "reviewed" ? "reviewed" : "draft") +
          " packet.zip",
        "Lease packet",
        d,
        { packetId },
      );
    packet.archiveId = archive.id;
    packet.archiveHash = archive.hash;
    await scoped().batch([
      { ...d, type: "lease", resolutions: resolutions || d.resolutions || {} },
      ...newDocs,
      archive,
      packet,
    ]);
    paused = null;
    scoped().refresh();
    viewPacket(packet.id);
    pm().toast("Packet retained in Documents.");
  }
  function viewPacket(key) {
    const s = read(key);
    if (!s) throw Error("This packet is unavailable.");
    const events = evidence(s),
      state = sigState(s, events);
    const amendmentParent = s.parentPacket ? read(s.parentPacket) : null;
    const documentId = s.mode === "reviewed" ? s.contractId : s.worksheetId;
    const htmlWorksheet = read(s.worksheetId)?.mime === "text/html";
    dialog(
      s.name,
      '<div class="ls-info">' +
        tag(state) +
        msg("Created " + shortDate(s.generated) + " · " + s.packageVersion) +
        "</div>" +
        msg(
          s.mode === "draft"
            ? "Draft files retain the open review items from the date of generation."
            : "The packet contains the exact reviewed agreement. Import returned scans to track signature evidence.",
        ) +
        (htmlWorksheet ? msg("The worksheet is printable HTML to preserve its script and characters. Open it in your browser and print to save a PDF.") : "") +
        (amendmentParent
          ? msg(
              "Amends " +
                amendmentParent.name +
                " · " +
                shortDate(amendmentParent.generated),
            )
          : "") +
        '<div class="ls-actions">' +
        btn("downloadPacket", "Download packet ZIP", true, s.id) +
        (s.mode === "draft" && htmlWorksheet
          ? btn("downloadDocument", "Download printable agreement", false, documentId)
          : btn("document", "Open agreement PDF", false, documentId)) +
        btn("compose", "Prepare email", false, s.archiveId) +
        btn("amend", "Start amendment", false, s.id) +
        "</div>" +
        detail(
          "Packet contents",
          s.attachments
            .map((x) => row("document", x.name, x.path, "Open", x.id))
            .join("") + msg("Archive SHA-256 " + s.archiveHash) +
            (s.mode === "reviewed"
              ? btn(htmlWorksheet ? "downloadDocument" : "document", "Owner’s review record", false, s.worksheetId)
              : ""),
        ) +
        (s.mode === "reviewed"
          ? heading("Signature evidence") +
            s.signers
              .map((a) => {
                const hit = events.find((e) => e.signerId === a.id);
                return hit
                  ? row(
                      "document",
                      a.name,
                      a.role + " · " + shortDate(hit.signedDate),
                      "Evidence",
                      hit.documentId,
                    )
                  : row(
                      "recordSign",
                      a.name,
                      a.role,
                      "Record return",
                      s.id + "|" + a.id,
                    );
              })
              .join("") +
            btn("signedReturn", "Import signed document", false, s.id) +
            (state === "Fully signed"
              ? btn(
                  "markOperative",
                  "Designate executed agreement",
                  false,
                  s.id,
                )
              : "")
          : ""),
    );
  }
  async function downloadDoc(docId) {
    const d = read(docId),
      b = d && (await pm().file(d.hash));
    if (!(b instanceof Blob))
      throw Error("This file is unavailable. Restore a verified backup.");
    pm().download(b, d.name);
  }
  function signatureForm(key, selected = "") {
    const s = read(key);
    if (!s || s.mode !== "reviewed")
      throw Error("Choose a reviewed packet first.");
    const seen = new Set(evidence(s).map((v) => v.signerId));
    dialog(
      "Record returned signatures",
      msg(
        "Verify the returned pages against this exact packet. Select only signers whose signatures you can confirm on the attached evidence.",
      ) +
        '<form id="ls-sign" data-ref="' +
        esc(key) +
        '">' +
        checkList(
          "signers",
          s.signers
            .filter((p) => !seen.has(p.id))
            .map((p) => [p.id, p.name + " · " + p.role]),
          selected ? [selected] : [],
        ) +
        field(
          "Returned signed PDF or scan",
          "document",
          "",
          "file",
          'accept="application/pdf,image/jpeg,image/png" required',
        ) +
        field(
          "Provider certificate, if supplied",
          "certificate",
          "",
          "file",
          'accept="application/pdf"',
        ) +
        group(
          field(
            "Date signed or confirmed",
            "signedDate",
            date(),
            "date",
            "required",
          ),
          choice("Verification method", "method", "", [
            "Compared wet signatures on returned scan",
            "Compared returned signed paper original",
            "Matched provider evidence and document",
          ]),
        ) +
        area(
          "How the signatures and packet version were confirmed",
          "basis",
          "",
          "required",
        ) +
        '<button class="ls-btn ls-primary">Save signature evidence</button></form>',
    );
  }
  function checkUpload(file, types) {
    if (
      !(file instanceof Blob) ||
      !file.size ||
      file.size > 32 * 1024 * 1024 ||
      !types.includes(file.type)
    )
      throw Error("Choose a matching PDF, JPEG or PNG file up to 32 MiB.");
  }
  async function assertContent(file) {
    const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const tests = {
      "application/pdf": [37, 80, 68, 70, 45],
      "image/jpeg": [255, 216, 255],
      "image/png": [137, 80, 78, 71, 13, 10, 26, 10],
    };
    if (!tests[file.type]?.every((v, i) => bytes[i] === v))
      throw Error("The file bytes do not match the selected document type.");
  }
  async function saveSign(form) {
    const s = read(form.dataset.ref),
      d = new FormData(form),
      ids = d.getAll("signers"),
      file = d.get("document"),
      cert = d.get("certificate");
    if (
      !ids.length ||
      !d.get("method") ||
      !d.get("basis").trim() ||
      !R.isDate(d.get("signedDate")) ||
      d.get("signedDate") > date()
    )
      throw Error(
        "Select the verified signers and complete the evidence details.",
      );
    const done = new Set(evidence(s).map((x) => x.signerId));
    if (ids.some((i) => done.has(i) || !s.signers.some((p) => p.id === i)))
      throw Error("Signer records changed. Reopen the packet to review.");
    checkUpload(file, ["application/pdf", "image/png", "image/jpeg"]);
    await assertContent(file);
    if (cert?.size) {
      checkUpload(cert, ["application/pdf"]);
      await assertContent(cert);
    }
    const doc = await storedDoc(file, file.name, "Returned signed lease", s, {
      packetId: s.id,
    });
    const certificate = cert?.size
      ? await storedDoc(cert, cert.name, "Signature certificate", s, {
          packetId: s.id,
        })
      : null;
    const changes = ids.map((i) => ({
      type: "signature",
      id: "sig-" + s.id + "-" + i,
      propertyId: s.propertyId,
      tenancyId: s.tenancyId,
      packetId: s.id,
      packetHash: s.archiveHash,
      signerId: i,
      documentId: doc.id,
      certificateId: certificate?.id || "",
      signedDate: d.get("signedDate"),
      method: d.get("method"),
      basis: d.get("basis"),
      immutable: true,
    }));
    await scoped().batch([
      doc,
      ...(certificate ? [certificate] : []),
      ...changes,
    ]);
    scoped().refresh();
    viewPacket(s.id);
  }
  function operative(key) {
    const s = read(key);
    if (!s || sigState(s) !== "Fully signed")
      throw Error("All required signers need evidence first.");
    const returns = docs()
      .filter(
        (doc) =>
          doc.kind === "Returned signed lease" ||
          doc.kind === "Executed lease" ||
          doc.mime === "application/pdf",
      )
      .map((doc) => [doc.id, doc.name]);
    dialog(
      "Designate executed agreement",
      msg(
        "Select a complete copy containing every required signature. Earlier versions remain available in packet history.",
      ) +
        '<form id="ls-operative" data-ref="' +
        esc(key) +
        '">' +
        choice("Complete signed copy", "signedDoc", "", returns) +
        field(
          "Effective date",
          "effective",
          s.facts.termStart || date(),
          "date",
          "required",
        ) +
        area(
          "Basis for selecting the complete signed copy",
          "basis",
          "",
          "required",
        ) +
        '<button class="ls-btn ls-primary">Confirm executed agreement</button></form>',
    );
  }
  function ruleRegister() {
    const p = currentPackage();
    rulePreview = null;
    dialog(
      "California rule package",
      heading(
        p.version,
        "Sources checked " +
          shortDate(p.verified) +
          " · " +
          p.rules.length +
          " review topics",
      ) +
        msg(
          "The installed research works offline. Source links open online. Jurisdiction findings, precise notice language and legal review are specific to the tenancy.",
        ) +
        detail(
          "Sources and applicability",
          p.rules
            .map(
              (r) =>
                '<section class="ls-source"><b>' +
                esc(r.title) +
                "</b><p>" +
                esc(r.text) +
                "</p>" +
                sourceLink(r) +
                "<p>" +
                esc(r.jurisdiction + " · " + r.reviewStatus) +
                "</p><small>" +
                esc(
                  (r.effective ? "Effective " + r.effective + " · " : "") +
                    (r.sunset ? "Sunset " + r.sunset + " · " : "") +
                    "Reviewed " +
                    r.verified,
                ) +
                "</small></section>",
            )
            .join(""),
        ) +
        detail(
          "Install reviewed update",
          msg(
            "Export the current JSON as a starting point. Review changed sources and rule effects before installing. Existing agreements retain their original rule package.",
          ) +
            btn("exportRules", "Export current rules JSON") +
            field(
              "Choose a reviewed rules JSON file",
              "updateRules",
              "",
              "file",
              'accept=".json,application/json"',
            ),
        ),
    );
  }
  function changedPkg(old, p) {
    const before = new Map(old.rules.map((r) => [r.id, r])),
      after = new Set(p.rules.map((r) => r.id));
    return [
      ...p.rules
        .filter((r) => JSON.stringify(before.get(r.id)) !== JSON.stringify(r))
        .map((r) => (before.has(r.id) ? "Updated · " : "Added · ") + r.title),
      ...old.rules
        .filter((r) => !after.has(r.id))
        .map((r) => "Removed · " + r.title),
    ];
  }
  async function reviewUpdate(file) {
    if (!file || file.size > 512 * 1024)
      throw Error("Choose a JSON package under 512 KB.");
    let pkg;
    try {
      pkg = R.validate(JSON.parse(await file.text()));
    } catch (e) {
      throw Error("Rule package rejected. " + e.message);
    }
    const old = currentPackage();
    if (
      pkg.verified > date() ||
      pkg.verified < old.verified ||
      pkg.version === old.version ||
      all("legalPackage").some((p) => p.package.version === pkg.version)
    )
      throw Error(
        "Use a distinct version with a verified date on or after the installed research date and no later than today.",
      );
    const changes = changedPkg(old, pkg);
    if (!changes.length) throw Error("The package has no rule changes.");
    rulePreview = pkg;
    const draftPreview = all("lease")
      .map((d) => {
        const before = new Map(outcomes(d).map((x) => [x.id, x.status]));
        const changed = pkg.rules
          .map((r) => R.evaluate(r, d.facts))
          .filter((x) => before.get(x.id) !== x.status);
        return (
          "<b>" +
          esc(d.name) +
          "</b>" +
          msg(
            changed.map((x) => x.title + " — " + x.status).join(" · ") ||
              "No outcome changes for the currently entered facts.",
          )
        );
      })
      .join("");
    dialog(
      "Review package changes",
      heading(pkg.version, pkg.summary) +
        "<ul>" +
        changes.map((c) => "<li>" + esc(c) + "</li>").join("") +
        "</ul>" +
        detail(
          "Changed source material",
          pkg.rules
            .filter(
              (r) =>
                !old.rules.some((x) => JSON.stringify(x) === JSON.stringify(r)),
            )
            .map(
              (r) =>
                '<section class="ls-source"><b>' +
                esc(r.title) +
                "</b><p>" +
                esc(r.text) +
                "</p>" +
                sourceLink(r) +
                "<p>" +
                esc(r.reviewStatus) +
                "</p></section>",
            )
            .join(""),
          true,
        ) +
        detail(
          "Applicability preview",
          draftPreview || msg("No drafts for this property."),
        ) +
        '<form id="ls-update">' +
        field(
          "Reviewing person or organization",
          "reviewer",
          "",
          "text",
          "required",
        ) +
        area("Source and change review reference", "basis", "", "required") +
        '<button class="ls-btn ls-primary">Install for new drafts</button></form>',
    );
  }
  const depositFields = [
    "tenancyId",
    "possession",
    "vacated",
    "inspection",
    "inspectionDate",
    "rightsNotice",
    "method",
    "consent",
    "statementMethod",
    "delivered",
    "deliveryProof",
    "deductionType",
    "deductionBasis",
    "deductionAmount",
    "electronic",
    "adults",
    "funds",
    "tenantReply",
    "photoNotes",
    "estimate",
    "finalDocs",
    "followup",
    "ledgerRef",
  ];
  function plusDays(when, days) {
    if (!R.isDate(when)) return "";
    const t = new Date(when + "T12:00:00Z");
    t.setUTCDate(t.getUTCDate() + days);
    return t.toISOString().slice(0, 10);
  }
  function cents(v) {
    const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(v || "");
    return m ? Number(m[1]) * 100 + Number((m[2] || "").padEnd(2, "0")) : null;
  }
  function collectDeposit() {
    const form = $("#ls-deposit");
    if (!form || !depositState) return;
    const d = new FormData(form);
    depositFields.forEach((k) => {
      if (d.has(k)) depositState[k] = String(d.get(k)).trim();
    });
    depositState.evidence = d.getAll("evidence");
    depositState.deadline = plusDays(depositState.vacated, 21);
  }
  function showReturn(key) {
    depositState = key
      ? clone(read(key))
      : {
          id: id(),
          type: "depositReturn",
          propertyId: current().id,
          tenancyId: all("tenancy")[0]?.id || "",
          items: [],
          evidence: [],
        };
    drawReturn();
  }
  function itemReady(x) {
    return (
      x.classification === "Documented deductible item" &&
      x.amountCents > 0 &&
      x.basis &&
      x.evidence?.length
    );
  }
  function drawReturn() {
    const s = depositState,
      items = s.items || [],
      total = items.filter(itemReady).reduce((a, x) => a + x.amountCents, 0),
      held = cents(s.funds);
    dialog(
      "Deposit return worksheet",
      msg(
        "Record actual dates for this household. The statewide target is 21 calendar days after the tenant vacates. Keep disputed possession or local requirements under review.",
      ) +
        '<form id="ls-deposit">' +
        group(
          choice("Tenancy", "tenancyId", s.tenancyId, tenantOptions()),
          field(
            "Actual possession returned",
            "possession",
            s.possession,
            "date",
          ),
          field("Actual tenant vacancy date", "vacated", s.vacated, "date"),
          field(
            "Written inspection-rights notice date",
            "rightsNotice",
            s.rightsNotice,
            "date",
          ),
          choice("Preliminary inspection", "inspection", s.inspection, [
            "Requested",
            "Declined",
            "Completed",
            "Exception under review",
          ]),
          field("Inspection date", "inspectionDate", s.inspectionDate, "date"),
        ) +
        '<p class="ls-call" id="ls-deadline">' +
        esc(
          s.deadline
            ? "Statewide return target · " + shortDate(s.deadline)
            : "Enter the actual vacancy date to calculate the statewide target.",
        ) +
        "</p>" +
        detail(
          "Inspection, evidence and notices",
          msg(
            "When applicable, offer the initial inspection in writing and the right to attend. Schedule a requested inspection within the last two weeks, and give 48 hours’ written notice unless waived in writing. Retain the findings and opportunity to remedy.",
          ) +
            area(
              "Condition at move-in, before work and after work",
              "photoNotes",
              s.photoNotes,
            ) +
            area(
              "Estimate, remaining repairs and follow-up itemization",
              "estimate",
              s.estimate,
            ) +
            field(
              "Date final invoices or work completion received",
              "finalDocs",
              s.finalDocs,
              "date",
            ) +
            field(
              "Follow-up statement delivered",
              "followup",
              s.followup,
              "date",
            ) +
            area("Tenant response or dispute", "tenantReply", s.tenantReply),
        ) +
        heading("Itemized amounts") +
        field(
          "Reconciled deposit held before return ($)",
          "funds",
          s.funds,
          "text",
          'inputmode="decimal"',
        ) +
        field(
          "Linked ledger entry / opening balance reference",
          "ledgerRef",
          s.ledgerRef,
        ) +
        items
          .map(
            (x, i) =>
              '<div class="ls-item"><b>' +
              esc(x.basis) +
              "</b><small>" +
              esc(x.classification) +
              " · " +
              esc(pm().currency(x.amountCents || 0)) +
              "</small>" +
              btn("removeDeduction", "Remove from worksheet", false, i) +
              "</div>",
          )
          .join("") +
        msg(
          "Documented deductions " +
            pm().currency(total) +
            (held !== null
              ? " · Remaining " + pm().currency(held - total)
              : ""),
        ) +
        detail(
          "Add an item",
          group(
            choice("Classification", "deductionType", s.deductionType, [
              "Documented deductible item",
              "Ordinary wear",
              "Missing evidence",
              "Disputed",
            ]),
            field(
              "Proposed amount ($)",
              "deductionAmount",
              s.deductionAmount,
              "text",
              'inputmode="decimal"',
            ),
          ) +
            area(
              "Description, invoice and legal basis",
              "deductionBasis",
              s.deductionBasis,
            ) +
            checkList("evidence", docOptions(), s.evidence || []) +
            btn("addDeduction", "Add to itemization"),
        ) +
        detail(
          "Return method and delivery",
          group(
            choice("Prior electronic receipt", "electronic", s.electronic, [
              "Yes",
              "No",
            ]),
            field(
              "Adult tenants at termination",
              "adults",
              s.adults,
              "number",
              'min="1" max="100"',
            ),
            choice("Refund method", "method", s.method, [
              "First-class mail check",
              "Personal delivery",
              "Electronic transfer",
              "Written alternative",
            ]),
            choice("Itemization method", "statementMethod", s.statementMethod, [
              "First-class mail",
              "Personal delivery",
              "Mutually agreed email",
              "Other agreed method",
            ]),
            field("Actual delivery date", "delivered", s.delivered, "date"),
          ) +
            area(
              "Written method agreements, all-adult directions and notices",
              "consent",
              s.consent,
            ) +
            area(
              "Delivery record, recipient and proof",
              "deliveryProof",
              s.deliveryProof,
            ) +
            msg(
              "Check AB 414 separately for electronic receipts, multiple adult payees and written agreements. Do not enter bank account numbers.",
            ),
        ) +
        '<div class="ls-footer">' +
        btn("returnPDF", "Export worksheet PDF") +
        '<button class="ls-btn ls-primary">Save return record</button></div></form>',
    );
  }
  function addDeduction() {
    collectDeposit();
    const s = depositState,
      m = cents(s.deductionAmount);
    if (m === null || !s.deductionType || !s.deductionBasis)
      throw Error("Enter a classification, description and amount.");
    if (
      s.deductionType === "Documented deductible item" &&
      (!s.evidence?.length || !m)
    )
      throw Error(
        "Link evidence and a positive amount for a documented deduction.",
      );
    s.items.push({
      id: id(),
      classification: s.deductionType,
      basis: s.deductionBasis,
      amountCents: m,
      evidence: [...s.evidence],
    });
    s.evidence = [];
    s.deductionBasis = "";
    s.deductionType = "";
    s.deductionAmount = "";
    drawReturn();
  }
  function validateReturn() {
    collectDeposit();
    const s = depositState;
    if (!s.tenancyId) throw Error("Select a tenancy.");
    if (s.funds && cents(s.funds) === null)
      throw Error("Enter the deposit balance in dollars and cents.");
    const t = s.items.filter(itemReady).reduce((a, x) => a + x.amountCents, 0),
      held = cents(s.funds);
    if (held !== null && t > held)
      throw Error("Documented deductions exceed the deposit balance.");
    if (
      s.delivered &&
      (!s.deliveryProof || !s.method || !s.statementMethod || held === null)
    )
      throw Error(
        "Add delivery evidence, method, itemization method and held amount.",
      );
    if (s.delivered > date() || s.vacated > date() || s.possession > date())
      throw Error("An actual date cannot be in the future.");
    if (s.deductionBasis || s.deductionAmount)
      throw Error(
        "Add the pending deduction to the itemization or clear its fields.",
      );
  }
  function returnPDF() {
    validateReturn();
    const s = depositState,
      t = s.items.filter(itemReady).reduce((a, x) => a + x.amountCents, 0),
      h = cents(s.funds);
    const sections = [
      {
        heading: "Return record",
        lines: [
          "Household: " + (read(s.tenancyId)?.name || "Unknown"),
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
          ...s.items.map(
            (x) =>
              x.basis +
              " / " +
              x.classification +
              " / " +
              pm().currency(x.amountCents) +
              " / " +
              x.evidence.map((i) => read(i)?.name || i).join(", "),
          ),
          "Beginning deposit: " +
            (h === null ? "Unconfirmed" : pm().currency(h)),
          "Documented deductions: " + pm().currency(t),
          "Balance: " + (h === null ? "Unconfirmed" : pm().currency(h - t)),
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
          s.finalDocs
            ? "Final invoice or completion: " +
              s.finalDocs +
              " / 14-day follow-up target: " +
              plusDays(s.finalDocs, 14)
            : "",
        ],
      },
    ];
    pm().download(
      pm().pdf("Deposit return worksheet", sections),
      "deposit-return-worksheet.pdf",
    );
  }
  function open(action, key) {
    switch (action) {
      case "create":
        return openDraft(null);
      case "lease":
        return openDraft(key);
      case "newFor":
        return openDraft(null, null, key);
      case "rules":
        return ruleRegister();
      case "depositReturn":
        return showReturn(key);
      case "packet":
        return viewPacket(key);
      case "household":
        return household(key);
      case "amend":
        return amend(key);
      case "backWizard":
        return drawWizard();
      case "preview":
        return preview();
      case "print":
        return window.print();
      case "document":
        return pm().openDoc(key);
      case "downloadPacket":
        return downloadDoc(read(key).archiveId);
      case "downloadDocument":
        return downloadDoc(key);
      case "compose":
        return globalThis.Work.open("compose", key);
      case "step":
        return saveDraft(true, Math.min(5, Math.max(0, Number(key) || 0)));
      case "save":
        return saveDraft(false);
      case "clauseAdd":
      case "clauseUp":
      case "clauseDown":
      case "clauseRemove":
        return editClause(action, key);
      case "updateDraftRules":
        session.package = clone(currentPackage());
        session.resolutions = {};
        session.reviewedInputs = false;
        return saveDraft(true, 3);
      case "generate":
        return generate("draft", null);
      case "finalize":
        return finalCheck();
      case "recordSign": {
        const [packet, person] = key.split("|");
        return signatureForm(packet, person);
      }
      case "signedReturn":
        return signatureForm(key);
      case "markOperative":
        return operative(key);
      case "exportRules":
        return pm().download(
          new Blob([JSON.stringify(currentPackage(), null, 2)], {
            type: "application/json",
          }),
          safeName(currentPackage().version) + ".json",
        );
      case "addDeduction":
        return addDeduction();
      case "removeDeduction":
        collectDeposit();
        depositState.items.splice(Number(key), 1);
        return drawReturn();
      case "returnPDF":
        return returnPDF();
    }
  }
  let busy = false;
  async function handleButton(b, fn) {
    if (busy) return;
    busy = true;
    if (b) b.disabled = true;
    operationScope = { dataset: pm().dataset(), propertyId: current()?.id };
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      operationScope = null;
      busy = false;
      if (b) b.disabled = false;
    }
  }
  if (typeof document !== "undefined") {
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-lease]");
      if (b) {
        e.preventDefault();
        handleButton(b, () => open(b.dataset.lease, b.dataset.ref));
      }
    });
    document.addEventListener("input", (e) => {
      if (e.target.closest("#ls-wizard")) {
        capture();
        if (session.step !== 4) session.reviewedInputs = false;
        const live = $("#ls-live");
        if (live && live.parentElement.open)
          live.innerHTML = htmlPreview(session);
      }
      if (e.target.closest("#ls-deposit") && e.target.name === "vacated") {
        collectDeposit();
        $("#ls-deadline").textContent = depositState.deadline
          ? "Statewide return target · " + shortDate(depositState.deadline)
          : "Enter the actual vacancy date.";
      }
    });
    document.addEventListener(
      "toggle",
      (e) => {
        const live = e.target.querySelector?.(":scope > #ls-live");
        if (live && e.target.open) live.innerHTML = htmlPreview(session);
      },
      true,
    );
    document.addEventListener("change", (e) => {
      if (e.target.name === "updateRules" && e.target.files[0])
        handleButton(null, () => reviewUpdate(e.target.files[0]));
    });
    document.addEventListener("submit", (e) => {
      const f = e.target;
      if (
        ![
          "ls-update",
          "ls-final",
          "ls-sign",
          "ls-operative",
          "ls-deposit",
          "ls-wizard",
        ].includes(f.id)
      )
        return;
      e.preventDefault();
      handleButton(e.submitter, async () => {
        const d = new FormData(f);
        if (f.id === "ls-wizard")
          return saveDraft(true, Math.min(5, session.step + 1));
        if (f.id === "ls-update") {
          if (
            !rulePreview ||
            !d.get("reviewer").trim() ||
            !d.get("basis").trim()
          )
            throw Error("Document the source reviewer and evidence.");
          await pm().save("legalPackage", {
            propertyId: current().id,
            package: rulePreview,
            installed: new Date().toISOString(),
            reviewer: d.get("reviewer"),
            basis: d.get("basis"),
            immutable: true,
          });
          pm().refresh();
          ruleRegister();
          pm().toast("Rule package installed for new drafts.");
        } else if (f.id === "ls-final") {
          if (!d.has("confirmed"))
            throw Error(
              "Review the agreement and confirm the exact documents.",
            );
          const resolutions = Object.fromEntries(outcomes(session)
            .filter((x) => x.status === R.review || x.status === R.required)
            .map((x) => [x.id, String(d.get(x.id) ?? "").trim()]));
          const clauseReferences = Object.fromEntries((session.customClauses || [])
            .map((c) => [c.id, String(d.get("clause." + c.id) ?? "").trim()]));
          if ([...Object.values(resolutions), ...Object.values(clauseReferences)].some(blank))
            throw Error("Document each required clause or review disposition.");
          await generate("reviewed", resolutions, clauseReferences);
        } else if (f.id === "ls-sign") {
          await saveSign(f);
        } else if (f.id === "ls-operative") {
          const s = read(f.dataset.ref);
          if (
            !d.get("signedDoc") ||
            !d.get("basis").trim() ||
            sigState(s) !== "Fully signed"
          )
            throw Error(
              "Select the complete signed document and record the confirmation basis.",
            );
          const original = read(d.get("signedDoc")),
            b = await pm().file(original.hash);
          if (!(b instanceof Blob))
            throw Error("The signed original is unavailable.");
          const doc = await storedDoc(b, original.name, "Executed lease", s, {
            packetId: s.id,
            sourceId: original.id,
          });
          const event = {
            type: "execution",
            id: id(),
            immutable: true,
            propertyId: s.propertyId,
            tenancyId: s.tenancyId,
            packetId: s.id,
            signedDoc: doc.id,
            effective: d.get("effective"),
            basis: d.get("basis"),
            confirmed: new Date().toISOString(),
          };
          const previous = all("operativeLease").find(
            (o) => o.tenancyId === s.tenancyId,
          );
          const op = {
            ...(previous || {}),
            id: previous?.id || "operative-" + s.tenancyId,
            type: "operativeLease",
            propertyId: s.propertyId,
            tenancyId: s.tenancyId,
            packetId: s.id,
            signedDoc: doc.id,
            effective: event.effective,
            executionId: event.id,
          };
          if (s.facts.kind === "Amendment" && previous) {
            op.signedDoc = previous.signedDoc;
            op.packetId = previous.packetId;
            op.amendments = [
              ...new Set([...(previous.amendments || []), s.id]),
            ];
          }
          await scoped().batch([doc, event, op]);
          scoped().refresh();
          household(s.tenancyId);
        } else {
          validateReturn();
          const s = depositState,
            changed = [s],
            taskId = "deposit-return-" + s.id,
            old = read(taskId);
          if (s.deadline || old)
            changed.push({
              ...old,
              id: taskId,
              type: "task",
              propertyId: s.propertyId,
              tenancyId: s.tenancyId,
              title: "Review deposit return",
              kind: "Reminder",
              due: s.deadline || "",
              completed: Boolean(s.delivered),
              depositReturnId: s.id,
            });
          await pm().batch(changed);
          pm().close();
          pm().refresh();
          pm().toast(
            "Deposit return worksheet saved. Record any cash movement in Money.",
          );
        }
      });
    });
  }
  function validateImport(records, hashes) {
    const index = new Map(records.map((r) => [r.id, r]));
    const verifiedPackages = new Set(),
      signedPackets = new Map(),
      checkedSigners = new Set();
    const check = (ok, why) => {
      if (!ok) throw Error("Invalid lease records. " + why);
    };
    function ref(id, type, owner) {
      const found = index.get(id);
      check(
        found &&
          found.type === type &&
          !found._deleted &&
          (!owner || found.propertyId === owner.propertyId),
        "A " +
          type +
          " reference is missing or belongs to a different property.",
      );
      return found;
    }
    function documentRef(id, owner, hash) {
      const d = ref(id, "document", owner);
      check(
        /^[a-f0-9]{64}$/.test(d.hash) &&
          (!hashes || hashes.has(d.hash)) &&
          (!hash || d.hash === hash),
        "A retained document has a missing or inconsistent hash.",
      );
      return d;
    }
    function checkPackage(pkg) {
      const serial = JSON.stringify(pkg);
      if (!verifiedPackages.has(serial)) {
        R.validate(pkg, { historical: true });
        verifiedPackages.add(serial);
      }
    }
    function facts(record) {
      check(
        record.facts &&
          typeof record.facts === "object" &&
          !Array.isArray(record.facts) &&
          Object.values(record.facts).every(
            (x) => typeof x === "string" || x === null,
          ),
        "The agreement facts must be text values.",
      );
      if (Object.hasOwn(record, "customClauses")) {
        const clauses = record.customClauses;
        check(
          Array.isArray(clauses) &&
          clauses.every((c) => c && typeof c.id === "string" &&
            /^[a-f0-9-]{16,64}$/i.test(c.id) &&
            typeof c.title === "string" && typeof c.text === "string") &&
          new Set(clauses.map((c) => c.id)).size === clauses.length,
          "An additional clause has invalid wording or a duplicate identifier.",
        );
        if (record.type === "leasePacket" && record.mode === "reviewed")
          check(clauses.every((c) => !blank(c.text) &&
            typeof record.clauseReferences?.[c.id] === "string" && !blank(record.clauseReferences[c.id])),
            "A reviewed additional clause lacks its contract or exhibit reference.");
      }
    }
    for (const r of records) {
      if (
        ![
          "lease",
          "leasePacket",
          "legalPackage",
          "signature",
          "execution",
          "operativeLease",
          "depositReturn",
        ].includes(r.type) ||
        r._deleted
      )
        continue;
      ref(r.propertyId, "property");
      if (r.tenancyId) ref(r.tenancyId, "tenancy", r);
      if (r.type === "legalPackage") {
        checkPackage(r.package);
        check(
          r.immutable && r.installed && r.reviewer && r.basis,
          "An installed rule package lacks its review record.",
        );
      }
      if (r.type === "lease") {
        facts(r);
        checkPackage(r.package);
        check(
          Number.isInteger(r.step) &&
            r.step >= 0 &&
            r.step <= 5 &&
            Array.isArray(r.attachments),
          "The resumable draft is malformed.",
        );
        r.attachments.forEach((i) => documentRef(i, r));
        if (r.facts.attorneyDoc) documentRef(r.facts.attorneyDoc, r);
        if (r.parentPacket) ref(r.parentPacket, "leasePacket", r);
      }
      if (r.type === "leasePacket") {
        check(
          r.immutable === true &&
            ["draft", "reviewed"].includes(r.mode) &&
            R.isDate(String(r.generated).slice(0, 10)),
          "The packet has invalid generation metadata.",
        );
        facts(r);
        checkPackage(r.package);
        check(
          r.packageVersion === r.package.version &&
            Array.isArray(r.attachments) &&
            Array.isArray(r.review) &&
            Array.isArray(r.signers),
          "The packet and pinned rule version disagree.",
        );
        check(
          r.review.every(
            (o) =>
              r.package.rules.some((a) => a.id === o?.id) &&
              [R.required, R.na, R.unknown, R.review].includes(o.status),
          ),
          "The stored applicability result is invalid.",
        );
        ref(r.leaseId, "lease", r);
        if (r.parentPacket) ref(r.parentPacket, "leasePacket", r);
        const archive = documentRef(r.archiveId, r, r.archiveHash),
          worksheet = documentRef(r.worksheetId, r);
        check(
          archive.immutable &&
            worksheet.immutable &&
            ["application/pdf", "text/html"].includes(worksheet.mime) &&
            archive.packetId === r.id &&
            worksheet.packetId === r.id,
          "The packet does not match its frozen originals.",
        );
        r.attachments.forEach((a) => {
          check(
            a &&
              typeof a.path === "string" &&
              !/[\\:\u0000-\u001f]/.test(a.path) &&
              !a.path.startsWith("/") &&
              a.path.split("/").every((x) => x && x !== "." && x !== ".."),
            "A packet entry has an unsafe or empty path.",
          );
          documentRef(a.id, r, a.hash);
          if (a.sourceId) documentRef(a.sourceId, r);
        });
        const expected = signers(r.facts);
        check(
          r.signers.length === expected.length &&
            r.signers.every(
              (a, i) =>
                a &&
                a.id === expected[i].id &&
                a.name === expected[i].name &&
                a.role === expected[i].role,
            ),
          "The required signer identities disagree with the retained agreement.",
        );
        if (r.mode === "reviewed") {
          const contract = documentRef(r.contractId, r);
          check(
            contract.mime === "application/pdf" &&
              r.attachments.some(
                (a) => a.id === contract.id && a.hash === contract.hash,
              ) &&
              r.signers.length >= 2 &&
              r.tenancyId,
            "A reviewed packet is missing its contract, tenancy or signers.",
          );
        }
      }
      if (r.type === "signature") {
        const p = ref(r.packetId, "leasePacket", r),
          s = String(p.id) + "|" + r.signerId;
        check(
          !checkedSigners.has(s) &&
            p.mode === "reviewed" &&
            r.immutable &&
            r.tenancyId === p.tenancyId &&
            r.packetHash === p.archiveHash &&
            p.signers.some((a) => a.id === r.signerId) &&
            R.isDate(r.signedDate) &&
            r.method &&
            r.basis,
          "A signature does not identify a unique signer on this packet.",
        );
        checkedSigners.add(s);
        check(
          documentRef(r.documentId, r).packetId === p.id,
          "A signature scan belongs to a different packet.",
        );
        if (r.certificateId)
          check(
            documentRef(r.certificateId, r).packetId === p.id,
            "A signature certificate belongs to a different packet.",
          );
        if (!signedPackets.has(p.id)) signedPackets.set(p.id, []);
        signedPackets.get(p.id).push(r);
      }
      if (r.type === "depositReturn") {
        check(
          Array.isArray(r.items) &&
            r.items.every(
              (x) =>
                x &&
                Number.isSafeInteger(x.amountCents) &&
                x.amountCents >= 0 &&
                Array.isArray(x.evidence),
            ),
          "Invalid deposit itemization.",
        );
        r.items.forEach((x) => x.evidence.forEach((i) => documentRef(i, r)));
        if (r.deadline)
          check(
            r.deadline === plusDays(r.vacated, 21),
            "The vacancy date and deposit deadline differ.",
          );
      }
    }
    for (const r of records.filter(
      (x) => ["execution", "operativeLease"].includes(x.type) && !x._deleted,
    )) {
      const s = ref(r.packetId, "leasePacket", r);
      check(
        r.tenancyId === s.tenancyId &&
          sigState(s, signedPackets.get(s.id) || []) === "Fully signed",
        "An executed designation is missing complete signature evidence.",
      );
      check(
        documentRef(r.signedDoc, r).kind === "Executed lease",
        "An executed copy is missing.",
      );
      if (r.type === "execution")
        check(
          r.immutable && r.basis && R.isDate(r.effective),
          "The execution confirmation is incomplete.",
        );
      else {
        const e = ref(r.executionId, "execution", r);
        check(
          e.tenancyId === s.tenancyId,
          "The operative designation and evidence name different tenancies.",
        );
        for (const k of r.amendments || [])
          check(
            ref(k, "leasePacket", r).tenancyId === s.tenancyId,
            "An amendment refers to a different tenancy.",
          );
      }
    }
  }
  globalThis.Leases = {
    open,
    render,
    seed,
    validateImport,
    domain: {
      sigState,
      signers,
      plusDays,
      cents,
      itemReady,
      issues,
      changedPkg,
      sections,
    },
  };
})();
