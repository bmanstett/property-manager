/* Leases workspace: the Leases home, the guided lease builder and the legal sources list.
   Every legal sentence, number and citation comes from lease-law.js, lease-clauses.js and
   lease-document.js. This file asks the questions, keeps the draft safe and shows the result.
   Finalized leases, signing, history and deposit returns live in lease-packets.js. */
(() => {
  "use strict";
  const G = globalThis;
  const pm = () => G.PM,
    law = () => G.LeaseLaw,
    lib = () => G.LeaseClauses,
    paper = () => G.LeaseDocument,
    packets = () => G.LeasePackets,
    kit = () => G.UI;

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const filled = (v) => String(v ?? "").trim() !== "";
  const clean = (v) => String(v ?? "").trim().replace(/\s+/g, " ");
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const csv = (v) => String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  const REVISION = ["_rev", "_parents", "_ancestors", "_device", "_updatedAt"];
  const noop = () => {};

  function addDays(iso, n) {
    const d = new Date(iso + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function dateText(iso, year = true) {
    return law().isDate(String(iso || "").slice(0, 10))
      ? new Date(String(iso).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          ...(year ? { year: "numeric" } : {}),
          timeZone: "UTC",
        })
      : "";
  }

  function stampText(stamp) {
    const when = new Date(stamp);
    if (!Number.isFinite(+when)) return "";
    try {
      return when.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: pm().prop()?.timezone || "America/Los_Angeles" });
    } catch {
      return when.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
  }

  /* Money is typed freely ("3,200", "$3200.5") and stored as "3200" or "3200.50". */
  function parseMoney(text) {
    const raw = String(text ?? "").replace(/[$,\s]/g, "");
    if (!/^\d{1,9}(\.\d{0,2})?$/.test(raw)) return null;
    const [whole, cents = ""] = raw.split(".");
    const pennies = (cents + "00").slice(0, 2);
    return String(Number(whole)) + (pennies === "00" ? "" : "." + pennies);
  }
  function showMoney(stored) {
    const value = parseMoney(stored);
    if (value === null) return String(stored ?? "");
    const [whole, cents] = value.split(".");
    return Number(whole).toLocaleString("en-US") + (cents ? "." + cents : "");
  }
  const dollars = (value) => (law().money(value) || "").replace(/\.00$/, "");

  /* ------------------------------------------------------------------ */
  /* The six steps and the choices offered                               */
  /* ------------------------------------------------------------------ */
  const STEPS = [
    { key: "home", label: "Home", intro: "Tell us about the home. These answers decide which California and San Diego rules apply.", anchor: "" },
    { key: "people", label: "People", intro: "Who is renting to whom.", anchor: "Parties" },
    { key: "terms", label: "Rent & term", intro: "The money and the dates.", anchor: "Term" },
    { key: "rules", label: "Rules", intro: "House rules and recommended clauses. Turn on what fits; read the exact wording any time.", anchor: "Pets and animals" },
    { key: "disclosures", label: "Disclosures", intro: "California and San Diego require certain notices. We add them for you.", anchor: "Required disclosures" },
    { key: "review", label: "Review & sign", intro: "Check it over, then make it final.", anchor: "" },
  ];
  const isAmendment = (lease) => lease?.facts?.kind === "Amendment";
  /* An amendment is one page, so it skips the Rules and Disclosures steps. */
  const stepsFor = (lease) => (isAmendment(lease) ? [0, 1, 2, 5] : [0, 1, 2, 3, 4, 5]);
  const stepLabel = (lease, i) => (i === 2 && isAmendment(lease) ? "What changes" : STEPS[i].label);
  const stepIntro = (lease, i) =>
    !isAmendment(lease)
      ? STEPS[i].intro
      : ["Check the address of the home.", "Check who signs the amendment.", "Say what is changing and when.", "", "", "Check it over, then make it final."][i];

  const UNIT_TYPES = [
    ["house", "House", "A single-family home"],
    ["condo", "Condo or townhome", "One unit you own on its own"],
    ["apartment", "Apartment", "A unit in a building with two or more"],
    ["adu", "ADU or guest house", "A second home on the lot"],
    ["room", "Room", "A room in a home"],
  ];
  const BUILDING_SIZES = [["2", "2"], ["3-4", "3–4"], ["5-15", "5–15"], ["16+", "16 or more"]];
  const OWNER_KINDS = [
    ["people", "People or a family trust"],
    ["llc", "An LLC owned only by people"],
    ["corp", "A corporation, REIT, or LLC with a corporate member"],
  ];
  const LEASE_KINDS = [
    ["Fixed term", "Fixed term", "Ends on a set date. Most common."],
    ["Month to month", "Month to month", "Continues until either side gives written notice."],
  ];
  const PAY_METHODS = [
    ["check", "Personal check"],
    ["moneyorder", "Cashier’s check or money order"],
    ["zelle", "Zelle or bank transfer"],
    ["online", "Online payment"],
    ["cash", "Cash"],
  ];
  const UTILITIES = [
    ["util_electric", "Electricity"],
    ["util_gas", "Gas"],
    ["util_water", "Water"],
    ["util_sewer", "Sewer"],
    ["util_trash", "Trash and recycling"],
    ["util_internet", "Internet"],
    ["util_yard", "Yard care"],
    ["util_pool", "Pool service"],
  ];
  const UTIL_KEYS = UTILITIES.map(([k]) => k).filter((k) => k !== "util_pool");
  const APPLIANCES = [
    ["stove", "Stove"],
    ["refrigerator", "Refrigerator"],
    ["dishwasher", "Dishwasher"],
    ["microwave", "Microwave"],
    ["washer", "Washer"],
    ["dryer", "Dryer"],
    ["ac", "Air conditioner"],
    ["disposal", "Garbage disposal"],
  ];
  const LANGUAGES = [["spanish", "Spanish"], ["chinese", "Chinese"], ["tagalog", "Tagalog"], ["vietnamese", "Vietnamese"], ["korean", "Korean"]];
  const YES_NO = [["no", "No"], ["yes", "Yes"]];
  const MONEY_HINT = "Enter an amount like 3,200 or 3,200.50.";

  /* Facts about the home and the owner that carry over to the next lease for the same rental. */
  const HOME_KEYS = ["premises", "city", "zip", "county", "inCity", "unitType", "buildingUnits", "otherUnitOnLot", "ownerOnSite", "sharedKitchenBath", "built", "cofo", "ownerKind", "multipleBuildings", "hoa", "pool", "parking", "storage", "affordable"];
  const HABIT_KEYS = [...UTILITIES.map(([k]) => k), "utilityBilling", "utilityAllocation", "payMethods", "payTo", "payDetails", "payHours"];
  const OWNER_KEYS = ["landlord", "manager", "signer", "noticeAddress", "noticePhone", "noticeEmail"];

  /* ------------------------------------------------------------------ */
  /* Drafts: defaults, values that follow other values, upgrades          */
  /* ------------------------------------------------------------------ */
  function utilityDefaults(unitType) {
    if (!filled(unitType)) return {};
    const house = unitType === "house";
    return {
      util_electric: "tenant",
      util_gas: "tenant",
      util_water: house ? "tenant" : "landlord",
      util_sewer: house ? "tenant" : "landlord",
      util_trash: "landlord",
      util_internet: "tenant",
      util_yard: house ? "tenant" : "landlord",
    };
  }
  /* The starting late fee and deposit come from lease-law.js when it offers them. */
  function suggestLate(rent) {
    const L = law(),
      value = L.amount(parseMoney(rent) ?? "");
    if (!value) return "";
    if (typeof L.suggest?.lateFee === "function") return parseMoney(L.suggest.lateFee(parseMoney(rent))) || "";
    return String(Math.max(5, Math.min(100, Math.round((value * 0.05) / 5) * 5)));
  }
  function suggestDeposit(rent) {
    const value = parseMoney(rent);
    return value && law().amount(value) ? value : "";
  }
  function lateDayFor(dueDay) {
    const base = Number(law().suggest?.lateFeeDay) || 5;
    return /^(?:[1-9]|1\d|2[0-8])$/.test(String(dueDay ?? "")) ? String(Math.min(28, Number(dueDay) + base - 1)) : String(base);
  }
  const autoEnd = (start) => addDays(law().addMonths(start, 12), -1);
  const yearOf = (v) => (/^\d{4}$/.test(String(v ?? "").trim()) ? Number(String(v).trim()) : null);
  function recentlyBuilt(built, today) {
    const year = yearOf(built),
      now = Number(String(today).slice(0, 4));
    return year !== null && year <= now && year >= now - 16;
  }

  /* Names from a tenant record such as "Avery Morgan" or "Jordan & Sam Rivera". */
  function namesFrom(household) {
    const text = clean(household);
    if (!text || /\b(tenan(t|cy|ts)|household|family|residents?|occupants?|unit)\b/i.test(text)) return [];
    const parts = text.split(/\s*(?:,|&|\/|;|\band\b)\s*/i).map(clean).filter(Boolean);
    const last = parts.at(-1)?.split(" ") || [];
    return parts.map((name) => (name.includes(" ") || last.length < 2 ? name : name + " " + last.at(-1)));
  }
  function autoName(lease) {
    const names = (lease.tenants || []).map((t) => clean(t.name)).filter(Boolean);
    const kind = lease.facts?.kind;
    const what = kind === "Amendment" ? "Lease amendment" : kind === "Renewal" ? "Lease renewal" : "Lease";
    const who = names.length > 2 ? names[0] + " and " + (names.length - 1) + " others" : names.join(" and ");
    return what + " – " + (who || clean(lease.facts?.premises) || "new tenant");
  }

  /* Make a stored draft safe to work with: plain string answers and the lists the builder expects. */
  function tidy(lease, uid) {
    const facts = lease.facts && typeof lease.facts === "object" && !Array.isArray(lease.facts) ? lease.facts : {};
    lease.facts = {};
    for (const [key, value] of Object.entries(facts)) if (value != null && value !== "") lease.facts[key] = String(value);
    lease.tenants = (Array.isArray(lease.tenants) ? lease.tenants : [])
      .filter((t) => t && typeof t === "object")
      .map((t) => ({ id: filled(t.id) ? String(t.id) : uid(), name: String(t.name ?? ""), email: String(t.email ?? ""), phone: String(t.phone ?? "") }));
    if (!lease.tenants.length) lease.tenants.push({ id: uid(), name: "", email: "", phone: "" });
    lease.clauses = lease.clauses && typeof lease.clauses === "object" && !Array.isArray(lease.clauses) ? lease.clauses : {};
    lease.customClauses = (Array.isArray(lease.customClauses) ? lease.customClauses : [])
      .filter((c) => c && typeof c === "object")
      .map((c) => ({ id: filled(c.id) ? String(c.id) : uid(), title: String(c.title ?? ""), text: String(c.text ?? "") }));
    lease.attachments = (Array.isArray(lease.attachments) ? lease.attachments : []).filter((x) => typeof x === "string" && x);
    lease.step = Number.isInteger(lease.step) && lease.step >= 0 && lease.step <= 5 ? lease.step : 0;
    if (!stepsFor(lease).includes(lease.step)) lease.step = 2;
    lease.name = typeof lease.name === "string" ? lease.name : "";
    lease.tenancyId = typeof lease.tenancyId === "string" ? lease.tenancyId : "";
    lease.parentPacket = typeof lease.parentPacket === "string" ? lease.parentPacket : "";
    lease.reviewedInputs = lease.reviewedInputs === true;
    lease.schema = 2;
    return lease;
  }

  /* Answers that are no longer asked must not keep steering the legal result. */
  function prune(f, today) {
    const type = f.unitType;
    if (type !== "apartment") delete f.buildingUnits;
    if (type !== "house" && type !== "room") delete f.otherUnitOnLot;
    const duplex = type === "apartment" && f.buildingUnits === "2";
    if (!(type === "adu" || type === "room" || duplex)) delete f.ownerOnSite;
    if (!(type === "room" && f.ownerOnSite === "yes")) delete f.sharedKitchenBath;
    if (!(f.ownerOnSite === "yes" && (type === "adu" || (type === "room" && f.sharedKitchenBath === "no")))) delete f.ownerRentsMore;
    /* A first payment typed for a mid-month start no longer applies once the start falls on the day rent is due. */
    let first = null;
    try {
      first = paper().firstPayment(f);
    } catch (e) {
      console.error(e);
    }
    if (first && !first.prorated) delete f.firstMonth;
    if (!recentlyBuilt(f.built, today)) delete f.cofo;
    if (f.ownerKind !== "corp") delete f.multipleBuildings;
    else if (f.coverageOverride === "exempt") delete f.coverageOverride;
    if (f.pool !== "yes") delete f.util_pool;
    if (!(f.inCity === "yes" && (f.util_water === "tenant" || f.util_sewer === "tenant"))) delete f.utilityBilling;
    if (!(law().cityBilled(f).length && type !== "house" && type !== "condo")) delete f.utilityAllocation;
  }

  /* Values that follow another answer until the owner sets them. `prev` is the facts before the change. */
  function derive(lease, prev, today) {
    const f = lease.facts,
      L = law(),
      was = (key) => prev[key] ?? "",
      now = (key) => f[key] ?? "";
    /* A draft that starts from a finished lease keeps that lease's deposit and late fee: they are already agreed,
       and on a renewal the deposit is money the owner already holds. */
    const settled = filled(lease.parentPacket);
    if (now("rent") !== was("rent")) {
      if (!filled(f.deposit) || (!settled && f.deposit === suggestDeposit(was("rent")))) f.deposit = suggestDeposit(f.rent);
      if (!filled(f.lateFeeAmount) || (!settled && f.lateFeeAmount === suggestLate(was("rent")))) f.lateFeeAmount = suggestLate(f.rent);
    }
    if (now("dueDay") !== was("dueDay") && (!filled(f.lateFeeDay) || f.lateFeeDay === lateDayFor(was("dueDay")))) f.lateFeeDay = lateDayFor(f.dueDay);
    const term = f.kind === "Fixed term" || f.kind === "Renewal";
    if (term && L.isDate(f.termStart) && (now("termStart") !== was("termStart") || now("kind") !== was("kind"))) {
      if (!filled(f.end) || (L.isDate(was("termStart")) && f.end === autoEnd(was("termStart")))) f.end = autoEnd(f.termStart);
    }
    if (f.kind !== "Renewal" && f.kind !== "Amendment") {
      if (filled(f.termStart)) f.start = f.termStart;
      else delete f.start;
    }
    if (now("unitType") !== was("unitType") && filled(f.unitType)) {
      const before = utilityDefaults(was("unitType"));
      if (UTIL_KEYS.every((key) => !filled(f[key]) || f[key] === before[key])) Object.assign(f, utilityDefaults(f.unitType));
    }
    if (f.pool === "yes" && !filled(f.util_pool)) f.util_pool = "landlord";
    if (!filled(f.inCity) && now("city") !== was("city") && /^san diego$/i.test(clean(f.city))) f.inCity = "yes";
    prune(f, today);
    if (!lease.nameEdited) lease.name = autoName(lease);
    return lease;
  }

  /* The owner's details from the most recent lease anywhere, and this rental's facts from its most recent lease. */
  function recentAnswers(records, propertyId) {
    const when = (r) => String(r.generated || r._updatedAt || "");
    const rows = (records || [])
      .filter((r) => r && !r._deleted && (r.type === "lease" || r.type === "leasePacket") && r.facts && typeof r.facts === "object")
      .sort((a, b) => when(b).localeCompare(when(a)));
    const pick = (row, keys) => Object.fromEntries(keys.filter((k) => filled(row.facts[k])).map((k) => [k, String(row.facts[k])]));
    const withOwner = rows.find((r) => filled(r.facts.landlord));
    const owner = !withOwner ? {} : withOwner.schema === 2 ? pick(withOwner, OWNER_KEYS) : { landlord: clean(withOwner.facts.landlord) };
    const here = rows.find((r) => r.schema === 2 && r.propertyId === propertyId && r.facts.kind !== "Amendment" && filled(r.facts.premises));
    return { owner, home: here ? { ...pick(here, HOME_KEYS), ...pick(here, HABIT_KEYS), unit: clean(here.facts.unit) } : {}, homeTenancyId: here?.tenancyId || "" };
  }

  /* A new schema-2 draft with the defaults applied, so the saved answers and the document agree. */
  function draftFor({ id, property, tenancy, today, recent, uid }) {
    const p = property || {},
      t = tenancy || null,
      r = recent || {},
      home = r.home || {},
      owner = r.owner || {};
    const city = clean(home.city) || clean(p.city) || "San Diego";
    const facts = {
      premises: clean(home.premises) || clean(p.address),
      unit: t && r.homeTenancyId === t.id ? clean(home.unit) : "",
      city,
      zip: clean(home.zip),
      county: clean(home.county) || clean(p.county) || "San Diego",
      state: "CA",
      inCity: /^san diego$/i.test(city) ? "yes" : "",
      kind: "Fixed term",
      agreementDate: today,
      dueDay: "1",
      payMethods: "check,zelle",
      lateFee: "yes",
      lateFeeDay: lateDayFor("1"),
      nsfFee: "yes",
      appliances: "stove,refrigerator",
      ownFridge: "no",
      moldKnown: "no",
      pestService: "no",
      negotiatedLanguage: "english",
    };
    for (const key of [...HOME_KEYS, ...HABIT_KEYS]) if (filled(home[key])) facts[key] = home[key];
    for (const key of OWNER_KEYS) if (filled(owner[key])) facts[key] = owner[key];
    if (t) {
      if (Number.isSafeInteger(t.rentCents) && t.rentCents > 0) facts.rent = parseMoney((t.rentCents / 100).toFixed(2)) || "";
      if (Number.isSafeInteger(t.depositCents) && t.depositCents > 0) facts.deposit = parseMoney((t.depositCents / 100).toFixed(2)) || "";
      if (law().isDate(t.start) && t.start >= today) facts.termStart = t.start;
    }
    const names = t ? namesFrom(t.name) : [];
    const lease = tidy(
      {
        type: "lease",
        schema: 2,
        id,
        propertyId: p.id,
        tenancyId: t?.id || "",
        name: "",
        step: 0,
        lawVersion: law().version,
        facts,
        tenants: names.map((name) => ({ id: uid(), name, email: "", phone: "" })),
        clauses: {},
        customClauses: [],
        attachments: [],
        parentPacket: "",
        reviewedInputs: false,
      },
      uid,
    );
    return derive(lease, {}, today);
  }

  /* Bring a draft from the earlier lease tool (no `schema`) to schema 2 without losing anything typed. */
  function upgrade(old, { today, uid }) {
    const source = old.facts && typeof old.facts === "object" ? old.facts : {};
    const used = new Set();
    const str = (key) => {
      used.add(key);
      return source[key] == null ? "" : String(source[key]).trim();
    };
    const yn = (key) => ({ yes: "yes", no: "no" })[str(key).toLowerCase()] || "";
    const f = {};
    const put = (key, value) => {
      if (filled(value)) f[key] = value;
    };
    put("premises", str("premises"));
    put("city", str("city") || "San Diego");
    put("county", str("county") || "San Diego");
    str("state");
    f.state = "CA";
    const boundary = str("jurisdiction");
    put("inCity", boundary === "City of San Diego" ? "yes" : boundary ? "no" : /^san diego$/i.test(f.city) ? "yes" : "");
    const kindOfHome = str("propertyType");
    put("unitType", { "Separately transferable home or condo": "house", Duplex: "apartment", Apartment: "apartment", "Shared owner home": "room" }[kindOfHome] || "");
    if (kindOfHome === "Duplex") f.buildingUnits = "2";
    else if (kindOfHome === "Apartment" && str("buildingSize") === "More than 15") f.buildingUnits = "16+";
    put("ownerOnSite", kindOfHome === "Shared owner home" ? "yes" : yn("ownerOccupied"));
    put("ownerKind", { "Natural person": "people", "LLC owned only by natural persons": "llc", "REIT, corporation or corporate LLC member": "corp" }[str("ownerType")] || "");
    put("built", yearOf(str("built")) ? str("built") : "");
    put("cofo", law().isDate(str("firstOccupancy")) ? str("firstOccupancy") : "");
    put("multipleBuildings", yn("multipleBuildings"));
    put("landlord", str("landlord"));
    put("noticeAddress", clean(str("noticeContact")));
    put("occupants", clean(str("occupants")));
    put("kind", ["Fixed term", "Month to month", "Renewal", "Amendment"].includes(str("kind")) ? str("kind") : "Fixed term");
    for (const key of ["agreementDate", "start", "termStart", "end"]) put(key, law().isDate(str(key)) ? str(key) : "");
    /* The earlier tool kept the day the tenant first moved in apart from the day this term begins. Here that is a
       renewal. Where it cannot be one, the earlier date stays on the record. */
    if (f.start && f.kind !== "Renewal" && f.kind !== "Amendment") {
      if (!f.termStart) f.termStart = f.start;
      else if (f.start < f.termStart && f.kind === "Fixed term") f.kind = "Renewal";
      else if (f.start !== f.termStart) f.old_start = f.start;
    }
    put("rent", parseMoney(str("rent")) ?? str("rent"));
    put("deposit", parseMoney(str("deposit")) ?? str("deposit"));
    put("dueDay", str("dueDay"));
    put("payDetails", clean(str("methods")));
    put("utilNotes", clean(str("utilities")));
    put("parking", clean(str("parking")));
    put("changeText", str("changeText"));
    put("bedbugContact", clean(str("bedbugContact")));
    put("floodKnown", yn("flood"));
    put("pestService", yn("pest"));
    put("sharedMeter", yn("sharedMeter"));
    put("demolition", yn("demolition"));
    put("ordnance", yn("ordnance"));
    put("deathRecent", yn("recentDeath"));
    put("contamination", yn("contaminationOrder"));
    put("waterSubmeter", yn("waterSubmeter"));
    put("ownerPesticide", yn("ownerPesticides"));
    put("service", yn("service"));
    put("depositSmallOwner", yn("smallOwner"));
    put("ownFridge", yn("ownFridge"));
    const language = str("language").toLowerCase();
    put("negotiatedLanguage", LANGUAGES.some(([v]) => v === language) ? language : "");
    const tenants = str("adults").split(/\r?\n/).map(clean).filter(Boolean).map((name) => ({ id: uid(), name, email: "", phone: "" }));
    /* Free text with no question of its own becomes a clause the owner can see and edit. */
    const customClauses = (Array.isArray(old.customClauses) ? old.customClauses : []).filter((c) => c && typeof c === "object").map((c) => ({ id: filled(c.id) ? String(c.id) : uid(), title: String(c.title ?? ""), text: String(c.text ?? "") }));
    for (const [key, title] of [["pets", "Pets"], ["maintenance", "Maintenance"], ["rulesText", "House rules"], ["appliances", "Appliances"], ["identity", "Landlord’s agent"]]) {
      const text = str(key);
      if (text) customClauses.push({ id: uid(), title, text });
    }
    /* Every other earlier answer stays on the record under an "old_" name. */
    for (const [key, value] of Object.entries(source)) if (!used.has(key) && value != null && String(value).trim() !== "") f["old_" + key] = String(value);
    const defaults = { agreementDate: today, dueDay: "1", payMethods: "check,zelle", lateFee: "yes", lateFeeDay: lateDayFor(f.dueDay || "1"), nsfFee: "yes", appliances: "stove,refrigerator", ownFridge: "no", moldKnown: "no", pestService: "no", negotiatedLanguage: "english" };
    for (const [key, value] of Object.entries(defaults)) if (!filled(f[key])) f[key] = value;
    if (f.ownFridge === "yes") f.appliances = "stove";
    const named = filled(old.name) && !/^(residential lease|lease renewal)$/i.test(clean(old.name));
    const lease = tidy(
      {
        ...old,
        schema: 2,
        package: null,
        template: null,
        resolutions: null,
        lawVersion: law().version,
        name: named ? clean(old.name) : "",
        nameEdited: named,
        facts: f,
        tenants,
        clauses: {},
        customClauses,
        attachments: Array.isArray(old.attachments) ? old.attachments : [],
        step: 0,
        reviewedInputs: false,
      },
      uid,
    );
    return derive(lease, {}, today);
  }
  const current = (record, ctx) => (record.schema === 2 ? tidy(clone(record), ctx.uid) : upgrade(clone(record), ctx));

  /* A new draft that starts from a finished lease: "renew", "amend" or "revise". */
  function fromPacket(packet, mode, { id, today, uid, has }) {
    const base = current({ facts: packet.facts, tenants: packet.tenants, clauses: packet.clauses, customClauses: packet.customClauses, name: packet.name, schema: packet.schema }, { today, uid });
    const f = base.facts,
      L = law();
    const lease = {
      type: "lease",
      schema: 2,
      id,
      propertyId: packet.propertyId,
      tenancyId: packet.tenancyId || "",
      name: "",
      nameEdited: false,
      step: 0,
      lawVersion: L.version,
      facts: f,
      tenants: base.tenants.map((t) => ({ ...t, id: uid() })),
      clauses: base.clauses,
      customClauses: base.customClauses.map((c) => ({ ...c, id: uid() })),
      attachments: (Array.isArray(packet.attachments) ? packet.attachments : []).map((a) => a?.sourceId).filter((x) => typeof x === "string" && (!has || has(x))),
      parentPacket: packet.id,
      origin: mode,
      reviewedInputs: false,
    };
    delete f.rareReviewed;
    if (mode === "renew") {
      const monthly = f.kind === "Month to month";
      f.start = L.isDate(f.start) ? f.start : L.isDate(f.termStart) ? f.termStart : "";
      f.termStart = !monthly && L.isDate(f.end) ? addDays(f.end, 1) : today;
      f.end = autoEnd(f.termStart);
      f.kind = "Renewal";
      f.agreementDate = today;
      delete f.firstMonth;
      lease.step = 2;
    } else if (mode === "amend") {
      f.kind = "Amendment";
      f.agreementDate = today;
      f.changeText = "";
      delete f.termStart;
      lease.clauses = {};
      lease.customClauses = [];
      lease.attachments = [];
      lease.step = 2;
    } else {
      lease.name = clean(packet.name);
      lease.nameEdited = filled(packet.name);
    }
    prune(f, today);
    if (!lease.nameEdited) lease.name = autoName(lease);
    return lease;
  }

  /* Everything that still has to be filled in: the document's own list plus two checks made here. */
  function problems(lease, today) {
    let list = [];
    try {
      list = paper().missing(lease, today).map((x) => ({ step: x.step, field: x.field, label: x.label }));
    } catch (e) {
      console.error(e);
    }
    const f = lease.facts || {},
      S = law().steps,
      day = /^(?:[1-9]|1\d|2[0-8])$/;
    const add = (field, label) => {
      if (!list.some((x) => x.field === field)) list.push({ step: S.terms, field, label });
    };
    if (!isAmendment(lease)) {
      if (f.lateFee === "yes" && day.test(f.dueDay || "") && day.test(f.lateFeeDay || "") && Number(f.lateFeeDay) < Number(f.dueDay)) add("lateFeeDay", "Choose a late day on or after the day rent is due.");
      let first = null;
      try {
        first = paper().firstPayment(f);
      } catch (e) {
        console.error(e);
      }
      if (first?.prorated && filled(f.firstMonth) && law().amount(f.firstMonth) === null) add("firstMonth", "Enter the first payment as an amount, or leave it blank.");
    }
    const shown = stepsFor(lease);
    return list.map((x) => (shown.includes(x.step) ? x : { ...x, step: 5 })).sort((a, b) => a.step - b.step);
  }
  function progress(lease, today) {
    const list = problems(lease, today),
      shown = stepsFor(lease);
    return { left: list.length, step: Math.max(0, shown.indexOf(lease.step)) + 1, of: shown.length };
  }

  /* ------------------------------------------------------------------ */
  /* Shell: routes, toasts, scope                                        */
  /* ------------------------------------------------------------------ */
  const view = { route: "", scope: "", confirm: "", undo: null, past: false, tenant: "" };
  let B = null; // the lease builder that is open, if any
  const unsaved = new Map(); // answers whose save failed as the builder closed, by draft id, kept until the draft is opened again
  let C = null; // what one draw of the builder needs

  const hasRoutes = () => typeof pm().route === "function";
  function routeNow() {
    try {
      if (hasRoutes()) return String(pm().route() || "");
    } catch (e) {
      console.error(e);
    }
    return view.route;
  }
  function go(rest) {
    const before = routeNow();
    view.route = rest;
    if (hasRoutes()) pm().navigate("Leases", rest);
    else pm().navigate("Leases");
    if (before.split("/")[0] !== rest.split("/")[0]) window.scrollTo(0, 0);
  }
  function forget(rest = "") {
    view.route = rest;
    try {
      if (typeof pm().setRoute === "function") pm().setRoute(rest, { replace: true });
    } catch (e) {
      console.error(e);
    }
  }
  const scopeKey = () => pm().dataset() + "|" + (pm().prop()?.id || "");
  const ctx = () => ({ today: pm().today(), uid: pm().uid });
  const toastActs = () => typeof pm().toast === "function" && pm().toast.length >= 2;
  function say(message, label, action) {
    if (label && toastActs()) pm().toast(message, { label, action, onAction: action, onClick: action });
    else pm().toast(message);
  }
  function words(e) {
    if (e?.name === "QuotaExceededError") return "This device is out of space for the app. Free some space, then try again.";
    return e?.message || "The app could not save just now. Try again.";
  }
  function report(e) {
    if (e?.name === "AbortError") return;
    console.error(e);
    pm().error(e instanceof Error ? e : Error(words(e)));
  }

  const EXTRA_ICONS = {
    eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.8"/>',
    print: '<path d="M7 8V3h10v5M7 17H4.5A1.5 1.5 0 0 1 3 15.5v-5A2.5 2.5 0 0 1 5.5 8h13a2.5 2.5 0 0 1 2.5 2.5v5a1.5 1.5 0 0 1-1.5 1.5H17"/><path d="M7 14h10v7H7z"/>',
    external: '<path d="M14 4h6v6m0-6-9 9m7 0v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>',
    back: '<path d="m15 5-7 7 7 7"/>',
    alert: '<path d="M12 4 3 19.5h18zm0 6v4.5m0 2.7h.01"/>',
  };
  function icon(name, size = 18) {
    if (EXTRA_ICONS[name])
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${EXTRA_ICONS[name]}</svg>`;
    return typeof G.ico === "function" ? G.ico(name, size) : "";
  }
  const newTab = (url, text, cls = "lb-link") =>
    `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}${icon("external", 15)}<span class="lb-vh"> (opens in a new tab)</span></a>`;

  /* ------------------------------------------------------------------ */
  /* Leases home                                                         */
  /* ------------------------------------------------------------------ */
  function statusOf(tenancyId) {
    const none = { state: "none", label: "No lease on file", detail: "" };
    try {
      const found = packets()?.statusFor?.(tenancyId);
      return found && typeof found === "object" ? { ...none, ...found } : none;
    } catch (e) {
      console.error(e);
      return none;
    }
  }
  function listFrom(name) {
    try {
      const rows = packets()?.[name]?.();
      return Array.isArray(rows) ? rows.filter((r) => r && typeof r === "object") : [];
    } catch (e) {
      console.error(e);
      return [];
    }
  }
  /* A draft that already became a final lease is no longer "in progress". */
  function finalPacketFor(draftId) {
    return pm().records("leasePacket").find((p) => p.mode === "final" && p.leaseId === draftId);
  }
  function openDrafts() {
    const done = new Set(pm().records("leasePacket").filter((p) => p.mode === "final" && p.leaseId).map((p) => p.leaseId));
    return pm()
      .records("lease")
      .filter((d) => !done.has(d.id) && !(d.finalPacket && pm().get(d.finalPacket)))
      .sort((a, b) => String(b._updatedAt || "").localeCompare(String(a._updatedAt || "")));
  }
  function draftLine(record) {
    try {
      const info = progress(current(record, ctx()), pm().today());
      return "Step " + info.step + " of " + info.of + " · " + (info.left ? plural(info.left, "thing", "things") + " left" : "Ready to finalize");
    } catch (e) {
      console.error(e);
      return "In progress";
    }
  }
  const act = (action, label, ref = "", cls = "") =>
    `<button type="button"${cls ? ` class="${cls}"` : ""} data-lease="${esc(action)}" data-ref="${esc(ref)}">${label}</button>`;

  function renderHome() {
    const P = pm(),
      L = law();
    const tenancies = P.records("tenancy"),
      drafts = openDrafts(),
      past = listFrom("history"),
      returns = listFrom("depositReturns");
    const chip = { active: "ok", ready: "due", "partly-signed": "due", none: "muted", ended: "muted" };
    const tenants = tenancies
      .map((t) => {
        const status = statusOf(t.id),
          mine = drafts.filter((d) => d.tenancyId === t.id),
          name = esc(t.name || "Tenant");
        const rent = dollars(status.rent) || (Number.isSafeInteger(t.rentCents) && t.rentCents > 0 ? dollars((t.rentCents / 100).toFixed(2)) : "");
        const signing = status.state === "ready" || status.state === "partly-signed";
        const pending = status.pendingPacketId || (signing ? status.packetId : ""),
          active = status.activePacketId || (signing ? "" : status.packetId);
        const buttons = [];
        if (pending) buttons.push(act("packet", "Finish signing", pending, "primary"));
        if (active) buttons.push(act("packet", "View lease", active));
        if (mine.length) buttons.push(act("lease", "Continue lease", mine[0].id));
        else if (active && !pending && status.state === "active") buttons.push(act("renew", "Renew", active), act("amend", "Amend", active));
        else if (!pending && (status.state === "none" || status.state === "ended")) buttons.push(act("newFor", "Create lease", t.id));
        return `<article class="lh-tenant" id="lh-tenant-${esc(t.id)}" tabindex="-1"><div class="lh-tenant-text"><h3>${name}</h3><p class="lh-facts">${kit().status(chip[status.state] || "muted", status.label || "No lease on file")}${rent ? `<span>${esc(rent)} a month</span>` : ""}</p>${filled(status.detail) ? `<p class="lh-detail">${esc(status.detail)}</p>` : ""}${mine.length ? `<p class="lh-detail">Lease in progress · ${esc(draftLine(mine[0]))}</p>` : ""}</div><div class="lh-actions" role="group" aria-label="Actions for ${name}">${buttons.join("")}</div></article>`;
      })
      .join("");
    const inProgress = drafts
      .map((d) => {
        const name = esc(d.name || "Lease");
        const asking = view.confirm === d.id;
        return `<article class="lh-draft" data-draft="${esc(d.id)}"><div class="lh-tenant-text"><h3>${name}</h3><p class="lh-detail">${esc(draftLine(d))}${stampText(d._updatedAt) ? " · Edited " + esc(stampText(d._updatedAt)) : ""}</p></div>${
          asking
            ? `<div class="lh-actions" role="group" aria-label="Delete ${name}"><span class="lh-ask">Delete this draft?</span>${act("deleteDraft", "Delete", d.id, "ui-danger")}${act("keepDraft", "Keep it", d.id)}</div>`
            : `<div class="lh-actions" role="group" aria-label="Actions for ${name}">${act("lease", "Continue", d.id)}${act("deleteDraft", "Delete draft", d.id, "ui-quiet")}</div>`
        }</article>`;
      })
      .join("");
    const undo = view.undo ? `<div class="ui-note ui-note--plain lh-undo" role="status"><div><p>“${esc(view.undo.name || "Lease")}” was deleted.</p></div>${act("undoDelete", "Undo")}</div>` : "";
    const versions = past
      .map(
        (v) =>
          `<li><button type="button" class="lh-row" data-lease="packet" data-ref="${esc(v.id)}"><span class="lh-row-text"><b>${esc(v.name || "Lease")}</b><small>${esc([v.label, stampText(v.generated)].filter(Boolean).join(" · "))}</small></span>${icon("chevron", 15)}</button></li>`,
      )
      .join("");
    const returnRows = returns
      .map(
        (r) =>
          `<li><button type="button" class="lh-row" data-lease="depositReturn" data-ref="${esc(r.id)}"><span class="lh-row-text"><b>${esc(r.label || "Deposit return")}</b>${filled(r.detail) ? `<small>${esc(r.detail)}</small>` : ""}</span>${icon("chevron", 15)}</button></li>`,
      )
      .join("");
    P.content().innerHTML = `<section class="lh"><header class="workspace-heading lh-head"><div><h1>Leases</h1><p>Write a California lease in a few minutes. San Diego’s rules are built in.</p></div><div class="lh-head-actions">${act("create", icon("plus", 17) + "Create a lease", "", "primary")}${act("addExisting", "Add a lease I already have")}</div></header><div class="lh-columns"><div class="lh-main"><section class="panel lh-panel" aria-labelledby="lh-tenants"><h2 id="lh-tenants">Your tenants</h2>${
      tenants ||
      kit().empty({ icon: "leases", title: "No tenants yet", text: "Create a lease and we will add the tenant for you." })
    }</section>${
      inProgress || undo ? `<section class="panel lh-panel" aria-labelledby="lh-drafts"><h2 id="lh-drafts">In progress</h2>${undo}${inProgress}</section>` : ""
    }${
      versions
        ? `<details class="panel lh-panel lh-past"${view.past ? " open" : ""}><summary><span>Past versions</span><small>${past.length}</small></summary><ul class="lh-list">${versions}</ul></details>`
        : ""
    }</div><aside class="lh-side"><section class="panel lh-panel" aria-labelledby="lh-moving"><h2 id="lh-moving">Moving out?</h2><p>When a tenant moves out, this helper walks you through the inspection, any deductions and returning the deposit within 21 days.</p>${act("depositReturn", "Start a deposit return")}${returnRows ? `<ul class="lh-list">${returnRows}</ul>` : ""}</section><section class="panel lh-panel" aria-labelledby="lh-law"><h2 id="lh-law">What law is built in</h2><p>California and City of San Diego rules, reviewed ${esc(L.longDate(L.reviewed))}.</p>${act("rules", "See the legal sources")}</section></aside></div></section>`;
    if (view.tenant) {
      const id = view.tenant;
      view.tenant = "";
      setTimeout(() => {
        const card = document.getElementById("lh-tenant-" + id);
        card?.scrollIntoView({ block: "center" });
        card?.focus({ preventScroll: true });
      }, 0);
    }
  }

  async function deleteDraft(id) {
    const draft = pm().get(id);
    if (!draft || draft.type !== "lease") return renderHome();
    if (!toastActs() && view.confirm !== id) {
      view.confirm = id;
      renderHome();
      document.querySelector('[data-draft="' + CSS.escape(id) + '"] [data-lease="keepDraft"]')?.focus();
      return;
    }
    const scope = scopeKey();
    const stored = await pm().save("lease", { ...draft, _deleted: true });
    if (scope !== scopeKey()) return;
    view.confirm = "";
    view.undo = { record: stored, name: draft.name };
    if (routeNow() === "") renderHome();
    say("Draft deleted.", "Undo", () => restoreDraft().catch(report));
  }
  async function restoreDraft() {
    const undo = view.undo;
    if (!undo) return;
    view.undo = null;
    const scope = scopeKey();
    await pm().save("lease", { ...undo.record, _deleted: false });
    if (scope !== scopeKey()) return;
    if (routeNow() === "") renderHome();
    say("Draft restored.");
  }

  function legalSources() {
    const L = law(),
      when = L.longDate(L.reviewed);
    const rows = L.sources
      .map((s) => `<li><h3>${esc(s.title)}</h3><p>${esc(s.summary)}</p>${newTab(s.url, s.cite)}</li>`)
      .join("");
    pm().modal(
      "Legal sources",
      `<div class="lh-sources"><p class="lh-lede">The lease builder applies these California and City of San Diego rules for you. Reviewed ${esc(when)}.</p><ul>${rows}</ul>${kit().note(
        "plain",
        `<p>The builder follows California and City of San Diego requirements as reviewed on ${esc(when)}. It is not a law firm, and this is not legal advice.</p><p>Unusual situations deserve an attorney’s review: subsidized housing, mobilehomes, commercial use, or a home outside the City of San Diego.</p>`,
      )}<p class="lh-version">Version ${esc(L.version)}</p></div>`,
      { wide: true, key: "lease-legal-sources" },
    );
  }

  /* ------------------------------------------------------------------ */
  /* Opening and creating drafts                                         */
  /* ------------------------------------------------------------------ */
  function defaultHousehold() {
    const today = pm().today();
    const open = pm()
      .records("tenancy")
      .filter((t) => !(t.end && t.end < today))
      .filter((t) => ["none", "ended"].includes(statusOf(t.id).state));
    return open.length === 1 ? open[0].id : "";
  }
  async function createDraft(tenancyId) {
    const P = pm(),
      p = P.prop();
    if (!p) throw Error("Set up a rental first, then create its lease.");
    const scope = scopeKey();
    const wanted = tenancyId === undefined ? defaultHousehold() : tenancyId;
    const tenancy = P.records("tenancy").find((t) => t.id === wanted) || null;
    const all = typeof P.all === "function" ? [...P.all("lease"), ...P.all("leasePacket")] : [...P.records("lease"), ...P.records("leasePacket")];
    const draft = draftFor({ id: P.uid(), property: p, tenancy, today: P.today(), recent: recentAnswers(all, p.id), uid: P.uid });
    const stored = await P.save("lease", draft);
    if (scope !== scopeKey()) return;
    view.undo = null;
    go("draft/" + stored.id);
  }
  async function draftFromPacket(mode, packetId) {
    const P = pm(),
      packet = P.get(packetId);
    if (!packet || packet.type !== "leasePacket" || packet.propertyId !== P.prop()?.id) throw Error("That lease is no longer here.");
    const started = openDrafts().find((d) => d.parentPacket === packetId && d.origin === mode);
    if (started) return go("draft/" + started.id);
    const scope = scopeKey();
    const draft = fromPacket(packet, mode, { id: P.uid(), today: P.today(), uid: P.uid, has: (id) => Boolean(P.get(id)?.hash) });
    const stored = await P.save("lease", draft);
    if (scope !== scopeKey()) return;
    go("draft/" + stored.id);
  }
  function openDraft(id) {
    const draft = pm().get(id);
    if (!draft || draft.type !== "lease" || draft.propertyId !== pm().prop()?.id) throw Error("That lease draft is no longer here.");
    go("draft/" + id);
  }
  function unavailable() {
    throw Error("This part of Leases is not ready yet. Update the app, then try again.");
  }

  function open(action, id) {
    switch (action) {
      case "create":
        return createDraft();
      case "newFor":
        return createDraft(id || "");
      case "lease":
        return openDraft(id);
      case "packet":
        return go("packet/" + id);
      case "household":
        view.tenant = id || "";
        return go("");
      case "home":
        return go("");
      case "renew":
      case "amend":
      case "revise":
        return draftFromPacket(action, id);
      case "depositReturn":
        return typeof packets()?.depositReturn === "function" ? packets().depositReturn(id || undefined) : unavailable();
      case "addExisting":
        return typeof packets()?.addExisting === "function" ? packets().addExisting(id || undefined) : unavailable();
      case "rules":
        return legalSources();
      default:
        throw Error("That lease action is not available.");
    }
  }

  function render() {
    const P = pm();
    if (!P.prop()) {
      closeBuilder();
      P.content().innerHTML = `<section class="lh"><header class="workspace-heading"><div><h1>Leases</h1><p>Set up a rental first, then create its lease here.</p></div></header></section>`;
      return;
    }
    if (view.scope !== scopeKey()) {
      view.scope = scopeKey();
      view.confirm = "";
      view.undo = null;
      if (!hasRoutes()) view.route = "";
    }
    const [kind, id] = routeNow().split("/");
    if (kind === "draft" && id) {
      if (showBuilder(id)) return;
      forget("");
    } else if (kind === "packet" && id) {
      closeBuilder();
      if (typeof packets()?.page === "function") {
        try {
          packets().page(id);
          return;
        } catch (e) {
          report(e);
        }
      }
      forget("");
    }
    closeBuilder();
    renderHome();
  }

  /* ------------------------------------------------------------------ */
  /* Builder: saving                                                     */
  /* ------------------------------------------------------------------ */
  const contentOf = (lease) => {
    const copy = { ...lease };
    for (const key of REVISION) delete copy[key];
    return JSON.stringify(copy);
  };
  const inScope = (s) => pm().dataset() === s.scope.dataset && pm().prop()?.id === s.scope.propertyId;
  const isDirty = (s) => contentOf(s.lease) !== s.savedJson;

  /* Saves run one at a time, always with the newest _rev. Typed text stays in `s.lease` whatever happens. */
  function persist(s = B) {
    if (!s) return Promise.resolve();
    clearTimeout(s.idle);
    s.wanted = true;
    if (!s.saving)
      s.saving = (async () => {
        /* Start on the next tick, after `s.saving` is assigned. With nothing to save this function
           would otherwise finish, and clear `s.saving`, before the assignment, and saving would stop
           for good. */
        await null;
        try {
          while (s.wanted) {
            s.wanted = false;
            const body = { ...clone(s.lease), lawVersion: law().version };
            const json = contentOf(body);
            if (json === s.savedJson) continue;
            showStatus(s, "saving");
            if (!inScope(s)) throw Error("The active rental changed. Reopen the lease to continue.");
            const stored = await pm().save("lease", body);
            s.lease.lawVersion = body.lawVersion;
            if (contentOf(s.lease) === json) {
              s.lease = tidy(clone(stored), pm().uid);
              s.savedJson = contentOf(s.lease);
            } else {
              for (const key of REVISION) s.lease[key] = stored[key];
              s.savedJson = json;
              s.wanted = true;
            }
          }
          s.error = "";
          showStatus(s, "saved");
        } catch (e) {
          s.error = words(e);
          showStatus(s, "error");
          throw e;
        } finally {
          s.saving = null;
        }
      })();
    return s.saving;
  }
  function conflict(s) {
    const stored = pm().get(s.id);
    return Boolean(stored && stored._rev !== s.lease._rev);
  }
  function showStatus(s, state) {
    s.state = state;
    if (B !== s || !s.root.isConnected) return;
    const clash = state === "error" && conflict(s);
    const reason = clash ? "this lease was changed somewhere else while you were editing." : s.error;
    const html =
      state === "error"
        ? `<span class="lb-status-bad">Not saved: ${esc(reason)}</span>`
        : state === "saving"
          ? `<span>Saving…</span>`
          : `${icon("check", 14)}<span>Saved</span>`;
    if (s.status.dataset.html !== html) {
      s.status.dataset.html = html;
      s.status.dataset.state = state;
      s.status.innerHTML = html;
    }
    const alert =
      state !== "error"
        ? ""
        : clash
          ? `<p>Not saved: ${esc(reason)} Choose which version to keep.</p><div class="lb-alert-actions">${act("keepMine", "Keep this version")}${act("takeTheirs", "Use the other one")}</div>`
          : `<p>Not saved: ${esc(reason)} What you typed is still here.</p><div class="lb-alert-actions">${act("retrySave", "Try again")}</div>`;
    if (s.alert.dataset.html !== alert) {
      s.alert.dataset.html = alert;
      s.alert.innerHTML = alert;
      s.alert.hidden = !alert;
    }
  }
  function touch(s, content = true) {
    if (content) s.lease.reviewedInputs = false;
    if (s.state !== "error") showStatus(s, "saving");
    clearTimeout(s.idle);
    s.idle = setTimeout(() => persist(s).catch(noop), 3000);
  }

  /* ------------------------------------------------------------------ */
  /* Builder: updating the page without disturbing the field in use       */
  /* ------------------------------------------------------------------ */
  const keyOf = (node) => (node.nodeType === 1 ? node.getAttribute("data-k") || "" : "");
  function alike(a, b) {
    if (a.nodeType !== b.nodeType) return false;
    if (a.nodeType !== 1) return true;
    if (a.tagName !== b.tagName || keyOf(a) !== keyOf(b)) return false;
    if (a.tagName === "INPUT") return a.type === b.type && a.name === b.name && ((a.type !== "radio" && a.type !== "checkbox") || a.value === b.value);
    return true;
  }
  /* Change `from` so that its children match `to`, keeping existing nodes (and so focus, caret and clicks). */
  function patchChildren(from, to) {
    const keyed = new Map();
    for (const child of from.children) if (keyOf(child)) keyed.set(child.tagName + "|" + keyOf(child), child);
    let old = from.firstChild;
    for (let next = to.firstChild; next; ) {
      const incoming = next;
      next = next.nextSibling;
      const key = keyOf(incoming);
      let match = null;
      if (key) {
        match = keyed.get(incoming.tagName + "|" + key) || null;
        if (match) keyed.delete(incoming.tagName + "|" + key);
      } else if (old && !keyOf(old) && alike(old, incoming)) match = old;
      if (!match) {
        from.insertBefore(incoming, old);
        continue;
      }
      if (match === old) old = old.nextSibling;
      else from.insertBefore(match, old);
      patchNode(match, incoming);
    }
    while (old) {
      const gone = old;
      old = old.nextSibling;
      from.removeChild(gone);
    }
  }
  function patchNode(el, src) {
    if (el.nodeType !== 1) {
      if (el.nodeValue !== src.nodeValue) el.nodeValue = src.nodeValue;
      return;
    }
    const tag = el.tagName,
      control = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    for (const { name, value } of [...src.attributes]) {
      if (control && (name === "value" || name === "checked")) continue;
      if (el.getAttribute(name) !== value) el.setAttribute(name, value);
    }
    for (const { name } of [...el.attributes]) {
      if (src.hasAttribute(name) || (control && (name === "value" || name === "checked")) || (tag === "DETAILS" && name === "open")) continue;
      el.removeAttribute(name);
    }
    const busy = document.activeElement === el;
    if (tag === "INPUT") {
      if (el.type === "checkbox" || el.type === "radio") {
        if (el.checked !== src.hasAttribute("checked")) el.checked = src.hasAttribute("checked");
      } else if (el.type !== "file" && !busy && el.value !== (src.getAttribute("value") ?? "")) el.value = src.getAttribute("value") ?? "";
      return;
    }
    if (tag === "TEXTAREA") {
      if (!busy && el.value !== src.textContent) el.value = src.textContent;
      return;
    }
    patchChildren(el, src);
    if (tag === "SELECT" && !busy) {
      const chosen = [...el.options].find((o) => o.hasAttribute("selected"));
      if (chosen && el.value !== chosen.value) el.value = chosen.value;
    }
  }
  function morph(target, html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    patchChildren(target, template.content);
  }

  /* ------------------------------------------------------------------ */
  /* Builder: field helpers (they read C, the context of the current draw) */
  /* ------------------------------------------------------------------ */
  const idFor = (key) => "lb-" + String(key).replace(/[^a-zA-Z0-9_-]/g, "-");
  function invalid(key, c) {
    const f = c.f,
      L = law(),
      v = String(f[key] ?? "").trim();
    if (!v) return "";
    switch (key) {
      case "rent":
        return L.amount(v) === null ? MONEY_HINT : L.amount(v) > 0 ? "" : "Enter the monthly rent.";
      case "deposit":
      case "firstMonth":
        return L.amount(v) === null ? MONEY_HINT : "";
      case "lateFeeAmount":
        return L.amount(v) === null ? MONEY_HINT : L.amount(v) > 0 ? "" : "Enter the late fee, or turn it off.";
      case "built":
        return yearOf(v) && yearOf(v) >= 1600 && yearOf(v) <= Number(c.today.slice(0, 4)) ? "" : "Enter the year as four digits, for example 1985.";
      case "dueDay":
        return /^(?:[1-9]|1\d|2[0-8])$/.test(v) ? "" : "Choose a day from 1 to 28.";
      case "lateFeeDay":
        return !/^(?:[2-9]|1\d|2[0-8])$/.test(v) ? "Choose a day from 2 to 28." : Number(v) < Number(f.dueDay) ? "Choose a day on or after the day rent is due." : "";
      case "end":
        return L.isDate(v) && L.isDate(f.termStart) && v <= f.termStart ? "The end date must be after the start date." : "";
      case "noticeEmail":
        return /^\S+@\S+\.\S+$/.test(v) ? "" : "Check the email address.";
      case "zip":
        return /^\d{5}(-\d{4})?$/.test(v) ? "" : "Enter a five-digit ZIP code.";
      default:
        return key.startsWith("clause.") ? c.problems.find((x) => x.field === key)?.label || "" : "";
    }
  }
  function errorFor(key) {
    const s = C.s;
    if (key === "deposit") {
      const over = C.analysis.blockers.find((b) => b.field === "deposit");
      if (over) return over.message;
    }
    if (s.fix === key) {
      const hit = C.problems.find((x) => x.field === key);
      if (hit) return hit.label;
    }
    return s.touched.has(key) ? invalid(key, C) : "";
  }
  const fieldAttrs = (key, extra, error) =>
    `data-field="${esc(key)}"${extra ? " " + extra : ""}${error ? ` aria-invalid="true" aria-errormessage="${idFor(key)}-error"` : ""}`;
  function hold(key, html, o = {}, error = "") {
    const body = error ? html.replace('class="ui-field', 'class="ui-field is-invalid') : html;
    return `<div class="lb-f${o.wide ? " ui-wide" : ""}${o.size ? " lb-f--" + o.size : ""}" data-k="${esc(key)}">${body}${error ? `<p class="ui-error" id="${idFor(key)}-error" role="alert">${esc(error)}</p>` : ""}</div>`;
  }
  /* kind: "text" | "money" | "area" | "select". `name` is the control's name; `key` is the field name used by Fix. */
  function control(kind, key, name, value, o = {}) {
    const error = errorFor(key);
    const base = { ...o, id: idFor(key), name };
    if (kind !== "select" && !/maxlength=/.test(o.attrs || "")) o = { ...o, attrs: (o.attrs ? o.attrs + " " : "") + 'maxlength="' + (kind === "area" ? 4000 : 300) + '"' };
    let html;
    if (kind === "money") html = kit().money({ ...base, value: showMoney(value), attrs: fieldAttrs(key, 'data-t="money" maxlength="16"' + (o.attrs ? " " + o.attrs : ""), error) });
    else if (kind === "area") html = kit().textarea({ ...base, value: value ?? "", attrs: fieldAttrs(key, o.attrs, error) });
    else if (kind === "select") html = kit().select({ ...base, value: value ?? "", attrs: fieldAttrs(key, o.attrs, error) });
    else html = kit().field({ ...base, value: value ?? "", attrs: fieldAttrs(key, o.attrs, error) });
    return hold(key, html, { wide: o.wide ?? kind === "area", size: o.size }, error);
  }
  const text = (key, o) => control("text", key, "f:" + key, C.f[key], o);
  const money = (key, o) => control("money", key, "f:" + key, C.f[key], o);
  const area = (key, o) => control("area", key, "f:" + key, C.f[key], o);
  const date = (key, o) => text(key, { ...o, type: "date" });
  const tagged = (html, key) => html.replaceAll("<input ", `<input data-field="${esc(key)}" `);
  const group = (key, html) => hold(key, tagged(html, key), { wide: true }, errorFor(key));
  const choice = (key, o) => group(key, kit().seg({ ...o, id: idFor(key), name: "f:" + key, value: o.value ?? C.f[key] ?? "" }));
  const yesNo = (key, o) => choice(key, { ...o, options: YES_NO });
  const picks = (key, o) => group(key, kit().picks({ ...o, id: idFor(key), name: "f:" + key, value: C.f[key] ?? "" }));
  const chips = (key, o) => group(key, kit().chips({ ...o, id: idFor(key), name: "f:" + key, values: o.values ?? csv(C.f[key]) }));
  const toggle = (key, o) => hold(key, kit().toggle({ ...o, name: "f:" + key, checked: C.f[key] === "yes", attrs: fieldAttrs(key) }), { wide: true }, errorFor(key));
  const grid = (...items) => `<div class="ui-grid">${items.filter(Boolean).join("")}</div>`;
  const keyed = (key, html) => html.replace("<div", `<div data-k="${esc(key)}"`);
  const stack = (...items) => `<div class="ui-stack">${items.filter(Boolean).join("")}</div>`;
  const part = (key, title, body, lede = "") =>
    `<section class="lb-part" data-k="part:${esc(key)}">${title ? `<h3>${esc(title)}</h3>` : ""}${lede ? `<p class="lb-lede">${esc(lede)}</p>` : ""}${body}</section>`;
  const more = (key, summary, html) =>
    kit().more(summary, html, C.s.open.has(key)).replace("<details", `<details data-k="more:${esc(key)}" data-more="${esc(key)}"`);
  const note = (key, kind, html) => kit().note(kind, html).replace("<div", `<div data-k="note:${esc(key)}"`);
  const warningsFor = (id) => C.analysis.warnings.filter((w) => w.id === id).map((w) => note("warn:" + w.id, "warn", `<p>${esc(w.message)}</p>`)).join("");

  /* ------------------------------------------------------------------ */
  /* Step 1 · Home                                                       */
  /* ------------------------------------------------------------------ */
  function stepHome(c) {
    const f = c.f,
      L = law(),
      amend = isAmendment(c.lease);
    const address = part(
      "address",
      "Address",
      stack(
        text("premises", { label: "Street address" }),
        `<div class="lb-trio" data-k="trio">${text("unit", { label: "Unit", optional: true })}${text("city", { label: "City" })}${text("zip", { label: "ZIP", attrs: 'inputmode="numeric" maxlength="10"' })}</div>`,
        amend
          ? ""
          : yesNo("inCity", {
              label: "Is the home inside the City of San Diego?",
              help: "City rules add tenant protections. A San Diego mailing address is not always inside the city limits.",
            }) + `<p class="lb-linkrow" data-k="citylink">${newTab(L.links.cityLookup, "Check on the City’s website")}</p>`,
      ),
    );
    if (amend) return address;
    const type = f.unitType,
      duplex = type === "apartment" && f.buildingUnits === "2";
    const kind = part(
      "kind",
      "",
      stack(
        picks("unitType", { label: "What kind of home is it?", options: UNIT_TYPES }),
        type === "apartment" ? choice("buildingUnits", { label: "How many homes are in the building?", options: BUILDING_SIZES }) : "",
        type === "house" || type === "room" ? yesNo("otherUnitOnLot", { label: "Is there another rentable unit on the same lot, such as an ADU?" }) : "",
        duplex || type === "adu" || type === "room" ? yesNo("ownerOnSite", { label: "Do you live on the property?" }) : "",
        type === "room" && f.ownerOnSite === "yes" ? yesNo("sharedKitchenBath", { label: "Will the tenant share your kitchen or bathroom?" }) : "",
        f.ownerOnSite === "yes" && (type === "adu" || (type === "room" && f.sharedKitchenBath === "no"))
          ? yesNo("ownerRentsMore", { label: "Do you rent out more than two units or bedrooms on this property?", help: "Count this one. An owner who lives on the property and rents out no more than two is outside the just-cause rules." })
          : "",
      ),
    );
    const built = part(
      "built",
      "",
      stack(
        text("built", {
          label: "Year built",
          help: "For an ADU, the year the ADU was finished. Homes built before 1978 need a lead paint disclosure.",
          attrs: 'inputmode="numeric" maxlength="4"',
          size: "s",
        }),
        recentlyBuilt(f.built, c.today)
          ? date("cofo", { label: "Date on the certificate of occupancy", optional: true, help: "Homes finished in the last 15 years are exempt from the rent cap for now. Without this date, the 15 years are counted from January 1 of the year built.", size: "m" })
          : "",
      ),
    );
    const owner = part(
      "owner",
      "",
      stack(
        picks("ownerKind", { label: "Who owns it?", options: OWNER_KINDS }),
        f.ownerKind === "corp"
          ? yesNo("multipleBuildings", { label: "Does the owner have more than one rental building?", help: "This decides whether tenants must be offered rent reporting to a credit bureau." })
          : "",
      ),
    );
    const cover = c.analysis.coverage;
    const result = part(
      "result",
      "",
      `<div class="lb-result${cover.known ? (cover.cause === "applies" || cover.cap === "applies" ? " is-covered" : " is-exempt") : ""}" data-k="result" aria-live="polite">${
        cover.known
          ? `<p class="lb-result-title"><b>${esc(cover.title)}</b></p><p>${esc(cover.reason)}</p>${cover.facts?.length ? `<p class="lb-result-facts">Based on: ${esc(cover.facts.join(" · "))}</p>` : ""}`
          : `<p class="lb-result-title"><b>Which rules apply</b></p><p>Answer the questions above and this box will show which rent-increase and tenant-protection rules apply to the home.</p>`
      }</div>` +
        warningsFor("turns15") +
        warningsFor("outsideCity") +
        (cover.known
          ? more(
              "override",
              "Change this",
              choice("coverageOverride", {
                label: "Rules to apply",
                help: "Change this only if an attorney has told you the answer is different.",
                value: f.coverageOverride || "",
                options: [["", "Use this answer"], ["covered", "Treat as covered"], ...(f.ownerKind === "corp" ? [] : [["exempt", "Treat as exempt"]])],
              }),
            )
          : ""),
    );
    const extra = more(
      "home",
      "More about the home",
      stack(
        grid(
          text("parking", { label: "Parking", optional: true, help: "What comes with the home. For example: the driveway and one garage space." }),
          text("storage", { label: "Storage", optional: true, help: "Any storage included. For example: the shed in the back yard." }),
        ),
        toggle("furnished", { label: "The home is rented furnished" }),
        f.furnished === "yes" ? area("furnishings", { label: "Furniture included", optional: true, help: "For example: sofa, dining table and four chairs, queen bed." }) : "",
        toggle("hoa", { label: "Part of a homeowners association", help: "Adds a clause that the tenant follows the association’s rules." }),
        toggle("pool", { label: "Pool or spa", help: "Adds pool safety rules and asks who pays for pool service." }),
        toggle("affordable", { label: "Deed-restricted affordable housing", help: "Only if a recorded agreement limits the rent. Different rules apply." }),
        toggle("section8", { label: "Tenant uses a Section 8 voucher", help: "The housing commission’s addendum must be attached to the lease." }),
      ),
    );
    return address + kind + built + owner + result + `<section class="lb-part lb-part--more" data-k="part:more">${extra}</section>`;
  }

  /* ------------------------------------------------------------------ */
  /* Step 2 · People                                                     */
  /* ------------------------------------------------------------------ */
  function stepPeople(c) {
    const f = c.f,
      s = c.s,
      lease = c.lease,
      amend = isAmendment(lease);
    const landlord = part(
      "landlord",
      "Landlord",
      stack(
        text("landlord", { label: "Landlord name", help: "Exactly as it should appear on the lease. For two owners, write both names." }),
        hold("managed", kit().toggle({ name: "ui:managed", label: "Someone else manages the home for me", checked: s.ui.managed }), { wide: true }),
        s.ui.managed
          ? keyed(
              "manager-grid",
              grid(
                text("manager", { label: "Manager’s name", wide: true }),
                choice("signer", { label: "Who signs the lease?", value: f.signer === "manager" ? "manager" : "owner", options: [["owner", "I do"], ["manager", "The manager"]] }),
              ),
            )
          : "",
      ),
    );
    const poBox = /\bp\.?\s*o\.?\s*box\b/i.test(f.noticeAddress || "");
    const notices = amend
      ? ""
      : part(
          "notices",
          "Where the tenant can reach you",
          stack(
            text("noticeAddress", {
              label: "Street address for notices",
              help: "California requires a street address where the tenant can deliver notices and legal papers. A P.O. box is not enough.",
            }),
            poBox ? note("pobox", "warn", "<p>This looks like a P.O. box. Use a street address where papers can be handed to someone.</p>") : "",
            grid(text("noticePhone", { label: "Phone", type: "tel", attrs: 'inputmode="tel"' }), text("noticeEmail", { label: "Email", optional: true, type: "email", attrs: 'inputmode="email"' })),
          ),
        );
    const households = lease.parentPacket ? [] : c.households;
    const whoFor = households.length
      ? hold(
          "tenancyId",
          tagged(
            kit().seg({
              id: "lb-tenancyId",
              name: "lease:tenancyId",
              label: "Which tenant is this lease for?",
              help: "This keeps the lease with the right tenant’s rent and records.",
              value: lease.tenancyId,
              options: [...households.map((t) => [t.id, t.name || "Tenant"]), ["", "A new tenant"]],
            }),
            "tenancyId",
          ),
          { wide: true },
        )
      : "";
    const many = lease.tenants.length > 1;
    const rows = lease.tenants
      .map((t, i) => {
        const key = "tenant." + t.id;
        return `<div class="lb-person" data-k="t:${esc(t.id)}"><div class="lb-person-head"><h4>Tenant ${i + 1}</h4>${
          many ? `<button type="button" class="ui-quiet" data-lease="removeTenant" data-ref="${esc(t.id)}" aria-label="Remove tenant ${i + 1}${filled(t.name) ? ", " + esc(clean(t.name)) : ""}">Remove</button>` : ""
        }</div>${grid(
          control("text", i === 0 ? "tenants" : key + ".name", "t:" + t.id + ":name", t.name, { label: "Full name", wide: true, attrs: 'autocomplete="off"' }),
          control("text", key + ".email", "t:" + t.id + ":email", t.email, { label: "Email", optional: true, type: "email", attrs: 'inputmode="email" autocomplete="off"' }),
          control("text", key + ".phone", "t:" + t.id + ":phone", t.phone, { label: "Phone", optional: true, type: "tel", attrs: 'inputmode="tel" autocomplete="off"' }),
        )}</div>`;
      })
      .join("");
    const tenants = part(
      "tenants",
      "Tenants",
      stack(
        whoFor,
        `<div class="lb-people" data-k="people">${rows}</div>`,
        `<div class="lb-row" data-k="addtenant"><button type="button" data-lease="addTenant">${icon("plus", 16)}Add another tenant</button></div>`,
        amend ? "" : text("occupants", { label: "Other people living there", optional: true, help: "Children and anyone else who will live in the home but not sign." }),
      ),
      "Everyone 18 or older who will live there should be on the lease.",
    );
    return landlord + notices + tenants;
  }

  /* ------------------------------------------------------------------ */
  /* Step 3 · Rent & term                                                */
  /* ------------------------------------------------------------------ */
  function firstPaymentText(f) {
    const L = law();
    let first = null;
    try {
      first = paper().firstPayment(f);
    } catch (e) {
      console.error(e);
    }
    if (!first) return "";
    const amount = first.prorated ? (L.amount(f.firstMonth) ?? first.amount) : first.amount;
    return (
      "First payment: " + L.money(amount) + " for " + dateText(first.from, false) + " – " + dateText(first.through, false) + (first.prorated ? " (prorated)" : "") + ". After that, " + L.money(f.rent) + " on the " + paper().ordinal(f.dueDay || 1) + "."
    );
  }
  function utilityRow(key, label, f) {
    const id = idFor(key);
    return `<div class="lb-util" data-k="${key}" role="radiogroup" aria-labelledby="${id}-label"><span class="lb-util-name" id="${id}-label">${esc(label)}</span><div class="ui-options">${[["tenant", "Tenant"], ["landlord", "Landlord"]]
      .map(([value, text]) => `<label class="ui-seg"><input data-field="${key}" type="radio" name="f:${key}" value="${value}"${f[key] === value ? " checked" : ""}><span>${text}</span></label>`)
      .join("")}</div></div>`;
  }
  function stepTerms(c) {
    const f = c.f,
      L = law(),
      lease = c.lease;
    if (isAmendment(lease)) {
      const parent = lease.parentPacket ? pm().get(lease.parentPacket) : null;
      return part(
        "change",
        "",
        stack(
          parent ? note("parent", "plain", `<p>This changes the lease “${esc(parent.name || "Lease")}”${dateText(parent.generated) ? " made on " + esc(dateText(parent.generated)) : ""}. Everything you do not mention stays the same.</p>`) : "",
          area("changeText", {
            label: "What is changing?",
            help: "Write full sentences and say which part of the lease changes. For example: Starting March 1, 2027, the monthly rent is $3,350.00.",
            attrs: 'rows="6"',
          }),
          date("termStart", { label: "Date the change takes effect", size: "m" }),
          more("dates", "More options", date("agreementDate", { label: "Agreement date", help: "The date on the amendment, usually the day it is signed.", size: "m" })),
        ),
      );
    }
    const renewal = f.kind === "Renewal",
      monthly = f.kind === "Month to month";
    const presets =
      !monthly && L.isDate(f.termStart)
        ? `<div class="lb-presets" data-k="presets" role="group" aria-label="Set the end date">${[6, 12, 18, 24]
            .map((n) => {
              const on = f.end === addDays(L.addMonths(f.termStart, n), -1);
              return `<button type="button" class="lb-pill" data-lease="endPreset" data-ref="${n}" aria-pressed="${on}">${n} months</button>`;
            })
            .join("")}</div>`
        : "";
    const dates = part(
      "dates",
      "Lease type and dates",
      stack(
        renewal
          ? `<p class="lb-fixed" data-k="kindtext"><b>Lease type</b><span>Renewal of the current lease</span></p>`
          : picks("kind", { label: "Lease type", options: LEASE_KINDS }),
        renewal ? date("start", { label: "Date the tenant first moved in", help: "The original move-in date. It stays the same when a lease is renewed.", size: "m" }) : "",
        grid(date("termStart", { label: renewal ? "New term starts" : "Start date" }), monthly ? "" : date("end", { label: renewal ? "New term ends" : "End date" })),
        presets,
        more("dates", "More options", date("agreementDate", { label: "Agreement date", help: "The date on the lease, usually the day it is signed.", size: "m" })),
      ),
    );
    let first = null;
    try {
      first = paper().firstPayment(f);
    } catch (e) {
      console.error(e);
    }
    const payment = firstPaymentText(f);
    const rent = part(
      "rent",
      "Rent",
      stack(
        grid(money("rent", { label: "Monthly rent" }), text("dueDay", { label: "Rent is due on day", attrs: 'inputmode="numeric" maxlength="2" title="Day of the month, 1 to 28"' })),
        payment ? note("first", "info", `<p>${esc(payment)}</p>`) : "",
        first?.prorated
          ? more("rent", "More options", money("firstMonth", { label: "First payment", optional: true, help: "Leave blank to use the prorated amount of " + L.money(first.amount) + ".", size: "m" }))
          : "",
      ),
    );
    const cash = csv(f.payMethods).includes("cash");
    const paying = part(
      "paying",
      "",
      stack(
        chips("payMethods", {
          label: "How can the tenant pay?",
          help: "California requires at least one option that is neither cash nor electronic, so keep a check or money order.",
          options: PAY_METHODS,
        }),
        c.s.kept ? note("kept", "info", "<p>A check or money order stays on the list. California requires one way to pay that is neither cash nor electronic.</p>") : "",
        text("payDetails", { label: "Payment details", optional: true, help: "For example, the email address or phone number you use for Zelle." }),
        cash ? text("payHours", { label: "When can the tenant pay in person?", help: "Cash is paid in person, so the lease must give the days and hours. For example: weekdays, 9 a.m. to 5 p.m." }) : "",
        more(
          "paying",
          "More options",
          stack(
            text("payTo", { label: "Payable to", optional: true, help: "Leave blank to use the landlord’s name.", placeholder: clean(f.landlord) }),
            cash ? "" : text("payHours", { label: "In-person drop-off hours", optional: true, help: "Only if the tenant may pay in person. For example: weekdays, 9 a.m. to 5 p.m." }),
          ),
        ),
      ),
    );
    const fees = part(
      "fees",
      "Late and returned payments",
      stack(
        toggle("lateFee", {
          label: "Charge a late fee",
          help: "California allows only a modest estimate of what a late payment costs you, and courts have struck down larger fees. Keep it small, and never add it to a pay-or-quit notice.",
        }),
        f.lateFee === "yes" ? keyed("late-grid", grid(money("lateFeeAmount", { label: "Late fee" }), text("lateFeeDay", { label: "Rent is late after day", attrs: 'inputmode="numeric" maxlength="2"' }))) : "",
        f.lateFee === "yes" ? warningsFor("lateFee") : "",
        toggle("nsfFee", { label: "Charge for returned payments", help: "$25 the first time, $35 after that. Set by California law." }),
      ),
    );
    const limit = L.depositLimit(lease),
      rentAmount = L.amount(f.rent),
      depositAmount = L.amount(f.deposit),
      above = rentAmount !== null && depositAmount !== null && depositAmount > rentAmount;
    const deposit = part(
      "deposit",
      "",
      stack(
        money("deposit", renewal ? { label: "Security deposit you hold", help: "The deposit your tenant paid under the earlier lease. It carries over, and the renewal does not ask for it again.", size: "m" } : { label: "Security deposit", help: limit.reason, size: "m" }),
        warningsFor("depositOlder"),
        above && f.ownerKind !== "corp" ? toggle("depositSmallOwner", { label: "I own no more than two rental properties with four units in total" }) : "",
        above ? toggle("service", { label: "A tenant is an active-duty service member" }) : "",
      ),
    );
    const inCity = f.inCity === "yes";
    const billed = L.cityBilled(f).length;
    const utilities = part(
      "utilities",
      "Who pays for what?",
      stack(
        `<div class="lb-utils" data-k="utils">${UTILITIES.filter(([key]) => key !== "util_pool" || f.pool === "yes")
          .map(([key, label]) => utilityRow(key, label, f))
          .join("")}</div>`,
        inCity && f.util_trash === "tenant"
          ? note("trash", "info", "<p>The City bills trash to owners on the property-tax bill, so the tenant will reimburse you. You may charge only what the City charges you; the lease includes the City’s required notice.</p>")
          : "",
        inCity && (f.util_water === "tenant" || f.util_sewer === "tenant")
          ? toggle("utilityBilling", { label: "The water account stays in my name and I bill the tenant", help: "Leave this off if the tenant opens an account with the City." })
          : "",
        billed && f.unitType !== "house" && f.unitType !== "condo"
          ? text("utilityAllocation", { label: "How is the bill divided?", help: "For example: half of each bill, because two homes share the meter." })
          : "",
        more("utilities", "More options", area("utilNotes", { label: "Anything else about utilities", optional: true })),
      ),
    );
    const own = f.ownFridge === "yes";
    const appliances = part(
      "appliances",
      "",
      stack(
        chips("appliances", {
          label: "Appliances you provide",
          help: "The stove stays on the list. It is required by California law.",
          options: APPLIANCES,
          locked: ["stove"],
          values: csv(f.appliances).filter((a) => a !== "stove" && (a !== "refrigerator" || !own)),
        }),
        own
          ? note("fridge", "info", "<p>The tenant has asked to bring their own refrigerator. The lease will include the checkbox California requires, which the tenant marks at signing. You cannot require this.</p>")
          : "",
      ),
    );
    return dates + rent + paying + fees + deposit + utilities + appliances;
  }

  /* ------------------------------------------------------------------ */
  /* Step 4 · Rules                                                      */
  /* ------------------------------------------------------------------ */
  function blocksHtml(blocks) {
    const inline = (b) =>
      Array.isArray(b.runs) && b.runs.length
        ? b.runs.map((r) => (r && typeof r === "object" ? (r.bold ? "<b>" + esc(r.text) + "</b>" : esc(r.text)) : esc(r))).join("")
        : esc(b.text);
    return (Array.isArray(blocks) ? blocks : [])
      .map((b) => {
        if (!b || typeof b !== "object") return "";
        if (b.t === "p" || b.t === "check") return `<p>${inline(b)}</p>`;
        if (b.t === "list") return `<ul>${(b.items || []).map((item) => `<li>${esc(typeof item === "string" ? item : (item?.text ?? ""))}</li>`).join("")}</ul>`;
        if (b.t === "notice") return (b.heading ? `<p><b>${esc(b.heading)}</b></p>` : "") + [].concat(b.paras || []).map((para) => `<p>${esc(para)}</p>`).join("");
        return "";
      })
      .join("");
  }
  function wordingHtml(clause, opts, c) {
    let section = null;
    try {
      section = clause.section(c.lease, opts);
    } catch (e) {
      console.error(e);
    }
    return (
      `<div class="lb-wording">${section ? `<p class="lb-wording-head">${esc(section.heading || clause.title)}</p>` + blocksHtml(section.blocks) : "<p>The wording could not be shown.</p>"}</div>` +
      (clause.note ? `<p class="lb-why"><b>Why this wording.</b> ${esc(clause.note)}</p>` : "") +
      (clause.cite ? `<p class="lb-cite">Source: ${esc(clause.cite)}</p>` : "")
    );
  }
  function optionField(clause, option, value) {
    const key = "clause." + clause.id + "." + option.key,
      name = "o:" + clause.id + ":" + option.key,
      base = { label: option.label, help: option.help };
    if (option.type === "choice") return group(key, kit().seg({ ...base, id: idFor(key), name, value, options: option.choices }));
    if (option.type === "money") return control("money", key, name, value, { ...base, size: "m" });
    if (option.type === "longtext") return control("area", key, name, value, base);
    if (option.type === "number")
      return control("text", key, name, value, { ...base, type: "number", size: "m", attrs: `inputmode="numeric" step="1"${option.min != null ? ` min="${Number(option.min)}"` : ""}${option.max != null ? ` max="${Number(option.max)}"` : ""}` });
    return control("text", key, name, value, base);
  }
  function clauseCard(clause, mine, c) {
    const id = clause.id,
      policy = clause.level === "policy";
    const badge = clause.level === "recommended" ? kit().status("ok", "Recommended") : "";
    const head = policy
      ? `<div class="lb-clause-text"><h4>${esc(clause.title)}</h4><p>${esc(clause.summary)}</p></div>`
      : kit().toggle({ name: "c:" + id, label: clause.title, help: clause.summary, checked: mine.on, wide: false, attrs: `data-field="clause.${esc(id)}"` }) + badge;
    const fields = mine.on ? lib().fields(clause, c.lease, mine.opts).map((o) => optionField(clause, o, mine.opts[o.key])) : [];
    return `<article class="lb-clause${mine.on ? " is-on" : ""}" data-k="clause:${esc(id)}"><div class="lb-clause-head">${head}</div>${fields.length ? `<div class="lb-clause-body ui-stack">${fields.join("")}</div>` : ""}${more("w:" + id, "Read the wording", wordingHtml(clause, mine.opts, c))}</article>`;
  }
  function stepRules(c) {
    const lease = c.lease,
      s = c.s,
      state = lib().state(lease),
      find = s.ui.find.trim().toLowerCase();
    const groups = [...lib().groups];
    for (const clause of lib().library) if (!groups.some((g) => g.id === clause.group)) groups.push({ id: clause.group, title: "More clauses", blurb: "" });
    const hit = (clause, g) => !find || [clause.title, clause.summary, g.title].join(" ").toLowerCase().includes(find);
    /* Optional clauses that start switched off wait behind "More clauses you can add". */
    const extra = (clause) => clause.level === "optional" && !lib().defaults(clause, lease).on;
    const sections = groups
      .map((g) => {
        const mine = lib().library.filter((clause) => clause.group === g.id && state[clause.id] && hit(clause, g));
        const card = (clause) => clauseCard(clause, state[clause.id], c);
        const main = mine.filter((clause) => find || !extra(clause)),
          rest = find ? [] : mine.filter(extra),
          on = rest.filter((clause) => state[clause.id].on).length;
        if (!mine.length) return "";
        return `<section class="lb-part" data-k="group:${esc(g.id)}"><h3>${esc(g.title)}</h3>${g.blurb ? `<p class="lb-lede">${esc(g.blurb)}</p>` : ""}${main.length ? `<div class="lb-clauses" data-k="main">${main.map(card).join("")}</div>` : ""}${
          rest.length ? more("extra:" + g.id, "More clauses you can add (" + rest.length + ")" + (on ? " · " + on + " on" : ""), `<div class="lb-clauses">${rest.map(card).join("")}</div>`) : ""
        }</section>`;
      })
      .join("");
    const search = part(
      "find",
      "",
      hold("find", kit().field({ id: "lb-find", name: "ui:find", type: "search", label: "Find a clause", value: s.ui.find, placeholder: "For example: pets, parking, guests", attrs: 'autocomplete="off"' }), { wide: true }) +
        (find && !sections ? `<p class="lb-lede" data-k="none">No clause matches “${esc(s.ui.find.trim())}”. You can write your own below.</p>` : ""),
    );
    const own = lease.customClauses
      .map((x, i, all) => {
        const key = "custom." + x.id;
        let flags = [];
        try {
          flags = lib().redFlags((x.title || "") + "\n" + (x.text || ""));
        } catch (e) {
          console.error(e);
        }
        const what = "your clause " + (i + 1);
        return `<article class="lb-own" data-k="own:${esc(x.id)}"><div class="lb-own-head"><h4>Your clause ${i + 1}</h4><div class="lb-own-tools">${
          i > 0 ? `<button type="button" class="ui-quiet" data-k="up" data-lease="clauseUp" data-ref="${esc(x.id)}" aria-label="Move ${what} up">Move up</button>` : ""
        }${i < all.length - 1 ? `<button type="button" class="ui-quiet" data-k="down" data-lease="clauseDown" data-ref="${esc(x.id)}" aria-label="Move ${what} down">Move down</button>` : ""}<button type="button" class="ui-quiet" data-k="remove" data-lease="removeClause" data-ref="${esc(x.id)}" aria-label="Remove ${what}">Remove</button></div></div>${stack(
          control("text", key + ".title", "x:" + x.id + ":title", x.title, { label: "Title", optional: true, attrs: 'maxlength="120"' }),
          control("area", key, "x:" + x.id + ":text", x.text, { label: "Wording", attrs: 'rows="4" maxlength="6000"' }),
          flags.map((flag, n) => note("flag:" + x.id + ":" + n, "warn", `<p>${esc(flag.message)}</p><p class="lb-cite">${esc(flag.cite)}. You can keep it, but it may not be enforceable.</p>`)).join(""),
        )}</article>`;
      })
      .join("");
    const custom = `<section class="lb-part" data-k="part:own"><h3>Your own clauses</h3><p class="lb-lede">Add anything special to this home. It appears in the lease under Additional provisions.</p><div class="lb-owns" data-k="owns">${own}</div>${
      s.removed ? `<div class="ui-note ui-note--plain lb-undo" data-k="undoclause" role="status"><div><p>Clause removed.</p></div>${act("undoClause", "Undo")}</div>` : ""
    }<div class="lb-row" data-k="addclause"><button type="button" data-lease="addClause">${icon("plus", 16)}Add a clause</button></div></section>`;
    return search + sections + custom;
  }

  /* ------------------------------------------------------------------ */
  /* Step 5 · Disclosures                                                */
  /* ------------------------------------------------------------------ */
  const sourceLink = (item) => (item.url && item.cite ? newTab(item.url, item.cite) : item.cite ? `<p class="lb-cite">${esc(item.cite)}</p>` : "");
  function stepDisclosures(c) {
    const f = c.f,
      L = law(),
      items = c.analysis.items;
    const todo = (i) => i.kind === "todo" || i.state === "attention" || i.state === "reminder";
    const included = items.filter((i) => (i.state === "included" || i.state === "attached") && !todo(i));
    const waiting = items.filter((i) => i.state === "needs-answer");
    const skipped = items.filter((i) => i.state === "not-needed");
    const tasks = items.filter(todo);
    const row = (i) =>
      `<details class="lb-item" data-k="item:${esc(i.id)}" data-more="i:${esc(i.id)}"${c.s.open.has("i:" + i.id) ? " open" : ""}><summary><span class="lb-item-mark" aria-hidden="true">${icon("check", 14)}</span><span class="lb-item-text"><b>${esc(i.title)}</b><small>${esc(i.summary)}</small></span><span class="lb-vh">${i.state === "attached" ? ", attached" : ", included"}</span></summary><div class="lb-item-body"><p>${esc(i.why)}</p>${sourceLink(i)}</div></details>`;
    const done = part(
      "included",
      "Included for you",
      (included.length ? `<div class="lb-items" data-k="items">${included.map(row).join("")}</div>` : `<p class="lb-lede" data-k="noitems">Nothing yet. Finish the earlier steps and the required notices will appear here.</p>`) +
        (waiting.length
          ? `<ul class="lb-waiting" data-k="waiting">${waiting
              .map(
                (i) =>
                  `<li data-k="wait:${esc(i.id)}"><span class="lb-item-text"><b>${esc(i.title)}</b><small>${esc(i.why)}</small></span>${i.ask ? `<button type="button" data-lease="fix" data-ref="${esc(i.ask)}" aria-label="Answer: ${esc(i.title)}">Answer</button>` : ""}</li>`,
              )
              .join("")}</ul>`
          : "") +
        (skipped.length
          ? more("skipped", "Not needed for this home", `<ul class="lb-plain">${skipped.map((i) => `<li><b>${esc(i.title)}.</b> ${esc(i.why)}</li>`).join("")}</ul>`)
          : ""),
    );
    const lead = items.some((i) => i.id === "lead" && i.state !== "not-needed");
    const questions = part(
      "questions",
      "A few quick questions",
      stack(
        yesNo("floodKnown", {
          label: "Do you know the home is in a flood hazard area?",
          help: "Say yes if a public agency told you in writing, your lender requires flood insurance, or you carry flood insurance.",
        }) + `<p class="lb-linkrow" data-k="hazards">${newTab(L.links.hazards, "Look up the address")}</p>`,
        lead ? yesNo("leadKnown", { label: "Do you know of any lead-based paint or lead hazards in the home?", help: "Asked because the home was built before 1978." }) : "",
        lead && f.leadKnown === "yes" ? area("leadDetails", { label: "What you know about lead in the home" }) : "",
        lead ? yesNo("leadRecords", { label: "Do you have any reports or records about lead paint in the home?" }) : "",
        lead && f.leadRecords === "yes" ? area("leadRecordsList", { label: "Reports or records you will give the tenant" }) : "",
        yesNo("moldKnown", { label: "Do you know of mold in the home?", help: "Say yes if you know of, or have reason to believe there is, mold that could affect health." }),
        f.moldKnown === "yes" ? area("moldDetails", { label: "What you know about the mold" }) : "",
        yesNo("pestService", { label: "Does a pest control company treat the home on a regular schedule?" }),
        f.pestService === "yes" ? text("pestCompany", { label: "Pest control company", optional: true }) : "",
        more("bedbugs", "More options", text("bedbugContact", { label: "How should the tenant report bed bugs?", optional: true, help: "Leave blank to use the address and email you gave for notices." })),
      ),
    );
    const other = f.negotiatedLanguage && f.negotiatedLanguage !== "english";
    const rare = part(
      "rare",
      "Less common situations",
      stack(
        toggle("sharedMeter", { label: "The gas or electric meter also serves another area", help: "For example shared lights, a laundry room or another unit." }),
        f.sharedMeter === "yes" ? area("sharedMeterDetails", { label: "What the meter also serves, and who pays for it" }) : "",
        toggle("deathRecent", { label: "Someone died in the home in the last three years" }),
        f.deathRecent === "yes" ? area("deathDetails", { label: "What the lease should say", optional: true, help: "Never mention that anyone had HIV or AIDS." }) : "",
        toggle("demolition", { label: "You have applied for a permit to demolish the home" }),
        f.demolition === "yes" ? area("demolitionDetails", { label: "Earliest dates demolition may begin and the lease may end" }) : "",
        toggle("ordnance", { label: "A former military ordnance site is within a mile", help: "Only if you know of one." }),
        f.ordnance === "yes" ? area("ordnanceDetails", { label: "What you know about the site", optional: true }) : "",
        toggle("contamination", { label: "A health officer has issued a contamination order for the home" }),
        toggle("waterSubmeter", { label: "Tenants are billed separately for water through a submeter" }),
        toggle("ownerPesticide", { label: "You or your manager apply pesticides on a regular schedule" }),
        toggle("asbestosKnown", { label: "You know of asbestos in the home" }),
        f.asbestosKnown === "yes" ? area("asbestosDetails", { label: "What the lease should say", optional: true }) : "",
        hold("language", kit().toggle({ name: "ui:language", label: "The lease was negotiated mainly in a language other than English", checked: other }), { wide: true }),
        other ? choice("negotiatedLanguage", { label: "Which language?", help: "California requires a translated copy of the lease in this language before the tenant signs.", options: LANGUAGES }) : "",
        `<div class="lb-confirm" data-k="rareconfirm">${toggle("rareReviewed", { label: "I have gone through this list" })}</div>`,
      ),
      "Turn on anything that applies. Most homes need none of these.",
    );
    const duties = tasks.length
      ? part(
          "todo",
          "For you to do",
          `<ul class="lb-todo" data-k="todo">${tasks
            .map((i) => {
              const outside = /not part of the lease/i.test(i.why || "");
              return `<li data-k="todo:${esc(i.id)}" class="${i.state === "attention" ? "is-due" : ""}"><div class="lb-item-text"><b>${esc(i.title)}</b>${outside ? kit().status("muted", "Not part of the lease") : ""}<small>${esc(i.summary)}</small><small>${esc(i.why)}</small></div>${sourceLink(i)}</li>`;
            })
            .join("")}</ul>`,
        )
      : "";
    return done + questions + rare + duties;
  }

  /* ------------------------------------------------------------------ */
  /* Step 6 · Review & sign                                              */
  /* ------------------------------------------------------------------ */
  function attachable() {
    return pm()
      .records("document")
      .filter((d) => d.hash && !d.packetId && ["application/pdf", "image/jpeg", "image/png"].includes(d.mime))
      .sort((a, b) => String(b.created || b.date || "").localeCompare(String(a.created || a.date || "")));
  }
  function stepReview(c) {
    const lease = c.lease,
      L = law(),
      s = c.s,
      list = c.problems;
    let rows = [];
    try {
      rows = paper().summary(lease);
    } catch (e) {
      console.error(e);
    }
    const glance = part("glance", "Your lease at a glance", `<dl class="lb-glance" data-k="glance">${rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${/[[^]]+]/.test(String(value)) ? '<span class="lb-blank">Not filled in yet</span>' : esc(value)}</dd></div>`).join("")}</dl>`);
    const needed = part(
      "needed",
      list.length ? "Still needed" : "",
      list.length
        ? `<ul class="lb-needs" data-k="needs">${list
            .map(
              (x) =>
                `<li data-k="need:${esc(x.field)}"><span><small>${esc(stepLabel(lease, x.step))}</small>${esc(x.label)}</span><button type="button" data-lease="fix" data-ref="${esc(x.field)}" aria-label="Fix: ${esc(x.label)}">Fix</button></li>`,
            )
            .join("")}</ul>`
        : note("complete", "info", "<p>Everything needed is filled in. Read the lease through once, then confirm below.</p>"),
    );
    const cautions = c.analysis.warnings.length
      ? part("heads", "Heads-up", stack(c.analysis.warnings.map((w) => note("warn:" + w.id, "warn", `<p>${esc(w.message)}</p>`)).join("")))
      : "";
    const mine = lease.attachments.map((id) => ({ id, doc: pm().get(id) }));
    const choices = attachable().slice(0, 30);
    const receives = part(
      "receives",
      "What the tenant receives",
      `<ul class="lb-gives" data-k="gives"><li data-k="give:lease">${icon("leases", 18)}<span class="lb-item-text"><b>${esc(paper().title(lease))}</b><small>${isAmendment(lease) ? "One page, signed by you and the tenant." : "The lease itself, with the bed bug information sheet at the back."}</small></span></li>${c.analysis.attachments
        .map(
          (a) =>
            `<li data-k="give:${esc(a.id)}">${icon("file", 18)}<span class="lb-item-text"><b>${esc(a.name)}</b><small>${a.pages ? plural(a.pages, "page", "pages") + ". " : ""}Give it to the tenant before they sign.</small></span><a class="lb-open" href="${esc(a.path)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(a.name)} in a new tab">Open</a></li>`,
        )
        .join("")}${mine
        .map(
          ({ id, doc }) =>
            `<li data-k="give:own:${esc(id)}">${icon("file", 18)}<span class="lb-item-text"><b>${esc(doc?.name || "A file that is no longer in Documents")}</b><small>${doc ? "Your attachment" : "Remove it, or add the file again."}</small></span><button type="button" class="ui-quiet" data-lease="removeAttachment" data-ref="${esc(id)}" aria-label="Remove ${esc(doc?.name || "attachment")}">Remove</button></li>`,
        )
        .join("")}</ul>` +
        more(
          "attach",
          "Add your own attachments",
          stack(
            hold(
              "upload",
              kit().field({ id: "lb-upload", name: "upload", type: "file", label: "Upload a PDF or photo", help: "For example HOA rules or the pest company’s notice. Up to 32 MB.", attrs: 'accept="application/pdf,image/jpeg,image/png"' }),
              { wide: true },
            ),
            choices.length
              ? `<fieldset class="ui-group ui-wide" data-k="docs"><legend>Or choose from Documents</legend><div class="lb-docs">${choices
                  .map((d) => `<label class="lb-doc" data-k="doc:${esc(d.id)}"><input type="checkbox" name="att:${esc(d.id)}"${lease.attachments.includes(d.id) ? " checked" : ""}><span>${esc(d.name || d.filename || "File")}</span></label>`)
                  .join("")}</div></fieldset>`
              : "",
          ),
        ),
    );
    const ready = !list.length && lease.reviewedInputs;
    const hint = list.length
      ? plural(list.length, "thing is", "things are") + " still needed above."
      : lease.reviewedInputs
        ? "Finalizing saves this lease as it is now. To change it afterwards, you make a new version."
        : "Turn on the switch above once you have read the lease.";
    const finish = part(
      "finish",
      "",
      `<div class="lb-confirm" data-k="confirm">${hold("reviewed", kit().toggle({ name: "lease:reviewed", label: "I have read the whole lease and the terms are right.", checked: lease.reviewedInputs, attrs: 'data-field="reviewedInputs"' }), { wide: true })}</div><div class="lb-finish" data-k="finish"><button type="button" class="primary" data-lease="finalize"${ready && !s.finalizing ? "" : " disabled"}>${s.finalizing ? "Finalizing…" : "Finalize lease"}</button><button type="button" data-lease="downloadDraft">${icon("download", 16)}Download draft</button><button type="button" data-lease="print">${icon("print", 16)}Print</button></div><p class="lb-hint" data-k="hint" id="lb-finish-hint">${esc(hint)}</p><p class="lb-honest" data-k="honest">This lease follows California and City of San Diego requirements as reviewed on ${esc(L.longDate(L.reviewed))}. It is not legal advice. For anything unusual, have an attorney look it over.</p><div class="lb-row" data-k="sources">${act("rules", "See the legal sources", "", "ui-quiet")}</div>`,
    );
    return glance + needed + cautions + receives + finish;
  }
  const RENDER = [stepHome, stepPeople, stepTerms, stepRules, stepDisclosures, stepReview];

  /* ------------------------------------------------------------------ */
  /* Builder: drawing                                                    */
  /* ------------------------------------------------------------------ */
  function context(s) {
    const today = pm().today();
    let analysis;
    try {
      analysis = law().analyze(s.lease, today);
    } catch (e) {
      console.error(e);
      analysis = { coverage: { known: false, need: [] }, items: [], attachments: [], blockers: [], warnings: [] };
    }
    return { s, lease: s.lease, f: s.lease.facts, today, analysis, problems: problems(s.lease, today), households: pm().records("tenancy") };
  }
  function stepsHtml(c) {
    const shown = stepsFor(c.lease),
      now = c.lease.step;
    return `<ol>${shown
      .map((i, n) => {
        const left = c.problems.filter((x) => x.step === i).length;
        const state = i === now ? "now" : !c.s.seen.has(i) ? "todo" : left ? "needs" : "done";
        const label = stepLabel(c.lease, i);
        const says = state === "now" ? "current step" : state === "done" ? "finished" : state === "needs" ? plural(left, "thing", "things") + " still needed" : "not started";
        return `<li data-k="s${i}" class="is-${state}"><button type="button" data-lease="step" data-ref="${i}"${state === "now" ? ' aria-current="step"' : ""} aria-label="Step ${n + 1}: ${esc(label)}, ${says}" title="${esc(label)}"><span class="lb-mark" aria-hidden="true">${state === "done" ? icon("check", 14) : n + 1}${state === "needs" ? '<i class="lb-dot"></i>' : ""}</span><span class="lb-step-label" aria-hidden="true">${esc(label)}</span></button></li>`;
      })
      .join("")}</ol>`;
  }
  function footHtml(c) {
    const shown = stepsFor(c.lease),
      at = shown.indexOf(c.lease.step);
    return `${at > 0 ? `<button type="button" class="ui-quiet lb-foot-back" data-k="back" data-lease="back" aria-label="Back">${icon("back", 16)}<span>Back</span></button>` : '<span data-k="noback"></span>'}<button type="button" class="lb-foot-preview" data-k="preview" data-lease="preview">${icon("eye", 17)}Preview</button>${
      at < shown.length - 1 ? `<button type="button" class="primary lb-foot-next" data-k="next" data-lease="next">Continue</button>` : ""
    }`;
  }
  function draw() {
    const s = B;
    if (!s) return;
    s.queued = false;
    if (!s.root.isConnected) return;
    const c = (C = context(s));
    try {
      const i = c.lease.step,
        shown = stepsFor(c.lease);
      s.root.dataset.step = STEPS[i].key;
      morph(s.nav, stepsHtml(c));
      s.caption.textContent = "Step " + (shown.indexOf(i) + 1) + " of " + shown.length + " · " + stepLabel(c.lease, i);
      morph(
        s.view,
        `<div class="lb-step" data-k="step${i}${isAmendment(c.lease) ? "a" : ""}"><header class="lb-step-head"><h2 id="lb-step-title" tabindex="-1">${esc(stepLabel(c.lease, i))}</h2><p>${esc(stepIntro(c.lease, i))}</p></header>${RENDER[i](c)}</div>`,
      );
      morph(s.foot, footHtml(c));
      if (document.activeElement !== s.nameInput && s.nameInput.value !== c.lease.name) s.nameInput.value = c.lease.name;
    } finally {
      C = null;
    }
  }
  let pressing = false;
  function requestDraw() {
    const s = B;
    if (!s || s.queued) return;
    s.queued = true;
    requestAnimationFrame(() => {
      if (B === s && s.queued && !pressing) draw();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Builder: live preview of the real document                          */
  /* ------------------------------------------------------------------ */
  const SHEET_CSS = "@media screen{:host{display:block}.doc{max-width:none;margin:0;padding:clamp(18px,6%,.75in)}}";
  function sheetIn(host) {
    const root = typeof host.attachShadow === "function" ? host.shadowRoot || host.attachShadow({ mode: "open" }) : host;
    root.innerHTML = "<style>" + G.Files.docCss + SHEET_CSS + '</style><div class="sheet"></div>';
    return root.querySelector(".sheet");
  }
  function previewHtml(lease) {
    try {
      return G.Files.htmlDoc(paper().build(lease, { draft: true, today: pm().today() }));
    } catch (e) {
      console.error(e);
      return '<article class="doc"><p class="doc-p">The preview could not be drawn. Your answers are safe.</p></article>';
    }
  }
  const showing = (pane) => (pane.dialog ? pane.dialog.open : pane.scroller.offsetParent !== null);
  function drawPreview(force = false) {
    const s = B;
    if (!s) return;
    clearTimeout(s.previewTimer);
    const panes = s.panes.filter((pane) => (force ? !pane.dialog || pane.dialog.open : showing(pane)));
    if (!panes.length) return;
    const html = previewHtml(s.lease);
    for (const pane of panes) {
      const top = pane.scroller.scrollTop;
      pane.sheet.innerHTML = html;
      pane.scroller.scrollTop = top;
    }
  }
  function queuePreview() {
    const s = B;
    if (!s) return;
    clearTimeout(s.previewTimer);
    s.previewTimer = setTimeout(() => {
      if (B === s) drawPreview();
    }, 150);
  }
  function previewTo(heading) {
    const s = B;
    if (!s) return;
    const calm = G.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    for (const pane of s.panes.filter(showing)) {
      const target = heading ? [...pane.sheet.querySelectorAll(".doc-h2")].find((el) => el.textContent.replace(/^\d+\.\s*/, "") === heading) : null;
      const top = target ? target.getBoundingClientRect().top - pane.scroller.getBoundingClientRect().top + pane.scroller.scrollTop - 14 : 0;
      pane.scroller.scrollTo({ top: Math.max(0, top), behavior: calm ? "auto" : "smooth" });
    }
  }
  function openPreview(opener) {
    const s = B;
    if (!s) return;
    const pane = s.panes.find((p) => p.dialog);
    if (pane.dialog.open) return;
    s.opener = opener || document.activeElement;
    pane.dialog.showModal();
    drawPreview();
    pane.scroller.scrollTop = 0;
    previewTo(STEPS[s.lease.step].anchor);
    pane.dialog.querySelector('[data-lease="closePreview"]')?.focus();
  }
  function printLease() {
    if (!B) return;
    drawPreview(true);
    window.print();
  }

  /* ------------------------------------------------------------------ */
  /* Builder: opening and closing                                        */
  /* ------------------------------------------------------------------ */
  function showBuilder(id) {
    const P = pm(),
      p = P.prop(),
      stored = P.get(id);
    if (!stored || stored.type !== "lease" || stored.propertyId !== p.id) {
      say("That lease draft is no longer here.");
      return false;
    }
    const made = finalPacketFor(id);
    if (made && typeof packets()?.page === "function") {
      closeBuilder();
      forget("packet/" + made.id);
      packets().page(made.id);
      return true;
    }
    if (B && B.id === id && B.root.isConnected && inScope(B)) {
      /* Already open. Take a newer saved copy only when nothing here is waiting to be saved. */
      if (stored._rev !== B.lease._rev && !isDirty(B) && !B.saving) {
        B.lease = current(stored, ctx());
        B.savedJson = contentOf(B.lease);
        draw();
        drawPreview();
      }
      return true;
    }
    closeBuilder();
    const kept = unsaved.get(id);
    unsaved.delete(id);
    const recovered = Boolean(kept && kept.dataset === P.dataset() && kept.propertyId === p.id);
    const lease = recovered ? tidy(clone(kept.lease), P.uid) : current(stored, ctx());
    lease.attachments = lease.attachments.filter((x) => P.get(x)?.type === "document");
    if (lease.tenancyId && !P.records("tenancy").some((t) => t.id === lease.tenancyId)) lease.tenancyId = "";
    const upgraded = stored.schema !== 2 || lease.attachments.length !== (stored.attachments || []).length || lease.tenancyId !== (stored.tenancyId || "");
    const root = P.content();
    root.innerHTML = `<section class="lb" data-step="home"><h1 class="lb-vh">Write a lease</h1><header class="lb-head"><div class="lb-top"><a class="lb-back" href="#leases" data-lease="home">${icon("back", 16)}<span>Leases</span></a><p class="lb-status" role="status" aria-live="polite"></p></div><div class="ui-field lb-name"><label for="lb-name">Lease name</label><input id="lb-name" name="lease:name" type="text" maxlength="120" autocomplete="off" value="${esc(lease.name)}"></div><nav class="lb-steps" aria-label="Lease steps"></nav><p class="lb-caption" aria-hidden="true"></p></header><div class="lb-body"><form class="lb-form" novalidate autocomplete="off"><div class="lb-view"></div><div class="lb-foot-wrap"><div class="lb-alert" role="alert" hidden></div><div class="lb-foot"></div></div></form><aside class="lb-preview" aria-label="Lease preview"><div class="lb-preview-bar"><h2>Preview</h2><span>Updates as you type</span></div><div class="lb-paper" tabindex="0" role="region" aria-label="The lease so far"><div class="lb-sheet"></div></div></aside></div><dialog class="lb-full" aria-labelledby="lb-full-title"><div class="lb-full-bar"><h2 id="lb-full-title">Preview</h2><button type="button" data-lease="print">${icon("print", 16)}Print</button><button type="button" class="primary" data-lease="closePreview">Close</button></div><div class="lb-paper" tabindex="0" role="region" aria-label="The lease so far"><div class="lb-sheet"></div></div></dialog></section>`;
    const el = root.querySelector(".lb"),
      dialog = el.querySelector(".lb-full");
    const pane = (holder, d) => ({ dialog: d || null, scroller: holder.querySelector(".lb-paper"), sheet: sheetIn(holder.querySelector(".lb-sheet")) });
    const s = (B = {
      id,
      scope: { dataset: P.dataset(), propertyId: p.id },
      lease,
      savedJson: upgraded || recovered ? "" : contentOf(lease),
      root: el,
      status: el.querySelector(".lb-status"),
      alert: el.querySelector(".lb-alert"),
      nameInput: el.querySelector("#lb-name"),
      nav: el.querySelector(".lb-steps"),
      caption: el.querySelector(".lb-caption"),
      view: el.querySelector(".lb-view"),
      foot: el.querySelector(".lb-foot"),
      panes: [pane(el.querySelector(".lb-preview")), pane(dialog, dialog)],
      seen: new Set(stepsFor(lease).filter((i) => i <= lease.step)),
      touched: new Set(),
      open: new Set(),
      stash: {},
      ui: { managed: filled(lease.facts.manager), find: "" },
      fix: "",
      kept: false,
      removed: null,
      state: "saved",
      error: "",
      saving: null,
      wanted: false,
      queued: false,
      finalizing: false,
      opener: null,
    });
    if (lease.step === 5) stepsFor(lease).forEach((i) => s.seen.add(i));
    dialog.addEventListener("close", () => {
      const back = s.opener;
      s.opener = null;
      if (back?.isConnected) back.focus();
      else s.foot.querySelector('[data-lease="preview"]')?.focus();
    });
    el.querySelector(".lb-form").addEventListener("submit", (e) => e.preventDefault());
    s.watch = new MutationObserver(() => {
      if (!el.isConnected) closeBuilder(s);
    });
    s.watch.observe(root, { childList: true });
    showStatus(s, "saved");
    fitFooter();
    draw();
    drawPreview();
    if (upgraded || recovered) persist(s).catch(noop);
    if (recovered) say("Your last changes to this lease had not been saved. They are back on the screen.");
    if (stored.schema !== 2) say("This draft came from the earlier lease tool. Your answers were carried over. Check each step.");
    return true;
  }
  /* Leave the builder. Anything not saved yet is saved in the background. */
  function closeBuilder(s = B) {
    if (!s) return;
    if (B === s) B = null;
    s.watch?.disconnect();
    clearTimeout(s.idle);
    clearTimeout(s.previewTimer);
    for (const pane of s.panes) if (pane.dialog?.open) pane.dialog.close();
    if (isDirty(s) && inScope(s))
      persist(s)
        .then(() => {
          if (!B && inScope(s) && routeNow() === "" && pm().content().querySelector(".lh")) renderHome();
        })
        .catch((e) => {
          /* The page has already moved on. Keep the answers so that opening the lease again brings them back. */
          console.error(e);
          unsaved.set(s.id, { dataset: s.scope.dataset, propertyId: s.scope.propertyId, lease: clone(s.lease) });
          say("Your last changes to “" + (s.lease.name || "this lease") + "” could not be saved. Open the lease again to get them back.");
        });
  }
  function fitFooter() {
    if (!B) return;
    const nav = document.querySelector(".bottom-nav");
    let height = 0;
    if (nav) {
      const style = getComputedStyle(nav);
      if (style.display !== "none" && style.position === "fixed") height = Math.round(nav.getBoundingClientRect().height);
    }
    B.root.style.setProperty("--lb-nav", height + "px");
  }
  async function leave(rest) {
    const s = B;
    if (s && (isDirty(s) || s.saving)) {
      const failedBefore = s.state === "error";
      try {
        await persist(s);
      } catch (e) {
        if (!failedBefore) return; // the page now says what went wrong; a second press leaves anyway
      }
    }
    go(rest);
  }

  /* ------------------------------------------------------------------ */
  /* Builder: reading what the owner typed or chose                      */
  /* ------------------------------------------------------------------ */
  function entry(lease, id) {
    const state = lib().state(lease)[id];
    const mine = (lease.clauses[id] ??= {});
    if (typeof mine.on !== "boolean") mine.on = state ? state.on : true;
    if (!mine.opts || typeof mine.opts !== "object") mine.opts = {};
    return mine;
  }
  function setHousehold(lease, id, households, uid) {
    const before = households.find((t) => t.id === lease.tenancyId),
      after = households.find((t) => t.id === id);
    const names = lease.tenants.map((t) => clean(t.name)).filter(Boolean),
      guessed = before ? namesFrom(before.name) : [];
    lease.tenancyId = after ? after.id : "";
    if (!names.length || (guessed.length === names.length && guessed.every((n, i) => n === names[i]))) {
      const next = after ? namesFrom(after.name) : [];
      lease.tenants = (next.length ? next : [""]).map((name) => ({ id: uid(), name, email: "", phone: "" }));
    }
    if (after && !filled(lease.facts.rent) && Number.isSafeInteger(after.rentCents) && after.rentCents > 0) lease.facts.rent = parseMoney((after.rentCents / 100).toFixed(2)) || "";
  }
  function checkedList(el) {
    return [...el.form.querySelectorAll('input[type="checkbox"]')]
      .filter((x) => x.name === el.name && x.checked)
      .map((x) => x.value)
      .join(",");
  }
  function valueOf(el, committed) {
    if (el.type === "radio") return el.checked ? el.value : undefined;
    if (el.type === "checkbox") return el.getAttribute("role") === "switch" ? (el.checked ? "yes" : "no") : checkedList(el);
    if (el.dataset.t === "money") return parseMoney(el.value) ?? el.value.trim();
    return committed ? el.value.trim() : el.value;
  }
  function setFact(s, key, value, el) {
    const f = s.lease.facts;
    if (key === "payMethods") {
      let list = csv(value);
      if (!list.includes("check") && !list.includes("moneyorder")) {
        list = PAY_METHODS.map(([v]) => v).filter((v) => list.includes(v) || v === (el.value === "moneyorder" ? "moneyorder" : "check"));
        s.kept = true;
      } else s.kept = false;
      f.payMethods = list.join(",");
      return;
    }
    if (key === "appliances") {
      const list = csv(value);
      f.ownFridge = list.includes("refrigerator") ? "no" : "yes";
      f.appliances = APPLIANCES.map(([v]) => v).filter((v) => v === "stove" || list.includes(v)).join(",");
      return;
    }
    if (key === "kind" && value !== f.kind) {
      if (value === "Month to month") {
        s.stash.end = f.end || "";
        delete f.end;
      } else if (filled(s.stash.end) && !filled(f.end)) f.end = s.stash.end;
    }
    f[key] = value;
  }
  /* Put one control's value into the draft. Returns false when the control is not part of the lease. */
  function applyControl(s, el, committed) {
    const [scope, a, b] = String(el.name || "").split(":");
    const lease = s.lease,
      f = lease.facts,
      prev = { ...f },
      value = valueOf(el, committed);
    let content = true;
    if (value === undefined) return false;
    if (scope === "f") {
      setFact(s, a, value, el);
      if (committed) s.touched.add(a);
    } else if (scope === "t") {
      const tenant = lease.tenants.find((t) => t.id === a);
      if (!tenant || !["name", "email", "phone"].includes(b)) return false;
      tenant[b] = value;
    } else if (scope === "c") {
      if (!lib().get(a)) return false;
      entry(lease, a).on = el.checked;
    } else if (scope === "o") {
      const clause = lib().get(a);
      if (!clause || !(clause.options || []).some((o) => o.key === b)) return false;
      entry(lease, a).opts[b] = String(value);
      if (committed) s.touched.add("clause." + a + "." + b);
    } else if (scope === "x") {
      const own = lease.customClauses.find((x) => x.id === a);
      if (!own || !["title", "text"].includes(b)) return false;
      own[b] = value;
    } else if (scope === "lease" && a === "name") {
      lease.name = el.value;
      lease.nameEdited = filled(el.value);
      if (committed && !lease.nameEdited) lease.name = autoName(lease);
      content = false;
    } else if (scope === "lease" && a === "tenancyId") {
      setHousehold(lease, value, pm().records("tenancy"), pm().uid);
    } else if (scope === "lease" && a === "reviewed") {
      lease.reviewedInputs = el.checked;
      content = false;
    } else if (scope === "ui" && a === "managed") {
      s.ui.managed = el.checked;
      if (el.checked) {
        if (filled(s.stash.manager)) f.manager = s.stash.manager;
        if (filled(s.stash.signer)) f.signer = s.stash.signer;
      } else {
        s.stash.manager = f.manager || "";
        s.stash.signer = f.signer || "";
        delete f.manager;
        delete f.signer;
      }
    } else if (scope === "ui" && a === "language") {
      if (el.checked) f.negotiatedLanguage = s.stash.language || "spanish";
      else {
        if (f.negotiatedLanguage !== "english") s.stash.language = f.negotiatedLanguage;
        f.negotiatedLanguage = "english";
      }
    } else if (scope === "ui" && a === "find") {
      s.ui.find = el.value;
      return "view";
    } else if (scope === "att") {
      lease.attachments = el.checked ? [...new Set([...lease.attachments, a])] : lease.attachments.filter((x) => x !== a);
      content = false;
    } else return false;
    derive(lease, prev, pm().today());
    if (s.fix && scope !== "ui") s.fix = "";
    touch(s, content);
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Builder: actions                                                    */
  /* ------------------------------------------------------------------ */
  function goStep(i, field = "") {
    const s = B;
    if (!s) return;
    const shown = stepsFor(s.lease);
    const target = shown.includes(i) ? i : shown[0];
    const moved = target !== s.lease.step;
    s.lease.step = target;
    s.seen.add(target);
    if (target === 5) shown.forEach((n) => s.seen.add(n));
    s.fix = field;
    if (field) s.ui.find = "";
    if (moved) {
      s.removed = null;
      s.kept = false;
    }
    draw();
    if (moved) persist(s).catch(noop);
    if (field) focusField(field);
    else if (moved) {
      const top = s.nav.getBoundingClientRect().top;
      if (top < 0 || top > innerHeight * 0.6) window.scrollTo(0, Math.max(0, top + window.scrollY - 12));
      s.view.querySelector("#lb-step-title")?.focus({ preventScroll: true });
    }
    if (moved) previewTo(STEPS[target].anchor);
  }
  function focusField(field) {
    const s = B,
      all = [...s.view.querySelectorAll('[data-field="' + CSS.escape(field) + '"]')];
    const el = all.find((x) => x.checked) || all[0];
    if (!el) return s.view.querySelector("#lb-step-title")?.focus();
    for (let d = el.closest("details"); d; d = d.parentElement?.closest("details")) {
      if (d.dataset.more) s.open.add(d.dataset.more);
      d.open = true;
    }
    el.focus({ preventScroll: true });
    (el.closest(".lb-f") || el).scrollIntoView({ block: "center" });
  }
  function step(by) {
    const shown = stepsFor(B.lease),
      at = shown.indexOf(B.lease.step);
    goStep(shown[Math.max(0, Math.min(shown.length - 1, at + by))]);
  }
  function changed(s, content = true) {
    derive(s.lease, { ...s.lease.facts }, pm().today());
    touch(s, content);
    draw();
    queuePreview();
    persist(s).catch(noop);
  }
  function safeName(name) {
    return (
      String(name || "Lease")
        .normalize("NFC")
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
        .replace(/^\.+/, "")
        .slice(0, 100) || "Lease"
    );
  }
  async function downloadDraft() {
    const s = B;
    await persist(s).catch(noop);
    if (typeof packets()?.draft === "function") {
      const made = await packets().draft(clone(s.lease));
      return pm().download(made.blob, made.name);
    }
    const doc = paper().build(s.lease, { draft: true, today: pm().today() });
    try {
      pm().download(G.Files.pdfDoc(doc), safeName(s.lease.name) + " (draft).pdf");
    } catch (e) {
      if (e?.code !== "PDF_TEXT_UNSUPPORTED") throw e;
      pm().download(new Blob([G.Files.htmlDoc(doc, { standalone: true })], { type: "text/html" }), safeName(s.lease.name) + " (draft).html");
    }
  }
  async function finalize() {
    const s = B;
    if (typeof packets()?.finalize !== "function") unavailable();
    if (problems(s.lease, pm().today()).length || !s.lease.reviewedInputs) return draw();
    s.finalizing = true;
    s.root.inert = true;
    draw();
    try {
      await persist(s);
      const packet = await packets().finalize(clone(s.lease));
      if (!inScope(s)) return;
      s.savedJson = contentOf(s.lease);
      closeBuilder(s);
      say("Lease finalized. Next: give it to your tenant and sign.");
      go("packet/" + packet.id);
    } finally {
      s.finalizing = false;
      s.root.inert = false;
      if (B === s) draw();
    }
  }
  async function addUpload(input) {
    const s = B,
      file = input.files?.[0];
    if (!file) return;
    input.value = "";
    const types = { "application/pdf": [37, 80, 68, 70, 45], "image/jpeg": [255, 216, 255], "image/png": [137, 80, 78, 71, 13, 10, 26, 10] };
    if (!types[file.type] || !file.size || file.size > 32 * 1024 * 1024) throw Error("Choose a PDF, JPEG or PNG file up to 32 MB.");
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if (!types[file.type].every((byte, i) => head[i] === byte)) throw Error("That file is not a real PDF or photo. Choose another file.");
    if (!inScope(s)) return;
    const hash = await pm().blob(file);
    if (!inScope(s)) return;
    const doc = await pm().save("document", {
      id: pm().uid(),
      propertyId: s.scope.propertyId,
      tenancyId: s.lease.tenancyId || "",
      name: file.name,
      filename: file.name,
      kind: "Disclosure",
      mime: file.type,
      hash,
      size: file.size,
      date: pm().today(),
      created: new Date().toISOString(),
      version: 1,
      immutable: true,
    });
    s.lease.attachments = [...new Set([...s.lease.attachments, doc.id])];
    changed(s, false);
    say("Attachment added.");
  }

  const builderActions = {
    home: () => leave(""),
    step: (ref) => goStep(Number(ref)),
    next: () => step(1),
    back: () => step(-1),
    fix: (ref) => {
      const hit = problems(B.lease, pm().today()).find((x) => x.field === ref);
      const where = hit ? hit.step : (law().analyze(B.lease, pm().today()).blockers.find((b) => b.field === ref)?.step ?? B.lease.step);
      goStep(where, ref);
    },
    addTenant: () => {
      const t = { id: pm().uid(), name: "", email: "", phone: "" };
      B.lease.tenants.push(t);
      changed(B);
      B.view.querySelector('[name="t:' + t.id + ':name"]')?.focus();
    },
    removeTenant: (ref) => {
      B.lease.tenants = B.lease.tenants.filter((t) => t.id !== ref);
      if (!B.lease.tenants.length) B.lease.tenants.push({ id: pm().uid(), name: "", email: "", phone: "" });
      changed(B);
      B.view.querySelector('[data-lease="addTenant"]')?.focus();
    },
    addClause: () => {
      const x = { id: pm().uid(), title: "", text: "" };
      B.lease.customClauses.push(x);
      B.removed = null;
      changed(B);
      B.view.querySelector('[name="x:' + x.id + ':title"]')?.focus();
    },
    removeClause: (ref) => {
      const list = B.lease.customClauses,
        at = list.findIndex((x) => x.id === ref);
      if (at < 0) return;
      const [gone] = list.splice(at, 1);
      B.removed = filled(gone.text) || filled(gone.title) ? { clause: gone, at } : null;
      changed(B);
      (B.view.querySelector('[data-lease="undoClause"]') || B.view.querySelector('[data-lease="addClause"]'))?.focus();
    },
    undoClause: () => {
      if (!B.removed) return;
      B.lease.customClauses.splice(Math.min(B.removed.at, B.lease.customClauses.length), 0, B.removed.clause);
      const id = B.removed.clause.id;
      B.removed = null;
      changed(B);
      B.view.querySelector('[name="x:' + id + ':text"]')?.focus();
    },
    clauseUp: (ref) => moveClause(ref, -1),
    clauseDown: (ref) => moveClause(ref, 1),
    endPreset: (ref) => {
      const f = B.lease.facts;
      if (!law().isDate(f.termStart)) return;
      f.end = addDays(law().addMonths(f.termStart, Number(ref) || 12), -1);
      B.touched.add("end");
      changed(B);
    },
    removeAttachment: (ref) => {
      B.lease.attachments = B.lease.attachments.filter((x) => x !== ref);
      changed(B, false);
    },
    preview: (ref, el) => openPreview(el),
    closePreview: () => B.panes.find((p) => p.dialog)?.dialog.close(),
    print: () => printLease(),
    downloadDraft,
    finalize,
    retrySave: () => persist(B).catch(noop),
    keepMine: () => {
      const stored = pm().get(B.id);
      if (stored) for (const key of REVISION) B.lease[key] = stored[key];
      return persist(B).catch(noop);
    },
    takeTheirs: () => {
      const stored = pm().get(B.id);
      if (!stored) return;
      B.lease = current(stored, ctx());
      B.savedJson = contentOf(B.lease);
      B.error = "";
      showStatus(B, "saved");
      draw();
      drawPreview();
    },
  };
  function moveClause(ref, by) {
    const list = B.lease.customClauses,
      at = list.findIndex((x) => x.id === ref),
      to = at + by;
    if (at < 0 || to < 0 || to >= list.length) return;
    [list[at], list[to]] = [list[to], list[at]];
    const keep = document.activeElement?.dataset?.lease;
    changed(B);
    const card = B.view.querySelector('[data-k="own:' + CSS.escape(ref) + '"]');
    (card?.querySelector('[data-lease="' + keep + '"]') || card?.querySelector("[data-lease]"))?.focus();
  }
  const homeActions = {
    deleteDraft: (ref) => deleteDraft(ref),
    keepDraft: (ref) => {
      view.confirm = "";
      renderHome();
      document.querySelector('[data-draft="' + CSS.escape(ref) + '"] [data-lease="deleteDraft"]')?.focus();
    },
    undoDelete: () => restoreDraft(),
  };

  let busy = false;
  async function run(fn) {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (e) {
      report(e);
    } finally {
      busy = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Page-wide listeners                                                 */
  /* ------------------------------------------------------------------ */
  if (typeof document !== "undefined") {
    const inBuilder = (el) => Boolean(B && el instanceof Element && B.root.contains(el));
    document.addEventListener(
      "click",
      (e) => {
        /* Without the app's own routes, the Leases button in the menu always means the Leases home. */
        if (!hasRoutes() && e.target.closest?.('[data-nav="Leases"]')) view.route = "";
      },
      true,
    );
    document.addEventListener("click", (e) => {
      const el = e.target.closest?.("[data-lease]");
      if (!el) return;
      e.preventDefault();
      if (el.disabled) return;
      const name = el.dataset.lease,
        ref = el.dataset.ref || "";
      if (builderActions[name] && inBuilder(el)) return run(() => builderActions[name](ref, el));
      if (homeActions[name]) return run(() => homeActions[name](ref, el));
      run(() => open(name, ref));
    });
    const typed = (e, committed) => {
      const el = e.target;
      if (!inBuilder(el) || !el.name) return;
      if (el.type === "file") {
        if (committed) run(() => addUpload(el));
        return;
      }
      const s = B;
      const result = applyControl(s, el, committed);
      if (!result) return;
      requestDraw();
      if (result === "view") return;
      queuePreview();
      if (committed) persist(s).catch(noop);
    };
    document.addEventListener("input", (e) => typed(e, false));
    document.addEventListener("change", (e) => typed(e, true));
    document.addEventListener(
      "toggle",
      (e) => {
        const d = e.target;
        if (!(d instanceof HTMLElement)) return;
        if (d.classList.contains("lh-past")) view.past = d.open;
        if (!inBuilder(d) || !d.dataset.more) return;
        if (d.open) B.open.add(d.dataset.more);
        else B.open.delete(d.dataset.more);
      },
      true,
    );
    /* Do not move things under the pointer between press and release: the click would land elsewhere. */
    const released = () =>
      setTimeout(() => {
        pressing = false;
        if (B?.queued) draw();
      }, 0);
    document.addEventListener("pointerdown", () => (pressing = true), true);
    document.addEventListener("pointerup", released, true);
    document.addEventListener("pointercancel", released, true);
    window.addEventListener("blur", released);
    window.addEventListener("resize", fitFooter);
    window.addEventListener("beforeprint", () => drawPreview(true));
    const flush = () => {
      if (B && isDirty(B)) persist(B).catch(noop);
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Records from a backup                                               */
  /* ------------------------------------------------------------------ */
  function checkDrafts(records) {
    const fail = (why) => {
      throw Error("Invalid lease records. " + why);
    };
    for (const r of records || []) {
      if (!r || r.type !== "lease" || r._deleted) continue;
      if (!r.facts || typeof r.facts !== "object" || Array.isArray(r.facts) || !Object.values(r.facts).every((v) => v == null || (typeof v === "string" && v.length <= 20000))) fail("A lease draft has answers that are not text.");
      if (!Number.isInteger(r.step) || r.step < 0 || r.step > 5) fail("A lease draft has an unknown step.");
      if (!Array.isArray(r.attachments ?? []) || !Array.isArray(r.customClauses ?? []) || (r.schema === 2 && !Array.isArray(r.tenants))) fail("A lease draft is missing one of its lists.");
    }
  }
  function validateImport(records, hashes) {
    if (typeof packets()?.validateImport === "function") return packets().validateImport(records, hashes);
    return checkDrafts(records);
  }

  /* A sample draft, partly filled in, so the sample rental shows a lease in progress. */
  function seed(property, tenancy, today) {
    let n = 0;
    const uid = () => "5a3b1e9c-7d24-4c1f-9a60-" + String(++n).padStart(12, "0");
    const lease = draftFor({ id: "sample-lease-" + property.id, property, tenancy, today, recent: null, uid });
    const f = lease.facts,
      prev = { ...f },
      start = law().addMonths(String(today).slice(0, 8) + "01", 1);
    Object.assign(f, { zip: "92103", unitType: "house", otherUnitOnLot: "no", built: "1962", ownerKind: "people", termStart: start });
    derive(lease, prev, today);
    lease.step = 1;
    return [lease];
  }

  G.Leases = {
    render,
    open,
    seed,
    validateImport,
    domain: { STEPS, parseMoney, showMoney, namesFrom, autoName, utilityDefaults, suggestLate, lateDayFor, draftFor, derive, prune, tidy, upgrade, fromPacket, recentAnswers, problems, progress, stepsFor },
  };
})();
