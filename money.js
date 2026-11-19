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
  const titleOf = (t) =>
    t.type === "payment"
      ? t.reverses
        ? "Returned or refunded rent"
        : "Rent payment"
      : t.type === "expense"
        ? t.vendor || "Expense"
        : t.type === "writeoff"
          ? "Rent written off"
          : deposits[t.kind] || "Deposit";
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
              ? labelCat(slices(t, propertyId)[0]?.category)
              : t.type === "payment"
                ? "Rent"
                : t.type === "deposit"
                  ? "Security deposit"
                  : "Adjustment",
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
  const byId = (id) => document.getElementById(id);
  const htmlButton = (action, label, extra = "") =>
    '<button type="button" class="mf-button" data-money="' +
    esc(action) +
    '" ' +
    extra +
    ">" +
    esc(label) +
    "</button>";
  const txt = (label, name, type = "text", val = "", extra = "") =>
    '<label class="mf-field"><span>' +
    esc(label) +
    '</span><input type="' +
    esc(type) +
    '" name="' +
    esc(name) +
    '" value="' +
    esc(val) +
    '" ' +
    extra +
    "></label>";
  const area = (label, name, val = "") =>
    '<label class="mf-field"><span>' +
    esc(label) +
    '</span><textarea name="' +
    esc(name) +
    '" rows="2">' +
    esc(val) +
    "</textarea></label>";
  function select(label, name, options, value = "", extra = "") {
    return (
      '<label class="mf-field"><span>' +
      esc(label) +
      '</span><select name="' +
      esc(name) +
      '" ' +
      extra +
      ">" +
      options
        .map(
          ([k, v]) =>
            '<option value="' +
            esc(k) +
            '" ' +
            (String(value) === String(k) ? "selected" : "") +
            ">" +
            esc(v) +
            "</option>",
        )
        .join("") +
      "</select></label>"
    );
  }
  const twocol = (...fields) =>
    '<div class="mf-grid">' + fields.join("") + "</div>";
  const note = (s) => '<p class="mf-note">' + esc(s) + "</p>";
  const chips = (options, current) =>
    '<nav class="mf-tabs" aria-label="Money views">' +
    options
      .map(
        ([k, label]) =>
          '<button type="button" data-money="tab:' +
          esc(k) +
          '" aria-pressed="' +
          (current === k) +
          '">' +
          esc(label) +
          "</button>",
      )
      .join("") +
    "</nav>";
  const tag = (text) => '<span class="mf-tag">' + esc(text) + "</span>";
  const reviewNotice = (id = "mf-error") =>
    '<p id="' + id + '" role="alert" class="mf-error" hidden></p>';
  function failure(e, form) {
    const message =
      e?.message || String(e || "Could not complete the operation.");
    const out = form?.querySelector('[role="alert"]');
    if (out) {
      out.hidden = false;
      out.textContent = message;
      out.focus?.();
    } else pm().toast(message);
  }
  function formDialog(
    title,
    body,
    submitLabel,
    onSubmit,
    key = "",
    extra = "",
  ) {
    pm().modal(
      title,
      '<form id="mf-form" class="mf-form">' +
        body +
        reviewNotice() +
        extra +
        '<div class="mf-foot"><button type="submit" class="mf-primary">' +
        esc(submitLabel) +
        "</button></div></form>",
      { key: key || title },
    );
    const form = byId("mf-form");
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (form.dataset.busy) return;
      form.dataset.busy = "1";
      const button = form.querySelector("[type=submit]");
      button.disabled = true;
      try {
        await onSubmit(new FormData(form), form);
        if (key) delete drafts[key];
      } catch (e) {
        failure(e, form);
      } finally {
        delete form.dataset.busy;
        button.disabled = false;
      }
    });
    return form;
  }
  function finish(msg) {
    pm().close();
    pm().refresh();
    pm().toast(msg);
  }
  const drafts = {};
  function bindDraft(form, key) {
    const ids = Array.from(form.elements).filter(
      (e) => e.name && !["file", "submit", "button"].includes(e.type),
    );
    const cache = drafts[key] || {};
    for (const e of ids)
      if (Object.hasOwn(cache, e.name)) e.value = cache[e.name];
    form.addEventListener("input", () => {
      const data = {};
      for (const e of form.elements)
        if (e.name && e.type !== "file") data[e.name] = e.value;
      drafts[key] = data;
    });
  }
  const selectedTenancy = (name = "tenancyId", value) =>
    select(
      "Tenancy",
      name,
      rec("tenancy").map((t) => [t.id, t.name || t.id]),
      value,
      "required",
    );
  const needTenancy = () => {
    if (!rec("tenancy").length) {
      pm().modal(
        "Set up a tenancy",
        note(
          "Add a tenancy in rental setup to begin recording rent and deposits.",
        ),
      );
      return true;
    }
    return false;
  };
  const dkey = (name) => [pm().dataset(), active(), name].join(":");
  function sameWorkspace(key) {
    if (dkey("") !== key)
      throw new Error(
        "The active workspace changed. Reopen this form in the original property.",
      );
  }
  const base = (type, id = uid()) => ({
    id,
    propertyId: active(),
    type,
    createdAt: new Date().toISOString(),
  });
  const moneyInput = (label, name, val = "", required = true) =>
    txt(
      label,
      name,
      "number",
      val,
      'step="0.01" inputmode="decimal" ' + (required ? "required" : ""),
    );
  const details = (label, body) =>
    '<details class="mf-details"><summary>' +
    esc(label) +
    "</summary>" +
    body +
    "</details>";
  const listWrap = (html) => '<div class="mf-list">' + html + "</div>";
  function ledgerRows(rows) {
    if (!rows.length)
      return '<div class="mf-empty">No entries in this view.</div>';
    return listWrap(
      rows
        .map((t) => {
          const v = classification(t, active()),
            amount =
              t.type === "deposit"
                ? t.amount
                : t.type === "writeoff"
                  ? sum(t.allocations || [], (a) => a.amount)
                  : t.type === "expense"
                    ? -sum(slices(t, active()), (s) => s.amount)
                    : v.cash;
          const label =
            t.type === "expense"
              ? labelCat(slices(t, active())[0]?.category)
              : t.type === "payment"
                ? "Rent"
                : t.type === "writeoff"
                  ? "Adjustment"
                  : "Deposit";
          return (
            '<button type="button" class="mf-row" data-money="activity" data-id="' +
            esc(t.id) +
            '"><span class="mf-symbol ' +
            (amount < 0 ? "minus" : "plus") +
            '" aria-hidden="true">' +
            (amount < 0 ? "↗" : "↙") +
            '</span><span class="mf-grow"><strong>' +
            esc(titleOf(t)) +
            "</strong><small>" +
            esc(t.date) +
            " · " +
            esc(label) +
            '</small></span><b class="mf-amount">' +
            esc(amt(amount)) +
            '</b><span aria-hidden="true">›</span></button>'
          );
        })
        .join(""),
    );
  }
  const sorted = (rows) =>
    [...rows].sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        String(b.createdAt || b.id).localeCompare(String(a.createdAt || a.id)),
    );
  const navigation = new Map();
  function state() {
    const key = dkey("view");
    if (!navigation.has(key))
      navigation.set(key, {
        tab: "activity",
        filter: "all",
        year: today().slice(0, 4),
      });
    return navigation.get(key);
  }
  function render() {
    const st = state(),
      s = home(),
      tx = transactions(),
      yr = st.year,
      report = annual(yr, active(), tx);
    const buttons = [
      ["payment", "Record payment"],
      ["expense", "Add expense"],
      ["receipt", "Photograph receipt"],
      ["cpa", "Prepare CPA packet"],
    ];
    const tile = (label, value, action) =>
      '<button type="button" class="mf-metric" data-money="' +
      action +
      '"><small>' +
      esc(label) +
      "</small><strong>" +
      esc(amt(value)) +
      "</strong></button>";
    const options = [
      ...new Set([
        today().slice(0, 4),
        yr,
        ...tx.map((t) => t.date.slice(0, 4)),
      ]),
    ]
      .sort()
      .reverse();
    let body = "";
    if (st.tab === "activity") {
      const rows = sorted(
        report.rows.filter((t) => st.filter === "all" || t.type === st.filter),
      );
      body =
        '<div class="mf-subhead"><h2>Transaction ledger</h2>' +
        select(
          "Type",
          "mfFilter",
          [
            ["all", "All entries"],
            ["payment", "Payments"],
            ["expense", "Expenses"],
            ["deposit", "Deposits"],
            ["writeoff", "Write-offs"],
          ],
          st.filter,
        ) +
        "</div>" +
        ledgerRows(rows);
    } else if (st.tab === "rent") {
      body =
        '<div class="mf-subhead"><h2>Rent this month</h2>' +
        tag(s.period) +
        '</div><div class="mf-metrics">' +
        tile("Scheduled rent", s.charged, "rent") +
        tile("Applied to this month", s.received, "rent") +
        tile("Received this month", s.receivedByDate, "monthReceipts") +
        tile("Unapplied credit", s.credit, "credit") +
        "</div>" +
        '<div class="mf-subhead"><h2>Rent obligations · ' +
        esc(yr) +
        "</h2>" +
        htmlButton("writeoff", "Record write-off") +
        "</div>" +
        chargesList(rec("charge").filter((c) => c.date.startsWith(yr))) +
        '<div class="mf-subhead"><h2>Unapplied credit</h2></div>' +
        creditList() +
        details(
          "Rent schedule history",
          sorted(rec("scheduleAdjustment"))
            .map(
              (event) =>
                '<p class="mf-note"><b>' +
                esc(event.date + " · " + event.reason) +
                "</b><br>" +
                esc("Effective " + event.effectiveFrom) +
                (event.changes.length
                  ? "<br>" +
                    event.changes
                      .map((c) =>
                        esc(
                          c.period +
                            " · " +
                            c.action +
                            " · " +
                            amt(c.oldAmount) +
                            " → " +
                            amt(c.newAmount),
                        ),
                      )
                      .join("<br>")
                  : "") +
                "</p>",
            )
            .join("") || note("No schedule changes recorded."),
        );
    } else if (st.tab === "deposits") {
      body =
        '<div class="mf-subhead"><h2>Deposit ledger</h2>' +
        htmlButton("deposit", "Record deposit activity") +
        "</div>" +
        note(
          "Held as a refundable liability. The opening entry carries the existing balance forward.",
        ) +
        ledgerRows(sorted(report.rows.filter((t) => t.type === "deposit")));
    } else if (st.tab === "reconcile") {
      body =
        '<div class="mf-subhead"><h2>Bank statements</h2><div class="mf-actions">' +
        htmlButton("csv", "Import bank CSV") +
        htmlButton("reconcile", "Reconcile statement") +
        "</div></div>" +
        note(
          rec("bankline").filter((r) => !r.matchedId).length +
            " bank lines await matching.",
        ) +
        listWrap(
          rec("reconciliation")
            .filter((r) => r.end?.startsWith(yr))
            .map(
              (r) =>
                '<button class="mf-row" type="button" data-money="reconciliation" data-id="' +
                esc(r.id) +
                '"><span class="mf-grow"><strong>' +
                esc(r.account) +
                "</strong><small>" +
                esc(r.start) +
                " – " +
                esc(r.end) +
                "</small></span><b>" +
                esc(amt(r.difference)) +
                " difference</b></button>",
            )
            .join("") ||
            '<div class="mf-empty">No statements reconciled for this year.</div>',
        ) +
        '<div class="mf-subhead"><h2>Imported activity</h2></div>' +
        listWrap(
          sorted(rec("bankline").filter((r) => r.date.startsWith(yr)))
            .map(
              (r) =>
                '<button class="mf-row" type="button" data-money="match" data-id="' +
                esc(r.id) +
                '"><span class="mf-grow"><strong>' +
                esc(r.description) +
                "</strong><small>" +
                esc(r.date) +
                " · " +
                (r.matchedId ? "Matched" : "Needs matching") +
                "</small></span><b>" +
                esc(amt(r.amount)) +
                "</b></button>",
            )
            .join("") ||
            '<div class="mf-empty">Import a bank CSV to review and match statement lines.</div>',
        );
    } else {
      body =
        '<div class="mf-subhead"><h2>Annual reports</h2>' +
        htmlButton("profile", "Reporting details") +
        "</div>" +
        note(mapping(yr)) +
        listWrap(
          rec("export")
            .filter((r) => r.kind === "CPA packet" && String(r.year) === yr)
            .map(
              (r) =>
                '<button class="mf-row" type="button" data-money="snapshot" data-id="' +
                esc(r.id) +
                '"><span class="mf-grow"><strong>' +
                esc(r.filename) +
                "</strong><small>" +
                esc(r.exportedAt || "") +
                "</small></span><b>Download ↓</b></button>",
            )
            .join("") ||
            '<div class="mf-empty">Prepare a CPA packet to retain a dated snapshot here.</div>',
        );
    }
    const inbox = rec("document").filter((d) => d.receiptInbox);
    const inboxHtml = inbox.length
      ? '<section class="mf-card"><div class="mf-subhead"><h2>Receipt inbox</h2><span>' +
        inbox.length +
        " to review</span></div>" +
        listWrap(
          inbox
            .map(
              (d) =>
                '<button class="mf-row" type="button" data-money="inbox" data-id="' +
                esc(d.id) +
                '"><span class="mf-grow"><strong>' +
                esc(d.filename || d.name) +
                "</strong><small>Confirm expense</small></span><b>›</b></button>",
            )
            .join(""),
        ) +
        "</section>"
      : "";
    pm().content().innerHTML =
      '<div class="mf-workspace"><header class="mf-head"><div><h1>Money</h1><p>Rent, expenses, and your property accounts.</p></div>' +
      select(
        "Reporting year",
        "mfYear",
        options.map((x) => [x, x]),
        yr,
      ) +
      '</header><div class="mf-actions mf-topactions">' +
      buttons.map(([action, label]) => htmlButton(action, label)).join("") +
      '</div><div class="mf-metrics">' +
      tile("Rent due to date", s.dueNow, "arrears") +
      tile("Income · " + yr, report.totals.income, "income") +
      tile("Expenses · " + yr, report.totals.expenses, "expenses") +
      tile("Deposit held", s.deposit, "deposits") +
      "</div>" +
      chips(
        [
          ["activity", "Activity"],
          ["rent", "Rent"],
          ["deposits", "Deposits"],
          ["reconcile", "Reconciliation"],
          ["reports", "Reports"],
        ],
        st.tab,
      ) +
      '<section class="mf-card">' +
      body +
      "</section>" +
      inboxHtml +
      "</div>";
  }
  function chargesList(rows) {
    const due = balances(
      rec("charge"),
      transactions().filter((t) => t.date <= today()),
    );
    return listWrap(
      sorted(rows)
        .map(
          (c) =>
            '<button type="button" class="mf-row" data-money="charge" data-id="' +
            esc(c.id) +
            '"><span class="mf-grow"><strong>Rent · ' +
            esc(c.period) +
            "</strong><small>Due " +
            esc(c.date) +
            " · " +
            esc(pm().get(c.tenancyId)?.name || "Tenancy") +
            '</small></span><span class="mf-right"><b>' +
            esc(amt(c.amount)) +
            "</b><small>" +
            esc(due.get(c.id) === 0 ? "Paid" : amt(due.get(c.id)) + " open") +
            "</small></span></button>",
        )
        .join("") ||
        '<div class="mf-empty">Scheduled rent will appear here after tenancy setup.</div>',
    );
  }
  function creditList() {
    const payments = rec("payment"),
      returned = refundGroups(payments);
    return listWrap(
      payments
        .filter((t) => !t.reverses)
        .map((t) => ({
          t,
          credit: receiptRemaining(t, returned.get(t.id)).credit,
        }))
        .filter((x) => x.credit > 0)
        .map(
          ({ t, credit }) =>
            '<button type="button" class="mf-row" data-money="allocate" data-id="' +
            esc(t.id) +
            '"><span class="mf-grow">Payment · ' +
            esc(t.date) +
            "</span><b>" +
            esc(amt(credit)) +
            " available</b></button>",
        )
        .join("") || '<div class="mf-empty">No unapplied payments.</div>',
    );
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
  function allocationInputs(tenancyId, amount, defaultCharge, asOf = today()) {
    const tx = transactions(),
      charges = rec("charge").filter((c) => c.tenancyId === tenancyId);
    const map = balances(charges, tx);
    const open = charges
      .filter((c) => map.get(c.id) > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    const selected = defaultCharge || open.find((c) => c.date <= asOf)?.id;
    return (
      '<p class="mf-kicker">Allocate to rent</p>' +
      (open.length
        ? open
            .map((c) =>
              moneyInput(
                c.period + " · " + amt(map.get(c.id)) + " open",
                "allocation:" + c.id,
                c.id === selected
                  ? (Math.min(amount, map.get(c.id)) / 100).toFixed(2)
                  : "",
                false,
              ),
            )
            .join("")
        : note(
            "No open charges. The payment will remain as unapplied credit.",
          )) +
      '<p id="mf-credit" class="mf-note" aria-live="polite"></p>'
    );
  }
  function formAllocations(fd, amount, tenancyId) {
    const list = [];
    for (const [k, v] of fd)
      if (k.startsWith("allocation:") && v && cents(v) !== 0)
        list.push({ chargeId: k.slice(11), amount: cents(v, true) });
    return allocate(
      amount,
      list,
      balances(
        rec("charge").filter((c) => c.tenancyId === tenancyId),
        transactions(),
      ),
    ).map((a) => {
      const c = pm().get(a.chargeId);
      return {
        ...a,
        ...(c.termEventId ? { chargeTermEventId: c.termEventId } : {}),
      };
    });
  }
  function paymentForm(charge, old, bank) {
    if (needTenancy()) return;
    const tenancyId =
      old?.tenancyId || charge?.tenancyId || rec("tenancy")[0].id;
    const dueMap = balances(rec("charge"), transactions()),
      near = rec("charge").find(
        (c) =>
          c.tenancyId === tenancyId &&
          c.date <= today() &&
          dueMap.get(c.id) > 0,
      );
    const amount = bank
      ? bank.amount
      : old
        ? receiptRemaining(old, refundGroups(rec("payment")).get(old.id)).credit
        : charge
          ? dueMap.get(charge.id)
          : near
            ? dueMap.get(near.id)
            : 0;
    const key = dkey("payment" + (old?.id || bank?.id || "")),
      targetId = uid();
    const fields = old
      ? note(
          "Apply the remaining " +
            amt(amount) +
            " from the payment received " +
            old.date +
            ".",
        )
      : twocol(
          selectedTenancy("tenancyId", tenancyId),
          txt(
            "Date received",
            "date",
            "date",
            bank?.date || today(),
            "required",
          ),
        ) +
        twocol(
          moneyInput(
            "Amount received ($)",
            "amount",
            amount ? (amount / 100).toFixed(2) : "",
          ),
          select("Method", "method", [
            ["Bank transfer", "Bank transfer"],
            ["Check", "Check"],
            ["Cash", "Cash"],
            ["Other", "Other"],
          ]),
        ) +
        txt(
          "Account",
          "account",
          "text",
          bank?.account || "Rental checking",
          "required",
        ) +
        area("Purpose or reference", "notes", bank?.description || "");
    const f = formDialog(
      old ? "Allocate credit" : "Record payment",
      fields + '<div id="mf-allocation"></div>',
      old ? "Save allocation" : "Save payment",
      async (fd) => {
        const id = old?.tenancyId || fd.get("tenancyId"),
          a = old ? amount : cents(fd.get("amount"), true);
        const portions = formAllocations(fd, a, id);
        if (old && !portions.length)
          throw new Error("Enter an amount for at least one rent charge.");
        if (old) {
          const current = pm().get(old.id);
          if (
            JSON.stringify(current.allocations) !==
            JSON.stringify(old.allocations)
          )
            throw new Error(
              "This payment changed. Reopen it before allocating credit.",
            );
          await pm().save("payment", {
            ...old,
            allocations: [...(old.allocations || []), ...portions].reduce(
              (r, p) => {
                const same = r.find((x) => x.chargeId === p.chargeId);
                if (same) same.amount += p.amount;
                else r.push({ ...p });
                return r;
              },
              [],
            ),
            allocationHistory: [
              ...(old.allocationHistory || []),
              { at: new Date().toISOString(), previous: old.allocations },
            ],
          });
        } else {
          const record = {
            ...base("payment", targetId),
            tenancyId: id,
            date: date(fd.get("date")),
            account: fd.get("account").trim(),
            method: fd.get("method"),
            amount: a,
            notes: fd.get("notes").trim(),
            allocations: portions,
            sourceId: bank?.id || "",
          };
          await saveWithBank(record, bank);
        }
        finish(old ? "Allocation saved." : "Payment saved.");
      },
      key,
    );
    const box = byId("mf-allocation");
    const update = () => {
      let a = amount;
      try {
        if (!old) a = cents(f.elements.amount.value || "0");
      } catch {
        a = 0;
      }
      box.innerHTML = allocationInputs(
        old?.tenancyId || f.elements.tenancyId.value,
        a,
        charge?.id,
      );
    };
    const credit = () => {
      let a = 0,
        total = 0;
      try {
        a = old ? amount : cents(f.elements.amount.value || "0");
        for (const [k, v] of new FormData(f))
          if (k.startsWith("allocation:") && v) total += cents(v);
        byId("mf-credit").textContent =
          "Allocated " + amt(total) + " · Unapplied " + amt(a - total);
      } catch {
        byId("mf-credit").textContent = "Check the allocation amounts.";
      }
    };
    update();
    bindDraft(f, key);
    if (!old)
      f.elements.tenancyId.addEventListener("change", () => {
        update();
        credit();
      });
    f.addEventListener("input", credit);
    credit();
  }
  async function saveWithBank(record, bank, extra = []) {
    if (bank) {
      const current = pm().get(bank.id);
      if (!current || current.matchedId)
        throw new Error("This bank line has already been matched.");
      if (
        current.amount !== accountMovement(record) ||
        current.account !== record.account
      )
        throw new Error("The amount and account must match the bank line.");
      extra.push({
        ...current,
        matchedId: record.id,
        linkedAt: new Date().toISOString(),
      });
    }
    await pm().batch([record, ...extra]);
  }
  const props = () =>
    all("property").length ? all("property") : [pm().prop()].filter(Boolean);
  const partRow = (
    i,
    category = "review",
    amount = "",
    propertyId = active(),
  ) =>
    '<div class="mf-split" data-part="' +
    i +
    '">' +
    select(
      "Category",
      "category" + i,
      Object.entries(categories).map(([k, v]) => [k, v[0]]),
      category,
    ) +
    moneyInput("Split amount ($)", "split" + i, amount, false) +
    (props().length > 1
      ? select(
          "Property",
          "prop" + i,
          props().map((p) => [p.id, p.name]),
          propertyId,
        )
      : "") +
    '<button type="button" data-remove-part aria-label="Remove split" class="mf-remove">×</button></div>';
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
        throw new Error("Each receipt must be between 1 byte and 20 MB.");
      if (
        !/\.(pdf|jpe?g|png|webp|gif|heic|heif|avif|tiff?|bmp)$/i.test(file.name)
      )
        throw new Error("Choose a receipt image or PDF.");
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
  function expenseForm(photoOnly = false, initialDoc, bank) {
    const targetId = uid(),
      key = dkey("expense" + (bank?.id || "")),
      prior = drafts[key] || {};
    const category = prior.category0 || "review";
    const upload =
      '<div class="mf-upload"><strong>Supporting receipts</strong>' +
      note(
        "Add images or PDFs. Captures are kept in the receipt inbox until you post the expense.",
      ) +
      '<label class="mf-file">Choose files<input id="mf-files" type="file" accept="image/*,.heic,.heif,application/pdf" multiple></label>' +
      '<label class="mf-file">Photograph receipt<input id="mf-camera" type="file" accept="image/*" capture="environment"></label><div id="mf-receipts" aria-live="polite"></div></div>';
    const modes = [
      ["expense", "Expense paid"],
      ["creditCard", "Credit-card purchase"],
      ["refund", "Vendor refund"],
      ["mortgage", "Mortgage payment"],
      ["escrowDisbursement", "Escrow tax / insurance disbursement"],
      ["tenantPaid", "Tenant paid owner cost"],
      ["incoming", "Incoming non-rent funds"],
      ["depreciation", "CPA-approved depreciation"],
    ];
    const data =
      twocol(
        txt(
          "Vendor or payee",
          "vendor",
          "text",
          bank?.description || "",
          'required maxlength="160"',
        ),
        txt(
          "Accounting date",
          "date",
          "date",
          bank?.date || today(),
          "required",
        ),
      ) +
      twocol(
        moneyInput(
          "Transaction total ($)",
          "amount",
          bank ? (Math.abs(bank.amount) / 100).toFixed(2) : "",
        ),
        select(
          "Entry type",
          "mode",
          modes,
          bank?.amount > 0 ? "refund" : "expense",
        ),
      ) +
      twocol(
        txt(
          "Account or credit card",
          "account",
          "text",
          bank?.account || "Rental checking",
          "required",
        ),
        txt("Payment method", "method", "text", ""),
      ) +
      '<div id="mf-splits">' +
      partRow(0, category) +
      '</div><button type="button" id="mf-addsplit" class="mf-button">Add a split</button>' +
      note(
        "A single category uses the full amount. For a split, enter each amount.",
      ) +
      area("Business purpose or reference", "notes") +
      details(
        "Asset, mileage, and allocation details",
        txt("Asset in-service date, if known", "inService", "date") +
          txt(
            "Business miles, if applicable",
            "miles",
            "number",
            "",
            'min="0" step="0.1"',
          ) +
          txt("Trip origin, destination, and purpose", "trip") +
          area(
            "Ownership, personal use, reimbursement, or CPA instructions",
            "reviewNotes",
          ),
      );
    const ids = new Set(initialDoc ? [initialDoc.id] : []);
    let pending = 0,
      nextPart = 1;
    const f = formDialog(
      photoOnly ? "Photograph receipt" : "Add expense",
      photoOnly ? upload + data : data + upload,
      "Save expense",
      async (fd, form) => {
        if (pending)
          throw new Error(
            "Wait for the selected receipt files to finish saving.",
          );
        const full = cents(fd.get("amount"), true),
          mode = fd.get("mode");
        const parts = [...form.querySelectorAll("[data-part]")].map((row) => {
          const i = row.dataset.part;
          return {
            category: fd.get("category" + i),
            amount:
              form.querySelectorAll("[data-part]").length === 1 &&
              !fd.get("split" + i)
                ? full
                : cents(fd.get("split" + i), true),
            propertyId: fd.get("prop" + i) || active(),
          };
        });
        validateSplits(full, parts);
        if (
          (mode === "depreciation" &&
            parts.some((s) => s.category !== "depreciation")) ||
          (mode !== "depreciation" &&
            parts.some((s) => s.category === "depreciation"))
        )
          throw new Error(
            "Use the CPA-approved depreciation entry type and category together.",
          );
        if (
          mode === "incoming" &&
          parts.some(
            (s) =>
              ![
                "transfer",
                "loan",
                "contribution",
                "recovery",
                "reimbursement",
                "review",
              ].includes(s.category),
          )
        )
          throw new Error(
            "Choose a transfer, loan, contribution, recovery, reimbursement, or review category for incoming funds.",
          );
        if (
          mode === "escrowDisbursement" &&
          parts.some(
            (s) => !["taxes", "insurance", "review"].includes(s.category),
          )
        )
          throw new Error(
            "Use taxes, insurance, or CPA review for an escrow disbursement.",
          );
        if (fd.get("miles") && !fd.get("trip").trim())
          throw new Error("Record the trip origin, destination, and purpose.");
        const direction = mode === "refund" || mode === "incoming" ? -1 : 1,
          attachments = [...ids];
        const record = {
          ...base("expense", targetId),
          date: date(fd.get("date")),
          vendor: fd.get("vendor").trim(),
          account: fd.get("account").trim(),
          mode,
          method: fd.get("method").trim(),
          amount: direction * full,
          splits: parts.map((s) => ({ ...s, amount: s.amount * direction })),
          attachments,
          notes: fd.get("notes").trim(),
          reviewNotes: fd.get("reviewNotes").trim(),
          inService: fd.get("inService") || "",
          miles: fd.get("miles") || "",
          trip: fd.get("trip").trim(),
          sourceId: bank?.id || "",
        };
        const docs = attachments.flatMap((id) => {
          const doc = pm().get(id);
          if (!doc) throw new Error("A receipt could not be retrieved.");
          return doc.immutable
            ? []
            : [
                {
                  ...doc,
                  receiptInbox: false,
                  immutable: true,
                  transactionId: record.id,
                  transactionIds: [
                    ...new Set([
                      ...(doc.transactionIds || []),
                      ...(doc.transactionId ? [doc.transactionId] : []),
                      record.id,
                    ]),
                  ],
                },
              ];
        });
        await saveWithBank(record, bank, docs);
        finish("Expense saved.");
      },
      key,
    );
    const box = byId("mf-splits");
    for (const name of Object.keys(prior))
      if (/^category\d+$/.test(name) && name !== "category0") {
        const i = Number(name.slice(8));
        box.insertAdjacentHTML("beforeend", partRow(i));
        nextPart = Math.max(nextPart, i + 1);
      }
    bindDraft(f, key);
    byId("mf-addsplit").onclick = () => {
      box.insertAdjacentHTML("beforeend", partRow(nextPart++));
    };
    box.addEventListener("click", (ev) => {
      if (
        ev.target.hasAttribute("data-remove-part") &&
        box.children.length > 1
      ) {
        ev.target.closest("[data-part]").remove();
        f.dispatchEvent(new Event("input"));
      }
    });
    f.elements.mode.addEventListener("change", () => {
      const mode = f.elements.mode.value;
      if (mode === "mortgage") {
        box.innerHTML =
          partRow(0, "principal") +
          partRow(1, "interest") +
          partRow(2, "escrow");
        nextPart = 3;
      } else if (mode === "escrowDisbursement") {
        box.innerHTML = partRow(0, "taxes");
        f.elements.account.value = "Mortgage escrow";
      } else if (mode === "creditCard") {
        f.elements.account.value = "Rental credit card";
        f.elements.method.value = "Credit card";
      } else if (mode === "depreciation") {
        box.innerHTML = partRow(0, "depreciation");
      } else if (mode === "incoming") {
        box.innerHTML = partRow(0, "review");
      }
    });
    const receipts = byId("mf-receipts");
    function refreshDocs() {
      const available = rec("document").filter(
        (d) =>
          ["Receipt", "Invoice"].includes(d.kind || d.category) ||
          ids.has(d.id),
      );
      receipts.innerHTML = available.length
        ? details(
            "Choose retained receipts (" + ids.size + " selected)",
            available
              .map(
                (d) =>
                  '<label class="mf-check"><input type="checkbox" data-doc="' +
                  esc(d.id) +
                  '" ' +
                  (ids.has(d.id) ? "checked" : "") +
                  ">" +
                  esc(d.filename || d.name) +
                  "</label>",
              )
              .join(""),
          )
        : note("No receipts selected.");
    }
    receipts.addEventListener("change", (e) => {
      if (e.target.dataset.doc) {
        if (e.target.checked) ids.add(e.target.dataset.doc);
        else ids.delete(e.target.dataset.doc);
        e.target.closest("details").querySelector("summary").textContent =
          "Choose retained receipts (" + ids.size + " selected)";
      }
    });
    refreshDocs();
    for (const input of [byId("mf-files"), byId("mf-camera")])
      input.addEventListener("change", async () => {
        pending++;
        receipts.textContent = "Saving originals…";
        try {
          for (const d of await captureReceipts([...input.files]))
            ids.add(d.id);
          input.value = "";
        } catch (e) {
          failure(e, f);
        } finally {
          pending--;
          refreshDocs();
        }
      });
  }
  function adjustment(kind) {
    if (needTenancy()) return;
    const isWrite = kind === "writeoff",
      id = uid(),
      first = rec("tenancy")[0].id;
    const form = formDialog(
      isWrite ? "Write off unpaid rent" : "Record deposit activity",
      note(
        isWrite
          ? "Record the reduced obligation and reason. Cash-basis income and deductible expenses are unaffected."
          : "Opening balances carry forward liability. An application to rent reduces the liability without creating another cash receipt.",
      ) +
        selectedTenancy("tenancyId", first) +
        (isWrite
          ? ""
          : select("Activity", "kind", Object.entries(deposits), "receipt")) +
        twocol(
          txt("Effective date", "date", "date", today(), "required"),
          moneyInput("Amount ($)", "amount"),
        ) +
        txt("Account for cash movement", "account", "text", "Rental checking") +
        '<div id="mf-depalloc"></div>' +
        area("Reason and evidence reference", "notes") +
        select("Supporting document", "doc", [
          ["", "None selected"],
          ...rec("document").map((d) => [d.id, d.name || d.filename]),
        ]),
      "Post entry",
      async (fd) => {
        if (!fd.get("notes").trim())
          throw new Error("Enter the reason or source for this entry.");
        const k = fd.get("kind") || "writeoff",
          t = fd.get("tenancyId"),
          a = cents(fd.get("amount"), k !== "adjustment"),
          day = date(fd.get("date"));
        if (!a) throw new Error("Enter a nonzero amount.");
        const negative = [
            "refund",
            "applyRent",
            "retainedIncome",
            "retainedReview",
          ].includes(k),
          value = negative ? -a : a;
        if (!isWrite && value < 0) {
          const history = rec("deposit")
            .filter((e) => e.tenancyId === t)
            .concat([{ date: day, amount: value }])
            .sort((a, b) => a.date.localeCompare(b.date));
          let held = 0;
          for (const e of history) {
            held += e.amount;
            if (held < 0)
              throw new Error(
                "This entry would exceed the deposit held at that date.",
              );
          }
        }
        const portions =
          isWrite || k === "applyRent" ? formAllocations(fd, a, t) : [];
        if (
          (isWrite || k === "applyRent") &&
          sum(portions, (r) => r.amount) !== a
        )
          throw new Error("Allocate the full amount to rent obligations.");
        await pm().save(isWrite ? "writeoff" : "deposit", {
          ...base(isWrite ? "writeoff" : "deposit", id),
          tenancyId: t,
          date: day,
          amount: value,
          kind: k,
          notes: fd.get("notes").trim(),
          account: fd.get("account").trim(),
          allocations: portions,
          attachments: fd.get("doc") ? [fd.get("doc")] : [],
        });
        finish("Ledger entry saved.");
      },
    );
    const refresh = () => {
      byId("mf-depalloc").innerHTML =
        isWrite || form.elements.kind?.value === "applyRent"
          ? allocationInputs(form.elements.tenancyId.value, 0)
          : "";
    };
    refresh();
    form.elements.tenancyId.onchange = refresh;
    if (form.elements.kind) form.elements.kind.onchange = refresh;
  }
  function transactionDetail(id) {
    const t = pm().get(id);
    if (!t) return;
    const v = classification(t, active());
    const dl = (rows) =>
      '<dl class="mf-dl">' +
      rows
        .map(
          ([k, v]) => "<dt>" + esc(k) + "</dt><dd>" + esc(v || "—") + "</dd>",
        )
        .join("") +
      "</dl>";
    const rows = [
      ["Accounting date", t.date],
      ["Cash movement", amt(v.cash)],
      ["Reporting income", amt(v.income)],
      ["Operating expenses", amt(v.expenses)],
      ["Account", t.account],
      ["Method", t.method],
      ["Tenancy", pm().get(t.tenancyId)?.name],
      ["Reference", t.notes],
      ["Transaction ID", t.id],
    ];
    if (t.type === "deposit")
      rows.splice(1, 0, ["Liability change", amt(t.amount)]);
    if (t.reverses) rows.push(["Reverses", t.reverses]);
    const linked = rec("bankline").filter((b) => b.matchedId === id);
    const portions = (t.allocations || []).map((a) => [
      pm().get(a.chargeId)?.period || a.chargeId,
      amt(a.amount),
    ]);
    const splitRows = (t.splits || []).map((s) => [
      labelCat(s.category),
      amt(s.amount),
    ]);
    const reversible =
      !t.reverses && !transactions().some((r) => r.reverses === id);
    const currentPayment =
      t.type === "payment" && !t.reverses
        ? receiptRemaining(t, refundGroups(rec("payment")).get(t.id))
        : null;
    const buttons =
      (currentPayment?.credit > 0
        ? htmlButton("allocate", "Allocate credit", 'data-id="' + esc(id) + '"')
        : "") +
      (t.type === "expense" && reversible
        ? htmlButton(
            "reclass",
            "Correct categories",
            'data-id="' + esc(id) + '"',
          ) +
          htmlButton(
            "linkReceipts",
            "Link receipts",
            'data-id="' + esc(id) + '"',
          )
        : "") +
      (currentPayment?.amount > 0
        ? htmlButton(
            "rentRefund",
            "Refund or return rent",
            'data-id="' + esc(id) + '"',
          )
        : "") +
      (reversible && t.type !== "payment"
        ? htmlButton("reverse", "Record reversal", 'data-id="' + esc(id) + '"')
        : "");
    pm().modal(
      titleOf(t),
      '<div class="mf-form">' +
        dl(rows) +
        (portions.length ? "<h3>Rent allocation</h3>" + dl(portions) : "") +
        (splitRows.length ? "<h3>Category splits</h3>" + dl(splitRows) : "") +
        (linked.length
          ? note(
              "Matched bank references: " +
                linked.map((x) => x.reference || x.id).join(", "),
            )
          : "") +
        (t.attachments || [])
          .map((d) =>
            htmlButton(
              "document",
              pm().get(d)?.name || "Open attachment",
              'data-id="' + esc(d) + '"',
            ),
          )
          .join("") +
        (t.categoryHistory?.length
          ? details(
              "Category correction history",
              t.categoryHistory
                .map((h) =>
                  note(
                    h.at.slice(0, 10) +
                      " · " +
                      h.reason +
                      " · Previous: " +
                      h.previous
                        .map((s) => labelCat(s.category) + " " + amt(s.amount))
                        .join(", "),
                  ),
                )
                .join(""),
            )
          : "") +
        '<div class="mf-actions">' +
        buttons +
        "</div></div>",
    );
  }
  function reclassify(t) {
    if (
      !t ||
      t.type !== "expense" ||
      t.reverses ||
      transactions().some((r) => r.reverses === t.id)
    )
      throw new Error("Open an active expense to correct its categories.");
    const allowed = Object.entries(categories).filter(([k]) =>
      t.mode === "depreciation" ? k === "depreciation" : k !== "depreciation",
    );
    const options = allowed.map(([k, v]) => [k, v[0]]);
    formDialog(
      "Correct expense categories",
      note(t.vendor + " · " + t.date + " · " + amt(t.amount)) +
        t.splits
          .map((s, i) =>
            select(
              "Allocation " + (i + 1) + " · " + amt(s.amount),
              "category" + i,
              options,
              s.category,
            ),
          )
          .join("") +
        txt(
          "Reason for correction",
          "reason",
          "text",
          "",
          'required maxlength="500"',
        ) +
        note(
          "The original classifications and correction reason are retained. Earlier CPA packet snapshots stay available in Reports.",
        ),
      "Save corrected categories",
      async (fd) => {
        const reason = fd.get("reason").trim();
        if (!reason) throw new Error("Enter a correction reason.");
        const splits = t.splits.map((s, i) => ({
          ...s,
          category: fd.get("category" + i),
        }));
        if (splits.every((s, i) => s.category === t.splits[i].category))
          throw new Error("Choose a changed category.");
        if (
          t.mode === "incoming" &&
          splits.some(
            (s) =>
              ![
                "transfer",
                "loan",
                "contribution",
                "recovery",
                "reimbursement",
                "review",
              ].includes(s.category),
          )
        )
          throw new Error("Choose an incoming funds or review category.");
        if (
          t.mode === "escrowDisbursement" &&
          splits.some(
            (s) => !["taxes", "insurance", "review"].includes(s.category),
          )
        )
          throw new Error(
            "An escrow disbursement uses taxes, insurance, or CPA review.",
          );
        await pm().save("expense", {
          ...t,
          splits,
          categoryHistory: [
            ...(t.categoryHistory || []),
            { at: new Date().toISOString(), reason, previous: t.splits },
          ],
        });
        finish("Expense categories corrected.");
      },
      dkey("reclass:" + t.id),
    );
  }
  function linkReceipts(t) {
    const docs = all("document").filter(
      (d) =>
        financialDoc(d) &&
        (d.propertyId === t.propertyId ||
          t.splits?.some((s) => s.propertyId === d.propertyId)),
    );
    formDialog(
      "Link supporting files",
      note(t.vendor + " · " + t.date + " · " + amt(t.amount)) +
        (docs.length
          ? docs
              .map(
                (d) =>
                  '<label class="mf-check"><input type="checkbox" name="document" value="' +
                  esc(d.id) +
                  '" ' +
                  (t.attachments?.includes(d.id) ? "checked disabled" : "") +
                  ">" +
                  esc(d.name || d.filename) +
                  "</label>",
              )
              .join("")
          : note(
              "Import an invoice or receipt in Documents, then select it here.",
            )),
      "Save links",
      async (fd) => {
        const selected = fd.getAll("document");
        if (!selected.length)
          throw new Error("Select at least one new supporting file.");
        const attachments = [
          ...new Set([...(t.attachments || []), ...selected]),
        ];
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
        finish("Supporting files linked.");
      },
      dkey("attachments:" + t.id),
    );
  }
  function reverse(id) {
    const t = pm().get(id);
    if (!t) return;
    const newId = uid();
    formDialog(
      "Reverse ledger entry",
      note(
        "The original entry stays in the ledger. This posts an equal, opposite entry dated when the refund, return, or correction occurred.",
      ) +
        txt("Reversal date", "date", "date", today(), "required") +
        txt("Reason", "reason", "text", "", 'required maxlength="500"'),
      "Confirm reversal",
      async (fd) => {
        const current = pm().get(id),
          day = date(fd.get("date"));
        if (transactions().some((r) => r.reverses === id) || current.reverses)
          throw new Error("This entry has already been reversed.");
        if (day < current.date)
          throw new Error("Choose the original date or a later date.");
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
          notes: fd.get("reason").trim(),
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
          throw new Error("This reversal would exceed the deposit held.");
        await pm().save(current.type, r);
        finish("Reversal saved. The original entry is retained.");
      },
      dkey("reverse:" + id),
    );
  }
  function refundRent(t) {
    if (!t || t.type !== "payment" || t.reverses)
      throw new Error("Select the original rental payment.");
    const remaining = receiptRemaining(
        t,
        refundGroups(rec("payment")).get(t.id),
      ),
      id = uid();
    if (remaining.amount <= 0)
      throw new Error("This payment has already been fully returned.");
    const entries = [...remaining.byCharge].filter(([, n]) => n > 0);
    const form = formDialog(
      "Refund or return rent",
      note(
        "Original receipt " +
          t.date +
          " · " +
          amt(t.amount) +
          ". The receipt stays in its original year. This separate entry uses the date money was actually returned.",
      ) +
        twocol(
          txt("Refund or return date", "date", "date", today(), "required"),
          moneyInput(
            "Total returned ($)",
            "amount",
            (remaining.amount / 100).toFixed(2),
          ),
        ) +
        "<h3>Reverse allocations</h3>" +
        note(
          "Enter the portion taken back from each rent month. Any remaining refund uses unapplied credit, up to " +
            amt(remaining.credit) +
            ".",
        ) +
        entries
          .map(([chargeId, n]) =>
            moneyInput(
              (pm().get(chargeId)?.period || chargeId) +
                " · available " +
                amt(n),
              "refund:" + chargeId,
              (n / 100).toFixed(2),
              false,
            ),
          )
          .join("") +
        txt(
          "Account used for refund",
          "account",
          "text",
          t.account || "Rental checking",
          "required",
        ) +
        txt(
          "Reason or payment reference",
          "reason",
          "text",
          "",
          'required maxlength="500"',
        ),
      "Post rent return",
      async (fd) => {
        const value = cents(fd.get("amount"), true),
          day = date(fd.get("date"));
        if (day < t.date)
          throw new Error("Use the receipt date or a later return date.");
        const current = pm().get(t.id),
          left = receiptRemaining(
            current,
            refundGroups(rec("payment")).get(t.id),
          );
        if (value > left.amount)
          throw new Error(
            "The return exceeds the remaining amount of this payment.",
          );
        const allocations = [];
        for (const [key, val] of fd)
          if (key.startsWith("refund:") && val && cents(val) !== 0) {
            const chargeId = key.slice(7),
              n = cents(val, true);
            if (n > (left.byCharge.get(chargeId) || 0))
              throw new Error("A return exceeds its original rent allocation.");
            const original = current.allocations.find(
              (a) => a.chargeId === chargeId,
            );
            allocations.push({ ...original, amount: -n });
          }
        const fromCredit = value + sum(allocations, (a) => a.amount);
        if (fromCredit < 0 || fromCredit > left.credit)
          throw new Error(
            "The returned allocations and available unapplied credit must cover the exact return.",
          );
        const reason = fd.get("reason").trim();
        if (!reason) throw new Error("Document the reason for the return.");
        await pm().save("payment", {
          ...base("payment", id),
          tenancyId: t.tenancyId,
          amount: -value,
          date: day,
          account: fd.get("account").trim(),
          method: t.method || "",
          notes: reason,
          kind: "rentRefund",
          reverses: t.id,
          allocations,
        });
        finish("Rent return posted. The original receipt is retained.");
      },
      dkey("rentRefund:" + t.id),
    );
    if (entries.length === 1 && !remaining.credit)
      form.elements.amount.addEventListener("input", () => {
        form.elements.namedItem("refund:" + entries[0][0]).value =
          form.elements.amount.value;
      });
  }
  function bankDate(input, format) {
    let value = input.trim();
    if (format === "mdy") {
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
      if (!m) throw new Error("Expected month/day/year.");
      value = m[3] + "-" + m[1].padStart(2, "0") + "-" + m[2].padStart(2, "0");
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
  function importCsv() {
    formDialog(
      "Import bank CSV",
      note(
        "Choose a statement export with a date, description, and signed amount. Money coming in is positive. Each imported line remains separate until you review its match.",
      ) +
        '<label class="mf-field">Statement CSV<input type="file" name="statement" accept=".csv,text/csv" required></label>' +
        txt(
          "Statement account",
          "account",
          "text",
          "Rental checking",
          "required",
        ),
      "Map columns",
      async (fd) => {
        const file = fd.get("statement");
        if (file.size > 2 * 1024 * 1024)
          throw new Error("Choose a CSV up to 2 MB.");
        const raw = await file.text(),
          rows = parseCsv(raw),
          headers = rows[0].map((h, i) => [
            String(i),
            h || "Column " + (i + 1),
          ]);
        const guess = (pattern) =>
          String(rows[0].findIndex((h) => pattern.test(h)));
        const account = fd.get("account").trim();
        if (!account) throw new Error("Enter the statement account.");
        const hash = await digestString(raw);
        formDialog(
          "Map statement columns",
          note(file.name + " · " + (rows.length - 1) + " lines · " + account) +
            twocol(
              select("Date", "dateCol", headers, guess(/date/i)),
              select(
                "Date format",
                "format",
                [
                  ["iso", "Year-month-day"],
                  ["mdy", "Month/day/year"],
                ],
                /^\d{4}-/.test(rows[1][Number(guess(/date/i))] || "")
                  ? "iso"
                  : "mdy",
              ),
            ) +
            select(
              "Description",
              "descriptionCol",
              headers,
              guess(/desc|merchant|memo|payee/i),
            ) +
            select(
              "Signed amount",
              "amountCol",
              headers,
              guess(/amount|total/i),
            ) +
            select(
              "Unique bank transaction ID (optional)",
              "refCol",
              [["", "No identifier"], ...headers],
              "",
            ),
          "Preview lines",
          async (map) => {
            const mapped = [],
              ignored = [],
              seen = new Set(),
              existing = new Set(rec("bankline").map((b) => b.id));
            if (
              new Set(
                ["dateCol", "descriptionCol", "amountCol"].map((k) =>
                  map.get(k),
                ),
              ).size !== 3
            )
              throw new Error("Map three different columns.");
            for (let i = 1; i < rows.length; i++) {
              const r = rows[i];
              try {
                const day = bankDate(r[map.get("dateCol")], map.get("format")),
                  amount = bankAmount(r[map.get("amountCol")]);
                if (!amount)
                  throw new Error("Zero-amount lines cannot be imported.");
                const reference =
                  map.get("refCol") !== "" ? r[map.get("refCol")].trim() : "";
                const stable = reference
                  ? "ref:" + reference
                  : "file:" + hash + ":" + i;
                const id =
                  "bank:" +
                  (await digestString(
                    JSON.stringify([active(), account, stable]),
                  ));
                if (seen.has(id))
                  throw new Error(
                    "The selected bank identifier repeats in this file.",
                  );
                seen.add(id);
                const description = r[map.get("descriptionCol")].trim();
                if (!description) throw new Error("Missing description.");
                if (existing.has(id)) {
                  const prev = pm().get(id);
                  if (prev.amount !== amount || prev.date !== day)
                    throw new Error(
                      "A stored bank identifier has different date or amount.",
                    );
                  ignored.push(i);
                  continue;
                }
                mapped.push({
                  ...base("bankline", id),
                  date: day,
                  amount,
                  description,
                  account,
                  reference,
                  sourceHash: hash,
                  sourceRow: i,
                  sourceName: file.name,
                  matchedId: "",
                });
              } catch (e) {
                throw new Error("Line " + (i + 1) + ": " + e.message);
              }
            }
            importPreview(mapped, ignored.length, file.name);
          },
        );
      },
    );
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
  function importPreview(mapped, skipped, name) {
    const tx = transactions(),
      existing = rec("bankline");
    const potential = new Set(
      existing.map((r) => JSON.stringify([r.date, r.amount, r.account])),
    );
    const rows = mapped.map((r) => [
      r.sourceRow + 1,
      r.date,
      r.description,
      amt(r.amount),
      potential.has(JSON.stringify([r.date, r.amount, r.account]))
        ? "Possible duplicate"
        : tx.some(
              (t) =>
                t.date === r.date &&
                accountMovement(t) === r.amount &&
                t.account === r.account,
            )
          ? "Possible match"
          : "Unmatched",
    ]);
    const f = formDialog(
      "Review bank import",
      note(
        name +
          " · " +
          mapped.length +
          " new lines · " +
          skipped +
          " previously imported. No transactions are created at this step.",
      ) +
        '<div class="mf-scroll" tabindex="0" aria-label="Bank line preview"><table class="mf-table"><thead><tr>' +
        ["Line", "Date", "Description", "Amount", "Review"]
          .map((x) => "<th>" + x + "</th>")
          .join("") +
        '</tr></thead><tbody id="mf-bank-preview"></tbody></table></div>' +
        '<button type="button" class="mf-button" id="mf-more">Show more rows</button>',
      "Import " + mapped.length + " bank lines",
      async () => {
        const fresh = mapped.filter((r) => !pm().get(r.id));
        if (fresh.length) await pm().batch(fresh);
        state().tab = "reconcile";
        finish(
          fresh.length +
            " bank lines imported. " +
            (skipped + mapped.length - fresh.length) +
            " skipped.",
        );
      },
    );
    let shown = 0;
    const more = () => {
      const next = rows.slice(shown, shown + 75);
      byId("mf-bank-preview").insertAdjacentHTML(
        "beforeend",
        next
          .map(
            (r) =>
              "<tr>" +
              r.map((x) => "<td>" + esc(x) + "</td>").join("") +
              "</tr>",
          )
          .join(""),
      );
      shown += next.length;
      byId("mf-more").hidden = shown >= rows.length;
    };
    byId("mf-more").onclick = more;
    more();
    return f;
  }
  function matchBank(id) {
    const b = pm().get(id);
    if (!b) return;
    if (b.matchedId) {
      pm().modal(
        "Matched bank line",
        note(b.date + " · " + b.description + " · " + amt(b.amount)) +
          htmlButton(
            "activity",
            "View matched transaction",
            'data-id="' + esc(b.matchedId) + '"',
          ),
      );
      return;
    }
    const options = matchingCandidates(b);
    const f = formDialog(
      "Match bank line",
      note(
        b.date +
          " · " +
          b.description +
          " · " +
          b.account +
          " · " +
          amt(b.amount),
      ) +
        select(
          "Existing entry with the same account and cash amount",
          "candidate",
          [
            ["", "Select a transaction"],
            ...options.map((t) => [
              t.id,
              t.date + " · " + titleOf(t) + " · " + amt(b.amount),
            ]),
          ],
        ) +
        note(
          "Confirm the date, description, and reference. Equal amounts alone do not identify a duplicate.",
        ) +
        '<div class="mf-actions">' +
        (b.amount > 0
          ? htmlButton(
              "bankpayment",
              "Create rent payment",
              'data-id="' + esc(id) + '"',
            )
          : "") +
        htmlButton(
          "bankexpense",
          b.amount > 0 ? "Create other inflow" : "Create expense",
          'data-id="' + esc(id) + '"',
        ) +
        "</div>",
      "Confirm match",
      async (fd) => {
        if (
          !matchingCandidates(b).some((t) => t.id === fd.get("candidate")) ||
          pm().get(id)?.matchedId
        )
          throw new Error("Select an available, unmatched transaction.");
        await pm().save("bankline", {
          ...b,
          matchedId: fd.get("candidate"),
          linkedAt: new Date().toISOString(),
        });
        finish("Matched. The original transaction was counted once.");
      },
      dkey("match:" + id),
    );
    if (!options.length) f.querySelector("[type=submit]").disabled = true;
  }
  function reconcile() {
    const form = formDialog(
      "Reconcile statement",
      txt(
        "Statement account",
        "account",
        "text",
        "Rental checking",
        "required",
      ) +
        twocol(
          txt(
            "Period begins",
            "start",
            "date",
            today().slice(0, 7) + "-01",
            "required",
          ),
          txt("Period ends", "end", "date", today(), "required"),
        ) +
        twocol(
          moneyInput("Opening balance ($)", "opening"),
          moneyInput("Statement closing balance ($)", "closing"),
        ) +
        '<div id="mf-cleared"></div>' +
        area("Difference explanation", "explanation"),
      "Save reconciliation",
      async (fd) => {
        const account = fd.get("account").trim(),
          start = date(fd.get("start")),
          end = date(fd.get("end"));
        if (end < start)
          throw new Error("Choose an ending date on or after the beginning.");
        const overlapping = rec("reconciliation").some(
          (r) => r.account === account && r.start <= end && r.end >= start,
        );
        if (overlapping)
          throw new Error(
            "This account already has a reconciliation covering part of this period.",
          );
        const opening = cents(fd.get("opening")),
          closing = cents(fd.get("closing")),
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
          throw new Error("Review the updated activity.");
        const bank = rec("bankline").filter(
          (b) => b.account === account && b.date >= start && b.date <= end,
        );
        const movement = sum(
            ledger.filter((t) => cleared.includes(t.id)),
            accountMovement,
          ),
          difference = closing - (opening + movement),
          explanation = fd.get("explanation").trim();
        if (difference && !explanation)
          throw new Error(
            "Explain the difference or update the cleared entries.",
          );
        const prior = rec("reconciliation")
          .filter((r) => r.account === account && r.end < start)
          .sort((a, b) => b.end.localeCompare(a.end))[0];
        if (prior && opening !== prior.closing && !explanation)
          throw new Error(
            "Explain why the opening balance differs from the last closing balance.",
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
        finish("Reconciliation saved.");
      },
    );
    const box = byId("mf-cleared");
    function updateRows() {
      const e = form.elements,
        rows = transactions().filter(
          (t) =>
            t.propertyId === active() &&
            t.account === e.account.value.trim() &&
            t.date >= e.start.value &&
            t.date <= e.end.value &&
            accountMovement(t),
        );
      const bank = rec("bankline").filter(
        (b) =>
          b.account === e.account.value.trim() &&
          b.date >= e.start.value &&
          b.date <= e.end.value,
      );
      const matched = new Set(bank.map((b) => b.matchedId));
      box.innerHTML =
        "<h3>Cleared entries</h3>" +
        note(
          bank.length +
            " imported lines · " +
            amt(sum(bank, (b) => b.amount)) +
            " imported net",
        ) +
        (rows.length
          ? sorted(rows)
              .map(
                (t) =>
                  '<label class="mf-check"><input name="cleared" type="checkbox" value="' +
                  esc(t.id) +
                  '" ' +
                  (matched.has(t.id) ? "checked" : "") +
                  ">" +
                  esc(
                    t.date +
                      " · " +
                      titleOf(t) +
                      " · " +
                      amt(accountMovement(t)),
                  ) +
                  "</label>",
              )
              .join("")
          : note("No ledger entries in this period.")) +
        '<p class="mf-note" id="mf-difference" aria-live="polite"></p>';
      calc();
    }
    function calc() {
      const fd = new FormData(form);
      try {
        const move = sum(fd.getAll("cleared"), (id) =>
          accountMovement(pm().get(id)),
        );
        byId("mf-difference").textContent =
          "Cleared movement " +
          amt(move) +
          " · Difference " +
          amt(
            cents(fd.get("closing") || "0") -
              cents(fd.get("opening") || "0") -
              move,
          );
      } catch {
        byId("mf-difference").textContent = "Check the balance amounts.";
      }
    }
    for (const n of ["account", "start", "end"])
      form.elements[n].onchange = updateRows;
    form.addEventListener("input", calc);
    updateRows();
  }
  function reconciliationDetail(id) {
    const r = pm().get(id);
    pm().modal(
      "Statement reconciliation",
      '<div class="mf-form"><h3>' +
        esc(r.account) +
        "</h3>" +
        note(r.start + " – " + r.end) +
        '<dl class="mf-dl">' +
        [
          ["Opening", r.opening],
          ["Imported net", r.imported],
          ["Cleared movement", r.movement],
          ["Closing", r.closing],
          ["Difference", r.difference],
        ]
          .map(
            ([key, v]) =>
              "<dt>" + esc(key) + "</dt><dd>" + esc(amt(v)) + "</dd>",
          )
          .join("") +
        "</dl>" +
        note(r.explanation || "No difference recorded.") +
        ledgerRows(r.cleared.map((id) => pm().get(id)).filter(Boolean)) +
        "</div>",
    );
  }
  function reportingProfile(propertyId, year) {
    return (
      all("financeprofile").find(
        (p) => p.propertyId === propertyId && p.year === String(year),
      ) || {}
    );
  }
  function profile(propertyId = active(), year = state().year) {
    const old = reportingProfile(propertyId, year);
    formDialog(
      "Reporting details · " + year,
      note(
        "Individual owner · calendar year · cash basis. Record the CPA’s instructions and any ownership or personal-use allocation. Totals remain at property level for CPA allocation.",
      ) +
        txt("Ownership or reporting entity", "owner", "text", old.owner || "") +
        twocol(
          txt(
            "Owner share (%)",
            "share",
            "number",
            old.share ?? "",
            'min="0" max="100" step="0.01"',
          ),
          txt(
            "Fair rental days",
            "rentalDays",
            "number",
            old.rentalDays ?? "",
            'min="0" max="366" step="1"',
          ),
        ) +
        txt(
          "Personal-use days",
          "personalDays",
          "number",
          old.personalDays ?? "",
          'min="0" max="366" step="1"',
        ) +
        area(
          "Allocation method and CPA instructions",
          "notes",
          old.notes || "",
        ),
      "Save reporting details",
      async (fd) => {
        const max =
          new Date(Date.UTC(+year, 1, 29)).getUTCMonth() === 1 ? 366 : 365;
        if (Number(fd.get("rentalDays")) + Number(fd.get("personalDays")) > max)
          throw new Error(
            "Rental and personal-use days exceed the calendar year.",
          );
        await pm().save("financeprofile", {
          ...old,
          id: old.id || "financial-profile:" + propertyId + ":" + year,
          type: "financeprofile",
          propertyId,
          year: String(year),
          owner: fd.get("owner").trim(),
          share: fd.get("share"),
          rentalDays: fd.get("rentalDays"),
          personalDays: fd.get("personalDays"),
          notes: fd.get("notes").trim(),
        });
        finish("Reporting details saved.");
      },
    );
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
  function cpaForm() {
    const yr = state().year,
      years = [
        ...new Set([
          today().slice(0, 4),
          yr,
          ...moneyTypes.flatMap(all).map((t) => t.date.slice(0, 4)),
        ]),
      ]
        .sort()
        .reverse();
    formDialog(
      "Prepare CPA packet",
      note(
        "Select the property and calendar year. Review the records and supporting files before generating the ZIP.",
      ) +
        select(
          "Property",
          "property",
          props().map((p) => [p.id, p.name]),
          active(),
          "required",
        ) +
        select(
          "Tax year",
          "year",
          years.map((y) => [y, y]),
          yr,
          "required",
        ),
      "Review packet",
      (fd) => cpaReview(fd.get("property"), fd.get("year")),
    );
  }
  function cpaReview(propertyId, year) {
    const data = packetData(propertyId, year),
      { issues, items, stats, docs, p } = data;
    const linked = new Set(items.flatMap(data.links));
    const isTaxYearDocument = (d) =>
      /tax document|1098/i.test(d.kind || d.category || "") &&
      String(d.taxYear || "") === year;
    const likely = docs.filter(
      (d) => financialDoc(d) && (linked.has(d.id) || isTaxYearDocument(d)),
    );
    const optional = docs.filter(
      (d) =>
        !likely.includes(d) &&
        financialDoc(d) &&
        (!d.date || String(d.date).startsWith(year)),
    );
    const picker = (d, checked) =>
      '<label class="mf-check"><input type="checkbox" name="include" value="' +
      esc(d.id) +
      '" ' +
      (checked ? "checked" : "") +
      ">" +
      esc(d.name || d.filename) +
      "</label>";
    const form = formDialog(
      "Review CPA packet",
      note(p.name + " · " + year + " · Calendar-year cash basis") +
        '<dl class="mf-dl"><dt>Recorded income</dt><dd>' +
        esc(amt(stats.income)) +
        "</dd><dt>Operating expenses</dt><dd>" +
        esc(amt(stats.expenses)) +
        "</dd><dt>Operating result</dt><dd>" +
        esc(amt(stats.income - stats.expenses)) +
        "</dd><dt>Net cash movement</dt><dd>" +
        esc(amt(stats.cash)) +
        "</dd><dt>Entries</dt><dd>" +
        items.length +
        "</dd></dl>" +
        note(mapping(year)) +
        details(
          issues.length + " items for CPA review",
          issues.length
            ? "<ul>" +
                issues
                  .map(
                    (i) => "<li>" + esc(i.topic + " · " + i.message) + "</li>",
                  )
                  .join("") +
                "</ul>"
            : note("No recorded issues in the available checks."),
        ) +
        details(
          "Supporting files (" + likely.length + " selected)",
          likely.map((d) => picker(d, true)).join("") +
            optional.map((d) => picker(d, false)).join("") ||
            note("No financial documents available."),
        ) +
        note(
          "Creates a local ZIP and retains an immutable snapshot. Personal-use and ownership allocations remain for CPA review.",
        ) +
        '<p id="mf-progress" role="status"></p>',
      issues.length ? "Generate preliminary ZIP" : "Generate CPA ZIP",
      async (fd) => {
        const selected = new Set(fd.getAll("include"));
        const out = await generatePacket(data, selected, (msg) => {
          if (byId("mf-progress")) byId("mf-progress").textContent = msg;
        });
        pm().download(out.blob, out.filename);
        state().tab = "reports";
        finish("CPA snapshot saved. Download started.");
      },
    );
    return form;
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
  function chargeDetail(id) {
    const c = pm().get(id);
    if (!c) return;
    const tx = transactions().filter((t) =>
        t.allocations?.some((a) => a.chargeId === id),
      ),
      due = balances([c], tx).get(id);
    pm().modal(
      "Rent obligation · " + c.period,
      '<div class="mf-form">' +
        note((pm().get(c.tenancyId)?.name || "Tenancy") + " · Due " + c.date) +
        '<dl class="mf-dl"><dt>Rent charged</dt><dd>' +
        esc(amt(c.amount)) +
        "</dd><dt>Open balance</dt><dd>" +
        esc(amt(due)) +
        "</dd></dl><h3>Applied entries</h3>" +
        ledgerRows(sorted(tx)) +
        (due > 0
          ? htmlButton("payment", "Record payment", 'data-id="' + esc(id) + '"')
          : "") +
        "</div>",
    );
  }
  async function open(action, id) {
    const row = id ? pm().get(id) : null;
    if (action.startsWith("tab:")) {
      state().tab = action.slice(4);
      render();
      return;
    }
    switch (action) {
      case "payment":
        return paymentForm(row?.type === "charge" ? row : null);
      case "allocate":
        return paymentForm(null, row);
      case "expense":
        return expenseForm();
      case "receipt":
        return expenseForm(true);
      case "inbox":
        return expenseForm(true, row);
      case "deposit":
      case "writeoff":
        return adjustment(action);
      case "rent":
        return pm().modal(
          "Rent obligations",
          '<div class="mf-form">' + chargesList(rec("charge")) + "</div>",
        );
      case "arrears": {
        const charges = rec("charge"),
          map = balances(
            charges,
            transactions().filter((t) => t.date <= today()),
          );
        return pm().modal(
          "Rent due to date",
          '<div class="mf-form">' +
            note(
              "Unpaid remaining balances on obligations due by " +
                today() +
                ".",
            ) +
            chargesList(
              charges.filter((c) => c.date <= today() && map.get(c.id) > 0),
            ) +
            "</div>",
        );
      }
      case "monthReceipts":
        return pm().modal(
          "Rent received this month",
          ledgerRows(
            sorted(
              rec("payment").filter(
                (t) =>
                  t.date <= today() && t.date.startsWith(today().slice(0, 7)),
              ),
            ),
          ),
        );
      case "charge":
        return chargeDetail(id);
      case "deposits":
        return pm().modal(
          "Deposit held",
          '<div class="mf-form">' +
            note("Current liability " + amt(home().deposit)) +
            ledgerRows(sorted(rec("deposit"))) +
            htmlButton("deposit", "Record deposit activity") +
            "</div>",
        );
      case "credit":
        return pm().modal("Unapplied credit", creditList());
      case "income":
      case "expenses": {
        const k = action === "income" ? "income" : "expenses",
          yr = state().year;
        return pm().modal(
          (action === "income" ? "Income" : "Expenses") + " · " + yr,
          ledgerRows(
            sorted(
              transactions().filter(
                (t) =>
                  t.date.startsWith(yr) && classification(t, active())[k] !== 0,
              ),
            ),
          ),
        );
      }
      case "activity":
        if (row?.type === "charge") return chargeDetail(id);
        return row
          ? transactionDetail(id)
          : pm().modal("Ledger activity", ledgerRows(sorted(transactions())));
      case "document":
        return pm().openDoc(id);
      case "reverse":
        return reverse(id);
      case "rentRefund":
        return refundRent(row);
      case "reclass":
        return reclassify(row);
      case "linkReceipts":
        return linkReceipts(row);
      case "csv":
        return importCsv();
      case "match":
        return matchBank(id);
      case "bankpayment":
        return paymentForm(null, null, row);
      case "bankexpense":
        return expenseForm(false, null, row);
      case "reconcile":
        return reconcile();
      case "reconciliation":
        return reconciliationDetail(id);
      case "profile":
        return profile();
      case "cpa":
        return cpaForm();
      case "snapshot": {
        if (!row) return;
        const blob = row.hash
          ? await pm().file(row.hash)
          : new Blob(
              await Promise.all(
                row.parts.map((id) => pm().file(pm().get(id).hash)),
              ),
              { type: "application/zip" },
            );
        return pm().download(blob, row.filename);
      }
    }
  }
  if (typeof document !== "undefined") {
    document.addEventListener("click", (e) => {
      const el = e.target.closest("[data-money]");
      if (el) {
        e.preventDefault();
        open(el.dataset.money, el.dataset.id).catch((err) =>
          failure(err, byId("mf-form")),
        );
      }
    });
    document.addEventListener("change", (e) => {
      if (e.target.name === "mfYear") {
        state().year = e.target.value;
        render();
      } else if (e.target.name === "mfFilter") {
        state().filter = e.target.value;
        render();
      }
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
  });
})(globalThis);
