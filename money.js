/* Local rental ledger. All stored and calculated monetary amounts are integer cents. */
(function (global) {
  "use strict";
  const pm = () => global.PM;
  const rec = (type) => pm().records(type);
  const all = (type) => (pm().all ? pm().all(type) : rec(type));
  const active = () => pm().prop()?.id || "";
  const esc = (value) => pm().esc(String(value ?? ""));
  const amt = (value) => pm().currency(value);
  const today = () => pm().today();
  const uid = () => pm().uid();
  const sum = (list, fn) =>
    list.reduce((total, row) => {
      const next = total + fn(row);
      if (!Number.isSafeInteger(next))
        throw new Error("The total exceeds the supported amount.");
      return next;
    }, 0);
  const moneyTypes = ["payment", "expense", "deposit", "writeoff"];
  const categories = {
    review: ["Needs CPA review", ""],
    advertising: ["Advertising", "5"],
    travel: ["Auto and travel", "6"],
    maintenance: ["Cleaning and maintenance", "7"],
    commissions: ["Commissions", "8"],
    insurance: ["Insurance", "9"],
    professional: ["Legal and professional fees", "10"],
    management: ["Management fees", "11"],
    interest: ["Mortgage interest paid to banks", "12"],
    otherInterest: ["Other interest", "13"],
    repairs: ["Repairs", "14"],
    supplies: ["Supplies", "15"],
    taxes: ["Property taxes", "16"],
    utilities: ["Utilities", "17"],
    depreciation: ["CPA-approved depreciation", "18"],
    other: ["Other operating expense", "19"],
    capital: ["Capital asset or improvement", ""],
    principal: ["Mortgage principal", ""],
    escrow: ["Escrow funding", ""],
    card: ["Credit-card balance payment", ""],
    transfer: ["Transfer between accounts", ""],
    contribution: ["Owner contribution", ""],
    distribution: ["Owner distribution", ""],
    loan: ["Loan proceeds", ""],
    recovery: ["Insurance recovery", ""],
    reimbursement: ["Reimbursement for review", ""],
    personal: ["Personal share", ""],
  };
  const labelCat = (key) => categories[key]?.[0] || "Needs CPA review";
  /* What the owner reads on screen: [label, one-line hint]. The labels above are the
     tax-form wording and are what the CPA files print, so the two lists stay separate. */
  const catScreen = {
    review: ["Not sure — ask my CPA", "Saved and listed for your CPA to decide."],
    advertising: ["Advertising", "Listings, signs, rental ads."],
    travel: ["Car and travel", "Driving or travel for the rental."],
    maintenance: [
      "Cleaning and upkeep",
      "Gardener, pest control, cleaning, routine upkeep.",
    ],
    commissions: ["Commissions", "Paid to an agent for finding a tenant."],
    insurance: ["Insurance", "Landlord, fire or liability premiums."],
    professional: ["Legal and professional", "Attorney, CPA, tax preparation."],
    management: [
      "Property management fees",
      "Paid to a company that manages the rental.",
    ],
    interest: ["Mortgage interest", "Usually entered through Mortgage payment."],
    otherInterest: [
      "Other loan interest",
      "Interest on another loan used for the rental.",
    ],
    repairs: ["Repairs", "Fixing what is already there."],
    supplies: ["Supplies", "Small items: bulbs, filters, paint, hardware."],
    taxes: ["Property tax", "The county property tax bill."],
    utilities: ["Utilities", "Water, trash, gas, electric that you pay."],
    depreciation: [
      "Depreciation (from my CPA)",
      "A yearly figure your CPA works out.",
    ],
    other: ["Other rental cost", "Anything that fits nowhere else."],
    capital: [
      "Big purchase or upgrade",
      "Something new that lasts years: roof, water heater, appliance.",
    ],
    principal: [
      "Mortgage principal",
      "The part of a mortgage payment that pays down the loan.",
    ],
    escrow: [
      "Mortgage escrow deposit",
      "Set aside by your lender for tax and insurance.",
    ],
    card: [
      "Paying the credit-card bill",
      "The purchases themselves were already recorded.",
    ],
    transfer: [
      "Transfer between my accounts",
      "Moving your own money. Not an expense.",
    ],
    contribution: ["Money I put in", "Your own money added to the rental."],
    distribution: ["Money I took out", "Money you moved out for yourself."],
    loan: ["Loan money received", "Money borrowed for the rental."],
    recovery: ["Insurance payout", "Money an insurer paid you for a claim."],
    reimbursement: ["Reimbursement", "Someone paid you back for a cost."],
    personal: [
      "Personal (not for the rental)",
      "The part that was for you, not the rental.",
    ],
  };
  const screenCat = (key) => catScreen[key]?.[0] || catScreen.review[0];
  const depositScreen = {
    opening: [
      "Balance carried in",
      "A deposit you already held before using this app.",
    ],
    receipt: ["Deposit received", "The tenant paid deposit money to you."],
    refund: ["Deposit returned", "You paid deposit money back to the tenant."],
    applyRent: ["Used for unpaid rent", "Kept to cover rent the tenant owed."],
    retainedIncome: [
      "Kept for damage or cleaning",
      "Kept to cover damage or cleaning. Counts as income.",
    ],
    retainedReview: [
      "Kept — ask my CPA how to report it",
      "Kept, and listed for your CPA to decide.",
    ],
    adjustment: [
      "Correct the balance",
      "Fix a wrong amount. Use a minus sign to lower it.",
    ],
  };
  function cents(value, positive = false) {
    const raw = String(value ?? "").trim();
    if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(raw))
      throw new Error("Enter a dollar amount with up to two decimal places.");
    const [d, c = ""] = raw.replace(/^[+-]/, "").split(".");
    const result =
      (Number(d) * 100 + Number(c.padEnd(2, "0"))) *
      (raw.startsWith("-") ? -1 : 1);
    if (
      !Number.isSafeInteger(result) ||
      Math.abs(result) > 999999999999 ||
      (positive && result <= 0)
    )
      throw new Error("Enter a valid amount within the supported range.");
    return result;
  }
  function dateOK(value) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value || "") ||
      +value.slice(0, 4) < 1900 ||
      +value.slice(0, 4) > 2200
    )
      return false;
    const t = new Date(value + "T12:00:00Z");
    return (
      Number.isFinite(t.getTime()) && t.toISOString().slice(0, 10) === value
    );
  }
  function date(value) {
    if (!dateOK(value)) throw new Error("Choose a valid calendar date.");
    return value;
  }
  function periodAt(value, offset = 0) {
    const y = +value.slice(0, 4),
      m = +value.slice(5, 7);
    return new Date(Date.UTC(y, m - 1 + offset, 1, 12))
      .toISOString()
      .slice(0, 7);
  }
  function dueIn(month, anchor) {
    const [y, m] = month.split("-").map(Number);
    const day = Math.min(
      +anchor.slice(-2),
      new Date(Date.UTC(y, m, 0)).getUTCDate(),
    );
    return month + "-" + String(day).padStart(2, "0");
  }
  const chargeId = (t, period) =>
    "charge:" + t.id + ":" + (t.scheduleId || "monthly") + ":" + period;
  function schedule(t, thru, existing) {
    if (
      !dateOK(t.nextDue) ||
      !Number.isSafeInteger(t.rentCents) ||
      t.rentCents <= 0
    )
      return [];
    const out = [],
      last = t.end && dateOK(t.end) && t.end < thru ? t.end : thru;
    const changes = [...(t.rentChanges || [])].sort((a, b) =>
      a.from.localeCompare(b.from),
    );
    if (
      changes.some(
        (v, i) =>
          !dateOK(v.from) ||
          !Number.isSafeInteger(v.rentCents) ||
          v.rentCents <= 0 ||
          changes[i - 1]?.from === v.from,
      )
    )
      throw new Error(
        "Review the effective dates and amounts in the rent schedule.",
      );
    let rate = t.rentCents,
      changeIndex = 0;
    for (
      let month = t.nextDue.slice(0, 7);
      month <= last.slice(0, 7);
      month = periodAt(month + "-01", 1)
    ) {
      const id = chargeId(t, month),
        dueDate = dueIn(month, t.nextDue);
      while (
        changeIndex < changes.length &&
        changes[changeIndex].from <= dueDate
      )
        rate = changes[changeIndex++].rentCents;
      if (!existing.has(id) && dueDate <= last)
        out.push({
          type: "charge",
          id,
          propertyId: t.propertyId,
          tenancyId: t.id,
          period: month,
          date: dueDate,
          amount: rate,
          ...(t.scheduleId ? { scheduleId: t.scheduleId } : {}),
        });
    }
    return out;
  }
  function scheduleFields(t = {}) {
    return {
      nextDue: t.nextDue || "",
      rentCents: t.rentCents || 0,
      scheduleId: t.scheduleId || "monthly",
      end: t.end || "",
      rentChanges: (t.rentChanges || []).map((v) => ({
        from: v.from,
        rentCents: v.rentCents,
        reason: String(v.reason || ""),
      })),
    };
  }
  function protectTermChanges(previous, incoming) {
    const events = incoming.filter((r) => r.type === "scheduleAdjustment");
    if (!events.length) return;
    const byId = new Map(previous.map((r) => [r.id, r]));
    for (const event of events) {
      if (!dateOK(event.date) || !event.reason?.trim() || !event.immutable)
        throw new Error("A dated basis is required for a schedule adjustment.");
      for (const change of event.changes) {
        const charge = byId.get(change.chargeId),
          mutation = incoming.find(
            (r) => r.type === "charge" && r.id === change.chargeId,
          );
        if (
          !mutation ||
          mutation.tenancyId !== event.tenancyId ||
          (change.action !== "scheduled" && mutation.termEventId !== event.id)
        )
          throw new Error(
            "The schedule proposal is incomplete. Reopen rental details.",
          );
        if (!charge || charge._deleted) continue;
        if (charge.date < event.date)
          throw new Error(
            "The " +
              charge.period +
              " charge is already historical. Keep its original terms and post the appropriate documented adjustment.",
          );
        const linked = previous.find(
          (r) =>
            !r._deleted &&
            ((r.allocations || []).some((a) => a.chargeId === charge.id) ||
              (r.allocationHistory || []).some((h) =>
                (h.previous || []).some((a) => a.chargeId === charge.id),
              ) ||
              r.chargeId === charge.id ||
              r.linkedChargeId === charge.id ||
              (r.type === "bankline" && r.matchedId === charge.id) ||
              (r.type === "reconciliation" &&
                (r.cleared || []).includes(charge.id))),
        );
        if (linked)
          throw new Error(
            "The " +
              charge.period +
              " charge is linked to " +
              linked.type +
              " " +
              linked.id +
              ". Review the payment and statement history. An allocated charge cannot be repriced or canceled here.",
          );
      }
    }
  }
  function termChanges(before, updated, { reason = "", from = "" } = {}) {
    const old = scheduleFields(before),
      next = scheduleFields(updated);
    if (JSON.stringify(old) === JSON.stringify(next)) return [];
    if (!updated.id || !updated.propertyId)
      throw new Error("Select a property and tenancy for the schedule.");
    if (
      before?.id &&
      (before.id !== updated.id || before.propertyId !== updated.propertyId)
    )
      throw new Error("A schedule cannot be moved to another tenancy.");
    if (
      updated.end &&
      (!dateOK(updated.end) || (updated.start && updated.end < updated.start))
    )
      throw new Error("Choose a tenancy end date on or after its start.");
    const versions = pm().chargeVersions
      ? pm().chargeVersions(updated.id)
      : all("charge").filter((c) => c.tenancyId === updated.id);
    if (
      versions.length &&
      (old.nextDue !== next.nextDue ||
        old.rentCents !== next.rentCents ||
        old.scheduleId !== next.scheduleId)
    )
      throw new Error(
        "Use a dated rent change to preserve the base schedule of an existing charge.",
      );
    const changes = next.rentChanges,
      rateChanged = JSON.stringify(changes) !== JSON.stringify(old.rentChanges);
    const asOf = today(),
      newlyChanged = changes.filter(
        (c) =>
          !old.rentChanges.some((o) => JSON.stringify(c) === JSON.stringify(o)),
      );
    if (
      rateChanged &&
      old.rentChanges.some(
        (c) =>
          c.from < asOf &&
          !changes.some((n) => JSON.stringify(c) === JSON.stringify(n)),
      )
    )
      throw new Error("A historical rent change cannot be removed or edited.");
    if (
      newlyChanged.some(
        (c) => !dateOK(c.from) || c.from < asOf || !c.reason.trim(),
      )
    )
      throw new Error(
        "Supply a current or future effective date and documented basis for each rent change.",
      );
    const source = String(reason || newlyChanged.at(-1)?.reason || "").trim();
    const establishing =
      !versions.length &&
      (!old.nextDue || !old.rentCents) &&
      next.nextDue &&
      next.rentCents > 0;
    if (!source && !establishing)
      throw new Error(
        "Enter a reason for changing the tenancy end or rent schedule.",
      );
    const effective =
      from ||
      newlyChanged[0]?.from ||
      updated.end ||
      before?.end ||
      updated.nextDue ||
      asOf;
    if (!dateOK(effective))
      throw new Error("Enter a valid schedule effective date.");
    const event = {
      type: "scheduleAdjustment",
      id: uid(),
      propertyId: updated.propertyId,
      tenancyId: updated.id,
      date: asOf,
      effectiveFrom: effective,
      reason: source || "Initial rent schedule recorded",
      before: old,
      after: next,
      immutable: true,
      changes: [],
    };
    const horizon = [periodAt(asOf, 1) + "-31", ...versions.map((c) => c.date)]
      .sort()
      .at(-1);
    const desired = schedule(updated, horizon, new Set()),
      prior = schedule(
        { ...before, propertyId: updated.propertyId, id: updated.id },
        horizon,
        new Set(),
      );
    const was = new Map(prior.map((c) => [c.id, c])),
      wanted = new Map(desired.map((c) => [c.id, c])),
      known = new Map(versions.map((c) => [c.id, c]));
    const out = [];
    for (const [id, current] of known) {
      const target = wanted.get(id),
        original = was.get(id);
      if (
        !target &&
        !current._deleted &&
        updated.end &&
        current.date > updated.end
      ) {
        event.changes.push({
          chargeId: id,
          period: current.period,
          date: current.date,
          action: "canceled",
          oldAmount: current.amount,
          newAmount: 0,
        });
        out.push({ ...current, _deleted: true, termEventId: event.id });
      } else if (target && current._deleted && current.termEventId) {
        if (current.date < asOf)
          throw new Error(
            "Reinstating a historical canceled charge requires a separately documented correction.",
          );
        event.changes.push({
          chargeId: id,
          period: current.period,
          date: current.date,
          action: "reinstated",
          oldAmount: 0,
          newAmount: target.amount,
        });
        out.push({
          ...current,
          ...target,
          _deleted: false,
          termEventId: event.id,
        });
      } else if (
        target &&
        !current._deleted &&
        original &&
        original.amount !== target.amount &&
        current.amount !== target.amount
      ) {
        event.changes.push({
          chargeId: id,
          period: current.period,
          date: current.date,
          action: "repriced",
          oldAmount: current.amount,
          newAmount: target.amount,
        });
        out.push({ ...current, amount: target.amount, termEventId: event.id });
      }
    }
    for (const target of desired)
      if (!known.has(target.id)) {
        event.changes.push({
          chargeId: target.id,
          period: target.period,
          date: target.date,
          action: "scheduled",
          oldAmount: 0,
          newAmount: target.amount,
        });
        out.push(target);
      }
    const result = [...out, event];
    protectTermChanges(
      [
        ...all("payment"),
        ...all("deposit"),
        ...all("writeoff"),
        ...all("bankline"),
        ...all("reconciliation"),
        ...versions,
      ],
      result,
    );
    return result;
  }
  function balances(charges, transactions) {
    const map = new Map(charges.map((c) => [c.id, c.amount]));
    for (const t of transactions)
      for (const a of t.allocations || []) {
        if (map.has(a.chargeId))
          map.set(a.chargeId, map.get(a.chargeId) - a.amount);
      }
    return map;
  }
  function slices(t, propertyId) {
    return (t.splits || []).filter(
      (s) => !propertyId || (s.propertyId || t.propertyId) === propertyId,
    );
  }
  function classification(t, propertyId) {
    let income = 0,
      expenses = 0,
      cash = 0,
      liability = 0,
      taxOnly = 0;
    if (t.type === "expense") {
      const splits = slices(t, propertyId);
      const amount = sum(splits, (s) => s.amount);
      cash = [
        "tenantPaid",
        "depreciation",
        "creditCard",
        "escrowDisbursement",
      ].includes(t.mode)
        ? 0
        : -sum(splits, (s) => (s.category === "transfer" ? 0 : s.amount));
      if (t.mode === "tenantPaid") income = amount;
      expenses = sum(splits, (s) =>
        categories[s.category]?.[1] && s.category !== "depreciation"
          ? s.amount
          : 0,
      );
      taxOnly = sum(splits, (s) =>
        s.category === "depreciation" ? s.amount : 0,
      );
    } else if (!propertyId || t.propertyId === propertyId) {
      if (t.type === "payment") {
        income = t.amount;
        cash = t.amount;
      }
      if (t.type === "deposit") {
        liability = t.amount;
        cash = ["receipt", "refund"].includes(t.kind) ? t.amount : 0;
        if (t.kind === "applyRent" || t.kind === "retainedIncome")
          income = -t.amount;
      }
    }
    return { income, expenses, cash, liability, taxOnly };
  }
  function accountMovement(t) {
    if (t.type === "expense")
      return ["tenantPaid", "depreciation"].includes(t.mode) ? 0 : -t.amount;
    return classification(t).cash;
  }
  function annual(year, propertyId, tx) {
    const monthly = Array.from({ length: 12 }, (_, i) => ({
      month: year + "-" + String(i + 1).padStart(2, "0"),
      income: 0,
      expenses: 0,
      cash: 0,
      taxOnly: 0,
    }));
    const cats = {},
      totals = { income: 0, expenses: 0, cash: 0, taxOnly: 0 };
    const rows = tx.filter(
      (t) =>
        t.date.slice(0, 4) === String(year) &&
        (t.propertyId === propertyId || slices(t, propertyId).length),
    );
    rows.forEach((t) => {
      const month = monthly[+t.date.slice(5, 7) - 1],
        v = classification(t, propertyId);
      for (const key of Object.keys(totals)) {
        month[key] += v[key];
        totals[key] += v[key];
      }
      for (const s of slices(t, propertyId))
        cats[s.category] = (cats[s.category] || 0) + s.amount;
    });
    return { monthly, cats, totals, rows };
  }
  function transactions() {
    return moneyTypes.flatMap((type) =>
      type === "expense"
        ? all(type).filter(
            (t) => t.propertyId === active() || slices(t, active()).length,
          )
        : rec(type),
    );
  }
  const deposits = {
    opening: "Opening balance",
    receipt: "Deposit received",
    refund: "Deposit refunded",
    applyRent: "Deposit applied to rent",
    retainedIncome: "Retained deposit · taxable",
    retainedReview: "Retained deposit · review",
    adjustment: "Liability adjustment",
  };
  /* Screen title of an entry (Home and Money lists). CPA files use `deposits` and `labelCat`. */
  const titleOf = (t) =>
    t.type === "payment"
      ? t.reverses
        ? "Rent returned"
        : "Rent payment"
      : t.type === "expense"
        ? t.vendor || "Expense"
        : t.type === "writeoff"
          ? t.reverses
            ? "Forgiven rent restored"
            : "Rent forgiven"
          : depositScreen[t.kind]?.[0] || "Security deposit";
  function summary(tx, charges, day, propertyId) {
    const period = day.slice(0, 7),
      asOf = tx.filter((t) => t.date <= day);
    const map = balances(charges, asOf),
      current = charges.filter((c) => c.period === period),
      booked = annual(day.slice(0, 4), propertyId, asOf);
    const recent = [...asOf]
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          String(b.createdAt || b.id).localeCompare(
            String(a.createdAt || a.id),
          ),
      )
      .slice(0, 12)
      .map((t) => {
        const v = classification(t, propertyId);
        return {
          id: t.id,
          title: titleOf(t),
          date: t.date,
          amount: Math.abs(v.cash),
          signedAmount: v.cash,
          type: t.type,
          category:
            t.type === "expense"
              ? screenCat(slices(t, propertyId)[0]?.category)
              : t.type === "payment"
                ? "Rent"
                : t.type === "deposit"
                  ? "Security deposit"
                  : "Forgiven rent",
        };
      });
    const due = charges
      .filter((c) => map.get(c.id) > 0)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    const charged = sum(current, (c) => c.amount),
      outstanding = sum(current, (c) => map.get(c.id) || 0);
    const written = sum(
      asOf.filter((t) => t.type === "writeoff"),
      (t) =>
        sum(
          (t.allocations || []).filter((a) =>
            current.some((c) => c.id === a.chargeId),
          ),
          (a) => a.amount,
        ),
    );
    const pastDue = sum(
        charges.filter((c) => c.date < day),
        (c) => map.get(c.id) || 0,
      ),
      dueNow = sum(
        charges.filter((c) => c.date <= day),
        (c) => map.get(c.id) || 0,
      );
    return {
      charged,
      received: charged - outstanding - written,
      allocated: charged - outstanding - written,
      writtenOff: written,
      outstanding,
      pastDue,
      dueNow,
      receivedByDate: sum(
        asOf.filter((t) => t.type === "payment" && t.date.startsWith(period)),
        (t) => t.amount,
      ),
      credit: sum(
        asOf.filter((t) => t.type === "payment"),
        (t) => t.amount - sum(t.allocations || [], (a) => a.amount),
      ),
      deposit: sum(
        asOf.filter((t) => t.type === "deposit"),
        (t) => t.amount,
      ),
      income: booked.totals.income,
      expenses: booked.totals.expenses,
      net: booked.totals.income - booked.totals.expenses,
      monthly: booked.monthly,
      recent,
      dueDate: due?.date || "",
      period,
    };
  }
  async function ensure() {
    if (!active()) return;
    const existing = new Set(rec("charge").map((c) => c.id)),
      newRows = [],
      horizon = periodAt(today(), 1) + "-31";
    for (const t of rec("tenancy")) {
      newRows.push(...schedule(t, horizon, existing));
      const id = "opening:" + t.id;
      if (t.depositCents > 0 && !pm().get(id))
        newRows.push({
          id,
          type: "deposit",
          kind: "opening",
          propertyId: active(),
          tenancyId: t.id,
          date: dateOK(t.depositDate) ? t.depositDate : today(),
          amount: t.depositCents,
          notes: "Opening liability from tenancy setup",
        });
    }
    if (newRows.length) await pm().batch(newRows);
  }
  function home(day = today()) {
    if (day.length === 7)
      day = day === today().slice(0, 7) ? today() : dueIn(day, "2000-01-31");
    const s = summary(transactions(), rec("charge"), day, active());
    const monthly = [];
    for (let i = -5; i <= 0; i++) {
      const month = periodAt(day, i),
        report = annual(
          month.slice(0, 4),
          active(),
          transactions().filter((t) => t.date <= day),
        );
      monthly.push(report.monthly[+month.slice(5) - 1]);
    }
    s.monthly = monthly;
    return s;
  }
  function seed(property, t, dateValue) {
    const propertyId = property.id,
      tenancyId = t.id,
      rows = [],
      costs = [42500, 68000, 28550, 128000, 39500, 28600];
    const sampleAge = Math.max(
      5,
      (+dateValue.slice(0, 4) -
        Number(t.start?.slice(0, 4) || dateValue.slice(0, 4))) *
        12 +
        Number(dateValue.slice(5, 7)) -
        Number(t.start?.slice(5, 7) || dateValue.slice(5, 7)),
    );
    for (let i = -sampleAge; i <= 0; i++) {
      const month = periodAt(dateValue, i),
        id = chargeId(t, month),
        day = month + "-01";
      rows.push({
        type: "charge",
        id,
        propertyId,
        tenancyId,
        date: day,
        period: month,
        amount: t.rentCents,
      });
      rows.push({
        type: "payment",
        id: "demo-pay-" + month,
        propertyId,
        tenancyId,
        date: day,
        account: "Rental checking",
        method: "Bank transfer",
        amount: t.rentCents,
        allocations: [{ chargeId: id, amount: t.rentCents }],
        notes: "Monthly rent",
      });
      const n = (((i + 5) % 6) + 6) % 6,
        amount = costs[n],
        category = [
          "maintenance",
          "insurance",
          "utilities",
          "repairs",
          "maintenance",
          "utilities",
        ][n];
      const vendor = [
        "Garden care",
        "Pacific Insurance",
        "Water utility",
        "Home repairs",
        "Garden care",
        "Water utility",
      ][n];
      const actualDay =
        month +
        "-" +
        (i === 0
          ? String(Math.min(12, +dateValue.slice(-2))).padStart(2, "0")
          : "12");
      rows.push({
        type: "expense",
        id: "demo-exp-" + month,
        propertyId,
        date: actualDay,
        account: "Rental checking",
        vendor,
        amount,
        mode: "expense",
        splits: [{ category, amount, propertyId }],
        notes: [
          "Landscape maintenance",
          "Monthly insurance",
          "Water and sewer",
          "Plumbing repair",
          "Landscape maintenance",
          "Water and sewer",
        ][n],
        attachments: [],
      });
    }
    if (t.depositCents > 0)
      rows.push({
        type: "deposit",
        kind: "opening",
        id: "opening:" + t.id,
        propertyId,
        tenancyId,
        date: t.start || rows[0].date,
        amount: t.depositCents,
        notes: "Refundable opening balance",
      });
    return rows;
  }
  function csvCell(v) {
    const original = String(v ?? "");
    const val =
      typeof v === "string" && /^[\s]*[=+@-]|^[\t\r\n]/.test(original)
        ? "'" + original
        : original;
    return '"' + val.replace(/"/g, '""') + '"';
  }
  const csv = (rows) =>
    "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  function parseCsv(text) {
    text = text.replace(/^\uFEFF/, "");
    let value = "",
      row = [],
      rows = [],
      quoted = false,
      closed = false;
    function next() {
      row.push(value);
      value = "";
      closed = false;
    }
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            value += '"';
            i++;
          } else {
            quoted = false;
            closed = true;
          }
        } else value += c;
        continue;
      }
      if (c === ",") {
        next();
        continue;
      }
      if (c === "\r" || c === "\n") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        next();
        if (row.some((v) => v.trim() !== "")) rows.push(row);
        row = [];
        continue;
      }
      if (closed || (c === '"' && value))
        throw new Error("Invalid CSV quoting.");
      if (c === '"') quoted = true;
      else value += c;
    }
    if (quoted) throw new Error("A CSV field is missing its closing quote.");
    next();
    if (row.some((v) => v.trim() !== "")) rows.push(row);
    if (rows.length < 2 || rows.length > 5001)
      throw new Error("Choose a CSV with a header and 1–5,000 data rows.");
    if (rows.some((r) => r.length !== rows[0].length))
      throw new Error("All rows must have the same number of columns.");
    return rows;
  }
  function allocate(amount, portions, available) {
    const ids = new Set();
    for (const a of portions) {
      if (
        !Number.isSafeInteger(a.amount) ||
        a.amount <= 0 ||
        ids.has(a.chargeId) ||
        !available.has(a.chargeId) ||
        a.amount > available.get(a.chargeId)
      )
        throw new Error(
          "An allocation exceeds the open charge or is repeated.",
        );
      ids.add(a.chargeId);
    }
    if (sum(portions, (a) => a.amount) > amount)
      throw new Error("Allocated rent exceeds the payment amount.");
    return portions;
  }
  function validateSplits(amount, splits) {
    if (
      !splits.length ||
      splits.some(
        (s) =>
          !Object.hasOwn(categories, s.category) ||
          !Number.isSafeInteger(s.amount) ||
          s.amount <= 0,
      ) ||
      sum(splits, (s) => s.amount) !== amount
    )
      throw new Error(
        "The split amounts must add up to the transaction total.",
      );
    return splits;
  }
  const mapping = (year) =>
    String(year) === "2025"
      ? "2025 Schedule E Part I · reviewed 2026-11-18"
      : "Provisional " +
        year +
        " crosswalk based on the 2025 Schedule E · CPA review required";
  const model = {
    categories,
    cents,
    dateOK,
    schedule,
    balances,
    classification,
    annual,
    summary,
    allocate,
    validateSplits,
    parseCsv,
    csv,
    mapping,
    chargeId,
  };
  /* ------------------------------------------------------------------
     Screens. Everything below this line runs in the browser only. It does
     not change the arithmetic or the stored records above: it chooses the
     words, fills in what the app already knows, and asks for less.
     ------------------------------------------------------------------ */
  const byId = (id) => document.getElementById(id);
  const kit = () => global.UI;
  const icon = (name, size = 18) =>
    typeof global.ico === "function" ? global.ico(name, size) : "";
  const attrText = (o) =>
    Object.entries(o || {})
      .map(([k, v]) =>
        v === false || v == null
          ? ""
          : v === true
            ? " " + k
            : " " + k + '="' + esc(v) + '"',
      )
      .join("");
  /* h("p", {class: "x"}, "trusted html") builds an element; attribute values are escaped,
     children are trusted markup, so pass text through esc() first. */
  const h = (tag, a, ...kids) =>
    "<" +
    tag +
    attrText(a) +
    ">" +
    kids
      .flat()
      .filter((kid) => kid != null && kid !== false)
      .join("") +
    "</" +
    tag +
    ">";
  const hv = (tag, a) => "<" + tag + attrText(a) + ">";
  const dateText = (value, options) => {
    const parsed = new Date(String(value || "").slice(0, 10) + "T12:00:00Z");
    return Number.isFinite(+parsed)
      ? new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(
          parsed,
        )
      : String(value || "");
  };
  const longDate = (value) =>
    dateText(value, { month: "short", day: "numeric", year: "numeric" });
  const shortDate = (value) =>
    dateText(value, { month: "short", day: "numeric" });
  const monthName = (period) =>
    dateText(String(period || "").slice(0, 7) + "-01", {
      month: "long",
      year: "numeric",
    });
  const dayNumber = (value) =>
    Math.round(Date.parse(value + "T12:00:00Z") / 86400000);
  const shiftDay = (value, days) =>
    new Date(Date.parse(value + "T12:00:00Z") + days * 86400000)
      .toISOString()
      .slice(0, 10);
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many || one + "s");
  const joinAnd = (list) =>
    list.length < 3
      ? list.join(" and ")
      : list.slice(0, -1).join(", ") + " and " + list.at(-1);
  const signed = (value) => (value > 0 ? "+" : "") + amt(value);
  const inputAmount = (value) => (value ? (value / 100).toFixed(2) : "");
  /* Amounts typed by a person: a leading "$" and thousands commas are fine. */
  function typed(value) {
    let raw = String(value ?? "")
      .trim()
      .replace(/^([+-]?)\$\s*/, "$1");
    if (/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(raw))
      raw = raw.replace(/,/g, "");
    return raw;
  }
  function fieldError(name, message) {
    const error = new Error(message);
    error.field = name;
    return error;
  }
  function entered(value, positive = false, name = "", blank = "") {
    const raw = typed(value);
    let message = "";
    if (raw === "") message = blank || "Enter the amount.";
    else if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(raw))
      message = "Enter an amount like 1250 or 1250.50.";
    else
      try {
        const result = cents(raw);
        if (positive && result <= 0)
          message = "Enter an amount greater than zero.";
        else return result;
      } catch (e) {
        message = e.message;
      }
    throw fieldError(name, message);
  }
  /* The amount in a box while the person is still typing: null when it cannot be read. */
  const peek = (value) => {
    const raw = typed(value);
    if (raw === "") return 0;
    try {
      return cents(raw);
    } catch {
      return null;
    }
  };
  const val = (fd, name) => String(fd.get(name) ?? "").trim();
  function dateOf(fd, name, message = "Choose a date.") {
    const value = String(fd.get(name) || "");
    if (!dateOK(value)) throw fieldError(name, message);
    return value;
  }
  const button = (action, label, o = {}) =>
    h(
      "button",
      {
        type: "button",
        class: "mf-button" + (o.cls ? " " + o.cls : ""),
        "data-money": action,
        "data-id": o.id,
        "data-with": o.with,
        "aria-label": o.aria,
      },
      o.icon ? icon(o.icon, 17) : "",
      esc(label),
    );
  const note = (s) => h("p", { class: "mf-note" }, esc(s));
  const lead = (s) => h("p", { class: "mf-lead" }, esc(s));
  const listWrap = (html) => h("div", { class: "mf-list" }, html);
  const emptyRow = (s) => h("div", { class: "mf-empty" }, esc(s));
  const subhead = (title, extra = "") =>
    h("div", { class: "mf-subhead" }, h("h2", null, esc(title)), extra);
  const facts = (rows) =>
    h(
      "dl",
      { class: "mf-dl" },
      rows
        .filter(([, value]) => value != null && value !== "")
        .map(([key, value]) => h("dt", null, esc(key)) + h("dd", null, esc(value))),
    );
  /* One line in a list: title, a small second line, and an amount or status on the right. */
  function row(o) {
    return h(
      "button",
      {
        type: "button",
        class: "mf-row",
        "data-money": o.action,
        "data-id": o.id,
        "data-with": o.with,
      },
      o.icon
        ? h(
            "span",
            { class: "mf-ico" + (o.tone ? " " + o.tone : ""), "aria-hidden": "true" },
            icon(o.icon, 18),
          )
        : "",
      h(
        "span",
        { class: "mf-grow" },
        h("strong", null, esc(o.title)),
        o.sub ? h("small", null, esc(o.sub)) : "",
      ),
      o.value != null || o.status
        ? h(
            "span",
            { class: "mf-right" },
            o.value != null
              ? h("b", { class: "mf-amount" + (o.plus ? " plus" : "") }, esc(o.value))
              : "",
            o.status
              ? h("small", { class: o.statusTone ? "mf-" + o.statusTone : null }, esc(o.status))
              : "",
          )
        : "",
      h("span", { class: "mf-chev", "aria-hidden": "true" }, icon("chevron", 15)),
    );
  }
  /* A choice with a line of explanation, used for menus of actions. */
  const choiceRow = (action, title, description, o = {}) =>
    h(
      "button",
      {
        type: "button",
        class: "mf-choice",
        "data-money": o.act ? null : action,
        "data-act": o.act ? action : null,
        "data-id": o.id,
        "data-with": o.with,
      },
      h(
        "span",
        { class: "mf-grow" },
        h("strong", null, esc(title)),
        description ? h("small", null, esc(description)) : "",
      ),
      h("span", { class: "mf-chev", "aria-hidden": "true" }, icon("chevron", 15)),
    );

  /* ---- Errors: beside the field when we know which one, in plain words ---- */
  const plainMessages = [
    [
      /^Allocated rent exceeds the payment amount\.$/,
      "The months add up to more than the payment.",
    ],
    [
      /^An allocation exceeds the open charge or is repeated\.$/,
      "That is more than is still owed for that month.",
    ],
    [
      /combined allocations overstate rent collected/,
      "That is more than is still owed for that month.",
    ],
    [
      /deposit liability would become negative/,
      "That is more than the deposit you were holding on that date.",
    ],
    [
      /combined rent returns exceed/,
      "That is more than is left of this payment or of that month.",
    ],
    [/statement periods overlap/, "This account was already checked for part of these dates."],
    [
      /exceeds the 192 MiB/,
      "The receipts you chose are too large for one packet. Open Receipts and documents to include, untick some, and send those separately.",
    ],
    [
      /^Missing stored original for (.*). Restore the file/,
      (found) =>
        "The file “" +
        found[1] +
        "” is missing from this device. Untick it under Receipts and documents to include, then try again.",
    ],
    [
      /bank match is duplicated or disagrees/,
      "That entry is already matched to another bank transaction, or its amount or account is different.",
    ],
  ];
  function friendly(e) {
    const raw = e?.message || String(e || "");
    if (!raw) return "That did not work. Please try again.";
    for (const [pattern, words] of plainMessages) {
      const found = pattern.exec(raw);
      if (found) return typeof words === "function" ? words(found) : words;
    }
    const ledger = /^Ledger validation: (.*)$/.exec(raw);
    return ledger
      ? "This was not saved because it does not fit with your other records (" +
          ledger[1].replace(/\.$/, "") +
          ")."
      : raw;
  }
  const named = (form, name) =>
    form.querySelector('[name="' + String(name).replace(/["\\]/g, "\\$&") + '"]');
  function clearErrors(form, target) {
    const scope =
      target?.closest?.(".ui-field, .ui-group, .mf-check, .mf-receipt") || form;
    for (const node of scope.querySelectorAll("[data-mf-error]")) node.remove();
    for (const node of scope.querySelectorAll(".is-invalid"))
      node.classList.remove("is-invalid");
    scope.classList?.remove("is-invalid");
    for (const node of scope.querySelectorAll("[aria-invalid]"))
      node.removeAttribute("aria-invalid");
    const out = form.querySelector("#mf-error");
    if (out) out.hidden = true;
  }
  function failure(e, form) {
    const message = friendly(e);
    form = form || byId("mf-form");
    if (!form) return pm().toast(message);
    clearErrors(form);
    const input = e?.field ? named(form, e.field) : null;
    const holder = input?.closest(".ui-field, .ui-group, .mf-check");
    if (input && holder && !holder.closest("[hidden]")) {
      for (let d = holder.closest("details"); d; d = d.parentElement?.closest("details"))
        d.open = true;
      holder.classList.add("is-invalid");
      const line = document.createElement("p");
      line.className = "ui-error";
      line.setAttribute("role", "alert");
      line.dataset.mfError = "1";
      line.textContent = message;
      holder.append(line);
      input.setAttribute("aria-invalid", "true");
      holder.scrollIntoView?.({ block: "center" });
      input.focus?.({ preventScroll: true });
      return;
    }
    const out = form.querySelector("#mf-error");
    if (out) {
      out.hidden = false;
      out.textContent = message;
      out.scrollIntoView?.({ block: "nearest" });
    } else pm().toast(message);
  }

  /* ---- Dialogs ---- */
  /* Every Money dialog opens through show(). A dialog opened from inside another one gets
     the app's Back button. The app only knows a few Money actions by name, so each dialog
     says how to reopen itself as the action "activity" with an id that open() unpacks. */
  let serial = 0,
    opening = null,
    selfNow = null,
    selfTitle = "",
    nextBack = null;
  function show(title, html, o = {}) {
    const back = nextBack,
      self = o.self === undefined ? opening : o.self;
    nextBack = null;
    const body = pm().modal(title, html, { ...o, self, ...(back ? { back } : {}) });
    selfNow = self;
    selfTitle = title;
    return body;
  }

  /* ---- Forms ---- */
  function formDialog(title, body, submitLabel, onSubmit, key = "", o = {}) {
    show(
      title,
      h(
        "form",
        { id: "mf-form", class: "mf-form", novalidate: true },
        o.intro ? h("p", { class: "mf-intro" }, esc(o.intro)) : "",
        body,
        '<p id="mf-error" role="alert" class="ui-error" hidden></p>',
        h(
          "div",
          { class: "mf-foot" },
          o.foot || "",
          submitLabel
            ? h("button", { type: "submit", class: "mf-primary" }, esc(submitLabel))
            : "",
        ),
      ),
      /* A new key each time: the app shell's own form memory must not put old values back.
         Money keeps what was typed itself (bindDraft) so it can say so and offer "Start over". */
      {
        key: (key || title) + "#" + ++serial,
        wide: Boolean(o.wide),
        onClose: o.onClose,
        self: o.self,
      },
    );
    const form = byId("mf-form");
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (form.dataset.busy) return;
      form.dataset.busy = "1";
      const submit = form.querySelector("[type=submit]");
      if (submit) submit.disabled = true;
      try {
        clearErrors(form);
        await onSubmit(new FormData(form), form);
        if (key) delete drafts[key];
      } catch (e) {
        failure(e, form);
      } finally {
        delete form.dataset.busy;
        if (submit && !submit.dataset.hold) submit.disabled = false;
      }
    });
    const tidy = (ev) => {
      if (ev.target?.name) clearErrors(form, ev.target);
      if (ev.target?.name === "account") {
        syncAccount(form);
        if (ev.type === "change" && ev.target.value === "" && ev.target.checked)
          form.elements.accountOther?.focus();
      }
    };
    form.addEventListener("input", tidy);
    form.addEventListener("change", tidy);
    syncAccount(form);
    return form;
  }
  function finish(msg) {
    pm().close();
    pm().refresh();
    pm().toast(msg);
  }
  /* What was typed in a form that was closed without saving, kept until the app is closed. */
  const drafts = {};
  const draftable = (e) =>
    e.name && !["file", "submit", "button", "hidden"].includes(e.type);
  const checkable = (e) => e.type === "radio" || e.type === "checkbox";
  const readValues = (form) =>
    Array.from(form.elements)
      .filter(draftable)
      .map((e) => ({
        name: e.name,
        value: e.value,
        on: checkable(e) ? e.checked : null,
      }));
  function applyValues(form, fields) {
    const pool = fields.slice();
    for (const e of Array.from(form.elements).filter(draftable)) {
      const i = pool.findIndex(
        (s) => s.name === e.name && (!checkable(e) || s.value === e.value),
      );
      if (i < 0) continue;
      const [saved] = pool.splice(i, 1);
      if (checkable(e)) e.checked = Boolean(saved.on);
      else if (
        e.tagName !== "SELECT" ||
        Array.from(e.options).some((option) => option.value === saved.value)
      )
        e.value = saved.value;
    }
  }
  /* o.before(saved) rebuilds any rows the saved values need; o.after(restored) brings
     dependent parts of the form in line; o.extra() adds state that is not in a field;
     o.reopen() opens the same form again from scratch. */
  function bindDraft(form, key, o = {}) {
    const saved = drafts[key];
    if (saved) {
      o.before?.(saved);
      applyValues(form, saved.fields);
      syncAccount(form);
      form.insertAdjacentHTML(
        "afterbegin",
        h(
          "div",
          { class: "mf-resume", role: "status" },
          h("span", null, "Continuing where you left off."),
          h("button", { type: "button", class: "mf-button mf-quiet", id: "mf-startover" }, "Start over"),
        ),
      );
      byId("mf-startover").onclick = () => {
        delete drafts[key];
        pm().close();
        o.reopen?.();
      };
    }
    o.after?.(Boolean(saved), saved);
    const remember = () => {
      drafts[key] = { fields: readValues(form), extra: o.extra?.() || {} };
    };
    form.addEventListener("input", remember);
    form.addEventListener("change", remember);
    form.remember = remember;
    return Boolean(saved);
  }
  const dkey = (name) => [pm().dataset(), active(), name].join(":");
  function sameWorkspace(key) {
    if (dkey("") !== key)
      throw new Error(
        "You switched to another property. Close this and open it again from the original property.",
      );
  }
  const base = (type, id = uid()) => ({
    id,
    propertyId: active(),
    type,
    createdAt: new Date().toISOString(),
  });
  const sorted = (rows) =>
    [...rows].sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        String(b.createdAt || b.id).localeCompare(String(a.createdAt || a.id)),
    );

  /* ---- Tenants ---- */
  const tenantName = (id) => pm().get(id)?.name || "Your tenant";
  const needTenancy = () => {
    if (rec("tenancy").length) return false;
    show(
      "Add a tenant first",
      h(
        "div",
        { class: "mf-form" },
        h(
          "p",
          { class: "mf-intro" },
          "Rent and deposits are recorded against a tenant. Add your tenant and their rent, then come back.",
        ),
        h(
          "div",
          { class: "mf-foot" },
          h("button", { type: "button", class: "mf-primary", "data-act": "new-household" }, "Add a tenant"),
        ),
      ),
    );
    return true;
  };
  /* Not asked when there is one tenant; pills for two or three; a list beyond that. */
  function tenantField(value, label, list = rec("tenancy")) {
    if (list.length < 2)
      return hv("input", { type: "hidden", name: "tenancyId", value: list[0]?.id || value });
    const options = list.map((t) => [t.id, t.name || "Tenant"]);
    return list.length <= 3
      ? kit().seg({ label, name: "tenancyId", options, value })
      : kit().select({ label, name: "tenancyId", options, value, wide: true });
  }
  const tenantOf = (fd) => {
    const id = fd.get("tenancyId");
    if (pm().get(id)?.type !== "tenancy")
      throw fieldError("tenancyId", "Choose the tenant.");
    return id;
  };
  /* Months with rent still unpaid, oldest first, counting everything recorded so far. */
  function openCharges(tenancyId) {
    const charges = rec("charge").filter((c) => c.tenancyId === tenancyId),
      map = balances(charges, transactions());
    return charges
      .filter((c) => map.get(c.id) > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((c) => ({ c, open: map.get(c.id) }));
  }
  const monthLabel = ({ c, open }) =>
    monthName(c.period) +
    " — " +
    amt(open) +
    (c.date > today() ? " due " + shortDate(c.date) : " still owed");
  const monthsText = (list) =>
    list.length > 2
      ? list.length +
        " months (" +
        monthName(list[0].c.period) +
        " to " +
        monthName(list.at(-1).c.period) +
        ")"
      : joinAnd(list.map((x) => monthName(x.c.period)));

  /* ---- Bank accounts: picked from the ones already used, so the spelling always matches ---- */
  function accounts() {
    const seen = new Map();
    const add = (account, when) => {
      const name = String(account ?? "");
      if (name.trim() && (!seen.has(name) || seen.get(name) < when))
        seen.set(name, String(when || ""));
    };
    for (const t of transactions()) add(t.account, t.date);
    for (const b of rec("bankline")) add(b.account, b.date);
    for (const r of rec("reconciliation")) add(r.account, r.end);
    return [...seen].sort((a, b) => b[1].localeCompare(a[1])).map(([name]) => name);
  }
  const latest = (type, test = () => true) =>
    sorted(rec(type).filter((t) => !t.reverses && test(t)))[0];
  function accountField(o) {
    const known = accounts(),
      value = o.value || known[0] || "Rental checking",
      id = "mf-account-" + ++serial;
    const list = [...new Set([value, ...(o.include || []), ...known])].slice(0, 5);
    return h(
      "fieldset",
      {
        class: "ui-group ui-wide mf-account",
        "aria-describedby": o.help ? id + "-help" : null,
      },
      h("legend", null, esc(o.label)),
      o.help ? h("p", { class: "ui-help", id: id + "-help" }, esc(o.help)) : "",
      h(
        "div",
        { class: "ui-options" },
        list.map((name) =>
          h(
            "label",
            { class: "ui-seg" },
            hv("input", { type: "radio", name: "account", value: name, checked: name === value }),
            h("span", null, esc(name)),
          ),
        ),
        h(
          "label",
          { class: "ui-seg" },
          hv("input", { type: "radio", name: "account", value: "" }),
          h("span", null, "Another account"),
        ),
      ),
      h(
        "div",
        { class: "ui-field mf-other", hidden: true },
        h("label", { for: id }, "Name of the account"),
        hv("input", {
          id,
          name: "accountOther",
          type: "text",
          value: "",
          maxlength: 80,
          autocomplete: "off",
        }),
      ),
    );
  }
  function syncAccount(form) {
    for (const box of form.querySelectorAll(".mf-account")) {
      const other = box.querySelector('input[type="radio"][value=""]');
      box.querySelector(".mf-other").hidden = !other?.checked;
    }
  }
  function setAccount(form, name) {
    const radios = Array.from(form.querySelectorAll('input[type="radio"][name="account"]'));
    if (!radios.length) return;
    const same = radios.find((r) => r.value === name);
    (same || radios.at(-1)).checked = true;
    if (!same && form.elements.accountOther) form.elements.accountOther.value = name;
    syncAccount(form);
  }
  function accountOf(fd) {
    const picked = fd.get("account"),
      value = String(picked || fd.get("accountOther") || "").trim();
    if (!value)
      throw fieldError(
        picked === "" ? "accountOther" : "account",
        picked === "" ? "Type the name of the account." : "Choose the account.",
      );
    return accounts().find((a) => a.toLowerCase() === value.toLowerCase()) || value;
  }

  /* ---- Categories: a few everyday choices as pills, the full list one tap away ---- */
  const quickCats = ["repairs", "maintenance", "utilities", "insurance", "taxes", "supplies"];
  const catGroups = [
    [
      "Everyday costs",
      [
        "repairs",
        "maintenance",
        "utilities",
        "insurance",
        "taxes",
        "supplies",
        "advertising",
        "travel",
        "professional",
        "management",
        "commissions",
        "other",
      ],
    ],
    ["Mortgage and loans", ["interest", "otherInterest", "principal", "escrow", "loan"]],
    ["Big purchases", ["capital"]],
    [
      "Moving money (not an expense)",
      ["card", "transfer", "contribution", "distribution", "personal"],
    ],
    ["Money back", ["recovery", "reimbursement"]],
    ["Not sure", ["review"]],
    ["From my CPA", ["depreciation"]],
  ];
  const modeCats = {
    escrowDisbursement: ["taxes", "insurance", "review"],
    incoming: ["recovery", "loan", "contribution", "reimbursement", "transfer", "review"],
    depreciation: ["depreciation"],
  };
  const allowedCats = (mode) =>
    modeCats[mode] || Object.keys(categories).filter((k) => k !== "depreciation");
  function catOptions(allowed, value) {
    return (
      h("option", { value: "", selected: !value }, "Choose a category") +
      catGroups
        .map(([label, keys]) => {
          const mine = keys.filter((k) => allowed.includes(k));
          return mine.length
            ? h(
                "optgroup",
                { label },
                mine.map((k) => h("option", { value: k, selected: k === value }, esc(screenCat(k)))),
              )
            : "";
        })
        .join("")
    );
  }
  const catSelect = (o) => {
    const id = "mf-cat-" + ++serial;
    return h(
      "div",
      { class: "ui-field" + (o.cls ? " " + o.cls : ""), hidden: Boolean(o.hidden) },
      h("label", { for: id }, esc(o.label)),
      h("select", { id, name: o.name }, catOptions(o.allowed, o.value)),
    );
  };
  /* Row i of an entry: pills that set the real field, select[name=category{i}]. */
  function catPicker(i, value, allowed, o = {}) {
    const quick = (o.quick || quickCats).filter((k) => allowed.includes(k)),
      unsure = allowed.includes("review") && !quick.includes("review"),
      rest = allowed.some((k) => !quick.includes(k) && k !== "review"),
      id = "mf-pick-" + ++serial,
      shown = value && !quick.includes(value) && value !== "review";
    const pill = (key, label, on) =>
      h(
        "label",
        { class: "ui-seg" },
        hv("input", { type: "radio", name: "catPick" + i, value: key, checked: on }),
        h("span", null, esc(label)),
      );
    return h(
      "fieldset",
      {
        class: "ui-group ui-wide mf-cat",
        "data-cat": i,
        "data-part": o.part === false ? null : i,
        "aria-describedby": id + "-hint",
      },
      h("legend", null, esc(o.label || "What was it for?")),
      h(
        "div",
        { class: "ui-options" },
        quick.map((k) => pill(k, o.names?.[k] || screenCat(k), value === k)),
        rest ? pill("more", "More…", Boolean(shown)) : "",
        unsure ? pill("review", "Not sure", value === "review") : "",
      ),
      h("p", { class: "ui-help mf-cat-hint", id: id + "-hint" }, esc(catScreen[value]?.[1] || "")),
      catSelect({
        label: "All categories",
        name: "category" + i,
        value,
        allowed,
        cls: "mf-cat-all",
        hidden: !shown,
      }),
    );
  }
  /* Bring the pills, the hint and the full list in line. from: "pill" when a pill was tapped. */
  function syncCat(form, i, from) {
    const box = form.querySelector('[data-cat="' + i + '"]'),
      select = form.elements["category" + i];
    if (!box || !select) return;
    const pills = Array.from(box.querySelectorAll('input[type="radio"]')),
      more = pills.find((p) => p.value === "more"),
      all = box.querySelector(".mf-cat-all");
    if (from === "pill") {
      const picked = pills.find((p) => p.checked);
      if (picked && picked !== more) select.value = picked.value;
      else if (pills.some((p) => p !== more && p.value === select.value))
        select.value = "";
    } else {
      const same = pills.find((p) => p !== more && p.value === select.value);
      if (same) same.checked = true;
      else if (select.value && more) more.checked = true;
      else if (!more?.checked) for (const p of pills) p.checked = false;
    }
    all.hidden = !more?.checked;
    box.querySelector(".mf-cat-hint").textContent = catScreen[select.value]?.[1] || "";
  }
  function setCat(form, i, key) {
    const select = form.elements["category" + i];
    if (!select || !Array.from(select.options).some((x) => x.value === key)) return;
    select.value = key;
    syncCat(form, i);
  }
  function watchCats(form, onChange = () => {}) {
    form.addEventListener("change", (ev) => {
      const name = ev.target.name || "";
      if (/^catPick\d+$/.test(name)) syncCat(form, name.slice(7), "pill");
      else if (/^category\d+$/.test(name) && form.querySelector('[data-cat="' + name.slice(8) + '"]'))
        syncCat(form, name.slice(8));
      else return;
      onChange(name.replace(/\D+/, ""));
    });
  }

  /* ---- Receipts: take a photo or pick a file, see it, remove it ---- */
  const safeFile = (name) =>
    String(name || "attachment")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .replace(/^\.+/, "")
      .slice(-130) || "attachment";
  async function captureReceipts(files) {
    const result = [],
      workspace = dkey("");
    if (files.length > 20)
      throw new Error("Choose up to 20 receipts at a time.");
    for (const file of files) {
      if (file.size > 20 * 1024 * 1024 || file.size === 0)
        throw new Error("Each receipt must be smaller than 20 MB and not empty.");
      if (
        !/\.(pdf|jpe?g|png|webp|gif|heic|heif|avif|tiff?|bmp)$/i.test(file.name)
      )
        throw new Error("Choose a photo or a PDF.");
      sameWorkspace(workspace);
      const hash = await pm().blob(file);
      sameWorkspace(workspace);
      const old = rec("document").find(
        (d) => d.hash === hash && d.receiptInbox,
      );
      if (old) {
        result.push(old);
        continue;
      }
      const created = await pm().save("document", {
        ...base("document"),
        name: file.name,
        filename: file.name,
        originalName: file.name,
        kind: "Receipt",
        category: "Receipt",
        mime: file.type || "application/octet-stream",
        size: file.size,
        hash,
        date: today(),
        importedAt: new Date().toISOString(),
        sourceModified: file.lastModified
          ? new Date(file.lastModified).toISOString()
          : "",
        receiptInbox: true,
      });
      result.push(created);
    }
    return result;
  }
  const docName = (d) => d?.filename || d?.name || "Saved file";
  const sizeText = (bytes) =>
    !bytes
      ? ""
      : bytes < 1024 * 1024
        ? Math.max(1, Math.round(bytes / 1024)) + " KB"
        : (bytes / 1048576).toFixed(1) + " MB";
  const thumb = (d) =>
    h("span", { class: "mf-thumb-img", "data-thumb": d.id, "aria-hidden": "true" }, icon("file", 22));
  /* Fill every [data-thumb] in root with a small picture where the file is an image. */
  function loadThumbs(root, urls) {
    for (const slot of root.querySelectorAll("[data-thumb]:not([data-done])")) {
      slot.dataset.done = "1";
      const doc = pm().get(slot.dataset.thumb);
      if (!doc?.hash || !/^image\//.test(doc.mime || "")) continue;
      Promise.resolve(urls.get(doc.id) || pm().file(doc.hash))
        .then((found) => {
          if (!found || !slot.isConnected) return;
          const url = typeof found === "string" ? found : URL.createObjectURL(found);
          urls.set(doc.id, url);
          const img = new Image();
          img.alt = "";
          img.onload = () => slot.replaceChildren(img);
          img.src = url;
        })
        .catch(() => {});
    }
  }
  const releaseThumbs = (urls) => {
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
  };
  const receiptStrip = (o = {}) =>
    h(
      "div",
      { class: "mf-receipt ui-wide" },
      h("p", { class: "mf-label" }, esc(o.label || "Receipt"), ' <span class="ui-opt">(optional)</span>'),
      h("p", { class: "ui-help" }, "Saved straight away, even if you close this form."),
      h(
        "div",
        { class: "mf-receipt-actions" },
        h(
          "label",
          { class: "mf-file" },
          icon("camera", 18),
          "Take photo",
          hv("input", { id: "mf-camera", type: "file", accept: "image/*", capture: "environment" }),
        ),
        h(
          "label",
          { class: "mf-file" },
          icon("file", 18),
          "Choose file",
          hv("input", {
            id: "mf-files",
            type: "file",
            accept: "image/*,.heic,.heif,application/pdf",
            multiple: true,
          }),
        ),
      ),
      h("div", { id: "mf-receipts", "aria-live": "polite" }),
      h("div", { id: "mf-saved" }),
    );
  /* ids: Set of chosen document ids (kept in order). Returns helpers for the form. */
  function wireReceipts(form, ids, o = {}) {
    const box = byId("mf-receipts"),
      saved = byId("mf-saved"),
      urls = new Map(),
      fresh = new Set();
    let pending = 0;
    const available = () =>
      (o.available
        ? o.available()
        : rec("document").filter((d) => ["Receipt", "Invoice"].includes(d.kind || d.category))
      ).filter((d) => !ids.has(d.id) && !o.locked?.has(d.id));
    function draw() {
      const chosen = [...ids].map((id) => pm().get(id)).filter(Boolean);
      box.innerHTML =
        chosen
          .map((d) =>
            h(
              "div",
              { class: "mf-thumb" },
              thumb(d),
              h(
                "span",
                { class: "mf-grow" },
                h("strong", null, esc(docName(d))),
                h(
                  "small",
                  null,
                  esc([/^image\//.test(d.mime || "") ? "Photo" : "File", sizeText(d.size)].filter(Boolean).join(" · ")),
                ),
              ),
              h(
                "button",
                {
                  type: "button",
                  class: "mf-button mf-quiet",
                  "data-remove-doc": d.id,
                  "aria-label": "Remove " + docName(d),
                },
                "Remove",
              ),
            ),
          )
          .join("") + (pending ? h("p", { class: "mf-note" }, "Saving the receipt…") : "");
      const rest = available();
      const open = saved.querySelector("details")?.open;
      saved.innerHTML = rest.length
        ? kit().more(
            "Use a receipt already saved (" + rest.length + ")",
            sorted(rest.map((d) => ({ ...d, date: String(d.importedAt || d.date || "") })))
              .map((d) =>
                h(
                  "label",
                  { class: "mf-check" },
                  hv("input", { type: "checkbox", "data-doc": d.id }),
                  h("span", null, esc(docName(d))),
                ),
              )
              .join(""),
            Boolean(open),
          )
        : "";
      loadThumbs(box, urls);
      o.onChange?.();
    }
    box.addEventListener("click", async (ev) => {
      const id = ev.target.closest("[data-remove-doc]")?.dataset.removeDoc;
      if (!id) return;
      ids.delete(id);
      const doc = pm().get(id);
      /* A photo taken in this form and never used anywhere is thrown away, not left waiting. */
      if (fresh.has(id) && doc?.receiptInbox && !doc.immutable) {
        fresh.delete(id);
        try {
          await pm().save("document", { ...doc, _deleted: true });
        } catch (e) {
          failure(e, form);
        }
      }
      draw();
      form.remember?.();
    });
    saved.addEventListener("change", (ev) => {
      const id = ev.target.dataset?.doc;
      if (!id) return;
      if (ev.target.checked) ids.add(id);
      draw();
      form.remember?.();
    });
    for (const input of [byId("mf-files"), byId("mf-camera")])
      input.addEventListener("change", async () => {
        if (!input.files.length) return;
        pending++;
        draw();
        try {
          const before = new Set(rec("document").map((d) => d.id));
          for (const d of await captureReceipts([...input.files])) {
            ids.add(d.id);
            if (!before.has(d.id)) fresh.add(d.id);
          }
          input.value = "";
          clearErrors(form);
        } catch (e) {
          failure(e, form);
        } finally {
          pending--;
          draw();
          form.remember?.();
        }
      });
    draw();
    return {
      draw,
      pending: () => pending,
      release: () => releaseThumbs(urls),
      waiting: () => [...ids].some((id) => pm().get(id)?.receiptInbox),
    };
  }
  /* Mark the chosen files as used by this entry. Files already filed stay as they are. */
  const filedDocs = (ids, recordId) =>
    [...ids].flatMap((id) => {
      const doc = pm().get(id);
      if (!doc) throw new Error("A receipt could not be found. Remove it and add it again.");
      return doc.immutable
        ? []
        : [
            {
              ...doc,
              receiptInbox: false,
              immutable: true,
              transactionId: recordId,
              transactionIds: [
                ...new Set([
                  ...(doc.transactionIds || []),
                  ...(doc.transactionId ? [doc.transactionId] : []),
                  recordId,
                ]),
              ],
            },
          ];
    });
  /* "Attach a saved document": money papers first, everything else behind "Show all". */
  function docField(label = "Attach a saved document") {
    const docs = rec("document"),
      first = docs.filter(financialDoc);
    if (!docs.length) return "";
    const options = (list) => [["", "None"], ...list.map((d) => [d.id, d.name || d.filename])];
    return (
      kit().select({ label, name: "doc", optional: true, options: options(first), wide: true }) +
      (first.length < docs.length
        ? h("button", { type: "button", class: "mf-button mf-quiet", "data-all-docs": true }, "Show all saved documents")
        : "")
    );
  }
  function wireDocField(form) {
    const more = form.querySelector("[data-all-docs]");
    if (!more) return;
    more.onclick = () => {
      const select = form.elements.doc,
        current = select.value;
      select.innerHTML =
        '<option value="">None</option>' +
        rec("document")
          .map((d) => h("option", { value: d.id, selected: d.id === current }, esc(d.name || d.filename)))
          .join("");
      more.hidden = true;
      select.focus();
    };
  }
  /* ---- The Money page ---- */
  function ledgerRows(rows, empty = "Nothing recorded here yet.") {
    if (!rows.length) return emptyRow(empty);
    return listWrap(
      rows
        .map((t) => {
          const mine = t.type === "expense" ? slices(t, active()) : [],
            amount =
              t.type === "deposit"
                ? t.amount
                : t.type === "writeoff"
                  ? sum(t.allocations || [], (a) => a.amount)
                  : t.type === "expense"
                    ? -sum(mine, (s) => s.amount)
                    : classification(t, active()).cash;
          const label =
            t.type === "expense"
              ? screenCat(mine[0]?.category) + (mine.length > 1 ? " and more" : "")
              : t.type === "payment"
                ? "Rent"
                : t.type === "writeoff"
                  ? "Forgiven rent"
                  : "Security deposit";
          const moneyIn = amount > 0 && t.type !== "writeoff";
          return row({
            action: "activity",
            id: t.id,
            icon:
              t.type === "payment"
                ? "money"
                : t.type === "expense"
                  ? "receipt"
                  : t.type === "deposit"
                    ? "lock"
                    : "check",
            tone: moneyIn ? "in" : "",
            title: titleOf(t),
            sub: longDate(t.date) + " · " + label,
            value: t.type === "writeoff" ? amt(amount) : signed(amount),
            plus: moneyIn,
          });
        })
        .join(""),
    );
  }
  /* The open tab is part of the address (#money/bank), so a reload or a link lands on it. */
  const tabSlugs = { activity: "", rent: "rent", deposits: "deposit", reconcile: "bank", reports: "tax" };
  function syncRoute(st) {
    if (!Object.hasOwn(tabSlugs, st.tab)) st.tab = "activity";
    if (typeof pm().route !== "function") return;
    const slug = String(pm().route() || "").split("/")[0],
      named = Object.keys(tabSlugs).find((k) => tabSlugs[k] && tabSlugs[k] === slug);
    if (named) st.tab = named;
    else if (slug !== tabSlugs[st.tab]) pm().setRoute?.(tabSlugs[st.tab], { replace: true });
  }
  function setTab(tab) {
    state().tab = tab;
    if (document.querySelector(".mf-workspace"))
      pm().setRoute?.(tabSlugs[tab] ?? "", { replace: true });
  }
  const navigation = new Map();
  function state() {
    const key = dkey("view");
    if (!navigation.has(key))
      navigation.set(key, {
        tab: "activity",
        filter: "all",
        year: today().slice(0, 4),
        allBank: false,
      });
    return navigation.get(key);
  }
  /* Who owes what, one line per tenant: current tenants, and former ones only while
     they still owe rent or have a credit. */
  function owes() {
    const day = today(),
      charges = rec("charge"),
      map = balances(
        charges,
        transactions().filter((t) => t.date <= day),
      ),
      payments = rec("payment"),
      returned = refundGroups(payments);
    return rec("tenancy")
      .map((t) => {
        const mine = charges
            .filter((c) => c.tenancyId === t.id && map.get(c.id) > 0)
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((c) => ({ c, open: map.get(c.id) })),
          due = mine.filter((x) => x.c.date <= day);
        return {
          t,
          due,
          owed: sum(due, (x) => x.open),
          next: mine.find((x) => x.c.date > day) || null,
          credit: sum(
            payments.filter(
              (p) => p.tenancyId === t.id && !p.reverses && p.date <= day,
            ),
            (p) => Math.max(0, receiptRemaining(p, returned.get(p.id)).credit),
          ),
          ended: Boolean(t.end && t.end < day),
        };
      })
      .filter((x) => !x.ended || x.owed > 0 || x.credit > 0);
  }
  const owesLine = (x) =>
    x.owed
      ? (x.due.length === 1
          ? monthName(x.due[0].c.period) + ", due " + shortDate(x.due[0].c.date)
          : monthsText(x.due)) + "."
      : x.next
        ? "Next rent " + amt(x.next.open) + " due " + shortDate(x.next.c.date) + "."
        : "Nothing more is scheduled.";
  const owesRows = (list) =>
    list
      .map((x) =>
        h(
          "div",
          { class: "mf-owes" + (x.owed ? " is-due" : "") },
          h(
            "div",
            { class: "mf-grow" },
            h(
              "p",
              { class: "mf-owes-name" },
              h("strong", null, esc(x.t.name || "Your tenant")),
              " ",
              kit().status(x.owed ? "due" : "ok", x.owed ? "Owes " + amt(x.owed) : "Paid up"),
            ),
            h(
              "p",
              { class: "mf-owes-sub" },
              esc(
                owesLine(x) +
                  (x.credit ? " Has a " + amt(x.credit) + " credit toward future rent." : ""),
              ),
            ),
          ),
          button("payment", "Record payment", {
            id: x.t.id,
            cls: x.owed ? "mf-strong" : "",
            aria: "Record payment from " + (x.t.name || "your tenant"),
          }),
        ),
      )
      .join("");
  /* Things waiting for the owner. Each one opens the place where it gets done. */
  function todo() {
    const items = [],
      waiting = rec("document").filter((d) => d.receiptInbox).length,
      unmatched = rec("bankline").filter((b) => !b.matchedId).length;
    if (waiting)
      items.push({
        action: "inboxList",
        text: plural(waiting, "receipt") + " waiting to be entered",
      });
    if (unmatched)
      items.push({
        action: "goto:reconcile",
        text: plural(unmatched, "bank transaction") + " to match",
      });
    const payments = rec("payment"),
      returned = refundGroups(payments),
      unpaid = new Map();
    for (const p of sorted(payments.filter((t) => !t.reverses))) {
      const credit = receiptRemaining(p, returned.get(p.id)).credit;
      if (credit <= 0) continue;
      if (!unpaid.has(p.tenancyId))
        unpaid.set(p.tenancyId, openCharges(p.tenancyId).length);
      if (unpaid.get(p.tenancyId))
        items.push({
          action: "allocate",
          id: p.id,
          text:
            amt(credit) +
            " from " +
            tenantName(p.tenancyId) +
            " not yet applied to a month",
        });
    }
    return items;
  }
  function chargesList(rows, empty = "No rent has been charged yet.") {
    if (!rows.length) return emptyRow(empty);
    const day = today(),
      tx = transactions().filter((t) => t.date <= day),
      due = balances(rec("charge"), tx),
      forgiven = new Map();
    for (const t of tx)
      if (t.type === "writeoff")
        for (const a of t.allocations || [])
          forgiven.set(a.chargeId, (forgiven.get(a.chargeId) || 0) + a.amount);
    return listWrap(
      sorted(rows)
        .map((c) => {
          const open = due.get(c.id) ?? c.amount,
            off = forgiven.get(c.id) || 0;
          return row({
            action: "charge",
            id: c.id,
            title: monthName(c.period),
            sub: "Due " + shortDate(c.date) + " · " + tenantName(c.tenancyId),
            value: amt(c.amount),
            status:
              open === 0
                ? off >= c.amount
                  ? "Forgiven"
                  : off > 0
                    ? "Paid, part forgiven"
                    : "Paid"
                : c.date > day && open === c.amount
                  ? "Not due yet"
                  : "Still owed " + amt(open),
            statusTone: open === 0 ? "ok" : c.date <= day ? "due" : "",
          });
        })
        .join(""),
    );
  }
  function creditRows() {
    const payments = rec("payment"),
      returned = refundGroups(payments);
    return payments
      .filter((t) => !t.reverses)
      .map((t) => ({
        t,
        credit: receiptRemaining(t, returned.get(t.id)).credit,
      }))
      .filter((x) => x.credit > 0)
      .map(({ t, credit }) =>
        row({
          action: "allocate",
          id: t.id,
          title: tenantName(t.tenancyId),
          sub: "Paid " + longDate(t.date),
          value: amt(credit),
          status: "Not applied yet",
        }),
      )
      .join("");
  }
  function refundGroups(payments) {
    const groups = new Map();
    for (const t of payments)
      if (t.reverses) {
        if (!groups.has(t.reverses)) groups.set(t.reverses, []);
        groups.get(t.reverses).push(t);
      }
    return groups;
  }
  function receiptRemaining(original, returns = []) {
    const byCharge = new Map(
      (original.allocations || []).map((a) => [a.chargeId, a.amount]),
    );
    let amount = original.amount;
    for (const row of returns) {
      amount += row.amount;
      for (const a of row.allocations || [])
        byCharge.set(a.chargeId, (byCharge.get(a.chargeId) || 0) + a.amount);
    }
    return {
      amount,
      byCharge,
      credit: amount - sum([...byCharge.values()], (v) => v),
    };
  }
  const heldList = () =>
    rec("tenancy")
      .map((t) => ({ t, held: heldFor(t.id, today()) }))
      .filter((x) => x.held !== 0);
  const heldFor = (tenancyId, day = "9999-12-31") =>
    sum(
      rec("deposit").filter((d) => d.tenancyId === tenancyId && d.date <= day),
      (d) => d.amount,
    );
  const holdingText = () => {
    const list = heldList();
    return list.length
      ? list
          .map(
            (x) =>
              "You are holding " +
              amt(x.held) +
              " for " +
              (x.t.name || "your tenant") +
              ".",
          )
          .join(" ")
      : "You are not holding a deposit right now.";
  };
  const changeWords = (c) =>
    monthName(c.period) +
    ": " +
    (c.action === "canceled"
      ? "charge removed (was " + amt(c.oldAmount) + ")"
      : c.action === "reinstated"
        ? "charge put back at " + amt(c.newAmount)
        : c.action === "repriced"
          ? "rent changed from " + amt(c.oldAmount) + " to " + amt(c.newAmount)
          : "rent of " + amt(c.newAmount) + " added");
  function activityTab(st, yr, report) {
    const kinds = [
      ["all", "All"],
      ["payment", "Rent"],
      ["expense", "Expenses"],
      ["deposit", "Deposit"],
    ];
    if (report.rows.some((t) => t.type === "writeoff"))
      kinds.push(["writeoff", "Forgiven rent"]);
    if (!kinds.some(([k]) => k === st.filter)) st.filter = "all";
    const rows = sorted(
        report.rows.filter((t) => st.filter === "all" || t.type === st.filter),
      ),
      word = {
        payment: "rent payments",
        expense: "expenses",
        deposit: "deposit changes",
        writeoff: "forgiven rent",
      }[st.filter];
    return (
      lead("Everything recorded in " + yr + ". Tap a line to see it or fix it.") +
      h(
        "fieldset",
        { class: "ui-group mf-filter" },
        h("legend", { class: "mf-sr" }, "Show"),
        h(
          "div",
          { class: "ui-options" },
          kinds.map(([k, label]) =>
            h(
              "label",
              { class: "ui-seg" },
              hv("input", { type: "radio", name: "mfFilter", value: k, checked: st.filter === k }),
              h("span", null, esc(label)),
            ),
          ),
        ),
      ) +
      ledgerRows(
        rows,
        word
          ? "No " + word + " recorded in " + yr + "."
          : "Nothing recorded in " + yr + " yet. Start with Record rent or Add expense.",
      )
    );
  }
  function rentTab(s, yr) {
    const stat = (label, value, action) =>
      h(
        "button",
        { type: "button", class: "mf-stat", "data-money": action },
        h("small", null, esc(label)),
        h("strong", null, esc(amt(value))),
        h("span", { class: "mf-chev", "aria-hidden": "true" }, icon("chevron", 15)),
      );
    const events = sorted(rec("scheduleAdjustment")),
      credit = creditRows();
    return (
      lead("What was charged each month and what has been paid.") +
      subhead("This month", h("span", { class: "mf-tag" }, esc(monthName(s.period)))) +
      h(
        "div",
        { class: "mf-stats" },
        stat("Rent charged", s.charged, "rent"),
        stat("Paid toward this month", s.received, "rent"),
        stat("Money received this month", s.receivedByDate, "monthReceipts"),
      ) +
      subhead("Rent by month · " + yr, button("writeoff", "Forgive unpaid rent")) +
      chargesList(
        rec("charge").filter((c) => c.date.startsWith(yr)),
        "No rent was charged in " + yr + ".",
      ) +
      (credit
        ? subhead("Credit not yet applied") +
          lead("Money a tenant paid that is not matched to a month yet. Tap one to apply it.") +
          listWrap(credit)
        : "") +
      kit().more(
        "Rent changes",
        events.length
          ? events
              .map((event) =>
                h(
                  "div",
                  { class: "mf-change" },
                  h("strong", null, esc(longDate(event.date) + " · " + event.reason)),
                  h("small", null, esc("Starting " + longDate(event.effectiveFrom))),
                  event.changes.map((c) => h("small", null, esc(changeWords(c)))),
                ),
              )
              .join("")
          : note("No rent changes recorded."),
      )
    );
  }
  function depositTab(yr, report) {
    return (
      lead(
        "The security deposit you are holding. It is the tenant's money until you keep or return it.",
      ) +
      h("p", { class: "mf-callout" }, esc(holdingText())) +
      h(
        "div",
        { class: "mf-actions" },
        button("depositIn", "Deposit received"),
        button("depositOut", "Return deposit"),
        button("deposit", "Other change"),
      ) +
      subhead("Deposit history · " + yr) +
      ledgerRows(
        sorted(report.rows.filter((t) => t.type === "deposit")),
        "No deposit changes in " + yr + ".",
      )
    );
  }
  function bankRow(b, t) {
    const sameAs = t ? titleOf(t) + ", " + shortDate(t.date) : "";
    return h(
      "div",
      { class: "mf-bank" },
      h(
        "div",
        { class: "mf-bank-main" },
        h(
          "span",
          { class: "mf-grow" },
          h("strong", null, esc(b.description)),
          h("small", null, esc(longDate(b.date) + " · " + b.account)),
        ),
        h("b", { class: "mf-amount" + (b.amount > 0 ? " plus" : "") }, esc(signed(b.amount))),
      ),
      h(
        "p",
        { class: "mf-bank-hint" },
        esc(
          t
            ? "Looks like " + sameAs + "."
            : "Nothing recorded for " +
                amt(Math.abs(b.amount)) +
                (b.amount > 0 ? " into " : " from ") +
                b.account +
                ".",
        ),
      ),
      h(
        "div",
        { class: "mf-actions" },
        t
          ? button("matchyes", "Yes, same one", {
              id: b.id,
              with: t.id,
              cls: "mf-strong",
              aria: "Yes, " + b.description + " is " + sameAs,
            })
          : b.amount > 0
            ? button("bankpayment", "Add as rent payment", { id: b.id, cls: "mf-strong" })
            : button("bankexpense", "Add as expense", { id: b.id, cls: "mf-strong" }),
        button("match", "Something else", {
          id: b.id,
          aria: "Something else for " + b.description,
        }),
      ),
    );
  }
  function bankTab(st, yr) {
    const lines = rec("bankline"),
      unmatched = sorted(lines.filter((b) => !b.matchedId)),
      matched = sorted(lines.filter((b) => b.matchedId && b.date.startsWith(yr))),
      guess = suggestions(unmatched),
      sure = unmatched.filter((b) => guess.has(b.id)).length,
      checks = rec("reconciliation"),
      last = [...checks].sort((a, b) => b.end.localeCompare(a.end))[0],
      shown = st.allBank ? unmatched : unmatched.slice(0, 20),
      saved = checks
        .filter((r) => r.end?.startsWith(yr))
        .sort((a, b) => b.end.localeCompare(a.end))
        .map((r) =>
          row({
            action: "reconciliation",
            id: r.id,
            title: r.account,
            sub: longDate(r.start) + " to " + longDate(r.end),
            status: r.difference ? "Off by " + amt(Math.abs(r.difference)) : "Balanced",
            statusTone: r.difference ? "due" : "ok",
          }),
        )
        .join("");
    const step = (n, title, status, extra = "") =>
      h(
        "li",
        { class: "mf-step" },
        h("span", { class: "mf-step-n", "aria-hidden": "true" }, n),
        h("span", { class: "mf-grow" }, h("strong", null, esc(title)), h("small", null, esc(status))),
        extra,
      );
    return (
      lead("Optional: check your records against your bank statement.") +
      h(
        "ol",
        { class: "mf-steps" },
        step(
          1,
          "Import your bank file",
          lines.length
            ? plural(lines.length, "transaction") + " imported so far."
            : "A CSV file you download from your bank's website.",
          button("csv", "Import bank file"),
        ),
        step(
          2,
          "Match transactions",
          unmatched.length
            ? unmatched.length + " left to match, listed below."
            : lines.length
              ? "Everything imported is matched."
              : "Nothing to match yet.",
        ),
        step(
          3,
          "Check the statement balance",
          last ? "Last checked through " + longDate(last.end) + "." : "Not checked yet.",
          button("reconcile", "Check the statement balance"),
        ),
      ) +
      (unmatched.length
        ? subhead(
            "To match (" + unmatched.length + ")",
            sure > 1
              ? button("matchall", "Confirm all " + sure + " suggested matches", {
                  cls: "mf-strong",
                })
              : "",
          ) +
          h("div", { class: "mf-list" }, shown.map((b) => bankRow(b, guess.get(b.id))).join("")) +
          (shown.length < unmatched.length
            ? button("bankall", "Show all " + unmatched.length)
            : "")
        : "") +
      (matched.length
        ? kit().more(
            "Matched in " + yr + " (" + matched.length + ")",
            listWrap(
              matched
                .map((b) =>
                  row({
                    action: "match",
                    id: b.id,
                    title: b.description,
                    sub: longDate(b.date) + " · " + b.account,
                    value: signed(b.amount),
                    plus: b.amount > 0,
                    status: "Matched",
                    statusTone: "ok",
                  }),
                )
                .join(""),
            ),
          )
        : "") +
      subhead("Statement checks · " + yr) +
      (saved ? listWrap(saved) : emptyRow("No statement checked for " + yr + " yet."))
    );
  }
  function taxTab(yr) {
    const groups = issueGroups(packetData(active(), yr)),
      packets = sorted(
        rec("export").filter((r) => r.kind === "CPA packet" && String(r.year) === yr),
      );
    return (
      lead("Everything your CPA needs for the year.") +
      h(
        "div",
        { class: "mf-actions" },
        button("cpa", "Year-end packet for my CPA", { cls: "mf-strong", icon: "download" }),
        button("profile", "Ownership and rental days"),
      ) +
      subhead("Before you send it") +
      (groups.length
        ? listWrap(groups.map((g) => issueRow(g)).join(""))
        : h(
            "p",
            { class: "mf-callout" },
            esc("Nothing needs fixing for " + yr + ". The packet is ready to make."),
          )) +
      subhead("Packets you have made") +
      (packets.length
        ? listWrap(
            packets
              .map((r) =>
                row({
                  action: "snapshot",
                  id: r.id,
                  title: r.filename,
                  sub: "Made " + longDate(r.exportedAt || r.date),
                  status: "Download",
                }),
              )
              .join(""),
          )
        : emptyRow("No packet made for " + yr + " yet."))
    );
  }
  function render() {
    const st = state(),
      s = home(),
      tx = transactions(),
      yr = st.year,
      report = annual(yr, active(), tx),
      years = [
        ...new Set([today().slice(0, 4), yr, ...tx.map((t) => t.date.slice(0, 4))]),
      ].sort(),
      waiting = todo(),
      people = owes();
    const yearPicker =
      years.length < 2
        ? ""
        : years.length <= 5
          ? h(
              "fieldset",
              { class: "ui-group mf-years" },
              h("legend", null, "Year"),
              h(
                "div",
                { class: "ui-options" },
                years.map((y) =>
                  h(
                    "label",
                    { class: "ui-seg" },
                    hv("input", { type: "radio", name: "mfYear", value: y, checked: y === yr }),
                    h("span", null, esc(y)),
                  ),
                ),
              ),
            )
          : kit().select({
              label: "Year",
              name: "mfYear",
              options: [...years].reverse(),
              value: yr,
            });
    const tile = (label, value, help, action) =>
      h(
        "button",
        { type: "button", class: "mf-metric", "data-money": action },
        h("small", null, esc(label)),
        h("strong", null, esc(amt(value))),
        h("span", { class: "mf-metric-help" }, esc(help)),
        h("span", { class: "mf-chev", "aria-hidden": "true" }, icon("chevron", 15)),
      );
    const tabs = [
      ["activity", "Activity"],
      ["rent", "Rent"],
      ["deposits", "Deposit"],
      ["reconcile", "Bank"],
      ["reports", "Tax time"],
    ];
    syncRoute(st);
    const body =
      st.tab === "rent"
        ? rentTab(s, yr)
        : st.tab === "deposits"
          ? depositTab(yr, report)
          : st.tab === "reconcile"
            ? bankTab(st, yr)
            : st.tab === "reports"
              ? taxTab(yr)
              : activityTab(st, yr, report);
    pm().content().innerHTML = h(
      "div",
      { class: "mf-workspace" },
      h(
        "header",
        { class: "mf-head" },
        h(
          "div",
          null,
          h("h1", null, "Money"),
          h("p", null, "Rent you have received, bills you have paid, and what is still owed."),
        ),
        yearPicker,
      ),
      h(
        "div",
        { class: "mf-actions mf-topactions" },
        button("payment", "Record rent", { cls: "mf-primary", icon: "plus" }),
        button("expense", "Add expense", { icon: "receipt" }),
        button("receipt", "Snap a receipt", { icon: "camera" }),
        button("other", "Other entry", { icon: "more" }),
      ),
      waiting.length
        ? h(
            "section",
            { class: "mf-card mf-todo", "aria-label": "To do" },
            h("h2", null, "To do"),
            listWrap(
              waiting
                .map((item) =>
                  row({ action: item.action, id: item.id, title: item.text }),
                )
                .join(""),
            ),
          )
        : "",
      people.length
        ? h(
            "section",
            { class: "mf-card", "aria-label": "Who owes what" },
            h("h2", null, "Who owes what"),
            owesRows(people),
          )
        : "",
      h(
        "div",
        { class: "mf-metrics" },
        tile("Unpaid rent", s.dueNow, "as of today", "arrears"),
        tile("Income " + yr, report.totals.income, "money received", "income"),
        tile("Expenses " + yr, report.totals.expenses, "money spent on the rental", "expenses"),
        tile("Deposit held", s.deposit, "the tenant's money, not income", "deposits"),
      ),
      h(
        "div",
        { class: "mf-panel" },
        h(
          "nav",
          { class: "mf-tabs", "aria-label": "Money sections" },
          tabs.map(([k, label]) =>
            h(
              "button",
              { type: "button", "data-money": "tab:" + k, "aria-pressed": String(st.tab === k) },
              esc(label),
            ),
          ),
        ),
        h("section", { class: "mf-card mf-tabpanel" }, body),
      ),
    );
  }
  /* ---- Rent payments ---- */
  const withTerms = (portions) =>
    portions.map((a) => {
      const c = pm().get(a.chargeId);
      return {
        ...a,
        ...(c.termEventId ? { chargeTermEventId: c.termEventId } : {}),
      };
    });
  function formAllocations(fd, amount, tenancyId) {
    const list = [];
    for (const [k, v] of fd)
      if (k.startsWith("allocation:") && typed(v) !== "") {
        const value = entered(v, false, k);
        if (value !== 0)
          list.push({ chargeId: k.slice(11), amount: entered(v, true, k) });
      }
    return withTerms(
      allocate(
        amount,
        list,
        balances(
          rec("charge").filter((c) => c.tenancyId === tenancyId),
          transactions(),
        ),
      ),
    );
  }
  /* Spread an amount over the unpaid months, oldest first (a chosen month goes first). */
  function spread(amount, months, firstId = "") {
    const order = [
      ...months.filter((x) => x.c.id === firstId),
      ...months.filter((x) => x.c.id !== firstId),
    ];
    let left = Math.max(0, amount || 0);
    const out = new Map();
    for (const { c, open } of order) {
      const take = Math.min(left, open);
      left -= take;
      out.set(c.id, take);
    }
    return out;
  }
  const monthBoxes = (months, values = new Map()) =>
    months.length
      ? months
          .map((x) =>
            kit().money({
              label: monthLabel(x),
              name: "allocation:" + x.c.id,
              value: inputAmount(values.get(x.c.id)),
            }),
          )
          .join("")
      : note("No month has rent waiting to be paid.");
  /* One plain sentence about where a payment goes. parts: [{c, open, value}] */
  function coverage(amount, parts, anyOpen) {
    const applied = sum(parts, (p) => p.value),
      extra = amount - applied;
    if (extra < 0) return "The months add up to more than the payment.";
    if (!parts.length)
      return anyOpen
        ? "Not applied to a month. The " + amt(amount) + " will be kept as a credit."
        : "No rent is due. This will be kept as a credit.";
    const short = parts.filter((p) => p.value < p.open),
      words = parts.map((p) =>
        p.value < p.open
          ? amt(p.value) + " of " + monthName(p.c.period)
          : monthName(p.c.period),
      );
    return (
      "Covers " +
      joinAnd(words) +
      (short.length ? "." : " in full.") +
      short
        .map(
          (p) =>
            " " +
            amt(p.open - p.value) +
            " will still be owed" +
            (parts.length > 1 ? " for " + monthName(p.c.period) : "") +
            ".",
        )
        .join("") +
      (extra > 0
        ? " The extra " + amt(extra) + " is kept as a credit toward future rent."
        : "")
    );
  }
  function paymentForm(o = {}) {
    if (needTenancy()) return;
    if (o.old) return creditForm(o.old);
    const { charge, bank } = o,
      list = rec("tenancy"),
      first = o.tenancyId || charge?.tenancyId || list[0].id,
      targetId = uid(),
      methods = ["Bank transfer", "Check", "Cash", "Other"],
      key = dkey(
        "payment:" +
          (bank
            ? "bank:" + bank.id
            : charge
              ? "month:" + charge.id
              : o.tenancyId
                ? "tenant:" + o.tenancyId
                : "new"),
      );
    const recent = (tenancyId) =>
      latest("payment", (t) => t.tenancyId === tenancyId) || latest("payment");
    const suggested = (tenancyId) => {
      const months = openCharges(tenancyId);
      /* Opened from one month: that month's balance, unless it is the oldest unpaid one,
         in which case everything overdue is the likelier payment. */
      if (charge && charge.tenancyId === tenancyId && months[0]?.c.id !== charge.id)
        return months.find((x) => x.c.id === charge.id)?.open || 0;
      const due = months.filter((x) => x.c.date <= today());
      return due.length ? sum(due, (x) => x.open) : months[0]?.open || 0;
    };
    const lastMethod = recent(first)?.method,
      body =
        h("p", { id: "mf-status", class: "mf-callout" }) +
        tenantField(first, "Who paid?", list) +
        (bank
          ? kit().note(
              "plain",
              esc(
                "From your bank file: " +
                  amt(bank.amount) +
                  " into " +
                  bank.account +
                  " on " +
                  longDate(bank.date) +
                  ". The amount and account stay as the bank shows them.",
              ),
            ) +
            hv("input", { type: "hidden", name: "amount", value: inputAmount(bank.amount) }) +
            hv("input", { type: "hidden", name: "account", value: bank.account })
          : "") +
        h(
          "div",
          { class: "ui-grid" },
          bank
            ? ""
            : kit().money({
                label: "Amount received",
                name: "amount",
                value: inputAmount(suggested(first)),
                help: "Change this if they paid a different amount.",
                required: true,
              }),
          kit().field({
            label: "Date received",
            name: "date",
            type: "date",
            value: bank?.date || today(),
            help: "The day the money reached you.",
            required: true,
          }),
        ) +
        kit().seg({
          label: "How they paid",
          name: "method",
          options: methods.map((m) => [m, m]),
          value: methods.includes(lastMethod) ? lastMethod : methods[0],
        }) +
        h("p", { id: "mf-credit", class: "mf-result", "aria-live": "polite" }) +
        kit().more(
          "More options",
          (bank
            ? ""
            : accountField({
                label: "Deposited into",
                help: "The bank account the money went into. Used to match your bank statement.",
                value: recent(first)?.account,
              })) +
            kit().textarea({
              label: "Note",
              name: "notes",
              optional: true,
              rows: 2,
              value: bank?.description || "",
              help: "Check number or anything to remember.",
            }) +
            h(
              "fieldset",
              { class: "ui-group ui-wide", "aria-describedby": "mf-months-help" },
              h("legend", null, "Choose months yourself"),
              h(
                "p",
                { class: "ui-help", id: "mf-months-help" },
                "Filled in for you, oldest month first. Change only if this payment is for a particular month.",
              ),
              h("div", { id: "mf-allocation", class: "ui-stack" }),
              h(
                "button",
                { type: "button", id: "mf-auto", class: "mf-button", hidden: true },
                "Back to automatic",
              ),
            ),
        );
    let manual = false,
      touched = false;
    const f = formDialog(
      "Record rent payment",
      body,
      "Save payment",
      async (fd) => {
        const id = tenantOf(fd),
          a = bank ? bank.amount : entered(fd.get("amount"), true, "amount"),
          day = dateOf(fd, "date", "Choose the date the money reached you.");
        const record = {
          ...base("payment", targetId),
          tenancyId: id,
          date: day,
          account: bank ? bank.account : accountOf(fd),
          method: fd.get("method") || "",
          amount: a,
          notes: val(fd, "notes"),
          allocations: formAllocations(fd, a, id),
          sourceId: bank?.id || "",
        };
        await saveWithBank(record, bank);
        finish("Payment saved.");
      },
      key,
      { intro: "Record rent a tenant has paid you." },
    );
    const box = byId("mf-allocation"),
      tenancy = () => f.elements.tenancyId.value,
      amountNow = () => (bank ? bank.amount : peek(f.elements.amount.value)),
      monthInput = (id) => named(f, "allocation:" + id);
    let months = [];
    const draw = () => {
      months = openCharges(tenancy());
      box.innerHTML = monthBoxes(months);
    };
    const fill = () => {
      const plan = spread(amountNow(), months, charge?.id);
      for (const { c } of months) monthInput(c.id).value = inputAmount(plan.get(c.id));
    };
    const status = () => {
      const due = months.filter((x) => x.c.date <= today()),
        next = months.find((x) => x.c.date > today()),
        name = tenantName(tenancy());
      byId("mf-status").textContent = due.length
        ? name + " owes " + amt(sum(due, (x) => x.open)) + " for " + monthsText(due) + "."
        : next
          ? name +
            " is paid up. Next rent: " +
            amt(next.open) +
            " due " +
            shortDate(next.c.date) +
            "."
          : name + " is paid up.";
    };
    const describe = () => {
      const out = byId("mf-credit"),
        a = amountNow(),
        parts = [];
      let unread = a == null;
      for (const x of months) {
        const value = peek(monthInput(x.c.id)?.value);
        if (value == null) unread = true;
        else if (value > 0) parts.push({ ...x, value });
      }
      byId("mf-auto").hidden = !manual;
      out.textContent = unread
        ? "Check the amounts. Use numbers like 1250 or 1250.50."
        : a > 0
          ? coverage(a, parts, months.length > 0)
          : "";
      out.classList.toggle("is-warn", !unread && a > 0 && sum(parts, (p) => p.value) > a);
    };
    /* These run before the draft is remembered, so what is kept is already up to date. */
    f.addEventListener("input", (ev) => {
      const name = ev.target.name || "";
      if (name === "amount") touched = true;
      if (name.startsWith("allocation:")) manual = true;
      else if (name === "amount" && !manual) fill();
      describe();
    });
    f.addEventListener("change", (ev) => {
      if (ev.target.name !== "tenancyId") return;
      manual = false;
      draw();
      if (!bank && !touched) f.elements.amount.value = inputAmount(suggested(tenancy()));
      fill();
      status();
      describe();
    });
    bindDraft(f, key, {
      reopen: () => paymentForm(o),
      extra: () => ({ manual, touched }),
      before: (saved) => {
        manual = Boolean(saved.extra.manual);
        touched = Boolean(saved.extra.touched);
        const who = saved.fields.find((x) => x.name === "tenancyId" && x.on !== false);
        if (who && f.elements.tenancyId.value !== who.value) f.elements.tenancyId.value = who.value;
        draw();
      },
      after: (restored) => {
        if (!restored) draw();
        if (!manual) fill();
        status();
        describe();
      },
    });
    byId("mf-auto").onclick = () => {
      manual = false;
      fill();
      describe();
      f.remember();
    };
  }
  /* A payment with money not yet matched to a month. */
  function creditForm(old) {
    const credit = receiptRemaining(old, refundGroups(rec("payment")).get(old.id)).credit,
      months = openCharges(old.tenancyId),
      name = tenantName(old.tenancyId),
      key = dkey("credit:" + old.id);
    if (credit <= 0 || !months.length)
      return show(
        "Apply credit to a month",
        h(
          "div",
          { class: "mf-form" },
          h(
            "p",
            { class: "mf-intro" },
            esc(
              credit <= 0
                ? "This payment is already fully applied."
                : name +
                    " has no unpaid month right now. The " +
                    amt(credit) +
                    " stays as a credit and can be applied when the next rent is charged.",
            ),
          ),
        ),
      );
    const f = formDialog(
      "Apply credit to a month",
      h(
        "p",
        { class: "mf-callout" },
        esc(name + " paid " + amt(old.amount) + " on " + longDate(old.date) + ". " + amt(credit) + " of it is not applied to a month yet."),
      ) +
        h(
          "fieldset",
          { class: "ui-group ui-wide", "aria-describedby": "mf-months-help" },
          h("legend", null, "Which month is this for?"),
          h(
            "p",
            { class: "ui-help", id: "mf-months-help" },
            "Filled in for you, oldest month first.",
          ),
          h("div", { id: "mf-allocation", class: "ui-stack" }, monthBoxes(months, spread(credit, months))),
        ) +
        h("p", { id: "mf-credit", class: "mf-result", "aria-live": "polite" }),
      "Apply credit",
      async (fd) => {
        const portions = formAllocations(fd, credit, old.tenancyId);
        if (!portions.length)
          throw new Error("Enter an amount for at least one month.");
        const current = pm().get(old.id);
        if (JSON.stringify(current.allocations) !== JSON.stringify(old.allocations))
          throw new Error(
            "This payment was changed in the meantime. Close this and open it again.",
          );
        await pm().save("payment", {
          ...old,
          allocations: [...(old.allocations || []), ...portions].reduce((r, p) => {
            const same = r.find((x) => x.chargeId === p.chargeId);
            if (same) same.amount += p.amount;
            else r.push({ ...p });
            return r;
          }, []),
          allocationHistory: [
            ...(old.allocationHistory || []),
            { at: new Date().toISOString(), previous: old.allocations },
          ],
        });
        finish("Credit applied.");
      },
      key,
      { intro: "Match money a tenant already paid to the month it is for." },
    );
    const describe = () => {
      const parts = [];
      let unread = false;
      for (const x of months) {
        const value = peek(named(f, "allocation:" + x.c.id)?.value);
        if (value == null) unread = true;
        else if (value > 0) parts.push({ ...x, value });
      }
      const applied = sum(parts, (p) => p.value);
      byId("mf-credit").textContent = unread
        ? "Check the amounts. Use numbers like 1250 or 1250.50."
        : applied > credit
          ? "That is more than the " + amt(credit) + " credit."
          : applied
            ? "Applied to rent: " + amt(applied) + ". Kept as credit: " + amt(credit - applied) + "."
            : "Enter an amount for at least one month.";
    };
    bindDraft(f, key, { reopen: () => creditForm(old), after: describe });
    f.addEventListener("input", describe);
  }
  async function saveWithBank(record, bank, extra = []) {
    if (bank) {
      const current = pm().get(bank.id);
      if (!current || current.matchedId)
        throw new Error("This bank transaction has already been matched.");
      if (
        current.amount !== accountMovement(record) ||
        current.account !== record.account
      )
        throw new Error(
          "The amount and account must stay the same as the bank transaction.",
        );
      extra.push({
        ...current,
        matchedId: record.id,
        linkedAt: new Date().toISOString(),
      });
    }
    await pm().batch([record, ...extra]);
  }
  /* ---- Expenses and the less common entries ---- */
  const props = () =>
    all("property").length ? all("property") : [pm().prop()].filter(Boolean);
  /* The six entries that are not an everyday purchase. Each is the same stored record
     (type "expense") with a fixed `mode`; only the questions and the words differ. */
  const entryKinds = {
    mortgage: {
      menu: [
        "Mortgage payment",
        "Your monthly payment, split into principal, interest and escrow.",
      ],
      title: "Mortgage payment",
      intro: "Copy the three numbers from your mortgage statement.",
      who: "Lender",
      whoMissing: "Enter the lender's name.",
      when: "Date paid",
      account: ["Paid from", "The account the payment came out of."],
      saved: "Mortgage payment saved.",
    },
    refund: {
      menu: ["Refund from a vendor", "Money back for something you paid earlier."],
      title: "Refund from a vendor",
      intro: "Money back for something you paid earlier.",
      who: "Who refunded you?",
      whoMissing: "Enter who refunded you.",
      when: "Date received",
      what: "What was the refund for?",
      account: ["Deposited into", "The account the refund went into."],
      saved: "Refund saved.",
    },
    incoming: {
      menu: [
        "Other money in (not rent)",
        "An insurance payout, a loan, or money you put in yourself.",
      ],
      title: "Other money in",
      intro: "Money that came in but is not rent. It does not count as rent income.",
      who: "Who was it from?",
      whoMissing: "Enter who the money came from.",
      when: "Date received",
      what: "What was it?",
      quick: ["recovery", "loan", "contribution", "reimbursement", "transfer"],
      names: { transfer: "Transfer from my other account" },
      account: ["Deposited into", "The account the money went into."],
      saved: "Saved.",
    },
    tenantPaid: {
      menu: [
        "Tenant paid a bill for me",
        "The tenant paid a repair or bill that was yours to pay.",
      ],
      title: "Tenant paid a bill for me",
      intro: "Counts as rent income and as an expense. No money moves in your bank.",
      who: "Who was paid?",
      whoMissing: "Enter who was paid.",
      when: "Date paid",
      saved: "Saved.",
    },
    escrowDisbursement: {
      menu: [
        "Lender paid tax or insurance from escrow",
        "From your lender's escrow statement.",
      ],
      title: "Paid from escrow",
      intro: "Your lender paid property tax or insurance from escrow. Copy it from the escrow statement.",
      who: "Paid to",
      whoMissing: "Enter who was paid.",
      when: "Date paid",
      what: "What was paid?",
      quick: ["taxes", "insurance"],
      account: ["Escrow account", "The escrow account your lender holds."],
      saved: "Saved.",
    },
    depreciation: {
      menu: ["Depreciation figure from my CPA", "Only enter a figure your CPA gave you."],
      title: "Depreciation from my CPA",
      intro: "Only enter a figure your CPA gave you.",
      when: "Date",
      saved: "Depreciation saved.",
    },
  };
  function otherMenu() {
    show(
      "Other entry",
      h(
        "div",
        { class: "mf-form" },
        h("p", { class: "mf-intro" }, "Less common things to record. Pick the one that fits."),
        h(
          "div",
          { class: "mf-choices" },
          Object.entries(entryKinds).map(([mode, k]) =>
            choiceRow("entry:" + mode, k.menu[0], k.menu[1]),
          ),
          choiceRow("deposits", "Security deposit", "Receive, return or correct the deposit you hold."),
          choiceRow("writeoff", "Forgive unpaid rent", "When you have agreed the tenant no longer owes it."),
        ),
      ),
    );
  }
  const waitingIn = (ids) => [...ids].some((id) => pm().get(id)?.receiptInbox);
  /* o: { photo, doc, bank, mode, prefill, key } */
  function expenseForm(o = {}) {
    const bank = o.bank || null,
      pre = o.prefill || null,
      fixed = entryKinds[o.mode] ? o.mode : "",
      kind = entryKinds[fixed] || null,
      mortgage = fixed === "mortgage",
      targetId = uid(),
      multi = props().length > 1,
      allowed = allowedCats(fixed),
      noCash = fixed === "tenantPaid" || fixed === "depreciation",
      ids = new Set(o.doc ? [o.doc.id] : pre?.attachments || []),
      key =
        o.key ||
        dkey(
          "expense:" +
            (bank ? "bank:" + bank.id + ":" : "") +
            (o.doc
              ? "doc:" + o.doc.id
              : pre
                ? "again:" + pre.id
                : fixed || (o.photo ? "photo" : "add")),
        );
    const expenses = sorted(all("expense").filter((e) => !e.reverses)),
      vendors = new Map();
    for (const e of expenses)
      if (e.vendor && !vendors.has(e.vendor.trim().toLowerCase()))
        vendors.set(e.vendor.trim().toLowerCase(), e);
    const mine = (test) => latest("expense", test),
      cards = new Set(
        rec("expense")
          .filter((t) => t.mode === "creditCard" && t.account)
          .map((t) => t.account),
      ),
      lastBank =
        mine((t) => t.mode === "expense" && t.account)?.account ||
        accounts().find((a) => !cards.has(a) && !/escrow/i.test(a)) ||
        "Rental checking",
      lastCard = mine((t) => t.mode === "creditCard" && t.account)?.account || "Rental credit card",
      lastMortgage = mortgage ? mine((t) => t.mode === "mortgage") : null,
      mode0 =
        fixed ||
        (pre && ["expense", "creditCard"].includes(pre.mode)
          ? pre.mode
          : bank && (cards.has(bank.account) || /card/i.test(bank.account))
            ? "creditCard"
            : "expense"),
      account0 =
        pre?.account ||
        (mortgage
          ? lastMortgage?.account || lastBank
          : fixed === "escrowDisbursement"
            ? mine((t) => t.mode === "escrowDisbursement" && t.account)?.account ||
              "Mortgage escrow"
            : mode0 === "creditCard"
              ? lastCard
              : lastBank),
      firstCat = pre?.splits?.[0]?.category || (fixed === "depreciation" ? "depreciation" : "");
    const propSelect = (name, label, value) =>
      kit().select({
        label,
        name,
        options: props().map((p) => [p.id, p.name]),
        value: value || active(),
      });
    const partRow = (i, category = "", amount = "", propertyId = active()) =>
      h(
        "div",
        { class: "mf-split", "data-part": i },
        catSelect({ label: "Category", name: "category" + i, value: category, allowed }),
        kit().money({ label: "Amount for this category", name: "split" + i, value: amount }),
        multi ? propSelect("prop" + i, "Property", propertyId) : "",
        h(
          "button",
          {
            type: "button",
            "data-remove-part": true,
            class: "mf-button mf-remove",
            "aria-label": "Remove this category",
          },
          icon("x", 16),
        ),
      );
    const priorPart = (category) =>
      inputAmount(
        Math.abs(
          sum(
            (pre || lastMortgage)?.splits?.filter((s) => s.category === category) || [],
            (s) => s.amount,
          ),
        ),
      );
    const mortgageBox = (i, category, label, help) =>
      h(
        "div",
        { "data-part": i },
        hv("input", { type: "hidden", name: "category" + i, value: category }),
        kit().money({ label, name: "split" + i, value: priorPart(category), help }),
      );
    const receipts = receiptStrip({
      label: mortgage || fixed === "escrowDisbursement" ? "Statement" : fixed === "depreciation" ? "Paper from your CPA" : "Receipt",
    });
    const dateField = kit().field({
      label: kind?.when || "Date paid",
      name: "date",
      type: "date",
      value: pre?.date || bank?.date || today(),
      required: true,
    });
    const tripBlock = h(
      "div",
      { id: "mf-trip", class: "ui-grid" },
      kit().field({
        label: "Miles driven",
        name: "miles",
        type: "number",
        optional: true,
        value: pre?.miles || "",
        attrs: 'min="0" step="0.1" inputmode="decimal"',
        help: "Only if you drove for this. Your CPA uses the miles.",
      }),
      kit().field({
        label: "Trip (from, to, why)",
        name: "trip",
        value: pre?.trip || "",
        attrs: 'maxlength="300"',
      }),
    );
    const assetBlock = h(
      "div",
      { id: "mf-asset" },
      kit().field({
        label: "Date it was installed or first used",
        name: "inService",
        type: "date",
        optional: true,
        value: pre?.inService || "",
        help: "For a big purchase. Your CPA needs it to spread the cost over the years.",
      }),
    );
    const noteField = kit().textarea({
      label: "Note",
      name: "notes",
      optional: true,
      rows: 2,
      value: pre?.notes || (bank && fixed ? bank.description : ""),
      help: "What the work was, an invoice number, anything to remember.",
    });
    const extras = fixed === "" || fixed === "refund" || fixed === "tenantPaid";
    const more =
      (fixed
        ? ""
        : kit().seg({
            label: "Paid with",
            name: "mode",
            options: [
              ["expense", "Bank account"],
              ["creditCard", "Credit card"],
            ],
            value: mode0,
          })) +
      (mortgage
        ? multi
          ? propSelect("propAll", "Which property is this for?")
          : ""
        : fixed === "depreciation"
          ? multi
            ? propSelect("prop0", "Which property is this for?", pre?.splits?.[0]?.propertyId)
            : ""
          : h(
              "fieldset",
              { class: "ui-group ui-wide mf-splitbox", "aria-describedby": "mf-split-help" },
              h(
                "legend",
                null,
                multi ? "Split between categories or properties" : "Split between categories",
              ),
              h(
                "p",
                { class: "ui-help", id: "mf-split-help" },
                "Use when one bill covers different things.",
              ),
              multi
                ? propSelect("prop0", "Which property is this for?", pre?.splits?.[0]?.propertyId)
                : "",
              h(
                "div",
                { id: "mf-first", hidden: true },
                kit().money({ label: "Amount for the first category", name: "split0", value: "" }),
              ),
              h("div", { id: "mf-splits", class: "ui-stack" }),
              h(
                "button",
                { type: "button", id: "mf-addsplit", class: "mf-button" },
                "Add another category",
              ),
              h("p", { id: "mf-left", class: "mf-result", "aria-live": "polite", hidden: true }),
            )) +
      (fixed === "depreciation" ? "" : noteField) +
      (noCash || bank
        ? ""
        : accountField({
            label: kind?.account?.[0] || "Paid from",
            help:
              kind?.account?.[1] ||
              "The account or card the money came out of. Used to match your bank statement.",
            value: account0,
            include: fixed ? [] : [lastBank, lastCard],
          })) +
      (noCash || fixed === "incoming" || fixed === "escrowDisbursement"
        ? ""
        : kit().field({
            label: "Payment method",
            name: "method",
            optional: true,
            value: pre?.method || "",
            attrs: 'maxlength="80"',
            help: "Check number or card name.",
          })) +
      (extras ? h("div", { id: "mf-trip-home" }, tripBlock) + h("div", { id: "mf-asset-home" }, assetBlock) : "") +
      kit().textarea({
        label: "Note for my CPA",
        name: "reviewNotes",
        optional: true,
        rows: 2,
        value: pre?.reviewNotes || "",
        help: "Anything your CPA should know about this entry.",
      });
    const body =
      (o.photo ? receipts : "") +
      (bank
        ? kit().note(
            "plain",
            esc(
              "From your bank file: " +
                amt(Math.abs(bank.amount)) +
                (bank.amount > 0 ? " into " : " from ") +
                bank.account +
                " on " +
                longDate(bank.date) +
                ". The amount and account stay as the bank shows them.",
            ),
          ) + hv("input", { type: "hidden", name: "account", value: bank.account })
        : "") +
      (fixed === "depreciation"
        ? hv("input", { type: "hidden", name: "vendor", value: "Depreciation" })
        : kit().field({
            label: kind?.who || "Who did you pay?",
            name: "vendor",
            value: pre?.vendor || lastMortgage?.vendor || (bank ? bank.description : ""),
            required: true,
            attrs: 'maxlength="160" list="mf-vendors" autocomplete="off"',
          }) +
          h(
            "datalist",
            { id: "mf-vendors" },
            [...vendors.values()].slice(0, 60).map((e) => hv("option", { value: e.vendor.trim() })),
          )) +
      (mortgage
        ? h("div", { class: "ui-grid" }, dateField) +
          h(
            "div",
            { class: "ui-stack", id: "mf-splits" },
            mortgageBox(0, "principal", "Principal", "The part that pays down the loan."),
            mortgageBox(1, "interest", "Interest", "What the lender charges for the loan."),
            mortgageBox(2, "escrow", "Escrow", "Set aside for property tax and insurance."),
          ) +
          h("p", { id: "mf-left", class: "mf-result", "aria-live": "polite" }) +
          hv("input", { type: "hidden", name: "amount", value: "" })
        : h(
            "div",
            { class: bank ? "ui-grid" : "mf-pair" },
            bank
              ? hv("input", {
                  type: "hidden",
                  name: "amount",
                  value: inputAmount(Math.abs(bank.amount)),
                })
              : kit().money({
                  label: "Amount",
                  name: "amount",
                  value: pre ? inputAmount(Math.abs(pre.amount)) : "",
                  required: true,
                }),
            dateField,
          )) +
      (mortgage
        ? ""
        : fixed === "depreciation"
          ? h(
              "div",
              { "data-part": 0 },
              hv("input", { type: "hidden", name: "category0", value: "depreciation" }),
            ) + noteField
          : catPicker(0, firstCat, allowed, {
              label: kind?.what,
              quick: kind?.quick,
              names: kind?.names,
            }) + h("div", { id: "mf-inline", class: "ui-stack" })) +
      (fixed ? hv("input", { type: "hidden", name: "mode", value: fixed }) : "") +
      (o.photo ? "" : receipts) +
      h("p", { id: "mf-paid", class: "mf-note", "aria-live": "polite" }) +
      kit().more("More options", more);
    let saved = false,
      shots = null,
      nextPart = 1,
      catTouched = Boolean(pre),
      payTouched = Boolean(pre || bank),
      methodAuto = false;
    const inboxSize = () => rec("document").filter((d) => d.receiptInbox).length,
      inboxAtOpen = inboxSize();
    const form = formDialog(
      kind?.title || (o.doc ? "Enter a receipt" : o.photo ? "Snap a receipt" : "Add expense"),
      body,
      fixed ? "Save" : "Save expense",
      async (fd) => {
        if (shots.pending())
          throw new Error("One moment. The receipt is still being saved.");
        const mode = fixed || fd.get("mode") || "expense",
          vendor = val(fd, "vendor");
        if (!vendor) throw fieldError("vendor", kind?.whoMissing || "Enter who you paid.");
        const day = dateOf(fd, "date"),
          where = (i) => fd.get("prop" + i) || fd.get("propAll") || active();
        let full, parts;
        if (mortgage) {
          parts = ["0", "1", "2"]
            .filter((i) => typed(fd.get("split" + i)) !== "")
            .map((i) => ({
              category: fd.get("category" + i),
              amount: entered(fd.get("split" + i), true, "split" + i),
              propertyId: where(i),
            }));
          if (!parts.length)
            throw fieldError("split0", "Enter at least one of the three amounts.");
          full = sum(parts, (p) => p.amount);
          if (bank && full !== Math.abs(bank.amount))
            throw fieldError(
              "split0",
              "The three amounts must add up to " +
                amt(Math.abs(bank.amount)) +
                ", the amount in your bank file. They add up to " +
                amt(full) +
                ".",
            );
        } else {
          full = bank ? Math.abs(bank.amount) : entered(fd.get("amount"), true, "amount");
          const order = ["0", ...extraRows().map((r) => r.dataset.part)];
          parts = order.map((i) => {
            const category = fd.get("category" + i);
            if (!category)
              throw fieldError(
                i === "0" ? "catPick0" : "category" + i,
                "Choose what it was for.",
              );
            const raw = typed(fd.get("split" + i));
            return {
              category,
              amount:
                order.length === 1 && raw === ""
                  ? full
                  : entered(raw, true, "split" + i, "Enter the amount for this category."),
              propertyId: where(i),
            };
          });
          const total = sum(parts, (p) => p.amount);
          if (total !== full)
            throw fieldError(
              order.length > 1 ? "split" + order.at(-1) : "amount",
              "The category amounts must add up to the total (" +
                amt(full) +
                "). They add up to " +
                amt(total) +
                ".",
            );
        }
        validateSplits(full, parts);
        if (
          (mode === "depreciation" &&
            parts.some((s) => s.category !== "depreciation")) ||
          (mode !== "depreciation" &&
            parts.some((s) => s.category === "depreciation"))
        )
          throw new Error(
            "Depreciation has its own entry. Use Other entry, then Depreciation figure from my CPA.",
          );
        if (
          mode === "incoming" &&
          parts.some((s) => !modeCats.incoming.includes(s.category))
        )
          throw new Error("Choose what kind of money this was from the choices shown.");
        if (
          mode === "escrowDisbursement" &&
          parts.some((s) => !modeCats.escrowDisbursement.includes(s.category))
        )
          throw new Error("Choose property tax, insurance, or not sure.");
        if (fd.get("miles") && !val(fd, "trip"))
          throw fieldError("trip", "Say where you drove and why.");
        const direction = mode === "refund" || mode === "incoming" ? -1 : 1;
        const record = {
          ...base("expense", targetId),
          date: day,
          vendor,
          account: noCash ? "" : bank ? bank.account : accountOf(fd),
          mode,
          method: val(fd, "method"),
          amount: direction * full,
          splits: parts.map((s) => ({ ...s, amount: s.amount * direction })),
          attachments: [...ids],
          notes: val(fd, "notes"),
          reviewNotes: val(fd, "reviewNotes"),
          inService: fd.get("inService") || "",
          miles: fd.get("miles") || "",
          trip: val(fd, "trip"),
          sourceId: bank?.id || "",
        };
        await saveWithBank(record, bank, filedDocs(ids, record.id));
        saved = true;
        finish(kind?.saved || "Expense saved.");
      },
      key,
      {
        intro:
          kind?.intro ||
          (o.doc
            ? "Fill in the details that go with this receipt."
            : o.photo
              ? "Take the photo now. Fill in the rest now, or finish later."
              : bank
                ? "Record this bank transaction as something you paid for the rental."
                : "Record something you paid for the rental."),
        foot:
          (fixed || bank
            ? ""
            : button("other", "Not a regular purchase?", { cls: "mf-quiet mf-foot-start" })) +
          h(
            "button",
            { type: "button", id: "mf-later", class: "mf-button", hidden: true },
            "Finish later",
          ),
        onClose: () => {
          shots?.release();
          if (!saved && inboxSize() !== inboxAtOpen) pm().refresh();
        },
      },
    );
    const box = byId("mf-splits"),
      later = byId("mf-later"),
      extraRows = () => (mortgage ? [] : Array.from(form.querySelectorAll("#mf-splits [data-part]"))),
      place = (node, parent) => {
        if (node && parent && node.parentElement !== parent) parent.append(node);
      };
    function tally() {
      const out = byId("mf-left");
      if (!out) return;
      if (mortgage) {
        const values = ["0", "1", "2"].map((i) => peek(form.elements["split" + i].value)),
          total = values.includes(null) ? null : sum(values, (v) => v);
        form.elements.amount.value = total ? inputAmount(total) : "";
        out.textContent =
          total == null
            ? "Check the amounts. Use numbers like 1250 or 1250.50."
            : total
              ? "Total payment: " + amt(total) + "."
              : "";
        return;
      }
      const rows = extraRows();
      byId("mf-first").hidden = !rows.length;
      if (!rows.length) form.elements.split0.value = "";
      out.hidden = !rows.length;
      if (!rows.length) return;
      const total = bank ? Math.abs(bank.amount) : peek(form.elements.amount.value),
        values = ["0", ...rows.map((r) => r.dataset.part)].map((i) =>
          peek(form.elements["split" + i].value),
        ),
        gap = total == null || values.includes(null) ? null : total - sum(values, (v) => v);
      out.textContent =
        gap == null
          ? "Check the amounts. Use numbers like 1250 or 1250.50."
          : gap === 0
            ? "Everything is assigned."
            : gap > 0
              ? "Left to assign: " + amt(gap) + "."
              : "Over by " + amt(-gap) + ".";
      out.classList.toggle("is-warn", gap != null && gap < 0);
    }
    function inline() {
      const category = form.elements.category0?.value;
      place(byId("mf-trip"), byId(category === "travel" ? "mf-inline" : "mf-trip-home"));
      place(byId("mf-asset"), byId(category === "capital" ? "mf-inline" : "mf-asset-home"));
    }
    /* One line that says which account this will be recorded against. */
    function paidLine() {
      const out = byId("mf-paid");
      let account = "";
      try {
        account = noCash || bank ? "" : accountOf(new FormData(form));
      } catch {
        account = "";
      }
      out.textContent = !account
        ? ""
        : (fixed === "refund" || fixed === "incoming"
            ? "Goes into "
            : form.elements.mode.value === "creditCard"
              ? "Paid with "
              : "Paid from ") +
          account +
          ". Change it under More options.";
    }
    function paidWith(user, account) {
      if (fixed) return;
      const card = form.elements.mode.value === "creditCard",
        method = form.elements.method;
      if (user && !bank) setAccount(form, account || (card ? lastCard : lastBank));
      if (card && user && !method.value) {
        method.value = "Credit card";
        methodAuto = true;
      } else if (!card && methodAuto && method.value === "Credit card") {
        method.value = "";
        methodAuto = false;
      }
    }
    if (pre && !mortgage && fixed !== "depreciation") {
      pre.splits.slice(1).forEach((s) => {
        box.insertAdjacentHTML(
          "beforeend",
          partRow(nextPart++, s.category, inputAmount(Math.abs(s.amount)), s.propertyId),
        );
      });
      if (pre.splits.length > 1)
        form.elements.split0.value = inputAmount(Math.abs(pre.splits[0].amount));
    }
    watchCats(form, (i) => {
      if (i === "0") {
        catTouched = true;
        inline();
      }
    });
    /* A vendor used before brings its usual category and the account it was paid from. */
    form.addEventListener("input", (ev) => {
      const known =
        ev.target.name === "vendor" && vendors.get(ev.target.value.trim().toLowerCase());
      if (known) {
        const category = (slices(known, active())[0] || known.splits?.[0])?.category;
        if (
          !catTouched &&
          allowed.includes(category) &&
          form.querySelector('[data-cat="0"]')
        ) {
          setCat(form, 0, category);
          inline();
        }
        if (!fixed && !payTouched && ["expense", "creditCard"].includes(known.mode)) {
          form.elements.mode.value = known.mode;
          paidWith(true, known.account);
        }
      }
      tally();
      paidLine();
    });
    form.addEventListener("change", (ev) => {
      const name = ev.target.name;
      if (name === "mode") paidWith(true);
      if (name === "mode" || name === "account" || name === "accountOther") {
        payTouched = true;
        paidLine();
      }
    });
    if (byId("mf-addsplit"))
      byId("mf-addsplit").onclick = () => {
        box.insertAdjacentHTML("beforeend", partRow(nextPart++));
        tally();
        box.lastElementChild.querySelector("select").focus();
        form.remember();
      };
    box?.addEventListener("click", (ev) => {
      const remove = ev.target.closest("[data-remove-part]");
      if (!remove) return;
      remove.closest("[data-part]").remove();
      tally();
      byId("mf-addsplit").focus();
      form.remember();
    });
    shots = wireReceipts(form, ids, {
      onChange: () => {
        later.hidden = !waitingIn(ids);
      },
    });
    later.onclick = () => {
      form.remember();
      pm().close();
      pm().toast("Receipt kept. It is under To do on the Money page.");
    };
    const restored = bindDraft(form, key, {
      reopen: () => expenseForm(o),
      extra: () => ({
        ids: [...ids],
        catTouched,
        payTouched,
        methodAuto,
        opts: { photo: Boolean(o.photo), mode: fixed },
      }),
      before: (draft) => {
        catTouched = Boolean(draft.extra.catTouched);
        payTouched = Boolean(draft.extra.payTouched);
        methodAuto = Boolean(draft.extra.methodAuto);
        if (!mortgage && box)
          for (const x of draft.fields) {
            const m = /^category(\d+)$/.exec(x.name);
            if (!m || +m[1] < 1 || named(form, x.name)) continue;
            box.insertAdjacentHTML("beforeend", partRow(+m[1]));
            nextPart = Math.max(nextPart, +m[1] + 1);
          }
        for (const id of draft.extra.ids || []) if (pm().get(id)) ids.add(id);
      },
      after: (again) => {
        syncCat(form, 0);
        inline();
        paidWith(false);
        tally();
        paidLine();
        if (again) shots.draw();
      },
    });
    /* On a phone, "Snap a receipt" goes straight to the camera. It has to happen inside
       the tap that opened this form, which is why nothing above waits for anything. */
    if (
      o.photo &&
      !o.doc &&
      !restored &&
      !ids.size &&
      global.matchMedia?.("(pointer: coarse)").matches
    )
      try {
        byId("mf-camera").click();
      } catch {
        /* The buttons are on screen either way. */
      }
  }
  /* ---- Security deposit ---- */
  /* The deposit held for a tenant may never drop below zero on any date. */
  function depositGuard(tenancyId, entries) {
    const byDate = new Map();
    for (const e of rec("deposit")
      .filter((d) => d.tenancyId === tenancyId)
      .concat(entries))
      byDate.set(e.date, (byDate.get(e.date) || 0) + e.amount);
    let held = 0;
    for (const [, change] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
      held += change;
      if (held < 0)
        throw new Error(
          "That is more than the deposit you were holding on that date (" +
            amt(Math.max(0, heldFor(tenancyId, entries[0].date))) +
            ").",
        );
    }
  }
  const oneDoc = (fd) => (fd.get("doc") ? [fd.get("doc")] : []);
  function depositIn() {
    if (needTenancy()) return;
    const id = uid(),
      list = rec("tenancy"),
      key = dkey("deposit:in"),
      papers = docField();
    const form = formDialog(
      "Deposit received",
      tenantField(list[0].id, "Who paid the deposit?", list) +
        h(
          "div",
          { class: "ui-grid" },
          kit().money({ label: "Amount", name: "amount", required: true }),
          kit().field({
            label: "Date received",
            name: "date",
            type: "date",
            value: today(),
            required: true,
          }),
        ) +
        kit().more(
          "More options",
          accountField({
            label: "Deposited into",
            help: "The bank account the money went into.",
            value:
              latest("deposit", (d) => d.account)?.account || latest("payment")?.account,
          }) +
            kit().textarea({
              label: "Note",
              name: "notes",
              optional: true,
              rows: 2,
              value: "Security deposit received",
            }) +
            papers,
        ),
      "Save deposit",
      async (fd) => {
        const t = tenantOf(fd),
          a = entered(fd.get("amount"), true, "amount"),
          day = dateOf(fd, "date");
        await pm().save("deposit", {
          ...base("deposit", id),
          tenancyId: t,
          date: day,
          amount: a,
          kind: "receipt",
          notes: val(fd, "notes") || "Security deposit received",
          account: accountOf(fd),
          allocations: [],
          attachments: oneDoc(fd),
        });
        finish("Deposit saved.");
      },
      key,
      {
        intro:
          "Record deposit money a tenant paid you. You hold it for the tenant. It is not income.",
      },
    );
    wireDocField(form);
    bindDraft(form, key, { reopen: depositIn });
  }
  /* Move-out: what went back to the tenant and what was kept, saved together. */
  function depositOut() {
    if (needTenancy()) return;
    const ids = [uid(), uid(), uid()],
      list = heldList()
        .filter((x) => x.held > 0)
        .map((x) => x.t),
      key = dkey("deposit:out");
    if (!list.length)
      return show(
        "Return deposit",
        h(
          "div",
          { class: "mf-form" },
          h(
            "p",
            { class: "mf-intro" },
            "You are not holding a deposit right now, so there is nothing to return.",
          ),
          h("div", { class: "mf-foot" }, button("depositIn", "Deposit received")),
        ),
      );
    const unpaidFor = (tenancyId) =>
      openCharges(tenancyId).filter((x) => x.c.date <= today());
    const form = formDialog(
      "Return deposit",
      tenantField(list[0].id, "Whose deposit?", list) +
        h("p", { id: "mf-held", class: "mf-callout" }) +
        kit().money({
          label: "Returned to tenant",
          name: "returned",
          help: "Money you are paying back.",
        }) +
        h(
          "div",
          { id: "mf-rentbox" },
          kit().money({
            id: "mf-keptrent",
            label: "Kept for unpaid rent",
            name: "keptRent",
            help: "Applied to the oldest unpaid month first.",
          }),
        ) +
        kit().money({
          label: "Kept for damage or cleaning",
          name: "keptDamage",
          help: "Counts as income. List the costs in the statement you send the tenant.",
        }) +
        kit().field({
          label: "Date",
          name: "date",
          type: "date",
          value: today(),
          required: true,
          help: "The day you returned or kept the money.",
        }) +
        h("p", { id: "mf-still", class: "mf-result", "aria-live": "polite" }) +
        kit().more(
          "More options",
          accountField({
            label: "Paid from",
            help: "The bank account the returned money came out of.",
            value:
              latest("deposit", (d) => d.account)?.account || latest("payment")?.account,
          }) +
            kit().textarea({
              label: "Reason",
              name: "notes",
              rows: 2,
              required: true,
              value: "Deposit returned at move-out",
            }) +
            kit().toggle({
              label: "Flag the amount kept for my CPA",
              name: "flag",
              help: "Use if you are not sure how to report it. It is then not counted as income.",
            }) +
            docField("Attach the itemized statement") +
            h(
              "button",
              { type: "button", class: "mf-button mf-quiet", "data-act": "depositReturn" },
              "Open the deposit return worksheet",
            ),
        ),
      "Save",
      async (fd) => {
        const t = tenantOf(fd),
          day = dateOf(fd, "date"),
          part = (name) => {
            if (typed(fd.get(name)) === "") return 0;
            const value = entered(fd.get(name), false, name);
            if (value < 0) throw fieldError(name, "Enter zero or more.");
            return value;
          },
          returned = part("returned"),
          keptRent = byId("mf-rentbox").hidden ? 0 : part("keptRent"),
          keptDamage = part("keptDamage"),
          reason = val(fd, "notes");
        if (!returned && !keptRent && !keptDamage)
          throw fieldError("returned", "Enter at least one amount.");
        if (!reason) throw fieldError("notes", "Say why, in a few words.");
        depositGuard(t, [{ date: day, amount: -(returned + keptRent + keptDamage) }]);
        let portions = [];
        if (keptRent) {
          const months = unpaidFor(t),
            unpaid = sum(months, (x) => x.open);
          if (keptRent > unpaid)
            throw fieldError(
              "keptRent",
              "That is more than the unpaid rent (" + amt(unpaid) + ").",
            );
          const plan = spread(keptRent, months);
          portions = withTerms(
            allocate(
              keptRent,
              months
                .filter((x) => plan.get(x.c.id) > 0)
                .map((x) => ({ chargeId: x.c.id, amount: plan.get(x.c.id) })),
              balances(
                rec("charge").filter((c) => c.tenancyId === t),
                transactions(),
              ),
            ),
          );
        }
        const attachments = oneDoc(fd),
          entry = (i, kind, amount, extra = {}) => ({
            ...base("deposit", ids[i]),
            tenancyId: t,
            date: day,
            amount: -amount,
            kind,
            notes: reason,
            account: "",
            allocations: [],
            attachments,
            ...extra,
          }),
          records = [];
        if (returned) records.push(entry(0, "refund", returned, { account: accountOf(fd) }));
        if (keptRent) records.push(entry(1, "applyRent", keptRent, { allocations: portions }));
        if (keptDamage)
          records.push(
            entry(2, fd.get("flag") ? "retainedReview" : "retainedIncome", keptDamage),
          );
        await pm().batch(records);
        finish("Deposit return saved.");
      },
      key,
      { intro: "Record what happened to the deposit when the tenant moved out." },
    );
    const tenancy = () => form.elements.tenancyId.value,
      e = form.elements,
      day = () => (dateOK(e.date.value) ? e.date.value : today()),
      held = () => Math.max(0, heldFor(tenancy(), day()));
    let ownReturn = false;
    const still = () => {
      const values = [e.returned, e.keptRent, e.keptDamage].map((x) => peek(x.value)),
        left = values.includes(null) ? null : held() - sum(values, (v) => v);
      byId("mf-still").textContent =
        left == null
          ? "Check the amounts. Use numbers like 1250 or 1250.50."
          : left < 0
            ? "That is " + amt(-left) + " more than you are holding."
            : "Still holding: " + amt(left) + ".";
      byId("mf-still").classList.toggle("is-warn", left != null && left < 0);
    };
    const setup = (fresh) => {
      const unpaid = sum(unpaidFor(tenancy()), (x) => x.open),
        name = tenantName(tenancy());
      byId("mf-held").textContent = "You are holding " + amt(held()) + " for " + name + ".";
      byId("mf-rentbox").hidden = !unpaid;
      byId("mf-keptrent-help").textContent =
        name + " owes " + amt(unpaid) + " in unpaid rent. It is applied to the oldest month first.";
      if (fresh) {
        const keep = Math.min(held(), unpaid);
        ownReturn = false;
        e.keptRent.value = inputAmount(keep);
        e.keptDamage.value = "";
        e.returned.value = inputAmount(held() - keep);
      }
      still();
    };
    form.addEventListener("input", (ev) => {
      const name = ev.target.name;
      if (name === "returned") ownReturn = true;
      else if ((name === "keptRent" || name === "keptDamage") && !ownReturn) {
        const kept = [e.keptRent, e.keptDamage].map((x) => peek(x.value));
        if (!kept.includes(null))
          e.returned.value = inputAmount(Math.max(0, held() - sum(kept, (v) => v)));
      }
      still();
    });
    form.addEventListener("change", (ev) => {
      if (ev.target.name === "tenancyId") setup(true);
      else if (ev.target.name === "date") setup(false);
    });
    wireDocField(form);
    bindDraft(form, key, {
      reopen: depositOut,
      extra: () => ({ ownReturn }),
      before: (saved) => {
        ownReturn = Boolean(saved.extra.ownReturn);
      },
      after: (restored) => setup(!restored),
    });
  }
  /* Everything else about the deposit, one entry at a time. */
  function depositOther() {
    if (needTenancy()) return;
    const id = uid(),
      list = rec("tenancy"),
      key = dkey("deposit:other"),
      papers = docField(),
      order = [
        "opening",
        "adjustment",
        "receipt",
        "refund",
        "applyRent",
        "retainedIncome",
        "retainedReview",
      ],
      reasons = {
        opening: "Deposit held before I started using this app",
        adjustment: "",
        receipt: "Security deposit received",
        refund: "Deposit returned to the tenant",
        applyRent: "Deposit used for unpaid rent",
        retainedIncome: "Kept for damage or cleaning",
        retainedReview: "Kept, to be checked with my CPA",
      };
    const form = formDialog(
      "Other deposit change",
      tenantField(list[0].id, "Whose deposit?", list) +
        kit().picks({
          label: "What happened?",
          name: "kind",
          value: order[0],
          options: order.map((k) => [k, depositScreen[k][0], depositScreen[k][1]]),
        }) +
        h(
          "div",
          { class: "ui-grid" },
          kit().money({ label: "Amount", name: "amount", required: true }),
          kit().field({ label: "Date", name: "date", type: "date", value: today(), required: true }),
        ) +
        h(
          "div",
          { id: "mf-bankbox", hidden: true },
          accountField({
            label: "Bank account",
            help: "The account the money went into or came out of.",
            value:
              latest("deposit", (d) => d.account)?.account || latest("payment")?.account,
          }),
        ) +
        h(
          "fieldset",
          { id: "mf-monthbox", class: "ui-group ui-wide", hidden: true },
          h("legend", null, "Which month's rent?"),
          h("div", { id: "mf-depalloc", class: "ui-stack" }),
        ) +
        kit().textarea({
          label: "Reason",
          name: "notes",
          rows: 2,
          required: true,
          value: reasons[order[0]],
          help: "A few words on why. It is kept with the entry.",
        }) +
        (papers ? kit().more("More options", papers) : ""),
      "Save",
      async (fd) => {
        const k = fd.get("kind");
        if (!Object.hasOwn(deposits, k)) throw fieldError("kind", "Choose what happened.");
        const reason = val(fd, "notes");
        if (!reason) throw fieldError("notes", "Say why, in a few words.");
        const t = tenantOf(fd),
          a = entered(fd.get("amount"), k !== "adjustment", "amount"),
          day = dateOf(fd, "date");
        if (!a) throw fieldError("amount", "Enter an amount that is not zero.");
        const value = ["refund", "applyRent", "retainedIncome", "retainedReview"].includes(k)
          ? -a
          : a;
        if (value < 0) depositGuard(t, [{ date: day, amount: value }]);
        const portions = k === "applyRent" ? formAllocations(fd, a, t) : [];
        if (k === "applyRent" && sum(portions, (r) => r.amount) !== a)
          throw new Error(
            "The months must add up to the amount (" +
              amt(a) +
              "). They add up to " +
              amt(sum(portions, (r) => r.amount)) +
              ".",
          );
        await pm().save("deposit", {
          ...base("deposit", id),
          tenancyId: t,
          date: day,
          amount: value,
          kind: k,
          notes: reason,
          account: k === "receipt" || k === "refund" ? accountOf(fd) : "",
          allocations: portions,
          attachments: oneDoc(fd),
        });
        finish("Saved.");
      },
      key,
      { intro: "For anything about the deposit that the other two buttons do not cover." },
    );
    let lastReason = reasons[order[0]];
    const sync = (user) => {
      const k = form.elements.kind.value;
      byId("mf-bankbox").hidden = k !== "receipt" && k !== "refund";
      byId("mf-monthbox").hidden = k !== "applyRent";
      byId("mf-depalloc").innerHTML =
        k === "applyRent" ? monthBoxes(openCharges(form.elements.tenancyId.value)) : "";
      if (user) {
        const notes = form.elements.notes;
        if (!notes.value.trim() || notes.value === lastReason) notes.value = reasons[k] ?? "";
        lastReason = reasons[k] ?? "";
      }
    };
    form.addEventListener("change", (ev) => {
      if (ev.target.name === "kind" || ev.target.name === "tenancyId") sync(true);
    });
    wireDocField(form);
    bindDraft(form, key, {
      reopen: depositOther,
      extra: () => ({ lastReason }),
      before: (saved) => {
        lastReason = saved.extra.lastReason ?? lastReason;
        for (const name of ["kind", "tenancyId"]) {
          const field = saved.fields.find((x) => x.name === name && x.on !== false);
          if (field) form.elements[name].value = field.value;
        }
        sync(false);
      },
      after: (restored) => {
        if (!restored) sync(false);
      },
    });
  }
  /* ---- Forgive unpaid rent (a write-off) ---- */
  function forgiveRent() {
    if (needTenancy()) return;
    const id = uid(),
      list = rec("tenancy").filter((t) => openCharges(t.id).length),
      key = dkey("forgive"),
      papers = docField("Attach a document");
    if (!list.length)
      return show(
        "Forgive unpaid rent",
        h(
          "div",
          { class: "mf-form" },
          h("p", { class: "mf-intro" }, "No unpaid rent to forgive."),
        ),
      );
    const form = formDialog(
      "Forgive unpaid rent",
      tenantField(list[0].id, "Whose rent?", list) +
        h(
          "fieldset",
          { class: "ui-group ui-wide", "aria-describedby": "mf-forgive-help" },
          h("legend", null, "How much to forgive"),
          h(
            "p",
            { class: "ui-help", id: "mf-forgive-help" },
            "Type an amount next to each month. Leave a month empty to keep it owed.",
          ),
          h("div", { id: "mf-depalloc", class: "ui-stack" }),
        ) +
        h("p", { id: "mf-credit", class: "mf-result", "aria-live": "polite" }) +
        kit().textarea({
          label: "Reason",
          name: "notes",
          rows: 2,
          required: true,
          help: "For example: agreed with the tenant in writing.",
        }) +
        kit().field({
          label: "Date",
          name: "date",
          type: "date",
          value: today(),
          required: true,
          help: "The day you agreed to forgive it.",
        }) +
        (papers ? kit().more("More options", papers) : ""),
      "Forgive this rent",
      async (fd) => {
        const t = tenantOf(fd),
          day = dateOf(fd, "date"),
          reason = val(fd, "notes");
        let total = 0;
        for (const [k, v] of fd)
          if (k.startsWith("allocation:") && typed(v) !== "") total += entered(v, true, k);
        if (!total) throw new Error("Enter how much to forgive for at least one month.");
        if (!reason) throw fieldError("notes", "Say why, in a few words.");
        await pm().save("writeoff", {
          ...base("writeoff", id),
          tenancyId: t,
          date: day,
          amount: total,
          kind: "writeoff",
          notes: reason,
          account: "",
          allocations: formAllocations(fd, total, t),
          attachments: oneDoc(fd),
        });
        finish("Saved. That rent is no longer owed.");
      },
      key,
      {
        intro:
          "Use this when you have agreed the tenant no longer owes this rent. It is not income and not an expense.",
      },
    );
    const draw = () => {
      byId("mf-depalloc").innerHTML = monthBoxes(openCharges(form.elements.tenancyId.value));
    };
    const total = () => {
      let amount = 0,
        unread = false;
      for (const input of form.querySelectorAll('[name^="allocation:"]')) {
        const value = peek(input.value);
        if (value == null) unread = true;
        else amount += value;
      }
      byId("mf-credit").textContent = unread
        ? "Check the amounts. Use numbers like 1250 or 1250.50."
        : amount > 0
          ? "Forgiving " + amt(amount) + " in total."
          : "";
    };
    form.addEventListener("input", total);
    form.addEventListener("change", (ev) => {
      if (ev.target.name !== "tenancyId") return;
      draw();
      total();
    });
    wireDocField(form);
    bindDraft(form, key, {
      reopen: forgiveRent,
      before: (saved) => {
        const who = saved.fields.find((x) => x.name === "tenancyId" && x.on !== false);
        if (who) form.elements.tenancyId.value = who.value;
        draw();
      },
      after: (restored) => {
        if (!restored) draw();
        total();
      },
    });
  }
  /* ---- One entry: what it is, and how to fix it ---- */
  function aboutEntry(t) {
    const who = tenantName(t.tenancyId),
      when = longDate(t.date);
    if (t.reverses) {
      const original = pm().get(t.reverses);
      return t.type === "payment"
        ? "You returned " + amt(Math.abs(t.amount)) + " of rent to " + who + " on " + when + "."
        : "This undoes an earlier entry" +
            (original ? " dated " + longDate(original.date) : "") +
            ". The two cancel each other out.";
    }
    if (t.type === "payment")
      return (
        who +
        " paid " +
        amt(t.amount) +
        " on " +
        when +
        ({ "Bank transfer": " by bank transfer", Check: " by check", Cash: " in cash" }[t.method] || "") +
        (t.account ? " into " + t.account : "") +
        "."
      );
    if (t.type === "writeoff")
      return (
        "You forgave " +
        amt(sum(t.allocations || [], (a) => a.amount)) +
        " of rent for " +
        who +
        " on " +
        when +
        "."
      );
    if (t.type === "deposit") {
      const a = amt(Math.abs(t.amount));
      return (
        {
          opening: "You were already holding " + a + " for " + who + " on " + when + ".",
          receipt: who + " paid a " + a + " deposit on " + when + ".",
          refund: "You returned " + a + " of the deposit to " + who + " on " + when + ".",
          applyRent: "You used " + a + " of the deposit for " + who + "'s unpaid rent on " + when + ".",
          retainedIncome: "You kept " + a + " of the deposit for damage or cleaning on " + when + ".",
          retainedReview:
            "You kept " + a + " of the deposit on " + when + ". Your CPA will decide how to report it.",
          adjustment: "The deposit balance was corrected by " + signed(t.amount) + " on " + when + ".",
        }[t.kind] || "A deposit entry dated " + when + "."
      );
    }
    const total = amt(Math.abs(t.amount)),
      mine = slices(t, active()),
      cats = [...new Set((mine.length ? mine : t.splits || []).map((s) => screenCat(s.category)))],
      what = cats.length > 1 ? " Split between " + joinAnd(cats) + "." : " Category: " + cats[0] + ".",
      from = t.account ? " from " + t.account : "",
      into = t.account ? " into " + t.account : "";
    switch (t.mode) {
      case "refund":
        return t.vendor + " refunded you " + total + " on " + when + into + "." + what;
      case "incoming":
        return "You received " + total + " from " + t.vendor + " on " + when + into + ". Recorded as: " + joinAnd(cats) + ".";
      case "tenantPaid":
        return "Your tenant paid " + t.vendor + " " + total + " for you on " + when + ". It counts as rent income and as an expense." + what;
      case "depreciation":
        return "Depreciation of " + total + " dated " + when + ", from your CPA.";
      case "mortgage":
        return "You made a mortgage payment of " + total + " to " + t.vendor + " on " + when + from + ".";
      case "escrowDisbursement":
        return "Your lender paid " + t.vendor + " " + total + " from escrow on " + when + "." + what;
      default:
        return "You paid " + t.vendor + " " + total + " on " + when + from + "." + what;
    }
  }
  function transactionDetail(id) {
    const t = pm().get(id);
    if (!t) return;
    const v = classification(t, active()),
      linked = rec("bankline").filter((b) => b.matchedId === id),
      undoneBy = transactions().find((r) => r.reverses === id && r.kind !== "rentRefund"),
      reversible = !t.reverses && !transactions().some((r) => r.reverses === id),
      payment =
        t.type === "payment" && !t.reverses
          ? receiptRemaining(t, refundGroups(rec("payment")).get(t.id))
          : null,
      months = (t.allocations || []).map((a) => [
        monthName(pm().get(a.chargeId)?.period || "") || "A month",
        amt(a.amount),
      ]),
      parts = (t.splits || []).map((s) => [
        screenCat(s.category) +
          (s.propertyId && s.propertyId !== t.propertyId
            ? " · " + (pm().get(s.propertyId)?.name || all("property").find((p) => p.id === s.propertyId)?.name || "another property")
            : ""),
        amt(Math.abs(s.amount)),
      ]);
    const choices =
      (payment?.credit > 0
        ? choiceRow(
            "allocate",
            "Apply credit to a month",
            amt(payment.credit) + " of this payment is not applied to a month yet.",
            { id },
          )
        : "") +
      (t.type === "expense" && reversible
        ? choiceRow(
            "reclass",
            "Change category",
            "Pick a different category. The earlier one stays in the history.",
            { id },
          ) +
          choiceRow("linkReceipts", "Add a receipt", "Take a photo or attach a saved file.", { id })
        : "") +
      (payment?.amount > 0
        ? choiceRow(
            "rentRefund",
            "Refund rent",
            "You gave some of this back, or the amount was entered too high.",
            { id },
          )
        : "") +
      (reversible && t.type !== "payment"
        ? choiceRow(
            "reverse",
            "Undo this entry",
            "Keeps the original and adds an opposite entry.",
            { id },
          )
        : "") +
      (reversible && t.type === "expense"
        ? choiceRow(
            "redo",
            "Undo and enter again",
            "To fix the amount, date or name. Opens a new form with the same details.",
            { id },
          )
        : "");
    show(
      titleOf(t),
      h(
        "div",
        { class: "mf-form" },
        h("p", { class: "mf-callout" }, esc(aboutEntry(t))),
        undoneBy
          ? kit().note(
              "warn",
              esc("This entry was undone on " + longDate(undoneBy.date) + ". It no longer counts."),
            )
          : "",
        facts([
          ["Date", longDate(t.date)],
          [
            t.type === "payment"
              ? t.reverses
                ? "Paid back from"
                : "Deposited into"
              : t.type === "expense"
                ? t.amount < 0
                  ? "Deposited into"
                  : "Paid from"
                : "Bank account",
            t.account,
          ],
          ["How it was paid", t.method],
          ["Tenant", t.tenancyId ? tenantName(t.tenancyId) : ""],
          ["Note", t.notes],
          ["Miles driven", t.miles],
          ["Trip", t.trip],
          ["First used", t.inService ? longDate(t.inService) : ""],
          ["Note for my CPA", t.reviewNotes],
        ]),
        months.length ? h("h3", null, "Months") + facts(months) : "",
        parts.length > 1 ? h("h3", null, "Categories") + facts(parts) : "",
        (t.attachments || []).length
          ? h("h3", null, "Receipts") +
              h(
                "div",
                { class: "mf-actions" },
                t.attachments.map((d) =>
                  h(
                    "button",
                    { type: "button", class: "mf-button", "data-act": "doc", "data-id": d },
                    icon("file", 17),
                    esc(pm().get(d)?.name || "Open the file"),
                  ),
                ),
              )
          : "",
        t.reverses ? button("activity", "See the original entry", { id: t.reverses }) : "",
        undoneBy ? button("activity", "See the entry that undid it", { id: undoneBy.id }) : "",
        choices
          ? h("h3", null, "Need to change something?") + h("div", { class: "mf-choices" }, choices)
          : "",
        kit().more(
          "Details for my CPA",
          facts([
            ["Money in or out of the bank", signed(v.cash)],
            ["Counts as income", amt(v.income)],
            ["Counts as expense", amt(v.expenses)],
            ["Change in deposit held", t.type === "deposit" ? signed(t.amount) : ""],
            ["Entry ID", t.id],
            ["Undoes entry", t.reverses],
            ["Matched bank reference", linked.map((x) => x.reference || x.id).join(", ")],
          ]) +
            (t.categoryHistory?.length
              ? h("h3", null, "Category changes") +
                t.categoryHistory
                  .map((item) =>
                    note(
                      longDate(item.at) +
                        " · " +
                        item.reason +
                        " · Before: " +
                        item.previous
                          .map((s) => screenCat(s.category) + " " + amt(Math.abs(s.amount)))
                          .join(", "),
                    ),
                  )
                  .join("")
              : ""),
        ),
      ),
    );
  }
  function reclassify(t) {
    if (
      !t ||
      t.type !== "expense" ||
      t.reverses ||
      transactions().some((r) => r.reverses === t.id)
    )
      throw new Error("Only an expense that has not been undone can change category.");
    const allowed = allowedCats(t.mode),
      key = dkey("reclass:" + t.id);
    const form = formDialog(
      "Change category",
      h("p", { class: "mf-callout" }, esc(aboutEntry(t))) +
        t.splits
          .map((s, i) =>
            catPicker(i, s.category, allowed, {
              part: false,
              quick: modeCats[t.mode] ? modeCats[t.mode].filter((k) => k !== "review") : undefined,
              label:
                t.splits.length > 1
                  ? "Part " + (i + 1) + " — " + amt(Math.abs(s.amount))
                  : "What was it for?",
            }),
          )
          .join("") +
        kit().field({
          label: "Why are you changing it?",
          name: "reason",
          required: true,
          attrs: 'maxlength="500"',
          help: "A few words. Kept with the entry for your CPA.",
        }),
      "Save category",
      async (fd) => {
        const reason = val(fd, "reason");
        const splits = t.splits.map((s, i) => ({
          ...s,
          category: fd.get("category" + i),
        }));
        if (splits.some((s) => !Object.hasOwn(categories, s.category)))
          throw fieldError("catPick0", "Choose what it was for.");
        if (splits.every((s, i) => s.category === t.splits[i].category))
          throw fieldError("catPick0", "Choose a different category from the one it has now.");
        if (!reason) throw fieldError("reason", "Say why, in a few words.");
        if (
          t.mode === "incoming" &&
          splits.some((s) => !modeCats.incoming.includes(s.category))
        )
          throw new Error("Choose what kind of money this was from the choices shown.");
        if (
          t.mode === "escrowDisbursement" &&
          splits.some((s) => !modeCats.escrowDisbursement.includes(s.category))
        )
          throw new Error("Choose property tax, insurance, or not sure.");
        await pm().save("expense", {
          ...t,
          splits,
          categoryHistory: [
            ...(t.categoryHistory || []),
            { at: new Date().toISOString(), reason, previous: t.splits },
          ],
        });
        finish("Category changed.");
      },
      key,
      {
        intro:
          "The earlier category and your reason are kept. Packets you already made do not change.",
      },
    );
    watchCats(form);
    bindDraft(form, key, {
      reopen: () => reclassify(t),
      after: () => t.splits.forEach((s, i) => syncCat(form, i)),
    });
  }
  function linkReceipts(t) {
    const linked = new Set(t.attachments || []),
      ids = new Set(),
      key = dkey("attachments:" + t.id);
    let shots = null;
    const form = formDialog(
      "Add a receipt",
      h("p", { class: "mf-callout" }, esc(aboutEntry(t))) + receiptStrip(),
      "Save",
      async () => {
        if (shots.pending())
          throw new Error("One moment. The receipt is still being saved.");
        const selected = [...ids].filter((id) => !linked.has(id));
        if (!selected.length)
          throw new Error("Take a photo, choose a file, or tick a saved receipt first.");
        const attachments = [...new Set([...(t.attachments || []), ...selected])];
        const updated = selected
          .map((id) => pm().get(id))
          .filter((d) => d.receiptInbox && !d.immutable)
          .map((d) => ({
            ...d,
            immutable: true,
            receiptInbox: false,
            transactionId: t.id,
          }));
        await pm().batch([{ ...t, attachments }, ...updated]);
        finish("Receipt added.");
      },
      key,
      {
        intro: "Attach a photo or file to this entry.",
        onClose: () => shots?.release(),
      },
    );
    shots = wireReceipts(form, ids, {
      locked: linked,
      available: () =>
        all("document").filter(
          (d) =>
            financialDoc(d) &&
            (d.propertyId === t.propertyId ||
              t.splits?.some((s) => s.propertyId === d.propertyId)),
        ),
    });
  }
  function reverse(id, again = false) {
    const t = pm().get(id);
    if (!t) return;
    const newId = uid(),
      key = dkey((again ? "again:" : "reverse:") + id);
    const form = formDialog(
      again ? "Undo and enter again" : "Undo this entry",
      h("p", { class: "mf-callout" }, esc(aboutEntry(t))) +
        kit().field({
          label: "Date of the undo",
          name: "date",
          type: "date",
          value: today(),
          required: true,
          help: "Today for a mistake, or the day the money actually came back.",
        }) +
        kit().field({
          label: "Why?",
          name: "reason",
          value: again ? "Entered again with corrections" : "",
          required: true,
          attrs: 'maxlength="500"',
        }),
      again ? "Undo and open a new form" : "Undo this entry",
      async (fd) => {
        const current = pm().get(id),
          day = dateOf(fd, "date"),
          reason = val(fd, "reason");
        if (!reason) throw fieldError("reason", "Say why, in a few words.");
        if (transactions().some((r) => r.reverses === id) || current.reverses)
          throw new Error("This entry has already been undone.");
        if (day < current.date)
          throw fieldError(
            "date",
            "Choose " + longDate(current.date) + " or a later date.",
          );
        const r = {
          ...base(current.type, newId),
          date: day,
          tenancyId: current.tenancyId,
          amount: -current.amount,
          mode: current.mode,
          kind: current.kind,
          method: current.method,
          account: current.account,
          vendor: current.vendor,
          notes: reason,
          reverses: id,
          allocations: (current.allocations || []).map((a) => ({
            ...a,
            amount: -a.amount,
          })),
          splits: (current.splits || []).map((s) => ({
            ...s,
            amount: -s.amount,
          })),
          attachments: current.attachments || [],
        };
        if (
          current.type === "deposit" &&
          r.amount < 0 &&
          sum(
            rec("deposit").filter(
              (d) => d.tenancyId === r.tenancyId && d.date <= day,
            ),
            (d) => d.amount,
          ) +
            r.amount <
            0
        )
          throw new Error(
            "Undoing this would take the deposit below zero. Undo the later deposit entries first.",
          );
        await pm().save(current.type, r);
        if (!again) return finish("Undone. The original entry is kept in your records.");
        pm().close();
        pm().refresh();
        pm().toast("Undone. Now enter it again with the right details.");
        opening = null;
        expenseForm({ prefill: current, mode: current.mode });
      },
      key,
      {
        intro:
          "The original stays in your records. This adds an equal, opposite entry so the two cancel out.",
      },
    );
    bindDraft(form, key, { reopen: () => reverse(id, again) });
  }
  function refundRent(t) {
    if (!t || t.type !== "payment" || t.reverses)
      throw new Error("Open the original rent payment to refund it.");
    const remaining = receiptRemaining(
        t,
        refundGroups(rec("payment")).get(t.id),
      ),
      id = uid(),
      key = dkey("rentRefund:" + t.id);
    if (remaining.amount <= 0)
      throw new Error("This payment has already been returned in full.");
    const entries = [...remaining.byCharge]
      .filter(([, n]) => n > 0)
      .map(([chargeId, n]) => ({ chargeId, n, c: pm().get(chargeId) }))
      .sort((a, b) => String(b.c?.date || "").localeCompare(String(a.c?.date || "")));
    const box = (x) => named(form, "refund:" + x.chargeId);
    /* Unused credit goes back first, then rent from the newest month backwards. */
    const plan = (amount) => {
      let left = Math.max(0, (amount || 0) - remaining.credit);
      const out = new Map();
      for (const x of entries) {
        const take = Math.min(left, x.n);
        left -= take;
        out.set(x.chargeId, take);
      }
      return out;
    };
    const first = plan(remaining.amount);
    let manual = false;
    const form = formDialog(
      "Refund rent",
      h("p", { class: "mf-callout" }, esc(aboutEntry(t))) +
        h(
          "div",
          { class: "ui-grid" },
          kit().money({
            label: "Amount returned",
            name: "amount",
            value: inputAmount(remaining.amount),
            required: true,
          }),
          kit().field({
            label: "Date returned",
            name: "date",
            type: "date",
            value: today(),
            required: true,
          }),
        ) +
        (entries.length
          ? h(
              "fieldset",
              { class: "ui-group ui-wide", "aria-describedby": "mf-refund-help" },
              h("legend", null, "Which month's rent is being returned?"),
              h(
                "p",
                { class: "ui-help", id: "mf-refund-help" },
                remaining.credit
                  ? "Filled in for you. The first " + amt(remaining.credit) + " comes from credit that was not applied to a month."
                  : "Filled in for you. That month will show as owed again.",
              ),
              entries.map((x) =>
                kit().money({
                  label: monthName(x.c?.period || "") + " — up to " + amt(x.n),
                  name: "refund:" + x.chargeId,
                  value: inputAmount(first.get(x.chargeId)),
                }),
              ),
            )
          : "") +
        kit().field({
          label: "Why?",
          name: "reason",
          required: true,
          attrs: 'maxlength="500"',
          help: "For example: overpaid, or check number of the refund.",
        }) +
        kit().more(
          "More options",
          accountField({
            label: "Paid back from",
            help: "The bank account the refund came out of.",
            value: t.account,
          }),
        ),
      "Save refund",
      async (fd) => {
        const value = entered(fd.get("amount"), true, "amount"),
          day = dateOf(fd, "date");
        if (day < t.date)
          throw fieldError("date", "Choose " + longDate(t.date) + " or a later date.");
        const current = pm().get(t.id),
          left = receiptRemaining(
            current,
            refundGroups(rec("payment")).get(t.id),
          );
        if (value > left.amount)
          throw fieldError(
            "amount",
            "That is more than is left of this payment (" + amt(left.amount) + ").",
          );
        const allocations = [];
        for (const [name, raw] of fd)
          if (name.startsWith("refund:") && typed(raw) !== "") {
            const chargeId = name.slice(7),
              n = entered(raw, false, name);
            if (!n) continue;
            if (n < 0 || n > (left.byCharge.get(chargeId) || 0))
              throw fieldError(name, "That is more than this payment put toward that month.");
            const original = current.allocations.find(
              (a) => a.chargeId === chargeId,
            );
            allocations.push({ ...original, amount: -n });
          }
        const fromCredit = value + sum(allocations, (a) => a.amount);
        if (fromCredit < 0 || fromCredit > left.credit)
          throw new Error(
            "The months must add up to " +
              amt(Math.max(0, value - left.credit)) +
              (left.credit ? " or more, up to " + amt(value) : "") +
              ". They add up to " +
              amt(-sum(allocations, (a) => a.amount)) +
              ".",
          );
        const reason = val(fd, "reason");
        if (!reason) throw fieldError("reason", "Say why, in a few words.");
        await pm().save("payment", {
          ...base("payment", id),
          tenancyId: t.tenancyId,
          amount: -value,
          date: day,
          account: accountOf(fd),
          method: t.method || "",
          notes: reason,
          kind: "rentRefund",
          reverses: t.id,
          allocations,
        });
        finish("Refund saved. The original payment is kept in your records.");
      },
      key,
      {
        intro:
          "Record rent you gave back. The original payment stays as it is, and this is saved as its own entry.",
      },
    );
    form.addEventListener("input", (ev) => {
      const name = ev.target.name || "";
      if (name.startsWith("refund:")) manual = true;
      else if (name === "amount" && !manual) {
        const next = plan(peek(ev.target.value));
        for (const x of entries) box(x).value = inputAmount(next.get(x.chargeId));
      }
    });
    bindDraft(form, key, {
      reopen: () => refundRent(t),
      extra: () => ({ manual }),
      before: (saved) => {
        manual = Boolean(saved.extra.manual);
      },
    });
  }
  /* ---- Bank: import a file, match its lines, check the statement balance ---- */
  function bankDate(input, format) {
    let value = String(input ?? "").trim();
    if (format === "mdy") {
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/.exec(value);
      if (!m) throw new Error("Expected month/day/year.");
      value =
        (m[3].length === 2 ? "20" + m[3] : m[3]) +
        "-" +
        m[1].padStart(2, "0") +
        "-" +
        m[2].padStart(2, "0");
    }
    return date(value);
  }
  function bankAmount(value) {
    let raw = String(value || "").trim();
    if (/^\(.*\)$/.test(raw)) raw = "-" + raw.slice(1, -1);
    raw = raw.replace(/^(-?)\$/, "$1");
    if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw))
      throw new Error("Invalid bank amount.");
    return cents(raw.replace(/,/g, ""));
  }
  async function digestString(str) {
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(str),
    );
    return Array.from(new Uint8Array(buf), (v) =>
      v.toString(16).padStart(2, "0"),
    ).join("");
  }
  /* Best guesses for which column is which, so most files need no questions. */
  function guessColumns(rows, account) {
    const head = rows[0].map((x) => String(x || "").trim()),
      find = (pattern, skip = []) =>
        head.findIndex((x, i) => pattern.test(x) && !skip.includes(i)),
      filled = (i) => i >= 0 && rows.slice(1).every((r) => String(r[i] || "").trim()),
      dateCol = find(/date/i),
      descriptionCol = [/desc/i, /merchant|payee/i, /memo|details/i, /name/i]
        .map((pattern) => find(pattern, [dateCol]))
        .find((i) => i >= 0) ?? -1,
      amountCol = find(/amount|total/i, [dateCol, descriptionCol]),
      outCol = find(/debit|withdraw|money out|paid out/i, [dateCol, descriptionCol]),
      inCol = find(/credit|deposit|money in|paid in/i, [dateCol, descriptionCol, outCol]),
      sample = dateCol >= 0 ? String(rows[1][dateCol] || "").trim() : "",
      earlier = rec("bankline").filter((b) => b.account === account);
    let refCol = find(
      /^(id|#|fitid|trans(action)?[ ._-]?(id|number|no\.?|#)|ref(erence)?([ ._-]?(id|number|no\.?|#))?|confirmation([ ._-]?(number|no\.?|#))?)$/i,
      [dateCol, descriptionCol, amountCol],
    );
    /* Use the bank's own ID only when every line has one, none repeats, and earlier
       imports for this account were identified the same way. */
    if (
      refCol >= 0 &&
      (!filled(refCol) ||
        new Set(rows.slice(1).map((r) => r[refCol].trim())).size !== rows.length - 1 ||
        (earlier.length && !earlier.some((b) => b.reference)))
    )
      refCol = -1;
    const two = amountCol < 0 && outCol >= 0 && inCol >= 0;
    return {
      dateCol,
      descriptionCol,
      amountCol,
      outCol,
      inCol,
      refCol,
      amountMode: two ? "two" : "one",
      format: /^\d{4}-/.test(sample) ? "iso" : "mdy",
      sure: dateCol >= 0 && descriptionCol >= 0 && (two || amountCol >= 0),
    };
  }
  function importCsv() {
    const lastLine = sorted(
      rec("bankline").map((b) => ({ ...b, date: String(b.createdAt || b.date) })),
    )[0];
    let file = null,
      result = null,
      run = 0,
      shown = 0;
    const form = formDialog(
      "Import bank file",
      kit().field({
        label: "Bank file (CSV)",
        name: "statement",
        type: "file",
        attrs: 'accept=".csv,text/csv"',
        required: true,
        help: "Download it from your bank's website. Choose CSV, sometimes called spreadsheet or Excel format.",
      }) +
        accountField({
          label: "Which account is this?",
          help: "The account this file came from.",
          value: lastLine?.account,
        }) +
        h("div", { id: "mf-import", class: "ui-stack" }),
      "Import",
      async () => {
        if (!result) throw fieldError("statement", "Choose your bank file first.");
        const fresh = result.mapped.filter((r) => !pm().get(r.id)),
          skipped = result.ignored + result.mapped.length - fresh.length;
        if (fresh.length) await pm().batch(fresh);
        setTab("reconcile");
        finish(
          fresh.length
            ? plural(fresh.length, "bank transaction") +
                " imported." +
                (skipped ? " " + skipped + " were already there." : "")
            : "Nothing new to import.",
        );
      },
      "",
      {
        wide: true,
        intro:
          "Bring in a file from your bank to check it against what you recorded. Importing does not add income or expenses.",
      },
    );
    const submit = form.querySelector("[type=submit]"),
      area = byId("mf-import"),
      ready = (label, on) => {
        submit.textContent = label;
        submit.disabled = !on;
        if (on) delete submit.dataset.hold;
        else submit.dataset.hold = "1";
      },
      accountNow = () => {
        try {
          return accountOf(new FormData(form));
        } catch {
          return "";
        }
      };
    ready("Import", false);
    const headName = (i) => file.rows[0][i] || "Column " + (Number(i) + 1);
    function columnFields(g) {
      const cols = file.rows[0].map((x, i) => [String(i), x || "Column " + (i + 1)]),
        pick = (label, name, value, o = {}) =>
          kit().select({
            label,
            name,
            options: [[
              "",
              o.none || "Choose a column",
            ], ...cols],
            value: value >= 0 ? String(value) : "",
            optional: o.optional,
            help: o.help,
          });
      return (
        h(
          "div",
          { class: "ui-grid" },
          pick("Date column", "dateCol", g.dateCol),
          pick("Description column", "descriptionCol", g.descriptionCol),
        ) +
        kit().seg({
          label: "How dates are written",
          name: "format",
          options: [
            ["mdy", "Month/day/year"],
            ["iso", "Year-month-day"],
          ],
          value: g.format,
        }) +
        kit().seg({
          label: "Amounts are in",
          name: "amountMode",
          options: [
            ["one", "One column"],
            ["two", "Two columns: money out and money in"],
          ],
          value: g.amountMode,
        }) +
        h(
          "div",
          { id: "mf-one", class: "ui-stack" },
          pick("Amount column", "amountCol", g.amountCol),
          kit().toggle({
            label: "Money out is shown without a minus sign",
            name: "flip",
            help: "Turn on if payments you made appear as plain positive numbers.",
          }),
        ) +
        h(
          "div",
          { id: "mf-two", class: "ui-grid" },
          pick("Money out column", "outCol", g.outCol),
          pick("Money in column", "inCol", g.inCol),
        ) +
        pick("The bank's own ID column", "refCol", g.refCol, {
          optional: true,
          none: "None",
          help: "Lets the app skip transactions you already imported.",
        })
      );
    }
    const mapping = () => {
      const fd = new FormData(form),
        col = (name) => (fd.get(name) === "" || fd.get(name) == null ? -1 : Number(fd.get(name)));
      return {
        dateCol: col("dateCol"),
        descriptionCol: col("descriptionCol"),
        amountCol: col("amountCol"),
        outCol: col("outCol"),
        inCol: col("inCol"),
        refCol: col("refCol"),
        format: fd.get("format") || "mdy",
        amountMode: fd.get("amountMode") || "one",
        flip: Boolean(fd.get("flip")),
      };
    };
    function problem(message) {
      result = null;
      byId("mf-found").innerHTML = kit().note("warn", esc(message));
      byId("mf-columns").open = true;
      byId("mf-preview").hidden = true;
      ready("Import", false);
    }
    /* Turn the file into bank lines with the current column choices. */
    async function compute() {
      if (!file) return;
      const ticket = ++run,
        m = mapping(),
        account = accountNow(),
        two = m.amountMode === "two";
      byId("mf-one").hidden = two;
      byId("mf-two").hidden = !two;
      const needed = two
        ? [m.dateCol, m.descriptionCol, m.outCol, m.inCol]
        : [m.dateCol, m.descriptionCol, m.amountCol];
      if (needed.some((i) => i < 0))
        return problem("Tell the app which column is which, then the preview appears.");
      if (new Set(needed).size !== needed.length)
        return problem("Each choice needs a different column.");
      if (!account) return problem("Choose which account this file is from.");
      const mapped = [],
        seen = new Set(),
        existing = new Set(rec("bankline").map((b) => b.id)),
        side = (value) => (String(value || "").trim() ? Math.abs(bankAmount(value)) : 0);
      let ignored = 0,
        zero = 0;
      for (let i = 1; i < file.rows.length; i++) {
        const r = file.rows[i],
          line = "Line " + (i + 1) + ": ";
        let day, amount;
        try {
          day = bankDate(r[m.dateCol], m.format);
        } catch {
          return problem(
            line +
              "the date “" +
              r[m.dateCol] +
              "” could not be read. Check the date column and how dates are written.",
          );
        }
        try {
          amount = two
            ? side(r[m.inCol]) - side(r[m.outCol])
            : (m.flip ? -1 : 1) * bankAmount(r[m.amountCol]);
        } catch {
          return problem(
            line +
              "the amount “" +
              (two ? r[m.outCol] || r[m.inCol] : r[m.amountCol]) +
              "” could not be read. Check the amount column.",
          );
        }
        if (!amount) {
          zero++;
          continue;
        }
        const reference = m.refCol >= 0 ? r[m.refCol].trim() : "",
          stable = reference ? "ref:" + reference : "file:" + file.hash + ":" + i,
          id = "bank:" + (await digestString(JSON.stringify([active(), account, stable])));
        if (ticket !== run) return;
        if (seen.has(id))
          return problem(
            line +
              "the bank's ID “" +
              reference +
              "” appears twice in this file. Choose None for the ID column.",
          );
        seen.add(id);
        const description = r[m.descriptionCol].trim();
        if (!description)
          return problem(line + "there is no description. Check the description column.");
        if (existing.has(id)) {
          const prev = pm().get(id);
          if (prev.amount !== amount || prev.date !== day)
            return problem(
              line +
                "this has the same bank ID as a transaction imported earlier, but a different date or amount.",
            );
          ignored++;
          continue;
        }
        mapped.push({
          ...base("bankline", id),
          date: day,
          amount,
          description,
          account,
          reference,
          sourceHash: file.hash,
          sourceRow: i,
          sourceName: file.name,
          matchedId: "",
        });
      }
      if (ticket !== run) return;
      result = { mapped, ignored, zero };
      const days = mapped.map((x) => x.date).sort(),
        tx = transactions(),
        known = new Set(
          rec("bankline").map((x) => JSON.stringify([x.date, x.amount, x.account])),
        );
      byId("mf-found").innerHTML = h(
        "p",
        { class: "mf-callout" },
        esc(
          (mapped.length
            ? "Found " +
              plural(mapped.length, "new transaction") +
              (days.length ? ", " + shortDate(days[0]) + " to " + longDate(days.at(-1)) : "") +
              "."
            : "Nothing new in this file.") +
            (ignored
              ? " " + (ignored === 1 ? "1 was" : ignored + " were") + " imported before and will be skipped."
              : "") +
            (zero
              ? " " + plural(zero, "line") + " with no amount " + (zero === 1 ? "was" : "were") + " skipped."
              : "") +
            " Date from “" +
            headName(m.dateCol) +
            "”, description from “" +
            headName(m.descriptionCol) +
            "”, amount from “" +
            (two ? headName(m.outCol) + "” and “" + headName(m.inCol) : headName(m.amountCol)) +
            "”.",
        ),
      );
      const lines = mapped.map((x) => [
        x.sourceRow + 1,
        longDate(x.date),
        x.description,
        signed(x.amount),
        known.has(JSON.stringify([x.date, x.amount, x.account]))
          ? "May already be imported"
          : tx.some(
                (t) =>
                  t.date === x.date &&
                  accountMovement(t) === x.amount &&
                  t.account === x.account,
              )
            ? "Matches something you recorded"
            : "Not recorded yet",
      ]);
      const body = byId("mf-bank-preview"),
        more = byId("mf-more");
      body.innerHTML = "";
      shown = 0;
      const draw = () => {
        const next = lines.slice(shown, shown + 75);
        body.insertAdjacentHTML(
          "beforeend",
          next
            .map((cells) => h("tr", null, cells.map((x) => h("td", null, esc(x)))))
            .join(""),
        );
        shown += next.length;
        more.hidden = shown >= lines.length;
      };
      more.onclick = draw;
      draw();
      byId("mf-preview").hidden = !lines.length;
      ready(
        mapped.length ? "Import " + plural(mapped.length, "transaction") : "Done",
        true,
      );
    }
    form.elements.statement.addEventListener("change", async () => {
      const chosen = form.elements.statement.files[0];
      file = null;
      result = null;
      ++run;
      area.innerHTML = "";
      ready("Import", false);
      clearErrors(form);
      if (!chosen) return;
      try {
        if (chosen.size > 2 * 1024 * 1024)
          throw new Error("That file is larger than 2 MB. Download a shorter date range.");
        const raw = await chosen.text(),
          rows = parseCsv(raw);
        file = { name: chosen.name, rows, hash: await digestString(raw) };
      } catch (e) {
        return failure(
          fieldError(
            "statement",
            /header and 1–5,000/.test(e.message)
              ? "That file has no transactions, or more than 5,000. Choose a CSV with a heading line and up to 5,000 lines."
              : /quot|same number of columns/i.test(e.message)
                ? "That file could not be read as a CSV. Download it again from your bank as CSV."
                : e.message,
          ),
          form,
        );
      }
      const g = guessColumns(file.rows, accountNow());
      area.innerHTML =
        h("div", { id: "mf-found", "aria-live": "polite" }) +
        h(
          "details",
          { class: "ui-more ui-wide", id: "mf-columns", open: !g.sure },
          h("summary", null, "Columns look wrong? Change them"),
          h("div", { class: "ui-more-body" }, columnFields(g)),
        ) +
        h(
          "div",
          { id: "mf-preview" },
          h(
            "div",
            { class: "mf-scroll", tabindex: "0", role: "region", "aria-label": "Preview of the bank transactions" },
            h(
              "table",
              { class: "mf-table" },
              h(
                "thead",
                null,
                h(
                  "tr",
                  null,
                  ["Line", "Date", "Description", "Amount", "What we found"].map((x) =>
                    h("th", { scope: "col" }, x),
                  ),
                ),
              ),
              h("tbody", { id: "mf-bank-preview" }),
            ),
          ),
          h("button", { type: "button", class: "mf-button", id: "mf-more" }, "Show more rows"),
        );
      compute();
    });
    form.addEventListener("change", (ev) => {
      if (ev.target.name && ev.target.name !== "statement") compute();
    });
  }
  function matchingCandidates(row) {
    const linked = new Set(
      rec("bankline")
        .filter((b) => b.matchedId && b.id !== row.id)
        .map((b) => b.matchedId),
    );
    return transactions()
      .filter(
        (t) =>
          t.propertyId === row.propertyId &&
          !linked.has(t.id) &&
          accountMovement(t) === row.amount &&
          t.account === row.account,
      )
      .sort(
        (a, b) =>
          Math.abs(Date.parse(a.date) - Date.parse(row.date)) -
          Math.abs(Date.parse(b.date) - Date.parse(row.date)),
      );
  }
  /* For each unmatched line, the one entry that is clearly the same: same account and
     amount, within ten days, and no other candidate nearly as close. */
  function suggestions(lines) {
    const linked = new Set(
        rec("bankline")
          .filter((b) => b.matchedId)
          .map((b) => b.matchedId),
      ),
      pool = new Map(),
      taken = new Set(),
      out = new Map();
    for (const t of transactions()) {
      const move = accountMovement(t);
      if (!move || linked.has(t.id) || t.propertyId !== active()) continue;
      const key = t.account + "\n" + move;
      if (!pool.has(key)) pool.set(key, []);
      pool.get(key).push(t);
    }
    for (const b of [...lines].sort((x, y) => x.date.localeCompare(y.date))) {
      const near = (pool.get(b.account + "\n" + b.amount) || [])
        .filter((t) => !taken.has(t.id))
        .map((t) => ({ t, gap: Math.abs(dayNumber(t.date) - dayNumber(b.date)) }))
        .sort((x, y) => x.gap - y.gap);
      if (near.length && near[0].gap <= 10 && (near.length < 2 || near[1].gap - near[0].gap >= 5)) {
        out.set(b.id, near[0].t);
        taken.add(near[0].t.id);
      }
    }
    return out;
  }
  async function saveMatch(bankId, entryId) {
    const b = pm().get(bankId);
    if (!b || b.matchedId)
      throw new Error("This bank transaction has already been matched.");
    if (!matchingCandidates(b).some((t) => t.id === entryId))
      throw new Error(
        "That entry no longer fits. Its amount or account changed, or it was matched to something else.",
      );
    await pm().save("bankline", {
      ...b,
      matchedId: entryId,
      linkedAt: new Date().toISOString(),
    });
    finish("Matched.");
  }
  const bankLine = (b) =>
    longDate(b.date) + " · " + b.description + " · " + signed(b.amount) + " · " + b.account;
  function matchBank(id, older = false) {
    const b = pm().get(id);
    if (!b) return;
    if (b.matchedId) {
      const t = pm().get(b.matchedId);
      show(
        "Matched bank transaction",
        h(
          "div",
          { class: "mf-form" },
          h("p", { class: "mf-callout" }, esc(bankLine(b))),
          h(
            "p",
            { class: "mf-intro" },
            esc(
              t
                ? "Matched to " + titleOf(t) + ", " + longDate(t.date) + "."
                : "Matched to an entry that is no longer here.",
            ),
          ),
          h(
            "div",
            { class: "mf-choices" },
            t ? choiceRow("activity", "View what it was matched to", "", { id: b.matchedId }) : "",
            choiceRow(
              "unmatch",
              "This is the wrong match",
              "Puts the bank transaction back in the list to match again.",
              { id },
            ),
          ),
        ),
      );
      return;
    }
    const every = matchingCandidates(b),
      close = every.filter((t) => Math.abs(dayNumber(t.date) - dayNumber(b.date)) <= 45),
      options = older ? every : close,
      add =
        b.amount > 0
          ? choiceRow("bankpayment", "Add as rent payment", "Rent from a tenant.", { id }) +
            choiceRow("bankentry:refund", "Add as a refund from a vendor", "Money back for something you paid earlier.", { id }) +
            choiceRow("bankentry:incoming", "Add as other money in", "An insurance payout, a loan, or money you put in.", { id })
          : choiceRow("bankexpense", "Add as expense", "Something you paid for the rental.", { id }) +
            choiceRow("bankentry:mortgage", "Add as mortgage payment", "Split into principal, interest and escrow.", { id }) +
            (/escrow/i.test(b.account)
              ? choiceRow("bankentry:escrowDisbursement", "Add as tax or insurance paid from escrow", "From your lender's escrow statement.", { id })
              : "");
    show(
      "Match a bank transaction",
      h(
        "div",
        { class: "mf-form" },
        h("p", { class: "mf-callout" }, esc(bankLine(b))),
        h("h3", null, "Is it one of these you already recorded?"),
        options.length
          ? listWrap(
              options
                .map((t) =>
                  row({
                    action: "matchpick",
                    id,
                    with: t.id,
                    title: titleOf(t),
                    sub: longDate(t.date),
                    value: signed(accountMovement(t)),
                    plus: b.amount > 0,
                    status: "Yes, same one",
                  }),
                )
                .join(""),
            )
          : note(
              "Nothing recorded for " +
                amt(Math.abs(b.amount)) +
                (b.amount > 0 ? " into " : " from ") +
                b.account +
                (every.length ? " within 45 days of this date." : ". The account and amount must be the same."),
            ),
        !older && every.length > close.length
          ? button("matchold", "Show older ones (" + (every.length - close.length) + ")", { id })
          : "",
        h("h3", null, "Or add it now"),
        h("div", { class: "mf-choices" }, add),
      ),
    );
  }
  function matchAll() {
    const lines = sorted(rec("bankline").filter((b) => !b.matchedId)),
      guess = suggestions(lines),
      pairs = lines.filter((b) => guess.has(b.id)).map((b) => [b, guess.get(b.id)]);
    if (!pairs.length) return pm().toast("There are no suggested matches right now.");
    formDialog(
      "Confirm suggested matches",
      h(
        "fieldset",
        { class: "ui-group ui-wide" },
        h("legend", null, "Bank transaction and the entry it looks like"),
        pairs.map(([b, t]) =>
          h(
            "label",
            { class: "mf-check" },
            hv("input", { type: "checkbox", name: "pair", value: b.id, checked: true }),
            h(
              "span",
              null,
              esc(shortDate(b.date) + " · " + b.description + " · " + signed(b.amount)),
              h("small", null, esc("Same as " + titleOf(t) + ", " + shortDate(t.date))),
            ),
          ),
        ),
      ),
      "Confirm matches",
      async (fd) => {
        const chosen = new Set(fd.getAll("pair")),
          now = new Date().toISOString(),
          updates = [];
        for (const [b, t] of pairs) {
          if (!chosen.has(b.id)) continue;
          const current = pm().get(b.id);
          if (!current || current.matchedId || !matchingCandidates(current).some((x) => x.id === t.id))
            throw new Error(
              "Your records changed while this was open. Close this and try again.",
            );
          updates.push({ ...current, matchedId: t.id, linkedAt: now });
        }
        if (!updates.length) throw new Error("Tick at least one match.");
        await pm().batch(updates);
        finish(plural(updates.length, "bank transaction") + " matched.");
      },
      "",
      {
        intro:
          "Each one has the same account and amount as a single entry with a nearby date. Untick any that are not the same.",
      },
    );
  }
  function reconcile() {
    const checks = rec("reconciliation"),
      lastCheck = [...checks].sort((a, b) => b.end.localeCompare(a.end))[0],
      lastLine = sorted(rec("bankline"))[0],
      key = dkey("reconcile");
    const prior = (account, before = "9999-12-31") =>
      rec("reconciliation")
        .filter((r) => r.account === account && r.end < before)
        .sort((a, b) => b.end.localeCompare(a.end))[0];
    /* The next statement after the last one checked, otherwise last calendar month. */
    const period = (account) => {
      const last = prior(account),
        start = last ? shiftDay(last.end, 1) : periodAt(today(), -1) + "-01";
      return {
        start,
        end: shiftDay(periodAt(start, 1) + "-01", -1),
        opening: last ? (last.closing / 100).toFixed(2) : "",
      };
    };
    const account0 = lastCheck?.account || lastLine?.account || accounts()[0] || "Rental checking",
      first = period(account0);
    const form = formDialog(
      "Check the statement balance",
      accountField({ label: "Which account?", value: account0 }) +
        h(
          "div",
          { class: "ui-grid" },
          kit().field({
            label: "Statement start",
            name: "start",
            type: "date",
            value: first.start,
            required: true,
            help: "The dates printed on the statement.",
          }),
          kit().field({
            label: "Statement end",
            name: "end",
            type: "date",
            value: first.end,
            required: true,
          }),
        ) +
        h(
          "div",
          { class: "ui-grid" },
          kit().money({
            id: "mf-opening",
            label: "Balance at the start",
            name: "opening",
            value: first.opening,
            required: true,
            help: "The starting balance printed on the statement.",
          }),
          kit().money({
            label: "Balance at the end",
            name: "closing",
            required: true,
            help: "The ending balance printed on the statement.",
          }),
        ) +
        h("div", { id: "mf-cleared", class: "ui-stack" }) +
        h("p", { class: "mf-result", id: "mf-difference", "aria-live": "polite" }) +
        h(
          "div",
          { id: "mf-why", hidden: true },
          kit().textarea({
            label: "Why does it not match?",
            name: "explanation",
            rows: 2,
            help: "For example: a bank fee not recorded yet.",
          }),
        ) +
        kit().note("plain", "A saved statement check cannot be changed later."),
      "Save statement check",
      async (fd) => {
        const account = accountOf(fd),
          start = dateOf(fd, "start", "Choose the statement start date."),
          end = dateOf(fd, "end", "Choose the statement end date.");
        if (end < start)
          throw fieldError("end", "The end date must be on or after the start date.");
        const overlapping = rec("reconciliation").find(
          (r) => r.account === account && r.start <= end && r.end >= start,
        );
        if (overlapping)
          throw fieldError(
            "start",
            "This account was already checked for " +
              longDate(overlapping.start) +
              " to " +
              longDate(overlapping.end) +
              ". Choose later dates.",
          );
        const opening = entered(fd.get("opening"), false, "opening", "Enter the balance at the start."),
          closing = entered(fd.get("closing"), false, "closing", "Enter the balance at the end."),
          cleared = fd.getAll("cleared");
        const ledger = transactions().filter(
          (t) =>
            t.propertyId === active() &&
            t.account === account &&
            t.date >= start &&
            t.date <= end &&
            accountMovement(t) !== 0,
        );
        const permitted = new Set(ledger.map((t) => t.id));
        if (cleared.some((id) => !permitted.has(id)))
          throw new Error(
            "Your records changed while this was open. Close this and start the check again.",
          );
        const bank = rec("bankline").filter(
          (b) => b.account === account && b.date >= start && b.date <= end,
        );
        const movement = sum(
            ledger.filter((t) => cleared.includes(t.id)),
            accountMovement,
          ),
          difference = closing - (opening + movement),
          explanation = val(fd, "explanation");
        if (difference && !explanation)
          throw fieldError(
            "explanation",
            "It is off by " +
              amt(Math.abs(difference)) +
              ". Untick what is not on the statement, or say why it does not match.",
          );
        const before = prior(account, start);
        if (before && opening !== before.closing && !explanation)
          throw fieldError(
            "explanation",
            "The balance at the start is different from the last ending balance (" +
              amt(before.closing) +
              "). Say why.",
          );
        await pm().save("reconciliation", {
          ...base("reconciliation"),
          start,
          end,
          date: end,
          account,
          opening,
          closing,
          movement,
          difference,
          cleared,
          bankIds: bank.map((b) => b.id),
          imported: sum(bank, (b) => b.amount),
          explanation,
          immutable: true,
        });
        finish("Statement check saved.");
      },
      key,
      {
        intro:
          "Compare your records with one bank statement. Type the ending balance and the app does the sums.",
      },
    );
    const box = byId("mf-cleared"),
      e = form.elements,
      ticks = new Map(),
      own = new Set(),
      accountNow = () => {
        try {
          return accountOf(new FormData(form));
        } catch {
          return "";
        }
      };
    function calc() {
      const fd = new FormData(form),
        out = byId("mf-difference"),
        why = byId("mf-why"),
        opening = peek(fd.get("opening")),
        closing = peek(fd.get("closing")),
        before = dateOK(e.start.value) ? prior(accountNow(), e.start.value) : null,
        carried = before && opening != null && typed(fd.get("opening")) !== "" && opening !== before.closing,
        clash =
          dateOK(e.start.value) &&
          dateOK(e.end.value) &&
          rec("reconciliation").find(
            (r) => r.account === accountNow() && r.start <= e.end.value && r.end >= e.start.value,
          );
      let text = "",
        off = false;
      if (clash)
        text =
          "This account was already checked for " +
          longDate(clash.start) +
          " to " +
          longDate(clash.end) +
          ". Choose later dates.";
      else if (opening == null || closing == null)
        text = "Check the balances. Use numbers like 1250 or 1250.50.";
      else if (typed(fd.get("closing")) === "")
        text = "Type the balance at the end to see whether it matches.";
      else {
        const gap =
          closing - opening - sum(fd.getAll("cleared"), (id) => accountMovement(pm().get(id)));
        off = gap !== 0;
        text = off
          ? "Off by " +
            amt(Math.abs(gap)) +
            ". Something on the statement is not recorded, or an entry is ticked that is not on it."
          : "Balanced: your records match the statement.";
      }
      out.textContent = text;
      out.classList.toggle("is-warn", off || Boolean(clash));
      out.classList.toggle("is-ok", !off && !clash && text.startsWith("Balanced"));
      why.hidden = !(off || carried || e.explanation.value.trim());
      byId("mf-opening-help").textContent = before
        ? carried
          ? "Your last check ended at " + amt(before.closing) + "."
          : "Carried over from your last check."
        : "The starting balance printed on the statement.";
    }
    function rows() {
      const account = accountNow(),
        inRange = (x) => x.date >= e.start.value && x.date <= e.end.value,
        list = transactions().filter(
          (t) =>
            t.propertyId === active() &&
            t.account === account &&
            inRange(t) &&
            accountMovement(t),
        ),
        bank = rec("bankline").filter((b) => b.account === account && inRange(b)),
        matched = new Set(bank.map((b) => b.matchedId));
      box.innerHTML = h(
        "fieldset",
        { class: "ui-group ui-wide", "aria-describedby": "mf-cleared-help" },
        h("legend", null, "Entries on this statement"),
        h(
          "p",
          { class: "ui-help", id: "mf-cleared-help" },
          bank.length
            ? "Ticked entries were matched to your bank file. Untick anything the statement does not show."
            : "Tick each entry that appears on the statement.",
        ),
        list.length
          ? sorted(list).map((t) =>
              h(
                "label",
                { class: "mf-check" },
                hv("input", {
                  name: "cleared",
                  type: "checkbox",
                  value: t.id,
                  checked: ticks.has(t.id) ? ticks.get(t.id) : matched.has(t.id),
                }),
                h(
                  "span",
                  null,
                  esc(shortDate(t.date) + " · " + titleOf(t)),
                  h("small", null, esc(signed(accountMovement(t)))),
                ),
              ),
            )
          : note("Nothing was recorded for this account between these dates."),
        bank.length
          ? note(
              "Your bank file has " +
                plural(bank.length, "transaction") +
                " for these dates, adding up to " +
                signed(sum(bank, (b) => b.amount)) +
                ".",
            )
          : "",
      );
      calc();
    }
    form.addEventListener("change", (ev) => {
      const name = ev.target.name;
      if (name === "cleared") ticks.set(ev.target.value, ev.target.checked);
      if (name === "account" || name === "accountOther") {
        /* A different account: suggest its next statement, unless dates were typed by hand. */
        const next = period(accountNow());
        if (!own.has("start")) e.start.value = next.start;
        if (!own.has("end")) e.end.value = next.end;
        if (!own.has("opening")) e.opening.value = next.opening;
      }
      if (["account", "accountOther", "start", "end"].includes(name)) rows();
      else calc();
    });
    form.addEventListener("input", (ev) => {
      const name = ev.target.name;
      if (["start", "end", "opening"].includes(name)) own.add(name);
      if (name === "start" || name === "end") rows();
      else calc();
    });
    bindDraft(form, key, {
      reopen: reconcile,
      extra: () => ({ ticks: [...ticks], own: [...own] }),
      before: (saved) => {
        for (const [id, on] of saved.extra.ticks || []) ticks.set(id, on);
        for (const name of saved.extra.own || []) own.add(name);
      },
      after: () => rows(),
    });
  }
  function reconciliationDetail(id) {
    const r = pm().get(id);
    if (!r) return;
    show(
      "Statement check",
      h(
        "div",
        { class: "mf-form" },
        h(
          "p",
          { class: "mf-callout" },
          esc(
            r.account +
              ", " +
              longDate(r.start) +
              " to " +
              longDate(r.end) +
              ". " +
              (r.difference
                ? "Off by " + amt(Math.abs(r.difference)) + "."
                : "Balanced: your records matched the statement."),
          ),
        ),
        facts([
          ["Balance at the start", amt(r.opening)],
          ["Ticked entries add up to", signed(r.movement)],
          ["Balance at the end", amt(r.closing)],
          ["Off by", amt(Math.abs(r.difference))],
          ["Bank file total for these dates", r.bankIds?.length ? signed(r.imported) : ""],
          ["Why it did not match", r.explanation],
        ]),
        h("h3", null, "Entries on this statement"),
        ledgerRows(
          r.cleared.map((entry) => pm().get(entry)).filter(Boolean),
          "No entries were ticked.",
        ),
        note("A saved statement check cannot be changed."),
      ),
    );
  }
  function reportingProfile(propertyId, year) {
    return (
      all("financeprofile").find(
        (p) => p.propertyId === propertyId && p.year === String(year),
      ) || {}
    );
  }
  /* Days in the year covered by a tenant, from the move-in and move-out dates on file. */
  function rentedDays(propertyId, year) {
    const first = year + "-01-01",
      last = year + "-12-31",
      spans = all("tenancy")
        .filter((t) => t.propertyId === propertyId && dateOK(t.start) && t.start <= last)
        .map((t) => [
          t.start < first ? first : t.start,
          dateOK(t.end) && t.end < last ? t.end : last,
        ])
        .filter(([a, b]) => a <= b)
        .sort((a, b) => a[0].localeCompare(b[0]));
    let days = 0,
      covered = "";
    for (const [a, b] of spans) {
      const from = covered && covered >= a ? shiftDay(covered, 1) : a;
      if (from > b) continue;
      days += dayNumber(b) - dayNumber(from) + 1;
      covered = b;
    }
    return spans.length ? String(days) : "";
  }
  function profile(propertyId = active(), year = state().year) {
    const old = reportingProfile(propertyId, year),
      prev = reportingProfile(propertyId, String(Number(year) - 1)),
      pick = (...values) => values.find((x) => x != null && x !== "") ?? "",
      key = dkey("profile:" + propertyId + ":" + year);
    const form = formDialog(
      "Ownership and rental days",
      kit().field({
        label: "Owner name on the tax return",
        name: "owner",
        value: pick(old.owner, prev.owner),
        attrs: 'maxlength="160" autocomplete="off"',
        help: "The person or company that reports this rental.",
      }) +
        h(
          "div",
          { class: "ui-grid" },
          kit().field({
            label: "Your share of the property",
            name: "share",
            type: "number",
            suffix: "%",
            value: pick(old.share, prev.share, "100"),
            attrs: 'min="0" max="100" step="0.01" inputmode="decimal"',
            help: "100 if you own it alone.",
          }),
          kit().field({
            label: "Days rented in " + year,
            name: "rentalDays",
            type: "number",
            value: pick(old.rentalDays, rentedDays(propertyId, year)),
            attrs: 'min="0" max="366" step="1" inputmode="numeric"',
            help: "Days it was rented at a fair price.",
          }),
        ) +
        kit().field({
          label: "Days you used it yourself",
          name: "personalDays",
          type: "number",
          value: pick(old.personalDays, prev.personalDays, "0"),
          attrs: 'min="0" max="366" step="1" inputmode="numeric"',
          help: "Days you or your family stayed there.",
        }) +
        kit().textarea({
          label: "Notes from or for my CPA",
          name: "notes",
          optional: true,
          rows: 3,
          value: pick(old.notes, prev.notes),
        }),
      "Save",
      async (fd) => {
        const max =
          new Date(Date.UTC(+year, 1, 29)).getUTCMonth() === 1 ? 366 : 365;
        if (Number(fd.get("rentalDays")) + Number(fd.get("personalDays")) > max)
          throw fieldError(
            "rentalDays",
            "The two day counts add up to more than the " + max + " days in " + year + ".",
          );
        await pm().save("financeprofile", {
          ...old,
          id: old.id || "financial-profile:" + propertyId + ":" + year,
          type: "financeprofile",
          propertyId,
          year: String(year),
          owner: val(fd, "owner"),
          share: fd.get("share"),
          rentalDays: fd.get("rentalDays"),
          personalDays: fd.get("personalDays"),
          notes: val(fd, "notes"),
        });
        finish("Saved.");
      },
      key,
      {
        intro:
          "Your CPA needs these for " +
          year +
          ". Check what is filled in, change anything that is wrong, and save.",
      },
    );
    bindDraft(form, key, { reopen: () => profile(propertyId, year) });
  }
  const financialDoc = (d) =>
    /receipt|invoice|tax document|mortgage|1098|bank statement|insurance statement/i.test(
      d.kind || d.category || "",
    );
  function packetData(propertyId, year) {
    const tx = moneyTypes.flatMap(all),
      report = annual(year, propertyId, tx),
      byProperty = (t) => t.propertyId === propertyId;
    const p =
      all("property").find((p) => p.id === propertyId) || pm().get(propertyId);
    const items = report.rows,
      stats = report.totals,
      issues = [];
    const itemIds = new Set(items.map((t) => t.id)),
      linkedFiles = new Set(items.flatMap((t) => t.attachments || []));
    const docs = all("document").filter(
        (d) =>
          byProperty(d) ||
          linkedFiles.has(d.id) ||
          itemIds.has(d.transactionId),
      ),
      docMap = new Map(docs.map((d) => [d.id, d]));
    const reverseLinks = new Map();
    for (const d of docs)
      for (const id of new Set(
        [d.transactionId, ...(d.transactionIds || [])].filter(Boolean),
      )) {
        if (!reverseLinks.has(id)) reverseLinks.set(id, []);
        reverseLinks.get(id).push(d.id);
      }
    const links = (t) => [
      ...new Set([...(t.attachments || []), ...(reverseLinks.get(t.id) || [])]),
    ];
    const profile = reportingProfile(propertyId, year),
      reconciliations = all("reconciliation").filter(
        (r) => byProperty(r) && r.end.startsWith(year),
      );
    const bank = all("bankline").filter(
        (r) => byProperty(r) && r.date.startsWith(year),
      ),
      deposits = all("deposit").filter(byProperty),
      depositOpening = sum(
        deposits.filter((d) => d.date.slice(0, 4) < year),
        (d) => d.amount,
      );
    const charges = all("charge").filter(byProperty),
      review = (id, topic, message) => issues.push({ id, topic, message });
    if (year !== "2025") review("", "Mapping", mapping(year));
    if (!profile.owner || profile.share == null || profile.share === "")
      review(
        "",
        "Ownership",
        "Confirm taxpayer/entity and ownership allocation.",
      );
    if (
      profile.rentalDays == null ||
      profile.rentalDays === "" ||
      profile.personalDays == null ||
      profile.personalDays === ""
    )
      review(
        "",
        "Rental use",
        "Supply fair rental and personal-use day counts.",
      );
    if (!reconciliations.length)
      review(
        "",
        "Reconciliation",
        "No statement-period reconciliation is recorded for this year.",
      );
    const same = new Map();
    for (const t of items) {
      if (t.type === "expense") {
        if (!links(t).length)
          review(
            t.id,
            "Evidence",
            "No supporting receipt or statement attached.",
          );
        for (const s of slices(t, propertyId)) {
          if (
            ["review", "recovery", "reimbursement", "capital"].includes(
              s.category,
            )
          )
            review(
              t.id,
              labelCat(s.category),
              "CPA classification or basis review required.",
            );
          if (s.category === "capital" && !t.inService)
            review(t.id, "Asset date", "In-service date is unknown.");
        }
      }
      if (
        t.type === "payment" &&
        t.amount !== sum(t.allocations || [], (a) => a.amount)
      )
        review(
          t.id,
          "Allocation",
          "Payment has an unapplied amount; receipt-year income includes the full payment.",
        );
      if (t.reverses && pm().get(t.reverses)?.date?.slice(0, 4) !== year)
        review(
          t.id,
          "Prior-year reversal",
          "Verify the reporting treatment of the refund, returned payment, or correction against the original year.",
        );
      if (
        t.type === "deposit" &&
        ["retainedReview", "adjustment"].includes(t.kind)
      )
        review(
          t.id,
          "Deposit",
          "Confirm the operational and tax treatment of this entry.",
        );
      if (t.type === "expense" || t.type === "payment") {
        const key = JSON.stringify([
          t.type,
          t.account,
          t.date,
          t.amount,
          t.vendor || t.tenancyId,
        ]);
        if (same.has(key))
          review(
            t.id,
            "Possible duplicate",
            "Review alongside " +
              same.get(key) +
              ". Equal-value entries are retained.",
          );
        else same.set(key, t.id);
      }
      for (const id of links(t)) {
        const d = docMap.get(id);
        if (!d || !financialDoc(d))
          review(
            t.id,
            "Attachment",
            "Linked evidence " + id + " requires manual inclusion or review.",
          );
      }
    }
    for (const b of bank)
      if (!b.matchedId)
        review(
          b.id,
          "Bank match",
          "Imported line awaits matching; excluded from ledger totals.",
        );
    for (const r of reconciliations)
      if (r.difference)
        review(
          r.id,
          "Reconciliation",
          amt(r.difference) + " difference. " + r.explanation,
        );
    const depositClosing =
      depositOpening +
      sum(
        items.filter((t) => t.type === "deposit"),
        (t) => t.amount,
      );
    if (depositClosing < 0)
      review("", "Deposit", "Review negative ending liability.");
    return {
      p,
      profile,
      report,
      items,
      stats,
      issues,
      docs,
      docMap,
      links,
      reconciliations,
      bank,
      deposits,
      depositOpening,
      depositClosing,
      charges,
      year,
      propertyId,
    };
  }
  /* ---- Tax time: what to double-check, and the packet itself ---- */
  const calmMapping = (year) =>
    "Categories follow the 2025 IRS Schedule E." +
    (String(year) === "2025" ? "" : " Your CPA will confirm them for " + year + ".");
  /* The packet's review list, grouped into plain lines the owner can act on. */
  function issueGroups(data) {
    const groups = new Map(),
      entries = (n) => plural(n, "entry", "entries");
    const add = (key, issue, label, o = {}) => {
      if (!groups.has(key)) groups.set(key, { key, label, ids: new Set(), count: 0, ...o });
      const group = groups.get(key);
      group.count++;
      if (issue.id) group.ids.add(issue.id);
    };
    for (const issue of data.issues) {
      const { topic, message, id } = issue;
      if (topic === "Mapping") continue;
      if (topic === "Ownership" || topic === "Rental use")
        add("profile", issue, () => "Owner name and rental days are not filled in", {
          action: "profile",
          one: true,
        });
      else if (topic === "Reconciliation" && !id)
        add("nocheck", issue, () => "No bank statement was checked for " + data.year, {
          action: "goto:reconcile",
          one: true,
        });
      else if (topic === "Reconciliation")
        add("offcheck", issue, (n) => plural(n, "statement check") + " did not balance", {
          action: "goto:reconcile",
        });
      else if (topic === "Evidence")
        add(
          "noreceipt",
          issue,
          (n) => (n === 1 ? "1 expense has no receipt" : n + " expenses have no receipt"),
          { list: true },
        );
      else if (/classification or basis/.test(message) && topic === labelCat("review"))
        add("unsure", issue, (n) => entries(n) + " marked “ask my CPA”", { list: true });
      else if (/classification or basis/.test(message))
        add("cpa", issue, (n) => entries(n) + " your CPA decides how to report", {
          list: true,
        });
      else if (topic === "Asset date")
        add("asset", issue, (n) => plural(n, "big purchase") + " with no “first used” date", {
          list: true,
        });
      else if (topic === "Allocation")
        add("credit", issue, (n) => plural(n, "payment") + " not fully applied to a month", {
          action: "credit",
        });
      else if (topic === "Prior-year reversal")
        add("prior", issue, (n) => entries(n) + " that undo something from an earlier year", {
          list: true,
        });
      else if (topic === "Deposit")
        add(
          "deposit",
          issue,
          (n) => plural(n, "deposit entry", "deposit entries") + " for your CPA to look at",
          { list: true },
        );
      else if (topic === "Possible duplicate")
        add("double", issue, (n) => entries(n) + " that may have been entered twice", {
          list: true,
        });
      else if (topic === "Attachment")
        add("attach", issue, (n) => plural(n, "attached file") + " that may not be a receipt", {
          list: true,
        });
      else if (topic === "Bank match")
        add("bank", issue, (n) => plural(n, "bank transaction") + " not matched", {
          action: "goto:reconcile",
        });
      else add("other:" + topic, issue, (n) => topic + " (" + n + ")", { list: true });
    }
    return [...groups.values()].map((g) => {
      const n = g.one ? 1 : g.ids.size || g.count;
      return { ...g, n, text: g.label(n), ids: [...g.ids] };
    });
  }
  const issueRow = (g, from = "") =>
    g.list && g.ids.length
      ? row({ action: "issues", id: g.key, with: from, title: g.text })
      : g.action
        ? row({ action: g.action, title: g.text })
        : h("div", { class: "mf-row mf-row-plain" }, h("span", { class: "mf-grow" }, h("strong", null, esc(g.text))));
  const issueHelp = {
    noreceipt:
      "Open one and choose Add a receipt. You can still send the packet without them.",
    unsure: "Open one and choose Change category if you now know what it was.",
    cpa: "Nothing for you to fix. Your CPA decides how these are reported.",
    asset:
      "Your CPA needs the date each was first used. Open one, choose Undo and enter again, and add the date.",
    double:
      "Check these are not the same thing entered twice. If one is, open it and choose Undo this entry.",
  };
  let lastPacket = null;
  function issuesDialog(key, from) {
    const scope =
        from === "cpa" && lastPacket
          ? lastPacket
          : { propertyId: active(), year: state().year },
      group = issueGroups(packetData(scope.propertyId, scope.year)).find((g) => g.key === key);
    if (!group)
      return from === "cpa" ? open("cpa", undefined, "back") : pm().toast("Nothing left to check here.");
    show(
      group.text.charAt(0).toUpperCase() + group.text.slice(1),
      h(
        "div",
        { class: "mf-form" },
        h("p", { class: "mf-intro" }, esc(issueHelp[key] || "Tap a line to open it.")),
        ledgerRows(
          sorted(
            group.ids
              .map((id) => pm().get(id) || all("expense").find((t) => t.id === id))
              .filter((t) => t && moneyTypes.includes(t.type)),
          ),
          "Nothing left to check here.",
        ),
      ),
    );
  }
  /* One step: pick the year, look over the totals, create the packet. */
  function cpaForm(start) {
    const now = today(),
      thisYear = now.slice(0, 4),
      lastYear = String(Number(thisYear) - 1),
      years = [
        ...new Set([
          thisYear,
          state().year,
          ...moneyTypes.flatMap(all).map((t) => t.date.slice(0, 4)),
        ]),
      ].sort(),
      year0 =
        start?.year ||
        (state().year !== thisYear
          ? state().year
          : Number(now.slice(5, 7)) <= 4 && years.includes(lastYear)
            ? lastYear
            : thisYear),
      property0 = start?.propertyId || active();
    let data = null;
    const form = formDialog(
      "Year-end packet for my CPA",
      (years.length < 2
        ? hv("input", { type: "hidden", name: "year", value: year0 })
        : years.length <= 5
          ? kit().seg({
              label: "Tax year",
              name: "year",
              options: years.map((y) => [y, y]),
              value: year0,
            })
          : kit().select({
              label: "Tax year",
              name: "year",
              options: [...years].reverse(),
              value: year0,
            })) +
        (props().length > 1
          ? kit().select({
              label: "Property",
              name: "property",
              options: props().map((p) => [p.id, p.name]),
              value: property0,
            })
          : hv("input", { type: "hidden", name: "property", value: property0 })) +
        h("div", { id: "mf-packet", class: "ui-stack" }),
      "Create packet",
      async (fd) => {
        const out = await generatePacket(data, new Set(fd.getAll("include")), (msg) => {
          if (byId("mf-progress")) byId("mf-progress").textContent = msg;
        });
        pm().download(out.blob, out.filename);
        setTab("reports");
        finish("Packet created. The download has started.");
      },
      "",
      {
        intro:
          "One ZIP file with the year's totals, every entry and your receipts, ready to send to your CPA.",
        /* Coming back from a list opened here returns to the same year. */
        self: { act: "activity", id: "money|cpa||back" },
      },
    );
    const draw = () => {
      const fd = new FormData(form),
        year = String(fd.get("year")),
        propertyId = fd.get("property");
      data = packetData(propertyId, year);
      lastPacket = { propertyId, year };
      const { items, stats, docs } = data,
        groups = issueGroups(data),
        linked = new Set(items.flatMap(data.links)),
        isTaxYearDocument = (d) =>
          /tax document|1098/i.test(d.kind || d.category || "") &&
          String(d.taxYear || "") === year,
        likely = docs.filter(
          (d) => financialDoc(d) && (linked.has(d.id) || isTaxYearDocument(d)),
        ),
        optional = docs.filter(
          (d) =>
            !likely.includes(d) &&
            financialDoc(d) &&
            (!d.date || String(d.date).startsWith(year)),
        ),
        picker = (d, checked) =>
          h(
            "label",
            { class: "mf-check" },
            hv("input", { type: "checkbox", name: "include", value: d.id, checked }),
            h("span", null, esc(d.name || d.filename)),
          );
      byId("mf-packet").innerHTML =
        h(
          "p",
          { class: "mf-callout" },
          esc(
            (data.p?.name || "This property") +
              ", " +
              year +
              (items.length ? "." : ". Nothing is recorded for this year yet."),
          ),
        ) +
        facts([
          ["Income", amt(stats.income)],
          ["Expenses", amt(stats.expenses)],
          ["Profit before depreciation", amt(stats.income - stats.expenses)],
          ["Change in bank cash", signed(stats.cash)],
          ["Number of entries", String(items.length)],
        ]) +
        note(calmMapping(year)) +
        kit().more(
          "Things to double-check (" + sum(groups, (g) => g.n) + ")",
          groups.length
            ? note("You can create the packet as it is. These are listed inside it for your CPA.") +
                listWrap(groups.map((g) => issueRow(g, "cpa")).join(""))
            : note("Nothing to double-check."),
        ) +
        h(
          "details",
          { class: "ui-more ui-wide" },
          h(
            "summary",
            { id: "mf-include-count" },
            "Receipts and documents to include (" + likely.length + ")",
          ),
          h(
            "div",
            { class: "ui-more-body" },
            likely.map((d) => picker(d, true)).join("") +
              optional.map((d) => picker(d, false)).join("") ||
              note("No receipts or financial documents are saved for this year."),
          ),
        ) +
        note(
          "Saves a ZIP file on this device and keeps a copy here. You can make a new one any time.",
        ) +
        '<p id="mf-progress" class="mf-note" role="status"></p>';
    };
    form.addEventListener("change", (ev) => {
      if (ev.target.name === "year" || ev.target.name === "property") draw();
      else if (ev.target.name === "include")
        byId("mf-include-count").textContent =
          "Receipts and documents to include (" +
          form.querySelectorAll('[name="include"]:checked').length +
          ")";
    });
    draw();
  }
  async function generatePacket(data, selected, progress = () => {}) {
    const {
      p,
      profile,
      report,
      items,
      stats,
      issues,
      docs,
      docMap,
      reconciliations,
      bank,
      deposits,
      depositOpening,
      depositClosing,
      charges,
      year,
      propertyId,
    } = data;
    const selectedIssues = issues.slice(),
      entries = [],
      when = new Date().toISOString(),
      dataset = pm().dataset(),
      workspace = dkey("");
    for (const t of items)
      for (const id of data.links(t))
        if (!selected.has(id) && financialDoc(docMap.get(id) || {}))
          selectedIssues.push({
            id: t.id,
            topic: "Attachment",
            message: "Owner excluded linked supporting document " + id + ".",
          });
    const prelim = selectedIssues.length > 0,
      taxMap = mapping(year);
    const add = (name, data) => entries.push({ name, data });
    const addCsv = (name, head, body) => add(name, csv([head, ...body]));
    const trans = (s) => String(s ?? "");
    const cols = [
      "transaction_id",
      "property_id",
      "tenancy_id",
      "kind",
      "date",
      "entry_time",
      "account",
      "method",
      "vendor",
      "purpose",
      "original_amount_cents",
      "property_cash_cents",
      "property_income_cents",
      "property_operating_expense_cents",
      "cpa_approved_depreciation_cents",
      "source_id",
      "reverses",
      "attachment_ids",
      "review_notes",
    ];
    addCsv(
      "ledger/transactions.csv",
      cols,
      items.map((t) => {
        const v = classification(t, propertyId);
        return [
          t.id,
          t.propertyId,
          t.tenancyId,
          t.kind || t.mode || t.type,
          t.date,
          t.createdAt || t._updatedAt,
          t.account,
          t.method,
          t.vendor,
          t.notes,
          t.amount,
          v.cash,
          v.income,
          v.expenses,
          v.taxOnly,
          t.sourceId,
          t.reverses,
          data.links(t).join(" | "),
          t.reviewNotes,
        ];
      }),
    );
    addCsv(
      "ledger/split-allocations.csv",
      [
        "entry_id",
        "allocation_id",
        "allocated_property_id",
        "category",
        "charge_id",
        "amount_cents",
        "included_in_this_property",
      ],
      items.flatMap((t) => [
        ...(t.splits || []).map((s, i) => [
          t.id,
          t.id + ":s" + i,
          s.propertyId || t.propertyId,
          s.category,
          "",
          s.amount,
          (s.propertyId || t.propertyId) === propertyId ? "yes" : "no",
        ]),
        ...(t.allocations || []).map((a, i) => [
          t.id,
          t.id + ":a" + i,
          t.propertyId,
          "rent",
          a.chargeId,
          a.amount,
          "yes",
        ]),
      ]),
    );
    const endDate = year + "-12-31",
      eligible = moneyTypes.flatMap(all).filter((t) => t.date <= endDate),
      due = balances(charges, eligible);
    addCsv(
      "ledger/rent-obligations.csv",
      [
        "charge_id",
        "tenancy_id",
        "period",
        "due",
        "charged_cents",
        "outstanding_at_year_end_cents",
      ],
      charges
        .filter((c) => c.date <= endDate)
        .map((c) => [
          c.id,
          c.tenancyId,
          c.period,
          c.date,
          c.amount,
          due.get(c.id),
        ]),
    );
    const scheduleEvents = all("scheduleAdjustment").filter(
      (e) =>
        e.propertyId === propertyId &&
        (e.date.startsWith(year) ||
          e.effectiveFrom.startsWith(year) ||
          e.changes.some((c) => c.date.startsWith(year))),
    );
    addCsv(
      "ledger/rent-schedule-history.csv",
      [
        "event_id",
        "tenancy_id",
        "recorded",
        "effective",
        "reason",
        "charge_id",
        "period",
        "action",
        "previous_cents",
        "new_cents",
      ],
      scheduleEvents.flatMap((e) =>
        (e.changes.length ? e.changes : [{}]).map((c) => [
          e.id,
          e.tenancyId,
          e.date,
          e.effectiveFrom,
          e.reason,
          c.chargeId,
          c.period,
          c.action,
          c.oldAmount,
          c.newAmount,
        ]),
      ),
    );
    addCsv(
      "reports/monthly.csv",
      [
        "month",
        "income_cents",
        "operating_expense_cents",
        "operating_net_cents",
        "net_cash_movement_cents",
        "cpa_approved_depreciation_cents",
      ],
      report.monthly.map((m) => [
        m.month,
        m.income,
        m.expenses,
        m.income - m.expenses,
        m.cash,
        m.taxOnly,
      ]),
    );
    addCsv(
      "reports/schedule-e-crosswalk.csv",
      [
        "year",
        "mapping",
        "category",
        "description",
        "schedule_e_2025_reference_line",
        "property_amount_cents",
        "treatment",
      ],
      [
        [
          year,
          taxMap,
          "rent",
          "Rental income",
          "3",
          stats.income,
          "Receipt year; review allocations",
        ],
        ...Object.entries(report.cats).map(([k, total]) => [
          year,
          taxMap,
          k,
          labelCat(k),
          categories[k]?.[1] || "",
          total,
          categories[k]?.[1]
            ? "Mapped for CPA review"
            : "Outside operating deduction subtotal",
        ]),
      ],
    );
    addCsv(
      "reports/deposit-liability.csv",
      [
        "transaction_id",
        "tenancy_id",
        "date",
        "activity",
        "liability_change_cents",
        "balance_cents",
        "purpose",
        "cash_movement_cents",
      ],
      (() => {
        let held = depositOpening;
        return [
          ["", "", year + "-01-01", "Prior-year carryforward", "", held, "", 0],
          ...deposits
            .filter((t) => t.date.startsWith(year))
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((t) => [
              t.id,
              t.tenancyId,
              t.date,
              depositsLabel(t),
              t.amount,
              (held += t.amount),
              t.notes,
              classification(t, propertyId).cash,
            ]),
          ["", "", endDate, "Ending liability", "", depositClosing, "", 0],
        ];
      })(),
    );
    addCsv(
      "reports/bank-lines.csv",
      [
        "id",
        "account",
        "bank_date",
        "description",
        "amount_cents",
        "matched_transaction",
        "source_reference",
        "source_file",
        "source_row",
      ],
      bank.map((b) => [
        b.id,
        b.account,
        b.date,
        b.description,
        b.amount,
        b.matchedId,
        b.reference,
        b.sourceName,
        b.sourceRow,
      ]),
    );
    addCsv(
      "reports/reconciliations.csv",
      [
        "id",
        "account",
        "start",
        "end",
        "opening_cents",
        "imported_activity_cents",
        "cleared_movement_cents",
        "closing_cents",
        "difference_cents",
        "explanation",
        "cleared_ids",
      ],
      reconciliations.map((r) => [
        r.id,
        r.account,
        r.start,
        r.end,
        r.opening,
        r.imported,
        r.movement,
        r.closing,
        r.difference,
        r.explanation,
        r.cleared.join(" | "),
      ]),
    );
    const allSplits = items.flatMap((t) =>
      slices(t, propertyId).map((s) => ({ t, s })),
    );
    addCsv(
      "reports/capital-assets.csv",
      [
        "id",
        "vendor",
        "purpose",
        "acquired",
        "in_service",
        "cost_cents",
        "receipt_ids",
        "cpa_notes",
      ],
      allSplits
        .filter(({ s }) => s.category === "capital")
        .map(({ t, s }) => [
          t.id,
          t.vendor,
          t.notes,
          t.date,
          t.inService,
          s.amount,
          data.links(t).join(" | "),
          t.reviewNotes ||
            "Determine basis, life, allocation and elections with CPA",
        ]),
    );
    addCsv(
      "reports/mortgage-escrow.csv",
      [
        "id",
        "date",
        "vendor",
        "component",
        "amount_cents",
        "account",
        "entry_kind",
        "review_notes",
      ],
      allSplits
        .filter(
          ({ s, t }) =>
            ["principal", "escrow", "interest"].includes(s.category) ||
            t.mode === "escrowDisbursement" ||
            t.mode === "mortgage",
        )
        .map(({ t, s }) => [
          t.id,
          t.date,
          t.vendor,
          labelCat(s.category),
          s.amount,
          t.account,
          t.mode,
          t.reviewNotes,
        ]),
    );
    addCsv(
      "reports/ownership-use.csv",
      [
        "property_id",
        "year",
        "owner",
        "ownership_percent",
        "rental_days",
        "personal_days",
        "cpa_instructions",
      ],
      [
        [
          propertyId,
          year,
          profile.owner,
          profile.share,
          profile.rentalDays,
          profile.personalDays,
          profile.notes,
        ],
      ],
    );
    addCsv(
      "reports/travel-mileage.csv",
      ["id", "date", "business_miles", "trip_details", "purpose", "cpa_notes"],
      items
        .filter(
          (t) =>
            t.miles ||
            slices(t, propertyId).some((s) => s.category === "travel"),
        )
        .map((t) => [t.id, t.date, t.miles, t.trip, t.notes, t.reviewNotes]),
    );
    addCsv(
      "reports/cpa-review.csv",
      ["record_id", "topic", "information_to_review"],
      selectedIssues.map((i) => [i.id, i.topic, i.message]),
    );
    const fileIndex = [],
      picked = docs.filter((d) => selected.has(d.id)),
      totalBytes = sum(picked, (d) => d.size || 0);
    if (totalBytes > 192 * 1024 * 1024)
      throw new Error(
        "This packet exceeds the 192 MiB local export budget. Select fewer supporting files and include the remainder separately.",
      );
    for (const d of picked) {
      progress(
        "Adding supporting file " +
          (fileIndex.length + 1) +
          " of " +
          picked.length +
          "…",
      );
      sameWorkspace(workspace);
      const blob = await pm().file(d.hash);
      if (!(blob instanceof Blob))
        throw new Error(
          "Missing stored original for " +
            d.name +
            ". Restore the file or deselect it and review the exclusion.",
        );
      const path =
        "support/" +
        String(fileIndex.length + 1).padStart(4, "0") +
        "-" +
        safeFile(d.filename || d.name);
      add(path, blob);
      fileIndex.push([
        d.id,
        d.hash,
        path,
        d.filename || d.name,
        items
          .filter((t) => data.links(t).includes(d.id))
          .map((t) => t.id)
          .join(" | "),
        blob.size,
      ]);
    }
    addCsv(
      "supporting-file-index.csv",
      [
        "document_id",
        "sha256",
        "archive_path",
        "original_name",
        "transaction_ids",
        "byte_length",
      ],
      fileIndex,
    );
    add(
      "reporting-assumptions.txt",
      [
        "Property Manager · " + p.name + " · " + year,
        dataset === "sample" ? "Synthetic sample dataset" : "Owner dataset",
        taxMap,
        "Individual residential rental, calendar-year cash basis. Property-level amounts before owner or personal-use allocation.",
        "Receipt-year income includes advance rent. Refundable deposits stay in a separate liability account until an identified application. Operating write-offs carry no cash-basis deduction.",
        "Operating expenses exclude capital, financing, transfers, escrow funding, and depreciation. Approved depreciation is shown separately. Review repayments, recoveries, mixed-use costs, and timing with the CPA.",
        "Money CSV columns ending in _cents are signed integer cents. Credits and reversals can be negative.",
        "Reviewed sources (2026-11-18): https://www.irs.gov/taxtopics/tc414 ; https://www.irs.gov/pub/irs-prior/p527--2025.pdf ; https://www.irs.gov/pub/irs-prior/f1040se--2025.pdf ; https://www.irs.gov/pub/irs-prior/i1040se--2025.pdf",
      ].join("\r\n"),
    );
    const sections = [
      {
        heading: p.name,
        lines: [
          (prelim ? "Preliminary packet" : "Reviewed ledger packet") +
            " · " +
            year +
            " · " +
            (dataset === "sample" ? "Sample property" : "Owner records"),
          "Prepared " + when + " · Calendar-year cash basis",
          taxMap,
        ],
      },
      {
        heading: "Annual summary",
        lines: [
          "Recorded income    " + amt(stats.income),
          "Operating expenses    " + amt(stats.expenses),
          "Operating result    " + amt(stats.income - stats.expenses),
          "Cash movement    " + amt(stats.cash),
          "CPA-approved depreciation    " + amt(stats.taxOnly),
          "Refundable deposit held at year end    " + amt(depositClosing),
        ],
      },
      {
        heading: "Monthly results",
        lines: report.monthly.map(
          (m) =>
            m.month +
            "     Income " +
            amt(m.income) +
            "     Expenses " +
            amt(m.expenses) +
            "     Net " +
            amt(m.income - m.expenses),
        ),
      },
      {
        heading: "Category detail",
        lines: Object.entries(report.cats).map(
          ([k, v]) => labelCat(k) + "     " + amt(v),
        ),
      },
      {
        heading: "Review and evidence",
        lines: [
          selectedIssues.length + " items listed in reports/cpa-review.csv.",
          items.length +
            " financial entries. " +
            fileIndex.length +
            " supporting files.",
          "See reporting-assumptions.txt for sources and accounting scope.",
        ],
      },
    ];
    progress("Generating annual PDF and archive…");
    add(
      "Annual-summary.pdf",
      pm().pdf(year + " rental property report", sections),
    );
    const revision = await digestString(
      JSON.stringify(
        [
          ...items,
          ...charges,
          ...scheduleEvents,
          ...reconciliations,
          ...bank,
          ...picked,
          profile,
          p,
        ]
          .map((r) => [r.id, r._rev || r._updatedAt || ""])
          .sort((a, b) => trans(a[0]).localeCompare(trans(b[0]))),
      ),
    );
    const manifest = {
      format: 1,
      exportedAt: when,
      propertyId,
      propertyName: p.name,
      year,
      dataset,
      preliminary: prelim,
      basis: "Calendar-year cash basis",
      mapping: taxMap,
      dataRevision: revision,
      files: [...entries.map((e) => e.name), "manifest.json"],
    };
    add("manifest.json", JSON.stringify(manifest, null, 2));
    const blob = await pm().zip(entries),
      id = uid(),
      filename =
        (dataset === "sample" ? "Sample-" : "") +
        safeFile(p.name) +
        "-CPA-" +
        year +
        "-" +
        when.slice(0, 10) +
        (prelim ? "-preliminary" : "") +
        ".zip";
    const snapshot = {
      id,
      type: "export",
      kind: "CPA packet",
      propertyId,
      date: when.slice(0, 10),
      exportedAt: when,
      filename,
      year,
      immutable: true,
      revision,
      manifest,
      size: blob.size,
    };
    sameWorkspace(workspace);
    if (blob.size <= 32 * 1024 * 1024) {
      snapshot.hash = await pm().blob(blob);
      sameWorkspace(workspace);
      await pm().save("export", snapshot);
    } else {
      const parts = [];
      for (let start = 0; start < blob.size; start += 8 * 1024 * 1024) {
        sameWorkspace(workspace);
        const part = blob.slice(start, start + 8 * 1024 * 1024),
          hash = await pm().blob(part);
        parts.push({
          ...base("exportPart"),
          propertyId,
          immutable: true,
          hash,
          size: part.size,
        });
      }
      sameWorkspace(workspace);
      snapshot.parts = parts.map((p) => p.id);
      await pm().batch([...parts, snapshot]);
    }
    return { blob, filename, id, manifest };
  }
  const depositsLabel = (t) => deposits[t.kind] || t.kind;
  function validateImport(records) {
    const ids = new Map(records.map((r) => [r.id, r])),
      tx = records.filter((t) => moneyTypes.includes(t.type)),
      charges = records.filter((t) => t.type === "charge");
    const seenRev = new Set(),
      bankMatches = new Set(),
      depositsByTenancy = new Map(),
      periods = new Set();
    const validAmount = (n) =>
      Number.isSafeInteger(n) && Math.abs(n) <= 999999999999;
    const requireValue = (test, msg) => {
      if (!test) throw new Error("Ledger validation: " + msg);
    };
    const financial = [
      ...charges,
      ...tx,
      ...records.filter((r) => r.type === "bankline"),
    ];
    for (const r of financial) {
      requireValue(
        dateOK(r.date) && validAmount(r.amount) && r.amount !== 0,
        "invalid date or amount on " + r.id,
      );
      requireValue(
        ids.get(r.propertyId)?.type === "property",
        "a property reference is missing.",
      );
      if (["charge", "payment", "deposit", "writeoff"].includes(r.type))
        requireValue(
          ids.get(r.tenancyId)?.type === "tenancy" &&
            ids.get(r.tenancyId).propertyId === r.propertyId,
          "a tenancy reference is invalid.",
        );
    }
    for (const c of charges) {
      const key =
        c.tenancyId + "|" + (c.scheduleId || "monthly") + "|" + c.period;
      requireValue(
        c.amount > 0 && c.date.slice(0, 7) === c.period && !periods.has(key),
        "duplicate or invalid monthly obligation.",
      );
      periods.add(key);
      if (c.termEventId)
        requireValue(
          ids.get(c.termEventId)?.type === "scheduleAdjustment" &&
            ids.get(c.termEventId).tenancyId === c.tenancyId,
          "a revised charge is missing its schedule history.",
        );
    }
    for (const event of records.filter(
      (r) => r.type === "scheduleAdjustment",
    )) {
      requireValue(
        event.immutable === true &&
          dateOK(event.date) &&
          dateOK(event.effectiveFrom) &&
          typeof event.reason === "string" &&
          event.reason.trim() &&
          Array.isArray(event.changes) &&
          event.changes.every(
            (c) =>
              typeof c.chargeId === "string" &&
              dateOK(c.date) &&
              c.period === c.date.slice(0, 7) &&
              ["repriced", "reinstated", "canceled", "scheduled"].includes(
                c.action,
              ) &&
              validAmount(c.oldAmount) &&
              validAmount(c.newAmount),
          ),
        "invalid schedule change history.",
      );
    }
    for (const r of tx) {
      if (r.reverses) {
        const orig = ids.get(r.reverses);
        requireValue(
          orig?.type === r.type &&
            orig.propertyId === r.propertyId &&
            !orig.reverses &&
            r.date >= orig.date,
          "invalid original entry or reversal date.",
        );
        if (r.type === "payment" && r.kind === "rentRefund") {
          requireValue(
            r.tenancyId === orig.tenancyId &&
              r.amount < 0 &&
              typeof r.notes === "string" &&
              r.notes.trim(),
            "invalid rent refund reference, amount, or reason.",
          );
        } else {
          requireValue(
            r.amount === -orig.amount && !seenRev.has(r.reverses),
            "invalid or duplicate reversal.",
          );
          seenRev.add(r.reverses);
          const equalReversed = (rows = [], original = [], field) =>
            rows.length === original.length &&
            rows.every(
              (s, i) =>
                s[field] === original[i][field] &&
                s.amount === -original[i].amount,
            );
          requireValue(
            equalReversed(r.allocations, orig.allocations, "chargeId") &&
              equalReversed(r.splits, orig.splits, "category"),
            "reversal splits or allocations differ from original.",
          );
        }
      }
      const alloc = r.allocations || [];
      requireValue(
        Array.isArray(alloc) &&
          new Set(alloc.map((a) => a.chargeId)).size === alloc.length,
        "duplicate allocation in one transaction.",
      );
      if (alloc.length) {
        requireValue(
          alloc.every((a) => {
            const c = ids.get(a.chargeId);
            return (
              c?.type === "charge" &&
              c.tenancyId === r.tenancyId &&
              validAmount(a.amount) &&
              Math.sign(a.amount) === (r.reverses ? -1 : 1)
            );
          }) && Math.abs(sum(alloc, (a) => a.amount)) <= Math.abs(r.amount),
          "allocation exceeds its payment or refers to another household.",
        );
        requireValue(
          alloc.every(
            (a) =>
              (ids.get(a.chargeId).termEventId || "") ===
              (a.chargeTermEventId || ""),
          ),
          "a payment allocation and its charge come from different rent-term versions; reconcile the source devices before importing.",
        );
      }
      if (r.type === "payment")
        requireValue(
          r.reverses || r.amount > 0,
          "negative rent without a reversal.",
        );
      if (r.type === "expense") {
        requireValue(
          Array.isArray(r.splits) &&
            r.splits.length > 0 &&
            r.splits.every(
              (s) =>
                Object.hasOwn(categories, s.category) &&
                validAmount(s.amount) &&
                Math.sign(s.amount) === Math.sign(r.amount) &&
                ids.get(s.propertyId || r.propertyId)?.type === "property",
            ) &&
            sum(r.splits, (s) => s.amount) === r.amount,
          "expense splits do not reconcile.",
        );
      }
      if (r.type === "deposit") {
        requireValue(
          Object.hasOwn(deposits, r.kind),
          "unknown deposit entry kind.",
        );
        if (!depositsByTenancy.has(r.tenancyId))
          depositsByTenancy.set(r.tenancyId, new Map());
        const dates = depositsByTenancy.get(r.tenancyId);
        dates.set(r.date, (dates.get(r.date) || 0) + r.amount);
        if (r.kind === "applyRent")
          requireValue(
            sum(alloc, (a) => a.amount) === -r.amount,
            "deposit application is not fully allocated.",
          );
      }
      if (r.type === "writeoff")
        requireValue(
          sum(alloc, (a) => a.amount) === r.amount,
          "write-off is not fully allocated.",
        );
      requireValue(
        (r.attachments || []).every((id) => ids.get(id)?.type === "document"),
        "a supporting document reference is missing.",
      );
    }
    const outstanding = balances(charges, tx);
    for (const [id, returns] of refundGroups(
      tx.filter((r) => r.type === "payment"),
    )) {
      const left = receiptRemaining(ids.get(id), returns);
      requireValue(
        left.amount >= 0 &&
          left.credit >= 0 &&
          [...left.byCharge.values()].every((n) => n >= 0),
        "combined rent returns exceed the original payment, its unapplied credit, or one of its allocations.",
      );
    }
    for (const [id, v] of outstanding)
      requireValue(
        v >= 0 && v <= ids.get(id).amount,
        "combined allocations overstate rent collected for " + id + ".",
      );
    for (const days of depositsByTenancy.values()) {
      let liability = 0;
      for (const [, v] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
        liability += v;
        requireValue(
          liability >= 0,
          "deposit liability would become negative.",
        );
      }
    }
    for (const b of records.filter(
      (r) => r.type === "bankline" && r.matchedId,
    )) {
      const t = ids.get(b.matchedId);
      requireValue(
        t &&
          moneyTypes.includes(t.type) &&
          t.account === b.account &&
          t.propertyId === b.propertyId &&
          b.amount === accountMovement(t) &&
          !bankMatches.has(t.id),
        "bank match is duplicated or disagrees with the entry.",
      );
      bankMatches.add(t.id);
    }
    const ends = new Map();
    for (const r of records
      .filter((r) => r.type === "reconciliation")
      .sort((a, b) => String(a.start).localeCompare(String(b.start)))) {
      requireValue(
        dateOK(r.start) &&
          dateOK(r.end) &&
          r.end >= r.start &&
          Array.isArray(r.cleared) &&
          new Set(r.cleared).size === r.cleared.length &&
          r.cleared.every((id) => {
            const t = ids.get(id);
            return (
              t &&
              moneyTypes.includes(t.type) &&
              t.propertyId === r.propertyId &&
              t.account === r.account &&
              t.date >= r.start &&
              t.date <= r.end
            );
          }) &&
          [r.opening, r.closing, r.difference, r.movement].every(
            Number.isSafeInteger,
          ) &&
          r.movement === sum(r.cleared, (id) => accountMovement(ids.get(id))) &&
          r.closing - r.opening - r.movement === r.difference,
        "statement reconciliation disagrees with its supporting entries.",
      );
      const scope = JSON.stringify([r.propertyId, r.account]);
      requireValue(
        !ends.has(scope) || r.start > ends.get(scope),
        "statement periods overlap.",
      );
      ends.set(scope, r.end);
      if (r.bankIds)
        requireValue(
          Array.isArray(r.bankIds) &&
            new Set(r.bankIds).size === r.bankIds.length &&
            r.bankIds.every(
              (id) =>
                ids.get(id)?.type === "bankline" &&
                ids.get(id).propertyId === r.propertyId &&
                ids.get(id).account === r.account,
            ) &&
            sum(r.bankIds, (id) => ids.get(id).amount) === r.imported,
          "statement bank activity is inconsistent.",
        );
    }
    for (const snapshot of records.filter(
      (r) => r.type === "export" && r.kind === "CPA packet",
    )) {
      requireValue(
        snapshot.immutable === true &&
          (!snapshot.parts
            ? typeof snapshot.hash === "string"
            : Array.isArray(snapshot.parts) &&
              snapshot.parts.length > 0 &&
              new Set(snapshot.parts).size === snapshot.parts.length &&
              snapshot.parts.every(
                (id) => ids.get(id)?.type === "exportPart",
              ) &&
              sum(snapshot.parts, (id) => ids.get(id).size) === snapshot.size),
        "a retained CPA archive is missing its file references.",
      );
    }
    return true;
  }
  /* ---- Lists and small dialogs ---- */
  function chargeDetail(id) {
    const c = pm().get(id);
    if (!c) return;
    const tx = transactions().filter((t) =>
        t.allocations?.some((a) => a.chargeId === id),
      ),
      due = balances([c], tx).get(id);
    show(
      "Rent for " + monthName(c.period),
      h(
        "div",
        { class: "mf-form" },
        h(
          "p",
          { class: "mf-callout" },
          esc(
            tenantName(c.tenancyId) +
              ", due " +
              longDate(c.date) +
              ". " +
              (due > 0 ? amt(due) + " is still owed." : "Nothing is owed for this month."),
          ),
        ),
        facts([
          ["Rent charged", amt(c.amount)],
          ["Still owed", amt(due)],
        ]),
        h("h3", null, "Payments and changes for this month"),
        ledgerRows(sorted(tx), "Nothing has been paid toward this month yet."),
        due > 0
          ? h(
              "div",
              { class: "mf-foot" },
              button("payment", "Record payment", { id, cls: "mf-primary" }),
            )
          : "",
      ),
    );
  }
  const listDialog = (title, intro, html) =>
    show(
      title,
      h("div", { class: "mf-form" }, h("p", { class: "mf-intro" }, esc(intro)), html),
    );
  function inboxList() {
    const urls = new Map(),
      inbox = sorted(
        rec("document")
          .filter((d) => d.receiptInbox)
          .map((d) => ({ ...d, date: String(d.importedAt || d.date || "") })),
      );
    const body = show(
      "Receipts waiting to be entered",
      h(
        "div",
        { class: "mf-form" },
        h(
          "p",
          { class: "mf-intro" },
          "Photos and files you saved but have not entered as an expense yet.",
        ),
        inbox.length
          ? inbox
              .map((d) =>
                h(
                  "div",
                  { class: "mf-thumb mf-waiting" },
                  thumb(d),
                  h(
                    "span",
                    { class: "mf-grow" },
                    h("strong", null, esc(docName(d))),
                    h("small", null, esc("Saved " + longDate(d.date))),
                  ),
                  h(
                    "span",
                    { class: "mf-actions" },
                    button("inbox", "Finish entering", {
                      id: d.id,
                      cls: "mf-strong",
                      aria: "Finish entering " + docName(d),
                    }),
                    button("discard", "Discard", {
                      id: d.id,
                      cls: "mf-quiet",
                      aria: "Discard " + docName(d),
                    }),
                  ),
                ),
              )
              .join("")
          : emptyRow("No receipts are waiting."),
      ),
      { onClose: () => releaseThumbs(urls) },
    );
    loadThumbs(body, urls);
  }
  function discardDialog(doc) {
    if (!doc?.receiptInbox) return inboxList();
    const urls = new Map();
    const body = show(
      "Discard this receipt?",
      h(
        "div",
        { class: "mf-form" },
        h(
          "div",
          { class: "mf-thumb" },
          thumb(doc),
          h("span", { class: "mf-grow" }, h("strong", null, esc(docName(doc)))),
        ),
        h(
          "p",
          { class: "mf-intro" },
          "It has not been entered as an expense. Discarding removes it from this app.",
        ),
        h(
          "div",
          { class: "mf-foot" },
          button("inboxList", "Keep it"),
          button("discardYes", "Discard receipt", { id: doc.id, cls: "mf-danger" }),
        ),
      ),
      { onClose: () => releaseThumbs(urls) },
    );
    loadThumbs(body, urls);
  }
  /* Show one tab of the Money page, from anywhere (a dialog, Home, the to-do list). */
  function goTab(tab) {
    setTab(tab);
    if (document.querySelector("dialog[open]")) pm().close();
    if (document.querySelector(".mf-workspace")) render();
    else pm().navigate("Money", tabSlugs[tab] || "");
    const nav = document.querySelector(".mf-tabs");
    nav?.scrollIntoView({ block: "start" });
    nav?.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
  }
  async function open(action, id, el) {
    /* The app's Back button arrives here as "activity" with a packed id (see show()). */
    if (action === "activity" && typeof id === "string" && id.startsWith("money|")) {
      const [, inner, innerId, innerWith] = id.split("|");
      return open(inner, innerId || undefined, innerWith || "");
    }
    const item = id ? pm().get(id) : null,
      extra = typeof el === "string" ? el : el?.dataset?.with || "";
    opening = { act: "activity", id: ["money", action, id || "", extra].join("|") };
    if (action.startsWith("tab:")) {
      setTab(action.slice(4));
      render();
      document
        .querySelector('.mf-tabs [aria-pressed="true"]')
        ?.focus({ preventScroll: true });
      return;
    }
    if (action.startsWith("goto:")) return goTab(action.slice(5));
    if (action.startsWith("entry:")) return expenseForm({ mode: action.slice(6) });
    if (action.startsWith("bankentry:"))
      return expenseForm({ bank: item, mode: action.slice(10) });
    switch (action) {
      case "payment":
        return paymentForm(
          item?.type === "charge"
            ? { charge: item }
            : item?.type === "tenancy"
              ? { tenancyId: item.id }
              : {},
        );
      case "allocate":
        return paymentForm({ old: item });
      case "expense":
        return expenseForm();
      case "receipt":
        return expenseForm({ photo: true });
      case "inbox": {
        if (!item) return inboxList();
        /* If this receipt was part of a form that was closed half-way, carry on with it. */
        const kept = Object.keys(drafts).find(
          (k) =>
            k.startsWith(dkey("expense:")) &&
            !k.startsWith(dkey("expense:bank:")) &&
            drafts[k].extra?.ids?.includes(id),
        );
        return kept
          ? expenseForm({ ...drafts[kept].extra.opts, key: kept })
          : expenseForm({ photo: true, doc: item });
      }
      case "inboxList":
        return inboxList();
      case "discard":
        return discardDialog(item);
      case "discardYes":
        if (item?.type === "document" && item.receiptInbox && !item.immutable)
          await pm().save("document", { ...item, _deleted: true });
        for (const draft of Object.values(drafts))
          if (draft.extra?.ids) draft.extra.ids = draft.extra.ids.filter((x) => x !== id);
        pm().close();
        await pm().refresh();
        pm().toast("Receipt discarded.");
        if (rec("document").some((d) => d.receiptInbox)) return open("inboxList");
        return;
      case "other":
        return otherMenu();
      case "deposit":
        return depositOther();
      case "depositIn":
        return depositIn();
      case "depositOut":
        return depositOut();
      case "writeoff":
        return forgiveRent();
      case "rent":
        return listDialog(
          "Rent by month",
          "What was charged each month and what has been paid. Tap a month for details.",
          chargesList(rec("charge")),
        );
      case "arrears": {
        const list = owes().filter((x) => x.owed > 0),
          late = list.flatMap((x) => x.due.map((d) => d.c));
        return listDialog(
          "Unpaid rent",
          "Rent that was due on or before " + longDate(today()) + " and has not been paid.",
          list.length
            ? owesRows(list) + h("h3", null, "Unpaid months") + chargesList(late)
            : emptyRow("Nobody owes rent right now."),
        );
      }
      case "monthReceipts":
        return listDialog(
          "Money received this month",
          "Rent payments dated in " + monthName(today()) + ".",
          ledgerRows(
            sorted(
              rec("payment").filter(
                (t) =>
                  t.date <= today() && t.date.startsWith(today().slice(0, 7)),
              ),
            ),
            "No rent received yet this month.",
          ),
        );
      case "charge":
        return chargeDetail(id);
      case "deposits":
        return show(
          "Security deposit held",
          h(
            "div",
            { class: "mf-form" },
            h("p", { class: "mf-callout" }, esc(holdingText())),
            h(
              "p",
              { class: "mf-intro" },
              "A deposit is the tenant's money until you keep or return it. It is not income.",
            ),
            h(
              "div",
              { class: "mf-actions" },
              button("depositIn", "Deposit received"),
              button("depositOut", "Return deposit"),
              button("deposit", "Other change"),
            ),
            h("h3", null, "Deposit history"),
            ledgerRows(sorted(rec("deposit")), "No deposit recorded yet."),
          ),
        );
      case "credit": {
        const rows = creditRows();
        return listDialog(
          "Credit not yet applied",
          "Money a tenant paid that is not matched to a month yet. Tap one to apply it.",
          rows ? listWrap(rows) : emptyRow("Every payment is applied to a month."),
        );
      }
      case "income":
      case "expenses": {
        const k = action === "income" ? "income" : "expenses",
          yr = state().year;
        return listDialog(
          (action === "income" ? "Income " : "Expenses ") + yr,
          action === "income"
            ? "Everything that counted as income in " + yr + "."
            : "Everything that counted as an expense in " + yr + ".",
          ledgerRows(
            sorted(
              transactions().filter(
                (t) =>
                  t.date.startsWith(yr) && classification(t, active())[k] !== 0,
              ),
            ),
            "Nothing recorded for " + yr + " yet.",
          ),
        );
      }
      case "activity":
        if (item?.type === "charge") return chargeDetail(id);
        return item
          ? transactionDetail(id)
          : listDialog(
              "All activity",
              "Everything recorded for this property, newest first.",
              ledgerRows(sorted(transactions())),
            );
      case "document":
        return pm().openDoc(id);
      case "reverse":
        return reverse(id);
      case "redo":
        return reverse(id, true);
      case "rentRefund":
        return refundRent(item);
      case "reclass":
        return reclassify(item);
      case "linkReceipts":
        return linkReceipts(item);
      case "csv":
        return importCsv();
      case "match":
        return matchBank(id);
      case "matchold":
        return matchBank(id, true);
      case "matchyes":
      case "matchpick":
        return saveMatch(id, extra);
      case "matchall":
        return matchAll();
      case "unmatch":
        if (item?.type !== "bankline" || !item.matchedId) return;
        await pm().save("bankline", { ...item, matchedId: "", linkedAt: "" });
        return finish("Match removed. It is back in the list to match.");
      case "bankall":
        state().allBank = true;
        return render();
      case "bankpayment":
        return paymentForm({ bank: item });
      case "bankexpense":
        return expenseForm({ bank: item, mode: item?.amount > 0 ? "incoming" : "" });
      case "reconcile":
        return reconcile();
      case "reconciliation":
        return reconciliationDetail(id);
      case "profile":
        return profile();
      case "cpa":
        return cpaForm(extra === "back" ? lastPacket : null);
      case "issues":
        return issuesDialog(id, extra);
      case "snapshot": {
        if (!item) return;
        const blob = item.hash
          ? await pm().file(item.hash)
          : new Blob(
              await Promise.all(
                item.parts.map((id) => pm().file(pm().get(id).hash)),
              ),
              { type: "application/zip" },
            );
        return pm().download(blob, item.filename);
      }
    }
  }
  if (typeof document !== "undefined") {
    document.addEventListener("click", (e) => {
      const el = e.target.closest("[data-money]");
      if (!el) return;
      e.preventDefault();
      nextBack =
        el.closest("#dialog") && selfNow && byId("dialog-title")?.textContent === selfTitle
          ? selfNow
          : null;
      open(el.dataset.money, el.dataset.id, el)
        .catch((err) => failure(err, byId("mf-form")))
        .finally(() => {
          nextBack = null;
        });
    });
    document.addEventListener("change", (e) => {
      const name = e.target.name;
      if (name !== "mfYear" && name !== "mfFilter") return;
      state()[name === "mfYear" ? "year" : "filter"] = e.target.value;
      render();
      document
        .querySelector('input[name="' + name + '"]:checked, select[name="' + name + '"]')
        ?.focus({ preventScroll: true });
    });
  }
  global.Money = Object.freeze({
    render,
    open,
    seed,
    ensure,
    home,
    termChanges,
    protectTermChanges,
    validateImport,
    model,
    generatePacket,
    packetData,
    owes,
    todo,
  });
})(globalThis);
