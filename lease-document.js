/* Builds the lease itself: one block model that export.js turns into the on-screen preview,
   the printable page and the PDF. Wording is plain English and stays inside California law;
   prescribed notices come verbatim from lease-law.js. */
(() => {
  "use strict";
  const law = () => globalThis.LeaseLaw;
  const lib = () => globalThis.LeaseClauses;
  const filled = (v) => String(v ?? "").trim() !== "";
  const clean = (v) => String(v ?? "").trim().replace(/\s+/g, " ");
  const sentence = (v) => {
    const text = String(v ?? "").trim();
    return text && !/[.!?]$/.test(text) ? text + "." : text;
  };
  const p = (text, extra) => ({ t: "p", text, ...extra });
  const titled = (title, text) => ({ t: "p", runs: [{ text: title + ". ", bold: true }, { text }] });
  /* "a, b and c"; switches to semicolons when an item already contains a comma, "and" or "or". */
  const series = (items, joiner = "and") => {
    if (items.length < 2) return items.join("");
    const plain = !items.some((x) => /,| and | or /.test(x));
    if (plain && items.length === 2) return items.join(" " + joiner + " ");
    return items.slice(0, -1).join(plain ? ", " : "; ") + (plain ? " " : "; ") + joiner + " " + items.at(-1);
  };
  const ordinal = (n) => {
    const v = Number(n),
      tens = v % 100;
    return v + (tens >= 11 && tens <= 13 ? "th" : ["th", "st", "nd", "rd"][v % 10] || "th");
  };
  const csv = (v) => String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const addDays = (iso, n) => {
    const d = new Date(iso + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const utilityNames = [
    ["util_electric", "electricity"],
    ["util_gas", "gas"],
    ["util_water", "water"],
    ["util_sewer", "sewer"],
    ["util_trash", "trash service"],
    ["util_internet", "internet"],
    ["util_yard", "yard care"],
    ["util_pool", "pool service"],
  ];
  const applianceNames = { stove: "stove", refrigerator: "refrigerator", dishwasher: "dishwasher", microwave: "microwave", washer: "clothes washer", dryer: "clothes dryer", ac: "air conditioner", disposal: "garbage disposal" };
  const methodNames = { check: "personal check", moneyorder: "cashier’s check or money order", zelle: "electronic transfer such as Zelle", online: "online payment", cash: "cash (Landlord will give a receipt)" };

  const tenants = (lease) => (lease.tenants || []).map((t) => ({ ...t, name: clean(t.name) })).filter((t) => t.name);
  const isAmendment = (lease) => lease?.facts?.kind === "Amendment";
  const monthly = (lease) => lease?.facts?.kind === "Month to month";
  function title(lease) {
    const kind = lease?.facts?.kind;
    return kind === "Amendment" ? "Lease Amendment" : kind === "Renewal" ? "Lease Renewal Agreement" : kind === "Month to month" ? "Month-to-Month Rental Agreement" : "Residential Lease Agreement";
  }
  function address(f) {
    const street = [clean(f.premises), filled(f.unit) ? "Unit " + clean(f.unit).replace(/^(unit|apt\.?|#)\s*/i, "") : ""].filter(Boolean).join(", ");
    const place = [clean(f.city) || "San Diego", "California" + (filled(f.zip) ? " " + clean(f.zip) : "")].join(", ");
    return street ? street + ", " + place : "";
  }
  /* The landlord (or the agent who signs for the landlord) first, then each tenant in order, then any co-signer. */
  function signers(lease) {
    const f = lease?.facts || {};
    const first = f.signer === "manager" && filled(f.manager) ? { name: clean(f.manager), role: "Landlord’s agent" } : { name: clean(f.landlord), role: "Landlord" };
    const guarantor = lib().state(lease).guarantor;
    const extra = guarantor?.on && filled(guarantor.opts.name) ? [{ name: clean(guarantor.opts.name), role: "Guarantor" }] : [];
    return [first, ...tenants(lease).map((t) => ({ name: t.name, role: "Tenant" })), ...extra].filter((s) => s.name).map((s, i) => ({ id: "signer-" + i, ...s }));
  }
  /* The first payment when the tenancy starts mid-period: daily rent on a 30-day month. */
  function firstPayment(f) {
    const L = law(),
      rent = L.amount(f.rent),
      day = Number(f.dueDay || 1);
    if (!rent || !L.isDate(f.termStart) || !(day >= 1 && day <= 28)) return null;
    const start = f.termStart;
    if (Number(start.slice(8)) === day) return { prorated: false, amount: rent, from: start, through: addDays(L.addMonths(start, 1), -1) };
    let due = start.slice(0, 8) + String(day).padStart(2, "0");
    if (due <= start) due = L.addMonths(due, 1);
    const days = Math.round((Date.parse(due + "T12:00:00Z") - Date.parse(start + "T12:00:00Z")) / 86400000);
    return { prorated: true, amount: Math.min(rent, Math.round((rent / 30) * days * 100) / 100), from: start, through: addDays(due, -1), nextDue: due };
  }

  /* Everything that must be filled in before the lease can be finalized. */
  function missing(lease, today) {
    const L = law(),
      S = L.steps,
      f = lease?.facts || {},
      out = [];
    const need = (step, field, label) => out.push({ step, field, label });
    if (!filled(f.premises)) need(S.home, "premises", "Enter the street address of the home.");
    if (!filled(f.landlord)) need(S.people, "landlord", "Enter the landlord’s name.");
    const people = tenants(lease);
    if (!people.length) need(S.people, "tenants", "Add at least one tenant.");
    const names = signers(lease).map((s) => s.name.toLocaleLowerCase());
    if (new Set(names).size !== names.length) need(S.people, "tenants", "Two signers have the same name. Add a middle initial so each one is distinct.");
    if (!L.isDate(f.agreementDate)) need(S.terms, "agreementDate", "Enter the date of the agreement.");
    if (isAmendment(lease)) {
      if (!filled(f.changeText) && !(lease.customClauses || []).some((c) => filled(c.text))) need(S.terms, "changeText", "Describe what the amendment changes.");
      if (!L.isDate(f.termStart)) need(S.terms, "termStart", "Enter the date the change takes effect.");
    } else {
      if (!L.isDate(f.termStart)) need(S.terms, "termStart", "Enter the date the lease starts.");
      if (!monthly(lease)) {
        if (!L.isDate(f.end)) need(S.terms, "end", "Enter the date the lease ends.");
        else if (L.isDate(f.termStart) && f.end <= f.termStart) need(S.terms, "end", "The end date must be after the start date.");
      }
      if (f.kind === "Renewal" && !L.isDate(f.start)) need(S.terms, "start", "Enter the date the tenant first moved in.");
      if (!(L.amount(f.rent) > 0)) need(S.terms, "rent", "Enter the monthly rent.");
      if (!/^(?:[1-9]|1\d|2[0-8])$/.test(String(f.dueDay ?? ""))) need(S.terms, "dueDay", "Choose the day of the month rent is due (1 to 28).");
      if (L.amount(f.deposit) === null) need(S.terms, "deposit", "Enter the security deposit, or 0 for none.");
      if (f.lateFee === "yes") {
        if (!(L.amount(f.lateFeeAmount) > 0)) need(S.terms, "lateFeeAmount", "Enter the late charge, or turn it off.");
        if (!/^(?:[2-9]|1\d|2[0-8])$/.test(String(f.lateFeeDay ?? ""))) need(S.terms, "lateFeeDay", "Choose the day of the month after which rent is late.");
      }
      const state = lib().state(lease);
      for (const clause of lib().library) {
        const mine = state[clause.id];
        if (!mine?.on) continue;
        for (const o of lib().fields(clause, lease, mine.opts)) {
          const value = String(mine.opts[o.key] ?? "").trim(),
            field = "clause." + clause.id + "." + o.key,
            what = clause.title + ": " + o.label.replace(/ \(optional\)$/, "").toLowerCase();
          if (o.type === "text" && o.when && !value) need(S.rules, field, what + ".");
          else if (o.type === "money" && (o.optional ? value && L.amount(value) === null : !(L.amount(value) > 0))) need(S.rules, field, what + (o.optional ? " must be an amount, or blank." : " needs an amount."));
          else if (o.type === "number" && (!/^\d{1,4}$/.test(value) || (o.min != null && Number(value) < o.min) || (o.max != null && Number(value) > o.max)))
            need(S.rules, field, what + " must be a number" + (o.min != null && o.max != null ? " from " + o.min + " to " + o.max : "") + ".");
        }
      }
    }
    (lease.customClauses || []).forEach((c, i) => {
      if (!filled(c.text)) need(S.rules, "custom." + c.id, "Write the wording for your clause " + (i + 1) + ", or remove it.");
    });
    for (const b of L.analyze(lease, today).blockers) if (!out.some((x) => x.field === b.field)) need(b.step, b.field, b.message);
    return out.sort((a, b) => a.step - b.step);
  }

  function termText(lease) {
    const L = law(),
      f = lease.facts;
    const start = L.longDate(f.termStart) || "[start date]";
    return monthly(lease) ? "Month to month, starting " + start : start + " through " + (L.longDate(f.end) || "[end date]");
  }
  function summary(lease) {
    const L = law(),
      f = lease?.facts || {},
      state = lib().state(lease);
    const tenantPays = utilityNames.filter(([k]) => f[k] === "tenant").map(([, n]) => n);
    const rows = [
      ["Landlord", clean(f.landlord) || "[landlord]"],
      ["Tenant", series(tenants(lease).map((t) => t.name)) || "[tenants]"],
      ["Home", address(f) || "[address]"],
    ];
    if (isAmendment(lease)) return [...rows, ["Takes effect", L.longDate(f.termStart) || "[date]"]];
    rows.push(
      ["Term", termText(lease)],
      ["Rent", (L.money(f.rent) || "[rent]") + " a month, due on the " + (filled(f.dueDay) ? ordinal(f.dueDay) : "[day]")],
      ["Security deposit", L.amount(f.deposit) === 0 ? "None" : L.money(f.deposit) || "[deposit]"],
      ["Tenant pays for", tenantPays.length ? series(tenantPays) : "No utilities"],
    );
    const pets = state.pets?.opts.policy,
      smoking = state.smoking?.opts.policy;
    rows.push(["Pets", pets === "none" ? "Not allowed" : pets === "approved" ? "Only those listed in the lease" : "Allowed"]);
    rows.push(["Smoking", smoking === "none" ? "Not allowed anywhere on the property" : smoking === "outside" ? "Outdoors in one area only" : "Allowed"]);
    return rows;
  }

  function amendment(lease, options) {
    const L = law(),
      f = lease.facts;
    const who = signers(lease);
    const blocks = [
      { t: "title", text: "Lease Amendment", sub: address(f) },
      p((clean(f.landlord) || "[landlord]") + " (“Landlord”) and " + (series(tenants(lease).map((t) => t.name)) || "[tenants]") + " (“Tenant”) agree to change their lease for the home at " + (address(f) || "[address]") + " as written below. This amendment is dated " + (L.longDate(f.agreementDate) || "[date]") + " and takes effect on " + (L.longDate(f.termStart) || "[date]") + "."),
      { t: "h2", text: "1. What changes" },
    ];
    if (filled(f.changeText)) blocks.push(p(f.changeText.trim()));
    (lease.customClauses || []).filter((c) => filled(c.text)).forEach((c) => blocks.push(filled(c.title) ? titled(clean(c.title).replace(/\.$/, ""), c.text.trim()) : p(c.text.trim())));
    if (blocks.at(-1).t === "h2") blocks.push(p("[describe the changes]"));
    blocks.push({ t: "h2", text: "2. Everything else stays the same" }, p("Every part of the lease that this amendment does not change stays in effect. If the lease and this amendment conflict, this amendment controls."), { t: "h1", text: "Signatures" }, { t: "sign", parties: who.length ? who.map(({ role, name }) => ({ role, name })) : [{ role: "Landlord", name: "" }, { role: "Tenant", name: "" }] });
    return { title: "Lease Amendment", footer: address(f), watermark: options.draft ? "DRAFT" : "", blocks };
  }

  function build(lease, options = {}) {
    const L = law(),
      f = lease?.facts || {},
      today = options.today || f.agreementDate || "";
    if (isAmendment(lease)) return amendment(lease, options);
    const analysis = L.analyze(lease, today),
      cover = analysis.coverage,
      people = tenants(lease),
      many = people.length > 1,
      who = signers(lease),
      home = address(f) || "[address]",
      rent = L.money(f.rent) || "[rent]",
      active = lib().active(lease),
      inSlot = (slot) => active.filter((c) => c.slot === slot).flatMap((c) => c.blocks),
      whole = (slot) => active.find((c) => c.slot === slot);
    const blocks = [],
      receipt = [];
    let n = 0;
    const section = (heading, body) => {
      const content = body.filter(Boolean);
      if (content.length) blocks.push({ t: "h2", text: ++n + ". " + heading }, ...content);
    };

    blocks.push({ t: "title", text: title(lease), sub: home }, { t: "kv", rows: summary(lease) }, p("This table is a summary for convenience. The numbered sections below are the agreement.", { size: 9.5 }));

    section("Parties", [
      p("This agreement (the “Lease”) is made on " + (L.longDate(f.agreementDate) || "[date]") + " between " + (clean(f.landlord) || "[landlord]") + " (“Landlord”) and " + (series(people.map((t) => t.name)) || "[tenants]") + " (" + (many ? "together, " : "") + "“Tenant”)."),
      many ? p("Each person who signs as Tenant is responsible for all of Tenant’s obligations under this Lease, including the full rent, not just a share.") : null,
    ]);

    const extras = [filled(f.parking) ? "parking: " + clean(f.parking).replace(/\.$/, "") : "", filled(f.storage) ? "storage: " + clean(f.storage).replace(/\.$/, "") : ""].filter(Boolean);
    section("The home", [
      p("Landlord rents to Tenant the home at " + home + (extras.length ? ", together with " + extras.join("; ") : "") + ". Tenant will use the home only as a private residence. This does not prevent a use the law protects, such as a licensed family daycare home."),
      f.furnished === "yes" ? p("The home is rented furnished" + (filled(f.furnishings) ? " with: " + sentence(f.furnishings) : ". Landlord and Tenant will list the furnishings on the move-in checklist.")) : null,
    ]);

    section("Term", [
      monthly(lease)
        ? p("The tenancy starts on " + (L.longDate(f.termStart) || "[start date]") + " and continues from month to month until Landlord or Tenant ends it with the written notice the law requires.")
        : p((f.kind === "Renewal" && L.isDate(f.start) ? "Tenant has lived in the home since " + L.longDate(f.start) + ". This Lease renews that tenancy and replaces the earlier lease for the new term. " : "") + "The term starts on " + (L.longDate(f.termStart) || "[start date]") + " and ends on " + (L.longDate(f.end) || "[end date]") + "."),
      monthly(lease) ? null : p("If Tenant stays after the end date with Landlord’s consent, the tenancy continues from month to month on the same terms until Landlord or Tenant ends it with the written notice the law requires."),
      ...inSlot("term"),
    ]);

    const renewal = f.kind === "Renewal";
    const first = firstPayment(f),
      methods = csv(f.payMethods).filter((m) => methodNames[m]).map((m) => methodNames[m]);
    section("Rent", [
      p("Tenant will pay rent of " + rent + " each month, in advance, on or before the " + (filled(f.dueDay) ? ordinal(f.dueDay) : "[day]") + " day of the month. If that day falls on a weekend or legal holiday, rent is due the next business day."),
      renewal
        ? p("This rent applies from " + (L.longDate(f.termStart) || "[start date]") + ". Rent for a partial month is figured by the day, using a 30-day month.")
        : first
          ? first.prorated
            ? p("The first payment is " + L.money(L.amount(f.firstMonth) ?? first.amount) + ", due on or before " + L.longDate(first.from) + ". It covers " + L.longDate(first.from) + " through " + L.longDate(first.through) + ". Rent for a partial month is figured by the day, using a 30-day month.")
            : p("The first month’s rent is due on or before " + L.longDate(first.from) + ". Rent for a partial month is figured by the day, using a 30-day month.")
          : null,
      titled("How to pay", "Rent is payable to " + (clean(f.payTo) || clean(f.landlord) || "[payee]") + ". Landlord accepts payment by " + (methods.length ? series(methods, "or") : "[payment methods]") + "." + (filled(f.payDetails) ? " " + sentence(f.payDetails) : "") + (filled(f.payHours) ? " Payments may be mailed to the address in the Notices section, or delivered there in person " + sentence(f.payHours) : " Payments sent by mail go to the address in the Notices section.")),
      p("Landlord does not charge a fee for paying by check and will accept rent from another person on Tenant’s behalf as California Civil Code section 1947.3 provides. Rent is paid when Landlord receives it."),
      titled("Rent changes", (monthly(lease) ? "Landlord may change the rent by giving the written notice the law requires: at least 30 days, or 90 days if the rent would rise more than 10 percent in a year." : "The rent does not change during the term. After the term, Landlord may change it by giving the written notice the law requires: at least 30 days, or 90 days if the rent would rise more than 10 percent in a year.") + (cover.known && cover.cap === "applies" ? " Because the rent limits of California Civil Code section 1947.12 apply to the home, the rent cannot rise by more than that law allows in any 12 months." : "")),
      ...inSlot("rent"),
    ]);

    section("Late and returned payments", [
      f.lateFee === "yes"
        ? p("If Landlord has not received the full rent by the end of the " + (filled(f.lateFeeDay) ? ordinal(f.lateFeeDay) : "[day]") + " day of the month, Tenant will pay a late charge of " + (L.money(f.lateFeeAmount) || "[amount]") + ". When the day rent is due moves to the next business day because of a weekend or legal holiday, this deadline moves by the same number of days. Landlord and Tenant agree that late rent causes Landlord costs that are impracticable or extremely difficult to fix exactly, such as extra bookkeeping, follow-up time and late charges on Landlord’s own bills, and that this amount is a fair estimate of them. A late charge is not rent, and it does not change the date rent is due.")
        : null,
      f.nsfFee === "no" ? null : p("If a check Tenant gives Landlord is returned unpaid, Tenant will pay Landlord a service charge of $25 for the first returned check and $35 for each one after that. After a check is returned or stopped, Landlord may require rent to be paid in cash for up to three months by giving the written notice California Civil Code section 1947.3 requires."),
    ]);

    const deposit = L.amount(f.deposit);
    const firstDue = first ? (first.prorated ? L.amount(f.firstMonth) ?? first.amount : first.amount) : null;
    const dueRows = !renewal && firstDue !== null && deposit !== null ? [[first.prorated ? "First payment" : "First month’s rent", L.money(firstDue)], ["Security deposit", deposit === 0 ? "None" : L.money(deposit)], ["Total due before move-in", L.money(firstDue + deposit)]] : null;
    section(
      "Security deposit",
      deposit === 0
        ? [p("Landlord is not collecting a security deposit.")]
        : [
            p((renewal ? "Landlord holds a security deposit of " + (L.money(f.deposit) || "[deposit]") + " that Tenant paid under the earlier lease. It continues as the security deposit under this Lease, and no further deposit is due." : "Tenant will pay a security deposit of " + (L.money(f.deposit) || "[deposit]") + " on or before " + (L.longDate(f.termStart) || "the start date") + ".") + " Landlord holds it for Tenant and may use it only as California Civil Code section 1950.5 allows: for unpaid rent, to repair damage beyond ordinary wear and tear caused by Tenant or Tenant’s household or guests, to clean the home so it is as clean as it was at move-in, and to restore, replace or return Landlord’s personal property, such as furnishings, keys and remotes, not counting ordinary wear and tear."),
            p("The deposit is fully refundable to the extent it is not used for those purposes. Tenant may not treat it as the last month’s rent. No interest is paid on the deposit unless a law requires it."),
            titled("Move-out inspection", "Before Tenant moves out, Landlord will tell Tenant in writing that Tenant may ask for an inspection of the home, to take place no earlier than two weeks before move-out, so that Tenant has a chance to fix anything that could lead to a deduction."),
            titled("Refund", "Within 21 calendar days after Tenant moves out, Landlord will give Tenant an itemized statement of any deductions, with the receipts and photographs the law requires, and will refund the rest. " + (renewal ? "Landlord will photograph the home when Tenant moves out." : "Landlord will photograph the home at move-in and again at move-out.") + " If Tenant paid the deposit or rent electronically, Landlord will send the refund electronically to the account Tenant names in writing, unless Landlord and Tenant agree in writing on another way."),
            ...inSlot("deposit"),
          ],
    );
    if (dueRows) blocks.push(p("Due before Tenant moves in:", { bold: true }), { t: "kv", rows: dueRows });

    const billed = L.cityBilled(f),
      billedKeys = { water: "util_water", sewer: "util_sewer", "trash and recycling": "util_trash" },
      reimbursed = new Set(billed.map((name) => billedKeys[name]));
    const paid = (side) => utilityNames.filter(([k]) => f[k] === side && !(side === "tenant" && reimbursed.has(k))).map(([, name]) => name);
    section("Utilities and services", [
      p((paid("tenant").length ? "Tenant will pay the provider directly for " + series(paid("tenant")) + (renewal ? ", and will keep those accounts in Tenant’s name. " : ", and will put those accounts in Tenant’s name by the start date. ") : "") + (paid("landlord").length ? "Landlord will pay for " + series(paid("landlord")) + "." : "") || (billed.length ? "" : "[who pays for utilities]")),
      ...(billed.length
        ? [
            titled("City utility charges", "The City of San Diego bills Landlord for " + series(billed) + ". Tenant will be charged a utility fee for those services that Tenant’s household consumes: Tenant will reimburse Landlord the amount the City charges Landlord for them, with nothing added" + (filled(f.utilityAllocation) ? ", divided as follows: " + sentence(f.utilityAllocation) : ".") + " Landlord will send Tenant the amount due with a copy or summary of the bill, and Tenant will pay it with the next month’s rent. If Tenant asks in writing, Landlord will provide within 10 calendar days a copy of the utility or tax bill and the calculation of Tenant’s share."),
            { t: "notice", paras: [L.texts.cityUtilityFees], size: 12, frame: "box" },
          ]
        : []),
      filled(f.utilNotes) ? p(sentence(f.utilNotes)) : null,
      f.sharedMeter === "yes" ? titled("Shared meter", "Landlord discloses that the gas or electric meter for the home also serves an area outside the home. Landlord and Tenant agree to the following arrangement for that cost: " + (sentence(f.sharedMeterDetails) || "[describe what the meter serves and who pays]")) : null,
      p("Tenant will sort trash, recycling and food and yard waste into the correct bins as the City requires."),
    ]);

    section("Who may live in the home", [
      p("Only " + (series(people.map((t) => t.name)) || "the Tenant") + (filled(f.occupants) ? ", and these other occupants: " + clean(f.occupants).replace(/\.$/, "") + "," : "") + " may live in the home. This does not limit a change in the household that fair housing law protects, such as a child joining the family."),
      ...inSlot("occupancy"),
    ]);

    section(renewal ? "Condition of the home" : "Condition of the home at move-in", [
      renewal
        ? p("Tenant already lives in the home. Its condition when Tenant first moved in, including any move-in checklist, remains the starting point for the security deposit. Nothing in this Lease limits Landlord’s duty to keep the home fit to live in or Tenant’s right to ask for repairs.")
        : p("Landlord will deliver the home clean, in good repair and fit to live in. At or before move-in, Landlord and Tenant will note the condition of the home on a move-in checklist that both keep. Tenant will tell Landlord in writing within five days after move-in about anything that is damaged or not working and is not on the checklist."),
    ]);

    const provided = csv(f.appliances || "stove,refrigerator").filter((a) => applianceNames[a] && !(a === "refrigerator" && f.ownFridge === "yes"));
    if (!provided.includes("stove")) provided.unshift("stove");
    section("Appliances" + (f.furnished === "yes" ? " and furnishings" : ""), [
      p("Landlord provides these appliances and will keep them in good working order: " + series(provided.map((a) => applianceNames[a])) + "."),
      ...(f.ownFridge === "yes"
        ? [
            p("Tenant has asked to bring Tenant’s own refrigerator. The choice is voluntary, and Landlord has not made it a condition of renting the home. If the box below is left blank, Landlord will provide and maintain a refrigerator in good working order."),
            { t: "check", text: law().texts.fridge, checked: false },
            p("If Tenant brings a refrigerator, Tenant may later give Landlord 30 days’ written notice that Tenant no longer wishes to keep it in the home. At the end of that 30-day period Landlord will install a refrigerator in good working order. Landlord is not responsible for maintaining a refrigerator that Tenant provides."),
          ]
        : []),
    ]);

    section("Care of the home and repairs", [
      p("Tenant will keep the home clean and sanitary, dispose of trash properly, use the plumbing, electrical, heating and other systems and the appliances as they are meant to be used, and not damage the home or let anyone else damage it."),
      p("In an emergency such as a fire, a gas smell or flooding, Tenant will call 911 or the utility first and then Landlord" + (filled(f.noticePhone) ? " at " + clean(f.noticePhone) : "") + "."),
      p("Tenant will tell Landlord promptly in writing when something needs repair. Landlord will make the repairs needed to keep the home fit to live in, as California Civil Code sections 1941 and 1941.1 require. Tenant will pay for repairing damage that Tenant, members of Tenant’s household, guests or pets cause, beyond ordinary wear and tear."),
      f.util_yard === "tenant" ? titled("Yard", "Tenant will water, mow and weed the yard and keep it neat. Landlord remains responsible for trees, irrigation repairs and anything that needs a contractor.") : null,
      ...inSlot("care"),
    ]);

    section("Changes to the home, locks and keys", [...inSlot("changes"), p("Tenant will return every key, remote and garage opener when the tenancy ends.")]);

    section("Landlord’s entry", [
      p("Landlord or Landlord’s agent may enter the home only as California Civil Code section 1954 allows: in an emergency; to make necessary or agreed repairs, decorations, alterations or improvements; to supply necessary or agreed services; to show the home to prospective or actual buyers, lenders, tenants, workers or contractors; for the move-out inspection Tenant requests; to carry out inspections the law requires; under a court order; or after Tenant has moved out or abandoned the home."),
      p("Except in an emergency, when Tenant agrees at the time, or after Tenant has moved out, Landlord will give written notice of the date, approximate time and purpose of the entry. Twenty-four hours’ notice is presumed reasonable, or six days if the notice is mailed. Landlord will enter during normal business hours unless Tenant agrees otherwise at the time."),
    ]);

    for (const slot of ["pets", "smoking"]) if (whole(slot)) section(whole(slot).heading, whole(slot).blocks);
    if (whole("parking")) section(whole("parking").heading, whole("parking").blocks);
    for (const slot of ["sublet", "insurance"]) if (whole(slot)) section(whole(slot).heading, whole(slot).blocks);

    section("Neighbors and conduct", [
      p("Tenant and Tenant’s household and guests will not disturb the neighbors, create a nuisance, damage the property or use the home for anything illegal. Nothing in this Lease limits anyone’s right to call the police or emergency services."),
      ...inSlot("conduct"),
    ]);

    section("Damage or destruction", [
      p("If fire or another event that Tenant did not cause makes the home unsafe or impossible to live in, either Landlord or Tenant may end this Lease by written notice, and rent stops on the day Tenant can no longer live there. Landlord will return any rent paid for the time after that day within 21 days. If only part of the home cannot be used, rent is reduced fairly until it is repaired."),
      p("Tenant owes no rent for any period when a mandatory evacuation order in a declared disaster keeps Tenant out of the home."),
    ]);

    section("Ending the tenancy and moving out", [
      p("Tenant may end a month-to-month tenancy by giving Landlord at least 30 days’ written notice. Landlord may end the tenancy only as the law allows and with the written notice it requires: generally at least 60 days once a tenant has lived in the home for a year, and at least 30 days before then." + (cover.known && cover.cause === "applies" ? " Because just cause rules apply to the home, Landlord must also have a reason the law recognizes." : "")),
      monthly(lease) ? null : p("If Tenant moves out before the term ends without a legal right to do so, Tenant remains responsible for the rent until the term ends or the home is rented again, whichever comes first, and for Landlord’s reasonable costs of renting it again. Landlord will make reasonable efforts to rent it again promptly."),
      p("When the tenancy ends, Tenant will leave the home as clean as it was at move-in, remove all belongings and trash, return the keys, and give Landlord a forwarding address. If Tenant stays after the tenancy has lawfully ended without Landlord’s consent, Tenant owes rent for each day at the daily rate of the rent then in effect, along with any other damages the law allows."),
      ...inSlot("ending"),
    ]);

    const protections = [];
    if (cover.known) {
      const T = L.texts;
      if (cover.notices.includes("cityCovered")) protections.push({ t: "notice", heading: "City of San Diego notice", paras: [T.cityCovered], size: 12, frame: "box" });
      if (cover.notices.includes("stateCovered")) protections.push({ t: "notice", heading: "State of California notice", paras: [T.stateCovered], size: 12, frame: "box" });
      if (cover.notices.includes("cityCovered") && cover.notices.includes("stateCovered")) protections.push(p("Both notices are given so that Tenant has complete information. " + (cover.shortTerm ? "The City’s just cause rules do not apply to a lease for a fixed term of three months or less. They apply from the first day if the tenancy continues after that term" : "Inside the City of San Diego the City’s just cause rules apply from the start of the tenancy") + ", and Tenant has the benefit of whichever rules give greater protection."));
      if (cover.guide) {
        protections.push(p("A copy of the City of San Diego Tenant Protection Guide is attached to this Lease and is part of this notice."));
      }
      if (cover.notices.includes("stateExempt")) protections.push({ t: "notice", heading: "Notice of exemption from state rent limits and just cause requirements", paras: [T.stateExempt], size: 12, frame: "box" });
      if (cover.notices.includes("cityExempt")) protections.push({ t: "notice", heading: "Notice of exemption from City of San Diego just cause requirements", paras: [T.cityExempt], size: 12, frame: "box" });
      if (cover.statement) protections.push(p(cover.statement));
    } else protections.push(p("[The required tenant-protection notice appears here once the questions about the home are answered.]"));
    protections.push(...inSlot("protections"));
    section("Tenant protections under state and city law", protections);

    section("Rights the law gives tenants to end a lease early", [
      p("The law lets some tenants end a lease early, including survivors of domestic violence, sexual assault, stalking, human trafficking, elder abuse and certain other crimes (California Civil Code section 1946.7) and service members who receive qualifying military orders (50 U.S.C. section 3955). Nothing in this Lease limits those rights."),
    ]);

    section("If the lease is broken", [
      p("If Tenant does not pay rent when it is due or breaks another important term of this Lease, Landlord may give the written notice the law requires. If the problem is not corrected within the time that notice allows, Landlord may end the tenancy and ask a court for possession of the home, unpaid rent and the other damages the law allows. Landlord will not lock Tenant out, remove Tenant’s belongings or shut off utilities."),
    ]);

    const contact = clean(f.manager) || clean(f.landlord) || "[name]";
    section("Notices", [
      p((filled(f.manager) ? contact + " manages the home for Landlord" : contact + " is the owner or the owner’s agent, manages the home,") + " and is authorized to receive rent, notices, demands and service of legal papers. Telephone: " + (clean(f.noticePhone) || "[phone]") + ". Street address where papers can be delivered in person: " + (clean(f.noticeAddress) || "[street address]") + "." + (filled(f.noticeEmail) ? " Email: " + clean(f.noticeEmail) + "." : "")),
      p("Landlord will deliver notices to Tenant at the home. Email and text messages are welcome for everyday communication" + (people.some((t) => filled(t.email)) ? " (" + series(people.filter((t) => filled(t.email)).map((t) => t.name + ": " + clean(t.email))) + ")" : "") + ", but a notice the law requires to be delivered in a particular way will be delivered that way."),
    ]);

    const disclosures = [
      titled("Megan’s Law", L.texts.megan),
      titled("Flood", (f.floodKnown === "yes" ? L.texts.floodKnown + " " : "") + L.texts.flood.join(" ")),
      titled("Bed bugs", "The information about bed bugs that California law requires is attached to this Lease. Tenant will report any sign of bed bugs to Landlord in writing right away" + (filled(f.bedbugContact) ? ", using " + clean(f.bedbugContact).replace(/\.$/, "") + "." : " at the address or email in the Notices section.")),
      titled("Mold", "Tenant has received the California Department of Public Health booklet “Information on Dampness and Mold for Renters in California.”" + (f.moldKnown === "yes" ? " Landlord discloses the following about mold in the home: " + (sentence(f.moldDetails) || "[describe the mold you know about]") : "")),
    ];
    receipt.push("the booklet “Information on Dampness and Mold for Renters in California”", "the “Information about Bed Bugs” attached to this Lease");
    const leadApplies = analysis.items.some((i) => i.id === "lead" && i.state !== "not-needed");
    if (leadApplies) {
      disclosures.push(titled("Lead-based paint", "The home was built before 1978. The Lead-Based Paint Disclosure attached to this Lease is part of it, and Tenant has received the pamphlet “Protect Your Family From Lead in Your Home.”"));
      receipt.push("the pamphlet “Protect Your Family From Lead in Your Home” and the Lead-Based Paint Disclosure");
    }
    if (cover.known && cover.guide) receipt.push("the City of San Diego Tenant Protection Guide");
    if (f.pestService === "yes") disclosures.push(titled("Pest control", "A pest control company treats the property on a regular schedule" + (filled(f.pestCompany) ? " (" + clean(f.pestCompany) + ")" : "") + ". A copy of the company’s notice about the pests it targets and the pesticides it uses is attached to this Lease."));
    if (f.deathRecent === "yes") disclosures.push(titled("Death in the home", sentence(f.deathDetails) || "A person died in the home within the last three years."));
    if (f.demolition === "yes") disclosures.push(titled("Demolition permit", "Landlord has applied for a permit to demolish the home. " + (sentence(f.demolitionDetails) || "[earliest approximate dates demolition may begin and the tenancy may end]")));
    if (f.ordnance === "yes") disclosures.push(titled("Former military ordnance", sentence(f.ordnanceDetails) || "Landlord knows of a former federal or state ordnance location within one mile of the home. Such sites may contain potentially explosive munitions."));
    if (f.asbestosKnown === "yes") disclosures.push(titled("Asbestos", sentence(f.asbestosDetails) || "Landlord knows that materials in the home contain asbestos. Tenant will not sand, drill, scrape or otherwise disturb ceilings, flooring, insulation or similar materials without Landlord’s written consent."));
    if (f.section8 === "yes") disclosures.push(titled("Housing voucher", "Tenant receives rental assistance through the Housing Choice Voucher program. The HUD Tenancy Addendum attached to this Lease is part of it and controls if it conflicts with any other term."));
    if (f.inCity === "yes") disclosures.push({ t: "notice", heading: "Family daycare homes (City of San Diego notice)", paras: [L.texts.cityDaycare], size: 12, frame: "box" });
    section("Required disclosures", disclosures);

    const custom = (lease.customClauses || []).filter((c) => filled(c.text) || filled(c.title));
    section("Additional provisions", custom.length ? [p("Landlord and Tenant also agree to the following. If one of these provisions conflicts with another section of this Lease, the provision below controls to the extent the law allows."), ...custom.map((c, i) => ({ t: "p", indent: 14, runs: [{ text: "(" + String.fromCharCode(97 + (i % 26)) + ") " + (filled(c.title) ? clean(c.title).replace(/\.$/, "") + ". " : ""), bold: true }, { text: filled(c.text) ? c.text.trim() : "[clause wording]" }] }))] : []);

    section("General terms", [
      p("This Lease and its attachments are the whole agreement between Landlord and Tenant about the home. It can be changed only in writing signed by both. If a court finds part of it unenforceable, the rest stays in effect. If Landlord does not enforce a term at one time, Landlord may still enforce it later. California law governs this Lease."),
      p("Federal, state and local laws apply to this Lease. A right the law gives Tenant applies even if this Lease does not mention it."),
      p("Landlord follows fair housing laws and does not discriminate on any basis the law protects, including a person’s source of income, such as a housing voucher. A person with a disability may ask Landlord at any time for a reasonable accommodation or modification."),
      p("Signatures may be handwritten or electronic, and a copy of the signed Lease is as valid as the original. Landlord will give each Tenant a copy of the signed Lease within 15 days after Tenant signs it."),
      ...inSlot("general"),
    ]);

    blocks.push({ t: "h1", text: "Signatures" }, p("By signing, Tenant confirms that, before signing, Tenant received " + series(receipt) + "."), p("Landlord and Tenant have read this Lease and agree to it."), { t: "sign", parties: who.length ? who.map(({ role, name }) => ({ role, name })) : [{ role: "Landlord", name: "" }, { role: "Tenant", name: "" }] });

    blocks.push(
      { t: "h1", text: "Attachment: Information about Bed Bugs", breakBefore: true },
      p("California Civil Code section 1954.603 requires landlords to give tenants this information before a tenancy begins."),
      { t: "notice", heading: L.texts.bedbugTitle, paras: [...L.texts.bedbug], size: 10.5, frame: "bar" },
      titled("How to report bed bugs", "Tell Landlord in writing right away if you see bed bugs or signs of them" + (filled(f.bedbugContact) ? ", using " + clean(f.bedbugContact).replace(/\.$/, "") : ", at the address or email in the Notices section of the Lease") + ". Say which rooms are affected. Landlord will arrange an inspection by a pest control operator. Reporting early and following the operator’s preparation instructions keeps bed bugs from spreading."),
    );

    if (leadApplies) {
      const agent = filled(f.manager);
      blocks.push(
        { t: "h1", text: "Attachment: Lead-Based Paint Disclosure", breakBefore: true },
        p("For the home at " + home + ". Federal law requires this disclosure before a lease is signed for housing built before 1978."),
        { t: "notice", heading: "Lead Warning Statement", paras: [L.texts.leadWarning], size: 11, frame: "box" },
        p("Landlord’s disclosure", { bold: true }),
        { t: "check", checked: f.leadKnown === "yes", text: "Known lead-based paint and/or lead-based paint hazards are present in the housing" + (f.leadKnown === "yes" ? ": " + (sentence(f.leadDetails) || "[describe]") : ".") },
        { t: "check", checked: f.leadKnown === "no", text: "Landlord has no knowledge of lead-based paint and/or lead-based paint hazards in the housing." },
        { t: "check", checked: f.leadRecords === "yes", text: "Landlord has provided Tenant with all available records and reports pertaining to lead-based paint and/or lead-based paint hazards in the housing" + (f.leadRecords === "yes" ? ": " + (sentence(f.leadRecordsList) || "[list the documents]") : ".") },
        { t: "check", checked: f.leadRecords === "no", text: "Landlord has no reports or records pertaining to lead-based paint and/or lead-based paint hazards in the housing." },
        p("Tenant’s acknowledgment", { bold: true }),
        { t: "check", checked: false, text: f.leadRecords === "yes" ? "Tenant has received copies of all the records and reports listed above." : "Tenant has received the information above; Landlord has no records or reports to provide." },
        { t: "check", checked: false, text: "Tenant has received the pamphlet “Protect Your Family From Lead in Your Home.”" },
        ...(agent ? [p("Agent’s acknowledgment", { bold: true }), { t: "check", checked: false, text: "The agent has informed Landlord of Landlord’s obligations under 42 U.S.C. 4852d and is aware of the agent’s responsibility to ensure compliance." }] : []),
        p("Certification of accuracy", { bold: true }),
        p("The people signing below have reviewed the information above and certify, to the best of their knowledge, that the information they have provided is true and accurate."),
        { t: "sign", parties: [{ role: "Landlord", name: clean(f.landlord) }, ...(agent ? [{ role: "Agent", name: clean(f.manager) }] : []), ...people.map((t) => ({ role: "Tenant", name: t.name }))] },
      );
    }
    return { title: title(lease), footer: address(f), watermark: options.draft ? "DRAFT" : "", blocks };
  }

  globalThis.LeaseDocument = Object.freeze({ title, address, signers, tenants, firstPayment, missing, summary, build, series, ordinal });
})();
