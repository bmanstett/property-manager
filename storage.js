/* Local record store, authenticated portable archives and explicit device merges.
   The first half is the storage engine. The second half (from "Words for people")
   is presentation only: the Backup & sync panels and every sentence they show. */
(() => {
  "use strict";
  const DB_NAME = "PropertyManagerLocal",
    SCHEMA = 2,
    MIB = 1024 * 1024;
  const MAX_FILE = 32 * MIB,
    MAX_ARCHIVE = 256 * MIB,
    MAX_META = 20 * MIB,
    CHUNK = MIB;
  const ITERATIONS = 600000,
    MAGIC = new TextEncoder().encode("PMVAULT2");
  const TOO_LARGE =
      "Your records and files are larger than the 256 MB a backup file can hold. Remove some large files, then try again.",
    DAMAGED =
      "This backup file is damaged. Try another copy. Nothing was changed.",
    INCOMPLETE =
      "This backup file is incomplete or damaged. Try another copy. Nothing was changed.";
  const enc = new TextEncoder(),
    dec = new TextDecoder("utf-8", { fatal: true });
  const token = () => crypto.randomUUID();
  const now = () => new Date().toISOString();
  const validScope = (ds) => {
    if (ds !== "owner" && ds !== "sample") throw Error("Unknown workspace.");
    return ds;
  };
  let db, opening, device;
  const request = (q) =>
    new Promise((resolve, reject) => {
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
  const revisionFields = new Set([
    "_rev",
    "_parents",
    "_ancestors",
    "_device",
    "_updatedAt",
  ]);
  const emptyMeta = (ds) => ({
    key: "summary:" + ds,
    revision: 0,
    confirmedRevision: 0,
    lastBackup: null,
    lastCreated: null,
    lastTransfer: null,
  });
  const friendly = (e) =>
    e?.name === "QuotaExceededError"
      ? "This device is out of space for the app. Nothing was lost. Free some space, then try again."
      : e?.name === "AbortError"
        ? "Stopped. Nothing was changed."
        : e?.message ||
          "The app could not save just now. Nothing was lost. Try again.";
  /* A backup that decrypts but does not add up inside. The original reason is kept as the detail. */
  function consistent(check) {
    try {
      return check();
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      throw Error(
        "This backup cannot be used because something inside it does not add up. Nothing was changed. Details: " +
          (e?.message || e),
        { cause: e },
      );
    }
  }
  function init() {
    if (db) return Promise.resolve();
    if (opening) return opening;
    opening = (async () => {
      if (!globalThis.indexedDB || !globalThis.crypto?.subtle)
        throw Error(
          "This browser cannot store your records. Private or incognito windows often cause this. Open the app in a normal Chrome, Edge or Safari window.",
        );
      db = await new Promise((resolve, reject) => {
        const q = indexedDB.open(DB_NAME, SCHEMA);
        q.onupgradeneeded = (e) => {
          const d = q.result;
          if (e.oldVersion < 1) {
            for (const [name, id] of [
              ["records", "id"],
              ["blobs", "hash"],
            ]) {
              const store = d.createObjectStore(name, {
                keyPath: ["dataset", id],
              });
              store.createIndex("dataset", "dataset");
            }
            d.createObjectStore("meta", { keyPath: "key" });
          }
          if (e.oldVersion < 2) {
            const log = d.createObjectStore("history", {
              keyPath: ["dataset", "id"],
            });
            log.createIndex("dataset", "dataset");
          }
        };
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
        q.onblocked = () =>
          reject(
            Error(
              "Close any other Property Manager tabs or windows, then reopen the app.",
            ),
          );
      });
      db.onversionchange = () => {
        db.close();
        db = null;
        opening = null;
      };
      await transact(["meta"], "readwrite", async (tx) => {
        const meta = tx.objectStore("meta"),
          existing = await request(meta.get("device"));
        device = existing?.id || token();
        if (!existing) meta.put({ key: "device", id: device });
      });
    })().catch((e) => {
      if (db) db.close();
      db = null;
      opening = null;
      throw e;
    });
    return opening;
  }
  async function transact(stores, mode, fn) {
    const tx = db.transaction(stores, mode);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(tx.error || Error("Stopped. Nothing was changed."));
      tx.onerror = () => {}; // The transaction abort event contains the final error.
    });
    done.catch(() => {});
    try {
      const result = await fn(tx);
      await done;
      return result;
    } catch (e) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw e;
    }
  }
  const select = (tx, table, ds) =>
    request(tx.objectStore(table).index("dataset").getAll(ds));
  const summary = async (tx, ds) =>
    (await request(tx.objectStore("meta").get("summary:" + ds))) ||
    emptyMeta(ds);
  function log(tx, ds, action, ids = [], info = "") {
    tx.objectStore("history").put({
      dataset: ds,
      id: token(),
      at: now(),
      device,
      action,
      ids,
      info,
    });
  }
  function inspectJson(value, depth = 0) {
    if (depth > 24) throw Error("A record has too many nested fields.");
    if (value == null || typeof value === "boolean") return;
    if (typeof value === "string") {
      if (value.length > 2 * MIB)
        throw Error("A record text field is too large.");
      return;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value))
        throw Error("A record contains an invalid number.");
      return;
    }
    if (
      typeof value !== "object" ||
      value instanceof Blob ||
      value instanceof Date
    )
      throw Error("Records must contain plain data.");
    for (const [key, v] of Object.entries(value)) {
      if (
        ["__proto__", "prototype", "constructor"].includes(key) ||
        key.length > 160
      )
        throw Error("A record contains an invalid field name.");
      inspectJson(v, depth + 1);
    }
  }
  function validateRecord(r, importing = false) {
    if (
      !r ||
      Array.isArray(r) ||
      typeof r.type !== "string" ||
      !/^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/.test(r.type) ||
      typeof r.id !== "string" ||
      !r.id ||
      r.id.length > 512
    )
      throw Error("A record is missing its type or stable identifier.");
    inspectJson(r);
    if (importing) {
      if (
        typeof r._rev !== "string" ||
        !r._rev ||
        !Array.isArray(r._ancestors) ||
        r._ancestors.length > 12000 ||
        r._ancestors.some((id) => typeof id !== "string" || id.length > 128) ||
        typeof r._device !== "string"
      )
        throw Error("A record has invalid revision ancestry.");
    }
  }
  const active = (records) => records.filter((r) => !r._deleted);
  function plain(r) {
    return Object.fromEntries(
      Object.entries(r).filter(([key]) => !revisionFields.has(key)),
    );
  }
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonical(value[key])]),
      );
    return value;
  }
  const equal = (a, b) =>
    JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  function revised(body, parents) {
    const ancestors = [
      ...new Set(
        parents
          .flatMap((item) => [item._rev, ...(item._ancestors || [])])
          .filter(Boolean),
      ),
    ];
    if (ancestors.length > 12000)
      throw Error(
        "Record revision history is full. Create a succeeding version.",
      );
    return {
      ...plain(body),
      _rev: token(),
      _parents: parents.map((r) => r._rev),
      _ancestors: ancestors,
      _device: device,
      _updatedAt: now(),
    };
  }
  async function list(ds, includeDeleted = false) {
    validScope(ds);
    await init();
    return transact(["records"], "readonly", async (tx) => {
      const rows = (await select(tx, "records", ds)).map((row) => row.value);
      return includeDeleted ? rows : active(rows);
    });
  }
  async function save(ds, items) {
    validScope(ds);
    await init();
    if (!Array.isArray(items) || items.length > 100000)
      throw Error("Invalid record batch.");
    const incoming = items.map((item) => ({ ...item, id: item.id || token() }));
    incoming.forEach((item) => validateRecord(item));
    if (new Set(incoming.map((r) => r.id)).size !== incoming.length)
      throw Error("A batch contains two edits for the same record.");
    return transact(["records", "meta", "history"], "readwrite", async (tx) => {
      const store = tx.objectStore("records");
      const [meta, ...rows] = await Promise.all([
        summary(tx, ds),
        ...incoming.map((r) => request(store.get([ds, r.id]))),
      ]);
      if (incoming.some((r) => r.type === "scheduleAdjustment")) {
        if (typeof globalThis.Money?.protectTermChanges !== "function")
          throw Error(
            "Rent schedule validation is unavailable. Reopen the installed application and retry.",
          );
        const before = (await select(tx, "records", ds)).map(
          (row) => row.value,
        );
        globalThis.Money.protectTermChanges(active(before), incoming);
      }
      const changed = [];
      const stored = incoming.map((r, index) => {
        const old = rows[index]?.value,
          body = { ...old, ...r };
        if (
          old &&
          (equal(plain(old), plain(body)) ||
            (old.type === "charge" &&
              r.type === "charge" &&
              equal(chargeValue(old), chargeValue(body))))
        )
          return old;
        if (old?.immutable)
          throw Error(
            "This item is final and cannot be changed. Make a new version instead.",
          );
        if (old && r._rev !== old._rev)
          throw Error(
            "This item was changed somewhere else while you were editing. Reopen it and make your changes again.",
          );
        if (old && r.type !== old.type)
          throw Error("A record type cannot change.");
        const value = revised(body, old ? [old] : []);
        store.put({ dataset: ds, id: r.id, value });
        changed.push(r.id);
        return value;
      });
      if (
        changed.length &&
        globalThis.Money?.validateImport &&
        incoming.some((r) =>
          [
            "charge",
            "payment",
            "expense",
            "deposit",
            "writeoff",
            "bankline",
            "reconciliation",
          ].includes(r.type),
        )
      ) {
        const current = (await select(tx, "records", ds)).map(
          (row) => row.value,
        );
        globalThis.Money.validateImport(active(current));
      }
      if (changed.length) {
        meta.revision++;
        tx.objectStore("meta").put(meta);
        log(tx, ds, "Saved records", changed);
      }
      return stored;
    });
  }
  const hex = (buffer) =>
    Array.from(new Uint8Array(buffer), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  const digest = async (data) =>
    hex(await crypto.subtle.digest("SHA-256", data));
  async function storeBlob(ds, blob) {
    validScope(ds);
    await init();
    if (!(blob instanceof Blob) || blob.size > MAX_FILE)
      throw Error(
        "That file is larger than 32 MB, so it was not added. Your original file is untouched.",
      );
    const hash = await digest(await blob.arrayBuffer());
    await transact(["blobs", "meta"], "readwrite", async (tx) => {
      const s = tx.objectStore("blobs");
      const [exists, m] = await Promise.all([
        request(s.getKey([ds, hash])),
        summary(tx, ds),
      ]);
      if (exists) return;
      s.put({ dataset: ds, hash, blob });
      m.revision++;
      tx.objectStore("meta").put(m);
    });
    return hash;
  }
  async function getBlob(ds, hash) {
    validScope(ds);
    await init();
    const row = await transact(["blobs"], "readonly", (tx) =>
      request(tx.objectStore("blobs").get([ds, hash])),
    );
    if (!row)
      throw Error(
        "This file is missing on this device. Restore a backup that contains it.",
      );
    return row.blob;
  }
  async function snapshot(ds) {
    validScope(ds);
    await init();
    return transact(
      ["records", "blobs", "meta", "history"],
      "readonly",
      async (tx) => {
        const [r, b, m, h] = await Promise.all([
          select(tx, "records", ds),
          select(tx, "blobs", ds),
          summary(tx, ds),
          select(tx, "history", ds),
        ]);
        return {
          records: r.map((x) => x.value),
          blobs: b,
          meta: m,
          history: h,
        };
      },
    );
  }
  async function status(ds) {
    validScope(ds);
    await init();
    const [[meta, records], estimate, persistent] = await Promise.all([
      transact(["meta", "records"], "readonly", (tx) =>
        Promise.all([
          summary(tx, ds),
          request(tx.objectStore("records").index("dataset").count(ds)),
        ]),
      ),
      navigator.storage?.estimate?.().catch(() => ({})),
      navigator.storage?.persisted?.().catch(() => false),
    ]);
    const result = {
      ...meta,
      changes: Math.max(0, meta.revision - (meta.confirmedRevision || 0)),
      usage: estimate?.usage,
      quota: estimate?.quota,
      persistent: !!persistent,
      // Display only: how many entries are stored (removed ones included).
      records,
    };
    // Display only. The stored times are UTC. The copies handed to screens carry this device's
    // own offset, so their first ten characters are the local calendar date and a backup made
    // in the evening is never shown with tomorrow's date. new Date(value) reads either form.
    for (const key of ["lastBackup", "lastCreated", "lastTransfer"])
      result[key] = localStamp(result[key]);
    result.summary = describe(result, { dataset: ds });
    return result;
  }
  function checkCancel(signal) {
    if (signal?.aborted)
      throw new DOMException("Stopped. Nothing was changed.", "AbortError");
  }
  async function derive(password, salt) {
    if (!password || password.length > 2048)
      throw Error("Type the backup password.");
    const passwordKey = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
      passwordKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }
  const u32 = (value) => {
    const a = new Uint8Array(4);
    new DataView(a.buffer).setUint32(0, value);
    return a;
  };
  function sealParams(header, index) {
    const iv = new Uint8Array(12);
    iv.set(header.subarray(24, 32));
    iv.set(u32(index), 8);
    const aad = new Uint8Array(36);
    aad.set(header);
    aad.set(u32(index), 32);
    return { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 };
  }
  async function makeBackup(
    ds,
    password,
    { progress = () => {}, signal } = {},
  ) {
    if (password.length < 12) throw Error("Use at least 12 characters.");
    const data = await snapshot(ds);
    checkCancel(signal);
    const files = data.blobs.map(({ hash, blob }) => ({
      hash,
      size: blob.size,
      mime: blob.type,
    }));
    const bytes = files.reduce((total, b) => total + b.size, 0);
    if (bytes > MAX_ARCHIVE) throw Error(TOO_LARGE);
    const body = {
      version: 2,
      schema: SCHEMA,
      dataset: ds,
      at: now(),
      device,
      revision: data.meta.revision,
      records: data.records,
      history: data.history,
      files,
    };
    const encoded = enc.encode(JSON.stringify(body));
    if (encoded.length > MAX_META)
      throw Error("There are too many entries for one backup file.");
    const meta = enc.encode(
      JSON.stringify({ hash: await digest(encoded), body }),
    );
    const totalFrames =
      1 + files.reduce((n, f) => n + Math.ceil(f.size / CHUNK), 0);
    if (meta.length + bytes + 32 + totalFrames * 20 > MAX_ARCHIVE)
      throw Error(TOO_LARGE);
    const header = new Uint8Array(32);
    header.set(MAGIC);
    crypto.getRandomValues(header.subarray(8));
    progress("Encrypting records", 0, bytes);
    const key = await derive(password, header.subarray(8, 24)),
      parts = [header];
    let index = 0,
      written = 0;
    async function frame(plainBytes) {
      checkCancel(signal);
      const cipher = await crypto.subtle.encrypt(
        sealParams(header, index++),
        key,
        plainBytes,
      );
      parts.push(u32(cipher.byteLength), new Blob([cipher]));
    }
    await frame(meta);
    for (const item of data.blobs) {
      for (let at = 0; at < item.blob.size; at += CHUNK) {
        const bytesPart = await item.blob.slice(at, at + CHUNK).arrayBuffer();
        await frame(bytesPart);
        written += bytesPart.byteLength;
        progress("Encrypting originals", written, bytes);
      }
    }
    checkCancel(signal);
    const blob = new Blob(parts, { type: "application/octet-stream" }),
      at = now();
    await transact(["meta", "history"], "readwrite", async (tx) => {
      const m = await summary(tx, ds);
      m.lastCreated = at;
      m.createdRevision = data.meta.revision;
      tx.objectStore("meta").put(m);
      log(
        tx,
        ds,
        "Created encrypted backup",
        [],
        "Saving to a durable location is unconfirmed.",
      );
    });
    return {
      blob,
      revision: data.meta.revision,
      at,
      files: files.length,
      records: data.records.length,
      dataset: ds,
    };
  }
  function validateBundle(body, hashes) {
    if (
      !Array.isArray(body.records) ||
      body.records.length > 100000 ||
      !Array.isArray(body.history) ||
      body.history.length > 150000
    )
      throw Error("The record manifest is invalid.");
    const ids = new Set();
    for (const r of body.records) {
      validateRecord(r, true);
      if (ids.has(r.id)) throw Error("The backup repeats a stable record ID.");
      ids.add(r.id);
      if (
        r.hash &&
        ["document", "export", "exportSnapshot", "exportPart"].includes(
          r.type,
        ) &&
        !hashes.has(r.hash)
      )
        throw Error("The backup is missing a referenced file.");
    }
    for (const log of body.history) {
      if (
        !log ||
        typeof log.id !== "string" ||
        typeof log.action !== "string" ||
        typeof log.at !== "string" ||
        !Array.isArray(log.ids)
      )
        throw Error("Invalid activity history.");
      inspectJson(log);
    }
    validateRelations(active(body.records), hashes);
  }
  function validateRelations(records, hashes) {
    const ids = new Map(records.map((r) => [r.id, r]));
    for (const record of records) {
      if (
        record.propertyId &&
        record.type !== "property" &&
        ids.get(record.propertyId)?.type !== "property"
      )
        throw Error("A record refers to a missing property.");
      if (record.tenancyId && ids.get(record.tenancyId)?.type !== "tenancy")
        throw Error("A record refers to a missing tenancy.");
    }
    if (globalThis.Money?.validateImport)
      globalThis.Money.validateImport(records);
    if (globalThis.Work?.validate) globalThis.Work.validate(records, hashes);
    if (globalThis.Leases?.validateImport)
      globalThis.Leases.validateImport(records, hashes);
  }
  async function readBackup(
    blob,
    password,
    ds,
    { progress = () => {}, signal } = {},
  ) {
    validScope(ds);
    if (!(blob instanceof Blob) || blob.size < 52 || blob.size > MAX_ARCHIVE)
      throw Error(
        "Choose a Property Manager backup file. Its name ends in .pmvault and it is at most 256 MB.",
      );
    let at = 32,
      index = 0;
    const head = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
    if (!MAGIC.every((b, i) => head[i] === b))
      throw Error(
        "That is not a Property Manager backup file. Choose the file ending in .pmvault.",
      );
    const key = await derive(password, head.subarray(8, 24));
    async function next(limit, expected) {
      checkCancel(signal);
      if (at + 4 > blob.size) throw Error(INCOMPLETE);
      const size = new DataView(
        await blob.slice(at, at + 4).arrayBuffer(),
      ).getUint32(0);
      at += 4;
      if (
        size < 16 ||
        size > limit + 16 ||
        at + size > blob.size ||
        (expected !== undefined && size !== expected + 16)
      )
        throw Error(INCOMPLETE);
      const cipher = await blob.slice(at, at + size).arrayBuffer();
      at += size;
      try {
        return await crypto.subtle.decrypt(
          sealParams(head, index++),
          key,
          cipher,
        );
      } catch {
        throw Object.assign(
          Error(
            "That password did not open this backup. Check capitals and typos. If the password is right, the file may be damaged.",
          ),
          { code: "password" },
        );
      }
    }
    progress("Verifying manifest", 0, blob.size);
    const manifest = JSON.parse(dec.decode(await next(MAX_META + 1024)));
    const body = manifest.body;
    if (
      !body ||
      body.version !== 2 ||
      body.schema > SCHEMA ||
      !Number.isSafeInteger(body.revision) ||
      body.revision < 0 ||
      typeof body.at !== "string" ||
      typeof body.device !== "string" ||
      !Array.isArray(body.files) ||
      body.files.length > 50000
    )
      throw Error(
        "This version of the app cannot read that backup. It may come from a newer version. Update the app, then try again.",
      );
    if ((await digest(enc.encode(JSON.stringify(body)))) !== manifest.hash)
      throw Error(DAMAGED);
    if (body.dataset !== ds) {
      // The rule is unchanged: a backup only goes back into the records it came from.
      // `code` and `holds` let the panel offer to carry on with the right ones.
      const holds = body.dataset === "sample" ? "sample" : "owner";
      throw Object.assign(
        Error(
          holds === "sample"
            ? "This backup holds the sample property, not your own records."
            : "This backup holds your own records, not the sample property.",
        ),
        { code: "other-records", holds },
      );
    }
    const hashes = new Set(),
      blobs = [];
    for (const f of body.files) {
      if (
        !f ||
        typeof f.hash !== "string" ||
        !/^[a-f0-9]{64}$/.test(f.hash) ||
        hashes.has(f.hash) ||
        !Number.isSafeInteger(f.size) ||
        f.size < 0 ||
        f.size > MAX_FILE ||
        typeof f.mime !== "string" ||
        f.mime.length > 256
      )
        throw Error(DAMAGED);
      hashes.add(f.hash);
      const parts = [];
      for (let i = 0; i < f.size; i += CHUNK) {
        parts.push(new Blob([await next(CHUNK, Math.min(CHUNK, f.size - i))]));
        progress("Checking originals", at, blob.size);
      }
      const original = new Blob(parts, { type: f.mime });
      if ((await digest(await original.arrayBuffer())) !== f.hash)
        throw Error(DAMAGED);
      blobs.push({ dataset: ds, hash: f.hash, blob: original });
    }
    if (at !== blob.size) throw Error(INCOMPLETE);
    consistent(() => validateBundle(body, hashes));
    checkCancel(signal);
    return { dataset: ds, body, blobs };
  }
  function chargeValue(r) {
    const body = plain(r);
    for (const key of [
      "created",
      "createdAt",
      "entered",
      "enteredAt",
      "updated",
      "updatedAt",
    ])
      delete body[key];
    return body;
  }
  function planMerge(local, incoming) {
    const existing = new Map(local.map((r) => [r.id, r]));
    const additions = [],
      updates = [],
      conflicts = [];
    let unchanged = 0;
    for (const other of incoming) {
      const ours = existing.get(other.id);
      if (!ours) {
        additions.push(other);
        continue;
      }
      if (ours.type !== other.type)
        throw Error("Two different record types share an identifier.");
      if (ours._rev === other._rev) {
        if (!equal(plain(ours), plain(other)))
          throw Error(
            "Identical revision identifiers contain inconsistent records.",
          );
        unchanged++;
        continue;
      }
      if (ours._ancestors.includes(other._rev)) {
        unchanged++;
        continue;
      }
      if (
        other._ancestors.includes(ours._rev) &&
        (!ours.immutable || equal(plain(ours), plain(other)))
      ) {
        updates.push(other);
        continue;
      }
      if (
        equal(plain(ours), plain(other)) ||
        (ours.type === "charge" && equal(chargeValue(ours), chargeValue(other)))
      ) {
        updates.push(revised(ours, [ours, other]));
        continue;
      }
      conflicts.push({ id: ours.id, local: ours, incoming: other });
    }
    return { additions, updates, conflicts, unchanged };
  }
  async function planImport(ds, bundle, mode) {
    if (!["restore", "merge"].includes(mode) || bundle.dataset !== ds)
      throw Error("Invalid import destination.");
    const local = await snapshot(ds);
    const merge =
      mode === "merge"
        ? consistent(() => planMerge(local.records, bundle.body.records))
        : null;
    return {
      ds,
      bundle,
      mode,
      baseline: local.meta.revision,
      local: local.records,
      localHashes: local.blobs.map((b) => b.hash),
      merge,
    };
  }
  async function commitImport(plan, choices = {}, signal) {
    const { ds, bundle, mode, baseline, local, merge } = plan;
    checkCancel(signal);
    let records;
    if (mode === "restore") {
      records = bundle.body.records;
    } else {
      const resolved = merge.conflicts.map((c) => {
        if (!["local", "incoming"].includes(choices[c.id]))
          throw Error(
            "Choose which version to keep for each item changed on both devices.",
          );
        const selected = c[choices[c.id]];
        if (c.local.immutable && !equal(plain(c.local), plain(selected)))
          throw Error(
            "One of these items is final on this device and cannot be replaced.",
          );
        return revised(selected, [c.local, c.incoming]);
      });
      records = [...merge.additions, ...merge.updates, ...resolved];
      const combined = new Map(local.map((r) => [r.id, r]));
      records.forEach((r) => combined.set(r.id, r));
      const hashSet = new Set([
        ...plan.localHashes,
        ...bundle.blobs.map((b) => b.hash),
      ]);
      consistent(() =>
        validateRelations(active([...combined.values()]), hashSet),
      );
    }
    return transact(
      ["records", "blobs", "meta", "history"],
      "readwrite",
      async (tx) => {
        const meta = await summary(tx, ds);
        if (meta.revision !== baseline)
          throw Object.assign(
            Error(
              "Something was saved on this device while you were reviewing. Check the backup again to see the latest.",
            ),
            { code: "changed-during-review" },
          );
        checkCancel(signal);
        const cancel = () => {
          try {
            tx.abort();
          } catch {}
        };
        signal?.addEventListener("abort", cancel, { once: true });
        tx.addEventListener(
          "complete",
          () => signal?.removeEventListener("abort", cancel),
          { once: true },
        );
        tx.addEventListener(
          "abort",
          () => signal?.removeEventListener("abort", cancel),
          { once: true },
        );
        const rs = tx.objectStore("records"),
          bs = tx.objectStore("blobs"),
          hs = tx.objectStore("history");
        const previousBlobKeys =
          mode === "merge"
            ? new Set(
                (await request(bs.index("dataset").getAllKeys(ds))).map(
                  (key) => key[1],
                ),
              )
            : new Set();
        const keys = [ds, ""],
          upper = [ds, []],
          range = IDBKeyRange.bound(keys, upper);
        if (mode === "restore") {
          rs.delete(range);
          bs.delete(range);
          hs.delete(range);
        }
        for (const r of records) rs.put({ dataset: ds, id: r.id, value: r });
        const newBlobs = bundle.blobs.filter(
          (b) => !previousBlobKeys.has(b.hash),
        );
        for (const b of newBlobs) bs.put(b);
        for (const item of bundle.body.history)
          hs.put({ ...item, dataset: ds });
        const imported = records.length,
          stamp = now();
        if (mode === "restore" || imported || newBlobs.length) meta.revision++;
        if (mode === "restore") {
          meta.lastBackup = stamp;
          meta.confirmedRevision = meta.revision;
          meta.backupEvidence = "Restore tested";
          meta.lastCreated = null;
          meta.createdRevision = null;
        }
        meta.lastTransfer = stamp;
        meta.transferMethod =
          mode === "restore"
            ? "Replaced from tested backup"
            : "Merged device changes";
        tx.objectStore("meta").put(meta);
        log(
          tx,
          ds,
          mode === "restore"
            ? "Restored encrypted backup"
            : "Merged encrypted device transfer",
          [],
          imported + " records applied.",
        );
        return { imported, revision: meta.revision };
      },
    );
  }
  async function confirmBackup(ds, revision, githubConfirmed = false) {
    await transact(["meta", "history"], "readwrite", async (tx) => {
      const meta = await summary(tx, ds);
      if (!githubConfirmed && revision !== meta.createdRevision)
        throw Error(
          "A newer backup file was made after this one. Save and confirm that one.",
        );
      if (githubConfirmed && revision < meta.confirmedRevision) return;
      meta.lastBackup = now();
      meta.backupEvidence = githubConfirmed ? "GitHub confirmed encrypted snapshot" : "Owner confirmed file saved";
      meta.confirmedRevision = revision;
      tx.objectStore("meta").put(meta);
      log(tx, ds, githubConfirmed ? "GitHub confirmed encrypted snapshot" : "Owner confirmed backup saved");
    });
  }
  async function estimate(ds) {
    const snap = await snapshot(ds);
    return {
      revision: snap.meta.revision,
      count: active(snap.records).length,
      files: snap.blobs.length,
      size:
        snap.blobs.reduce((s, b) => s + b.blob.size, 0) +
        enc.encode(JSON.stringify(snap.records)).length,
    };
  }
  async function history(ds) {
    await init();
    return transact(["history"], "readonly", async (tx) =>
      (await select(tx, "history", validScope(ds))).sort((a, b) =>
        b.at.localeCompare(a.at),
      ),
    );
  }

  /* ====================================================================
     Words for people

     Everything from here down is presentation: it turns the stored values
     above into plain sentences and draws the Backup & sync panels.

     Stored values (backupEvidence, transferMethod, history actions and the
     progress labels the engine emits) are data. They also live inside
     existing backup files, so they are translated here when shown and are
     never rewritten.
     ==================================================================== */
  const GIB = 1024 * MIB,
    DAY = 86400000,
    REPO_KEY = "propertymanager.githubRepository",
    KEY_KEY = "propertymanager.githubKey",
    PASS_KEY = "propertymanager.githubPassword",
    PROBE_KEY = "propertymanager.probe",
    PROTECT_KEY = "propertymanager.protectAsked",
    PENDING_KEY = "propertymanager.backupFile.";
  const prefs = {
    get(key) {
      try {
        return localStorage.getItem(key) || "";
      } catch {
        return "";
      }
    },
    set(key, value) {
      try {
        if (value) localStorage.setItem(key, value);
        else localStorage.removeItem(key);
      } catch {}
    },
  };
  /* Store.syncRepository() -> the GitHub repository this device last synced with, or "". */
  const remembered = () => prefs.get(REPO_KEY);
  const shortNumber = (n) => String(+n.toFixed(n >= 10 ? 0 : 1));
  const sizeLabel = (bytes) => {
    const n = Math.max(0, Number(bytes) || 0);
    if (n >= GIB) return shortNumber(n / GIB) + " GB";
    if (n >= MIB) return shortNumber(n / MIB) + " MB";
    return Math.ceil(n / 1024) + " KB";
  };
  const plural = (n, one, many) =>
    Number(n || 0).toLocaleString("en-US") +
    " " +
    (Number(n) === 1 ? one : many);
  const entryCount = (n) => plural(n, "entry", "entries");
  const fileCount = (n) => plural(n, "file", "files");
  const changeCount = (n) => plural(n, "change", "changes");
  const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
  const nameList = (names) =>
    names.length <= 2
      ? names.join(" and ")
      : names.slice(0, 2).join(", ") + " and " + (names.length - 2) + " more";
  const dateWords = (d, options) =>
    new Intl.DateTimeFormat("en-US", options).format(d).replace(/\s/g, " ");
  const clock = (d) => dateWords(d, { hour: "numeric", minute: "2-digit" });
  const dayStart = (d) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  /* Store.when(value, { now, time }) -> "today at 7:43 PM", "yesterday at 9:02 AM", "Nov 3" or
     "Nov 3, 2025". Always in this device's own time zone, so an evening backup is never
     dated tomorrow. Pass time: false for "today" and "yesterday" without the clock. */
  function when(value, { now = new Date(), time = true } = {}) {
    const d = new Date(value),
      base = new Date(now);
    if (!value || !Number.isFinite(d.getTime())) return "";
    const days = Math.round((dayStart(base) - dayStart(d)) / DAY);
    if (days === 0) return time ? "today at " + clock(d) : "today";
    if (days === 1) return time ? "yesterday at " + clock(d) : "yesterday";
    return dateWords(d, {
      month: "short",
      day: "numeric",
      ...(d.getFullYear() === base.getFullYear() ? {} : { year: "numeric" }),
    });
  }
  const fullDate = (value) => {
    const d = new Date(value);
    return Number.isFinite(d.getTime())
      ? dateWords(d, { month: "short", day: "numeric", year: "numeric" }) +
          " at " +
          clock(d)
      : "an unknown date";
  };
  const two = (n) => String(n).padStart(2, "0");
  /* The same moment written with this device's own offset, for example
     "2026-11-18T19:43:25.000-08:00". Used only for the times Store.status() hands to screens. */
  function localStamp(value) {
    const d = new Date(value);
    if (!value || !Number.isFinite(d.getTime())) return value;
    const offset = -d.getTimezoneOffset(),
      size = Math.abs(offset);
    return (
      new Date(d.getTime() + offset * 60000).toISOString().slice(0, 23) +
      (offset < 0 ? "-" : "+") +
      two(Math.floor(size / 60)) +
      ":" +
      two(size % 60)
    );
  }
  const instant = (value) => (value ? new Date(value).getTime() || 0 : 0);
  /* Backup files are named with the local date and time they were made. */
  function backupName(ds, at) {
    const d = new Date(at);
    return (
      "Property-Manager-" +
      (ds === "sample" ? "sample" : "backup") +
      "-" +
      d.getFullYear() +
      "-" +
      two(d.getMonth() + 1) +
      "-" +
      two(d.getDate()) +
      "-" +
      two(d.getHours()) +
      two(d.getMinutes()) +
      ".pmvault"
    );
  }
  /* Store.describe(status, options) -> how safe the records are, in plain words.

     status   what Store.status(dataset) returned (only its stored fields are read).
     options  dataset     "owner" or "sample". Read from the status when omitted.
              records     how many entries exist. Read from status.records when omitted.
              repository  the remembered sync repository. Read from this device when omitted.
              now         the moment to measure from. For tests.

     Returns { state, kind, headline, detail, short, needsAction, action, actionLabel }:
       state        "sample" | "empty" | "unfinished" | "never" | "brought" | "current" | "recent" | "behind"
       kind         "ok" | "due" | "muted", ready for UI.status(kind, text)
       headline     a few words, for example "Backed up" or "Backup needed"
       detail       one supporting line, for example "Today at 7:43 PM" or "7 changes since Nov 2"
       short        both in one line, for a sidebar card or a settings row
       needsAction  true only when the owner should back up or sync soon
       action       the PM.action name for a one-click button, or "": "backup", "sync-now" (opens
                    Sync with GitHub and starts the sync when this device has its access key),
                    or "storage" when a backup file was made but not yet marked as saved
       actionLabel  "Back up now", "Sync now" or "Finish backup", or ""

     It is pure: it saves nothing. Store.status(dataset).summary holds the same result. A backup
     counts as behind after 5 saved changes or after 14 days with any change, because the app
     adds next month's rent charge by itself and that alone should not raise a reminder. */
  function describe(s, o = {}) {
    s = s || {};
    const now = o.now ? new Date(o.now) : new Date();
    const dataset =
      o.dataset ||
      (String(s.key || "").startsWith("summary:") ? s.key.slice(8) : "owner");
    const records = o.records ?? s.records ?? 0;
    const repository = o.repository ?? remembered();
    const make = (state, kind, headline, detail, short, needsAction = false) => ({
      state,
      kind,
      headline,
      detail,
      short: short || headline,
      needsAction,
      action: needsAction ? (repository ? "sync-now" : "backup") : "",
      actionLabel: needsAction ? (repository ? "Sync now" : "Back up now") : "",
    });
    if (dataset === "sample")
      return make(
        "sample",
        "muted",
        "Sample property",
        "Nothing here needs a backup.",
      );
    if (!records)
      return make(
        "empty",
        "muted",
        "Nothing to back up yet",
        "Add your rental and it will appear here.",
      );
    const changes = Number(s.changes) || 0;
    // A file was made but never marked as saved, and it holds something no saved backup has.
    if (
      s.lastCreated &&
      (!s.lastBackup ||
        (instant(s.lastCreated) > instant(s.lastBackup) && changes > 0))
    ) {
      // The file from "Back up now" may be sitting in a folder already. Backup & sync can mark
      // it as saved, so that is where the reminder leads. A sync that stopped has no such file.
      const fileMade =
        o.fileMade ??
        (s.createdRevision != null &&
          prefs.get(PENDING_KEY + dataset) ===
            s.createdRevision + "|" + instant(s.lastCreated));
      return {
        ...make(
          "unfinished",
          "due",
          "Backup started " + when(s.lastCreated, { now }) + ", not finished",
          fileMade
            ? "If you saved that file, say so. If not, back up again."
            : "Back up or sync again to finish.",
          "",
          true,
        ),
        ...(fileMade
          ? { fileMade, action: "storage", actionLabel: "Finish backup" }
          : {}),
      };
    }
    if (!s.lastBackup) {
      if (!s.lastTransfer)
        return make(
          "never",
          "due",
          "Not backed up yet",
          "Your records exist only on this device.",
          "",
          true,
        );
      const old = now - instant(s.lastTransfer) >= 14 * DAY;
      return make(
        "brought",
        old ? "due" : "ok",
        "Brought in from your other device " + when(s.lastTransfer, { now }),
        "Not yet backed up from this device.",
        "",
        old,
      );
    }
    const date = when(s.lastBackup, { now });
    if (!changes)
      return make(
        "current",
        "ok",
        "Backed up",
        capital(date),
        "Backed up " + date,
      );
    if (changes < 5 && now - instant(s.lastBackup) < 14 * DAY)
      return make(
        "recent",
        "ok",
        "Backed up " + date,
        changeCount(changes) + " since then",
        "Backed up " + date,
      );
    return make(
      "behind",
      "due",
      "Backup needed",
      changeCount(changes) + " since " + date,
      "Backup needed: " + changeCount(changes) + " since " + date,
      true,
    );
  }
  const evidenceWords = {
    "Owner confirmed file saved": "saved as a backup file",
    "GitHub confirmed encrypted snapshot": "synced to GitHub",
    "Restore tested": "restored from a backup file",
  };
  const methodWords = {
    "Replaced from tested backup": "replaced everything",
    "Merged device changes": "combined",
  };
  const logWords = {
    "Saved records": "Saved changes",
    "Created encrypted backup": "Backup file made",
    "Owner confirmed backup saved": "Backup marked as saved",
    "GitHub confirmed encrypted snapshot": "Synced to GitHub",
    "Restored encrypted backup": "Restored from a backup file",
    "Merged encrypted device transfer": "Combined changes from another device",
  };
  const progressWords = {
    "Encrypting records": "Locking your records…",
    "Encrypting originals": "Adding your files…",
    "Verifying manifest": "Checking the password…",
    "Checking originals": "Checking your files…",
  };
  const typeWords = {
    property: "Property details",
    unit: "Rental unit",
    tenancy: "Tenant and rent",
    charge: "Rent charge",
    payment: "Payment",
    deposit: "Deposit",
    expense: "Expense",
    writeoff: "Rent written off",
    bankline: "Bank statement line",
    reconciliation: "Bank statement check",
    scheduleAdjustment: "Rent change",
    depositReturn: "Deposit return",
    financeprofile: "Money settings",
    document: "Document",
    export: "Tax packet",
    exportPart: "Tax packet file",
    exportSnapshot: "Tax packet copy",
    task: "Task",
    inspection: "Inspection",
    communication: "Email",
    lease: "Lease",
    leasePacket: "Lease packet",
    leaseVersion: "Lease version",
    operativeLease: "Signed lease",
    signature: "Signature",
    execution: "Signing record",
    legalPackage: "Legal sources",
    setupdraft: "Setup draft",
  };
  const fieldWords = {
    name: "Name",
    title: "Title",
    address: "Street address",
    city: "City",
    county: "County",
    state: "State",
    timezone: "Time zone",
    rentCents: "Monthly rent",
    depositCents: "Deposit",
    depositDate: "Deposit date",
    start: "Move-in date",
    end: "Move-out date",
    nextDue: "First rent date",
    amount: "Amount",
    date: "Date",
    period: "Month",
    due: "Due date",
    planned: "Planned date",
    completed: "Done",
    notes: "Notes",
    vendor: "Paid to",
    account: "Account",
    method: "Paid by",
    category: "Category",
    status: "Status",
    subject: "Subject",
    body: "Message",
    to: "To",
    kind: "Kind",
    tags: "Tags",
    filename: "File name",
    immutable: "Final",
    _deleted: "This item",
  };

  const pm = () => globalThis.PM;
  const kit = () => globalThis.UI;
  const element = (id) => document.getElementById(id);
  const escapeText = (value) => pm().esc(String(value ?? ""));
  const icon = (name, size = 20) => pm().ico(name, size);
  /* The shared form helpers always write a name attribute, and the dialog keeps what was typed
     in any named input. Nothing typed here should be kept (passwords least of all), so the name
     is removed and every value is read by id. */
  const unnamed = (html) => html.replace(/ name="[^"]*"/g, "");
  const lead = (text) => '<p class="bk-lead">' + escapeText(text) + "</p>";
  const small = (text) => '<p class="bk-small">' + escapeText(text) + "</p>";
  const fact = (label, value, extra = "") =>
    '<div class="bk-fact"><span>' +
    escapeText(label) +
    "</span><span>" +
    escapeText(value) +
    extra +
    "</span></div>";
  function resultBox() {
    return '<div class="ui-note" role="status" aria-live="polite" id="vault-result" hidden></div>';
  }
  /* kind: "" for progress, "error" or "warn". Each line of text becomes its own paragraph. */
  function message(text, kind = "") {
    const out = element("vault-result");
    if (!out) return;
    const body = document.createElement("div");
    for (const line of String(text).split("\n")) {
      const p = document.createElement("p");
      p.textContent = line;
      body.append(p);
    }
    out.className = "ui-note" + (kind ? " ui-note--" + kind : "");
    out.setAttribute("role", kind === "error" ? "alert" : "status");
    out.replaceChildren(body);
    out.hidden = false;
    if (kind) out.scrollIntoView?.({ block: "nearest" });
  }
  function action(id, handler) {
    const button = element(id);
    if (button)
      button.addEventListener("click", async () => {
        try {
          await handler(button);
        } catch (e) {
          message(friendly(e), "error");
        }
      });
    return button;
  }
  /* The one submit pipeline. It blocks a second submit, disables the form while it works, shows
     progress in plain words and stops the work if the dialog is closed. */
  function progressForm(form, operation) {
    let ctrl;
    const cancel = element("vault-cancel"),
      dialog = element("dialog");
    const abort = () => ctrl?.abort();
    dialog?.addEventListener("close", abort, { once: true });
    cancel?.addEventListener("click", abort);
    stopWork = abort;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (ctrl) return;
      ctrl = new AbortController();
      const controls = [...form.elements].filter(
        (el) => el !== cancel && !el.disabled,
      );
      const focused = document.activeElement;
      controls.forEach((el) => {
        el.disabled = true;
      });
      if (cancel) cancel.hidden = false;
      const options = {
        signal: ctrl.signal,
        progress: (label, n, total) => {
          if (!form.isConnected) return;
          message(
            (progressWords[label] || label + "…") +
              (total && n > 0
                ? " " + Math.min(100, Math.round((n * 100) / total)) + "%"
                : ""),
          );
        },
      };
      try {
        await operation(options);
      } catch (e) {
        // Stopping on purpose is not an error.
        if (form.isConnected)
          message(friendly(e), e?.name === "AbortError" ? "" : "error");
      } finally {
        controls.forEach((el) => {
          el.disabled = false;
        });
        if (cancel) cancel.hidden = true;
        ctrl = null;
        // Disabling a control can drop keyboard focus. Put it back if nothing else took it.
        if (
          form.isConnected &&
          form.contains(focused) &&
          !form.contains(document.activeElement)
        )
          focused.focus({ preventScroll: true });
      }
    });
  }
  /* A new backup password must be long enough. Checked before any work starts, in the same
     words everywhere, and the field is ready to be corrected. */
  function longEnough(input) {
    if (input.value.length >= 12) return input.value;
    setTimeout(() => input.focus());
    throw Error("Use at least 12 characters for the backup password.");
  }
  /* Where Back leads from most panels: the Backup & sync screen. From a sync step: the sync form. */
  const HUB = { act: "storage" },
    SYNC = { act: "github-sync" };
  let stopWork = null;
  /* Every panel opens through here. The dialog draws Back in its own header:
       options.back = { act }  where Back leads; null hides it; left out, the dialog decides
                               (back to Settings when the panel was opened from there)
       options.self = { act }  how this panel is reopened when a later one goes back to it
     When a panel closes, or another takes its place, the work it was doing is stopped first,
     so nothing finishes unseen after the owner has moved on. */
  function openPanel(title, html, options = {}) {
    const after = options.onClose;
    return pm().modal(title, html, {
      ...options,
      onClose: () => {
        stopWork?.();
        stopWork = null;
        after?.();
      },
    });
  }
  /* Only for a dialog that has no Back button of its own. */
  const backButton = (back) =>
    back && !element("dialog-back")
      ? '<button type="button" class="ui-quiet ui-foot-start" data-act="' +
        escapeText(back.act) +
        '">Back</button>'
      : "";
  function footer(caption, back, extra = "") {
    return (
      '<div class="ui-foot bk-foot">' +
      backButton(back) +
      extra +
      '<button type="button" id="vault-cancel" hidden>Stop</button><button type="submit" id="vault-submit">' +
      escapeText(caption) +
      "</button></div>"
    );
  }
  /* A password or access key with a Show or Hide button. It has no name attribute and is marked
     data-secret, so the dialog never keeps what was typed in it. */
  function secret({ id, label, help, shown = false, fresh = false, attrs = "" }) {
    const what = escapeText(label.toLowerCase());
    return (
      '<div class="ui-field"><label for="' +
      id +
      '">' +
      escapeText(label) +
      "</label>" +
      (help
        ? '<p class="ui-help" id="' + id + '-help">' + escapeText(help) + "</p>"
        : "") +
      '<div class="ui-affix bk-secret"><input id="' +
      id +
      '" type="' +
      (shown ? "text" : "password") +
      '" data-secret required maxlength="2048" autocomplete="' +
      (fresh ? "new-password" : "off") +
      '" autocapitalize="none" autocorrect="off" spellcheck="false"' +
      (help ? ' aria-describedby="' + id + '-help"' : "") +
      (attrs ? " " + attrs : "") +
      '><button type="button" class="bk-reveal" data-reveal="' +
      id +
      '" data-what="' +
      what +
      '" aria-label="' +
      (shown ? "Hide " : "Show ") +
      what +
      '">' +
      (shown ? "Hide" : "Show") +
      "</button></div></div>"
    );
  }
  function wireSecrets() {
    element("dialog-body")
      .querySelectorAll("[data-reveal]")
      .forEach((button) => {
        const input = element(button.dataset.reveal);
        button.addEventListener("click", () => {
          const show = input.type === "password";
          input.type = show ? "text" : "password";
          button.textContent = show ? "Hide" : "Show";
          button.setAttribute(
            "aria-label",
            (show ? "Hide " : "Show ") + button.dataset.what,
          );
        });
      });
  }
  /* Run when a panel closes or is replaced. Elements may already be gone, so each is checked. */
  const forget =
    (...ids) =>
    () =>
      ids.forEach((id) => {
        const input = element(id);
        if (input) input.value = "";
      });
  /* Ask the browser, once and without being asked, not to clear these records when space runs
     low. The Turn on button in More options asks again whenever the owner wants. */
  async function protect(automatic = false) {
    if (!navigator.storage?.persist) return false;
    if (automatic) {
      if (prefs.get(PROTECT_KEY)) return false;
      prefs.set(PROTECT_KEY, "1");
    }
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  /* After records were brought in: show them. Your own records open if the sample was showing. */
  async function reveal(ds) {
    if (ds === "owner" && pm().dataset() !== "owner")
      await pm().action("owner-property");
    else await pm().refresh();
  }
  const propertyNames = (records) =>
    records
      .filter((r) => r.type === "property" && !r._deleted && r.name)
      .map((r) => String(r.name));

  /* ---- Backup & sync: the one screen every backup task starts from ---- */
  async function hub({ open = false } = {}) {
    const sample = pm().dataset() === "sample";
    const [s, info] = await Promise.all([status("owner"), estimate("owner")]);
    const repository = remembered(),
      mine = info.count > 0 || info.files > 0;
    const sum =
      sample && !mine
        ? {
            state: "sample",
            kind: "muted",
            headline: "Sample property",
            detail:
              "You are exploring the sample. Nothing of yours needs a backup yet.",
          }
        : describe(s, { dataset: "owner", records: mine ? 1 : 0, repository });
    const pending = !!sum.fileMade;
    const row = ([id, glyph, title, help], primary) =>
      '<button type="button" class="bk-row' +
      (primary ? " bk-row--primary" : "") +
      '" id="' +
      id +
      '"><span class="bk-row-icon">' +
      icon(glyph, 20) +
      '</span><span class="bk-row-text"><strong>' +
      escapeText(title) +
      "</strong><small>" +
      escapeText(help) +
      "</small></span>" +
      icon("chevron", 16) +
      "</button>";
    const backupRow = [
      "vault-make",
      "lock",
      "Back up now",
      "Save everything to a password-protected file that you keep.",
    ];
    const restoreRow = [
      "vault-restore",
      "download",
      "Restore from a backup file",
      mine
        ? "Load a backup onto this device, or add changes made on another device."
        : "Load your records onto this device from a backup file you saved.",
    ];
    const syncRow = repository
      ? [
          "vault-sync",
          "backup",
          "Sync now",
          "Match this device with " + repository + " on GitHub.",
        ]
      : [
          "vault-sync",
          "backup",
          "Sync with GitHub",
          "Keep your phone and computer matched through your own private GitHub storage.",
        ];
    const rows = !mine
      ? [restoreRow, syncRow]
      : repository
        ? [syncRow, backupRow, restoreRow]
        : [backupRow, restoreRow, syncRow];
    const where =
      location.protocol === "file:" ? "a file on this computer" : location.host;
    const canProtect = !!navigator.storage?.persist;
    const facts =
      '<div class="bk-facts">' +
      fact(
        "On this device",
        mine
          ? entryCount(info.count) +
              " · " +
              fileCount(info.files) +
              " · " +
              sizeLabel(info.size)
          : "None of your records yet",
      ) +
      (s.lastBackup
        ? fact(
            "Last backup",
            capital(when(s.lastBackup)) +
              (evidenceWords[s.backupEvidence]
                ? " (" + evidenceWords[s.backupEvidence] + ")"
                : ""),
          )
        : "") +
      (s.lastTransfer
        ? fact(
            "Last brought in from another device",
            capital(when(s.lastTransfer)) +
              (methodWords[s.transferMethod]
                ? " (" + methodWords[s.transferMethod] + ")"
                : ""),
          )
        : "") +
      fact(
        "Protection from automatic clean-up",
        s.persistent ? "On" : canProtect ? "Off" : "Not offered by this browser",
        !s.persistent && canProtect
          ? ' <button type="button" id="vault-persist">Turn on</button>'
          : "",
      ) +
      (s.quota
        ? fact(
            "Space used by this app",
            sizeLabel(s.usage || 0) + " of about " + sizeLabel(s.quota),
          )
        : "") +
      "</div>" +
      small(
        "This copy of the app lives at " +
          where +
          ". Your records stay with this address and this browser.",
      ) +
      small("Limits: 32 MB per file, 256 MB per backup file.") +
      (mine || !sample
        ? '<div class="bk-inline"><button type="button" id="vault-log">' +
          icon("list", 17) +
          "Activity log</button></div>"
        : "") +
      (sample
        ? '<div class="bk-sample"><p class="bk-small"><strong>Sample property.</strong> These work on the sample only, never on your own records.</p><div class="bk-inline"><button type="button" id="vault-sample-make">Back up the sample property</button><button type="button" id="vault-sample-restore">Use a backup file with the sample property</button><button type="button" id="vault-sample-log">Sample activity log</button></div></div>'
        : "");
    openPanel(
      "Backup & sync",
      '<div class="ui-stack bk-form">' +
        lead("Keep a safe copy of your records, or keep two devices matched.") +
        '<div class="bk-status bk-status--' +
        sum.kind +
        '"><span class="bk-dot" aria-hidden="true"></span><div><strong>' +
        escapeText(sum.headline) +
        "</strong><span>" +
        escapeText(
          pending
            ? "If you saved that file, press “I saved it”. If not, back up again."
            : sum.detail,
        ) +
        "</span>" +
        (pending
          ? '<button type="button" id="vault-saved">I saved it</button>'
          : "") +
        "</div></div>" +
        (sample && mine
          ? small(
              "You are looking at the sample property. Everything below works on your own records.",
            )
          : "") +
        '<div class="bk-rows">' +
        rows.map((r, i) => row(r, i === 0)).join("") +
        "</div>" +
        kit().more("More options", facts, open) +
        resultBox() +
        "</div>",
      { self: HUB },
    );
    const from = { back: HUB };
    action("vault-make", () => backupPanel("owner", from));
    action("vault-restore", () => importPanel("owner", from));
    action("vault-sync", () => githubPanel(from));
    action("vault-log", () => logPanel("owner", from));
    action("vault-sample-make", () => backupPanel("sample", from));
    action("vault-sample-restore", () => importPanel("sample", from));
    action("vault-sample-log", () => logPanel("sample", from));
    action("vault-saved", async () => {
      await confirmBackup("owner", s.createdRevision);
      prefs.set(PENDING_KEY + "owner", "");
      protect(true);
      await pm().refresh();
      await hub();
      pm().toast("Backed up");
    });
    action("vault-persist", async () => {
      if (await protect()) return hub({ open: true });
      message(
        "Your browser did not turn this on. Installing the app to your Home Screen or desktop usually does. Until then, keep a recent backup.",
      );
    });
  }

  /* ---- Back up now ---- */
  async function backupPanel(ds = "owner", { then, back } = {}) {
    const sample = ds === "sample";
    const [info, records] = await Promise.all([estimate(ds), list(ds)]);
    // Nothing of the owner's to save yet: the first screen explains that instead.
    if (!sample && !info.count && !info.files && !then) return hub();
    const names = propertyNames(records);
    // Reached from a review ("Back up this device first"): Not now returns to that review.
    if (then) back = null;
    else if (sample) back = back || HUB;
    openPanel(
      sample ? "Back up the sample property" : "Back up now",
      '<form class="ui-stack bk-form" id="vault-form">' +
        lead(
          sample
            ? "Save the sample property into one password-protected file. This does not include your own records."
            : "Save every property, payment, lease and file into one password-protected file that you keep off this device.",
        ) +
        small(
          "Included: " +
            (names.length ? nameList(names) + ", " : "") +
            entryCount(info.count) +
            " and " +
            fileCount(info.files) +
            ", about " +
            sizeLabel(info.size) +
            ".",
        ) +
        secret({
          id: "vault-pass",
          label: "Backup password",
          help: "At least 12 characters. Write it down, because nobody can reset it.",
          shown: true,
          fresh: true,
        }) +
        resultBox() +
        footer(
          "Create backup file",
          back,
          then
            ? '<button type="button" class="ui-quiet ui-foot-start" id="vault-skip">Not now</button>'
            : "",
        ) +
        "</form>",
      {
        onClose: forget("vault-pass"),
        back,
        ...(sample || then ? {} : { self: { act: "backup" } }),
      },
    );
    const form = element("vault-form");
    wireSecrets();
    action("vault-skip", () => then());
    progressForm(form, async (options) => {
      const password = longEnough(element("vault-pass"));
      const backup = await makeBackup(ds, password, options);
      checkCancel(options.signal);
      if (form.isConnected) savePanel(ds, backup, info.count, then);
    });
  }
  /* Step two. The backup counts as made only when the owner presses "Done, I saved it",
     and that button stays off until a save was started. */
  function savePanel(ds, backup, count, then) {
    const name = backupName(ds, backup.at);
    const touch = !!globalThis.matchMedia?.("(pointer: coarse)").matches;
    let payload = null;
    try {
      if (typeof File === "function" && navigator.canShare) {
        const offer = {
          files: [
            new File([backup.blob], name, { type: "application/octet-stream" }),
          ],
        };
        if (navigator.canShare(offer)) payload = offer;
      }
    } catch {}
    const shareFirst = !!payload && touch;
    const download =
      '<button type="button" id="vault-download"' +
      (shareFirst ? "" : ' class="primary"') +
      ">" +
      icon("download", 17) +
      (touch ? "Save to this device" : "Save to this computer") +
      "</button>";
    const share = payload
      ? '<button type="button" id="vault-share"' +
        (shareFirst ? ' class="primary"' : "") +
        ">Save to Files or share</button>"
      : "";
    openPanel(
      "Save your backup file",
      '<div class="ui-stack bk-form">' +
        lead(
          "Your backup file is ready. Save it now, then keep a copy off this device, such as in OneDrive, iCloud Drive or on a USB drive.",
        ) +
        '<div class="bk-file">' +
        icon("file", 22) +
        "<div><strong>" +
        escapeText(name) +
        "</strong><span>" +
        sizeLabel(backup.blob.size) +
        " · " +
        entryCount(count) +
        " · " +
        fileCount(backup.files) +
        '</span></div></div><div class="bk-inline">' +
        (shareFirst ? share + download : download + share) +
        "</div>" +
        resultBox() +
        '<div class="ui-foot bk-foot"><button type="button" class="ui-quiet ui-foot-start" id="vault-later">Not now</button><button type="button" id="vault-confirm" aria-describedby="vault-confirm-help" disabled>Done, I saved it</button></div><p class="ui-help" id="vault-confirm-help">Press Done once you can see the file where you saved it.' +
        (ds === "owner" ? " If you choose Not now, the app will keep reminding you." : "") +
        "</p></div>",
      { back: null },
    );
    const done = element("vault-confirm");
    const started = (text) => {
      /* Only now might the file exist somewhere, so only now can Backup & sync offer "I saved it" for it. */
      if (ds === "owner")
        prefs.set(PENDING_KEY + ds, backup.revision + "|" + instant(backup.at));
      done.disabled = false;
      done.classList.add("primary");
      element("vault-download").classList.remove("primary");
      element("vault-share")?.classList.remove("primary");
      message(text);
    };
    action("vault-download", () => {
      pm().download(backup.blob, name);
      started(
        "Download started. When you can see the file, press “Done, I saved it”.",
      );
    });
    action("vault-share", async () => {
      try {
        await navigator.share(payload);
      } catch (e) {
        return message(
          e?.name === "AbortError"
            ? "Nothing was shared. You can still save the file."
            : "This device could not share the file. Use the other save button.",
          e?.name === "AbortError" ? "" : "error",
        );
      }
      started(
        "Sent. When you can see the file where you saved it, press “Done, I saved it”.",
      );
    });
    action("vault-confirm", async () => {
      await confirmBackup(ds, backup.revision);
      prefs.set(PENDING_KEY + ds, "");
      protect(true);
      if (then) return then();
      pm().close();
      await pm().refresh();
      pm().toast("Backed up");
    });
    action("vault-later", async () => {
      if (then) return then();
      pm().close();
      await pm().refresh();
      if (ds === "owner")
        pm().toast("Not marked as saved yet. The app will keep reminding you.");
    });
  }

  /* ---- Restore from a backup file (restore and combine are one flow) ---- */
  async function importPanel(ds = "owner", { prefer = "", back } = {}) {
    let target = ds;
    // The shell's own route back to this form: "restore" starts on Replace, "merge" on Combine.
    const self = { act: prefer === "restore" ? "restore" : "merge" };
    if (ds === "sample") back = back || HUB;
    openPanel(
      ds === "sample"
        ? "Use a backup file with the sample property"
        : "Restore from a backup file",
      '<form id="vault-form" class="ui-stack bk-form">' +
        lead(
          "Choose a backup file and type its password. Nothing changes until you confirm on the next screen.",
        ) +
        unnamed(
          kit().field({
            id: "vault-file",
            type: "file",
            label: "Backup file",
            help: "Its name ends in .pmvault.",
            required: true,
            attrs: 'accept=".pmvault,application/octet-stream"',
          }),
        ) +
        secret({
          id: "vault-pass",
          label: "Backup password",
          help: "The password chosen when that backup was made.",
        }) +
        resultBox() +
        '<div class="bk-inline" id="vault-other" hidden><button type="button" id="vault-switch"></button></div>' +
        (ds === "owner"
          ? '<div class="bk-inline"><button type="button" class="ui-quiet" id="vault-github">My records are on GitHub instead</button></div>'
          : "") +
        footer("Check backup", back) +
        "</form>",
      {
        onClose: forget("vault-pass"),
        back,
        ...(ds === "sample" ? {} : { self }),
      },
    );
    const form = element("vault-form"),
      other = element("vault-other");
    wireSecrets();
    action("vault-github", () => githubPanel({ pull: true, back: self }));
    // The file holds the other set of records: carry on with those, keeping the file and password.
    action("vault-switch", (button) => {
      target = button.dataset.holds;
      other.hidden = true;
      if (form.requestSubmit) form.requestSubmit();
      else element("vault-submit").click();
    });
    progressForm(form, async (options) => {
      other.hidden = true;
      let bundle;
      try {
        bundle = await readBackup(
          element("vault-file").files[0],
          element("vault-pass").value,
          target,
          options,
        );
      } catch (e) {
        if (e?.code === "other-records" && form.isConnected) {
          const button = element("vault-switch");
          button.dataset.holds = e.holds;
          button.textContent =
            e.holds === "owner"
              ? "Load it as my records"
              : "Use it for the sample property";
          other.hidden = false;
        }
        throw e;
      }
      const context = await prepare(target, bundle, { prefer, source: "file" });
      checkCancel(options.signal);
      if (form.isConnected) review(context);
    });
  }
  /* Compare a checked backup with this device. Plans are never changed after they are made. */
  async function prepare(ds, bundle, extra) {
    const info = await estimate(ds),
      empty = !info.count && !info.files,
      plans = {};
    if (extra.source === "github")
      plans.merge = await planImport(ds, bundle, "merge");
    else {
      plans.restore = await planImport(ds, bundle, "restore");
      if (!empty)
        try {
          plans.merge = await planImport(ds, bundle, "merge");
        } catch {
          // The two cannot be compared. Replacing everything is still possible.
        }
    }
    return { ...extra, ds, bundle, plans, empty, localCount: info.count };
  }
  const safeDate = (text, options) => {
    const d = new Date(text);
    return Number.isFinite(d.getTime())
      ? dateWords(d, { ...options, timeZone: "UTC" })
      : "";
  };
  const dayWords = (v) =>
    safeDate(v + "T12:00:00Z", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }) || v;
  const monthWords = (v) =>
    safeDate(v + "-01T12:00:00Z", { month: "long", year: "numeric" }) || v;
  const isDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const isMonth = (v) => typeof v === "string" && /^\d{4}-\d{2}$/.test(v);
  const clip = (text, max = 140) =>
    text.length > max ? text.slice(0, max - 1) + "…" : text;
  /* "Rent charge: November 2026", "Property details: Maple Street house". Never an internal id. */
  function itemTitle(r) {
    const main = r.title || r.name || r.vendor || r.subject || r.purpose || r.filename;
    const bits = main ? [clip(String(main), 80)] : [];
    if (r.type === "charge" && isMonth(r.period)) bits.push(monthWords(r.period));
    else if (
      !main ||
      ["payment", "expense", "deposit", "writeoff", "depositReturn"].includes(
        r.type,
      )
    ) {
      if (Number.isFinite(r.amount)) bits.push(pm().currency(r.amount));
      if (isDay(r.date)) bits.push(dayWords(r.date));
    }
    return (
      (typeWords[r.type] || capital(wordsFromKey(r.type))) +
      (bits.length ? ": " + bits.join(", ") : "")
    );
  }
  const wordsFromKey = (key) =>
    String(key)
      .replace(/^_+/, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_.-]+/g, " ")
      .toLowerCase();
  function valueWords(key, v) {
    if (key === "_deleted") return v ? "Removed" : "Still there";
    if (v === undefined || v === null || v === "") return "Not set";
    if (typeof v === "boolean") return v ? "Yes" : "No";
    if (typeof v === "number")
      return key === "amount" || /Cents$/.test(key)
        ? pm().currency(v)
        : String(v);
    if (isDay(v)) return dayWords(v);
    if (isMonth(v)) return monthWords(v);
    return "“" + clip(String(v)) + "”";
  }
  /* What differs between two copies, in words. Links, time stamps and nested details are
     counted but left to the technical view. */
  function differences(a, b) {
    const left = plain(a),
      right = plain(b),
      rows = [];
    let rest = 0;
    const nested = (v) => v !== null && typeof v === "object";
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      if (key === "id" || key === "type" || equal(left[key], right[key]))
        continue;
      if (
        key === "hash" ||
        /(Id|At)$/.test(key) ||
        nested(left[key]) ||
        nested(right[key])
      )
        rest++;
      else
        rows.push([
          fieldWords[key] || capital(wordsFromKey(key)),
          valueWords(key, left[key]),
          valueWords(key, right[key]),
        ]);
    }
    return { rows: rows.slice(0, 5), rest: rest + Math.max(0, rows.length - 5) };
  }
  function conflictCard(c, i) {
    const title = itemTitle(c.local._deleted ? c.incoming : c.local);
    const diff = differences(c.local, c.incoming);
    const mine = String(c.local._updatedAt || ""),
      theirs = String(c.incoming._updatedAt || "");
    const side = (label, value, newer) =>
      "<dd><span>" +
      label +
      "</span><span>" +
      escapeText(value) +
      (newer ? " " + kit().status("ok", "Newer") : "") +
      "</span></dd>";
    const json = (label, r) =>
      '<p class="bk-json-title"><strong>' +
      label +
      '</strong></p><pre class="bk-json">' +
      escapeText(JSON.stringify(plain(r), null, 2)) +
      "</pre>";
    return (
      '<section class="bk-conflict" data-conflict="' +
      i +
      '"><h3>' +
      escapeText(title) +
      '</h3><dl class="bk-diff">' +
      diff.rows
        .map(
          ([label, a, b]) =>
            "<dt>" +
            escapeText(label) +
            "</dt>" +
            side("This device", a) +
            side("Other device", b),
        )
        .join("") +
      "<dt>Last changed</dt>" +
      side("This device", mine ? capital(when(mine)) : "Unknown", mine > theirs) +
      side(
        "Other device",
        theirs ? capital(when(theirs)) : "Unknown",
        theirs > mine,
      ) +
      "</dl>" +
      (diff.rest
        ? small(
            (diff.rows.length ? "Also different: " : "Different: ") +
              plural(diff.rest, "other detail", "other details") +
              ". Open Technical details to compare.",
          )
        : "") +
      (c.local.immutable
        ? small(
            "This item is final and cannot be replaced, so this device’s copy is kept.",
          )
        : '<div class="ui-options" role="group" aria-label="Which copy to keep for ' +
          escapeText(title) +
          '"><button type="button" class="ui-seg bk-seg" data-keep="local" aria-pressed="false"><span>Keep this device’s</span></button><button type="button" class="ui-seg bk-seg" data-keep="incoming" aria-pressed="false"><span>Keep the other device’s</span></button></div>') +
      kit().more(
        "Technical details",
        json("This device", c.local) + json("Other device", c.incoming),
      ) +
      "</section>"
    );
  }
  function compareWords(m) {
    const bits = [];
    if (m.additions.length) bits.push(m.additions.length + " new");
    if (m.updates.length) bits.push(m.updates.length + " updated");
    if (m.conflicts.length)
      bits.push(
        m.conflicts.length === 1
          ? "1 needs your choice"
          : m.conflicts.length + " need your choice",
      );
    if (m.unchanged) bits.push(m.unchanged + " already here");
    return bits.join(", ");
  }
  /* The one review screen: a new device, combine or replace, and both kinds of sync.
     Nothing is saved until its button is pressed. */
  function review(ctx) {
    const { ds, bundle, plans, empty } = ctx,
      github = ctx.source === "github",
      merge = plans.merge?.merge || null,
      choose = !github && !empty && !!plans.merge,
      conflicts = merge?.conflicts || [];
    let use =
      plans.merge && (github || ctx.prefer !== "restore") ? "merge" : "restore";
    const incoming = active(bundle.body.records),
      names = propertyNames(incoming),
      fresh = merge
        ? merge.additions.length + merge.updates.length + conflicts.length
        : 0;
    const caption = () =>
      github
        ? ctx.publish
          ? "Finish sync"
          : fresh
            ? "Bring in changes"
            : "Done"
        : empty
          ? "Restore to this device"
          : use === "merge"
            ? "Combine now"
            : "Replace with this backup";
    const pick = (value, title, text) =>
      '<button type="button" class="bk-pick" data-use="' +
      value +
      '" aria-pressed="' +
      (use === value) +
      '"><span class="ui-pick-body"><b>' +
      title +
      "</b><small>" +
      escapeText(text) +
      "</small></span></button>";
    const replaceText =
      "Removes the " +
      entryCount(ctx.localCount) +
      " on this device and uses only the backup.";
    let head, body;
    if (github) {
      head =
        (fresh
          ? "From your other device: " + compareWords(merge) + "."
          : "Nothing new from your other device.") +
        (ctx.publish
          ? (fresh ? " Then this" : " This") +
            " device’s records will be uploaded to " +
            ctx.publish.repository +
            "."
          : fresh
            ? ""
            : " This device already has everything in your online backup.");
      body = "";
    } else {
      head =
        "Backup made " +
        fullDate(bundle.body.at) +
        ". Contains: " +
        (names.length ? nameList(names) + ", " : "") +
        entryCount(incoming.length) +
        ", " +
        fileCount(bundle.blobs.length) +
        ".";
      body = empty
        ? lead(
            (ds === "sample"
              ? "The sample property is empty on this device."
              : "This device has no records yet.") +
              " Everything in the backup will be loaded.",
          )
        : choose
          ? '<div class="ui-picks" role="group" aria-labelledby="dialog-title">' +
            pick(
              "merge",
              "Combine (recommended)",
              fresh
                ? "Keeps what is on this device and adds what is new: " +
                    compareWords(merge) +
                    "."
                : "Keeps what is on this device. The backup has nothing new to add.",
            ) +
            pick("restore", "Replace everything", replaceText) +
            "</div>"
          : kit().note(
              "warn",
              "<p>This backup and this device do not line up, so they cannot be combined. You can still replace everything.</p>",
            ) + small(replaceText);
    }
    const conflictList = conflicts.length
      ? '<section class="bk-conflicts" data-when="merge"><h3>Changed on both devices (' +
        conflicts.length +
        ")</h3>" +
        small("Choose which copy to keep for each one.") +
        (conflicts.length > 3
          ? '<div class="bk-inline"><button type="button" data-keep-all="local">Keep all from this device</button><button type="button" data-keep-all="incoming">Keep all from the other device</button></div>'
          : "") +
        conflicts.map(conflictCard).join("") +
        "</section>"
      : "";
    const replaceExtras =
      !github && !empty
        ? '<div class="ui-stack" data-when="restore">' +
          unnamed(
            kit().toggle({
              label: "Yes, remove what is on this device and use the backup",
              attrs: 'id="vault-approve"',
            }),
          ) +
          '<div class="bk-inline"><button type="button" id="vault-first">Back up this device first</button></div></div>'
        : "";
    const back = github
      ? SYNC
      : ds === "owner"
        ? { act: ctx.prefer === "restore" ? "restore" : "merge" }
        : HUB;
    openPanel(
      github
        ? "Review and finish sync"
        : empty
          ? "Restore this backup?"
          : "How should this backup be used?",
      '<form id="vault-form" class="ui-stack bk-form">' +
        lead(head) +
        body +
        conflictList +
        replaceExtras +
        resultBox() +
        footer(caption(), back) +
        "</form>",
      {
        back,
        onClose: () => {
          ctx.publish = null;
          ctx.retry = null;
        },
      },
    );
    const form = element("vault-form");
    const show = () => {
      form.querySelectorAll("[data-use]").forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.use === use));
      });
      form.querySelectorAll("[data-when]").forEach((el) => {
        el.hidden = el.dataset.when !== use;
      });
      element("vault-submit").textContent = caption();
    };
    // A choice was made, so an earlier "choose first" message no longer applies.
    const answered = () => {
      element("vault-result").hidden = true;
    };
    form.querySelectorAll("[data-use]").forEach((b) =>
      b.addEventListener("click", () => {
        use = b.dataset.use;
        answered();
        show();
      }),
    );
    const keep = (card, value) =>
      card.querySelectorAll("[data-keep]").forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.keep === value));
      });
    form.querySelectorAll("[data-keep]").forEach((b) =>
      b.addEventListener("click", () => {
        keep(b.closest("[data-conflict]"), b.dataset.keep);
        answered();
      }),
    );
    form.querySelectorAll("[data-keep-all]").forEach((b) =>
      b.addEventListener("click", () => {
        form
          .querySelectorAll("[data-conflict]")
          .forEach((card) => keep(card, b.dataset.keepAll));
        answered();
      }),
    );
    element("vault-approve")?.addEventListener("change", answered);
    show();
    // Making a backup does not change what the plan was compared with, so the review can resume.
    action("vault-first", () =>
      backupPanel(ds, { then: () => review({ ...ctx, prefer: "restore" }) }),
    );
    progressForm(form, async (options) => {
      const publication = ctx.publish,
        retry = ctx.retry,
        choices = Object.create(null);
      if (use === "merge")
        conflicts.forEach((c, i) => {
          const card = form.querySelector('[data-conflict="' + i + '"]');
          const chosen = c.local.immutable
            ? "local"
            : card.querySelector('[aria-pressed="true"]')?.dataset.keep;
          if (!chosen) {
            card.scrollIntoView?.({ block: "center" });
            throw Error(
              "Choose which copy to keep for each item changed on both devices.",
            );
          }
          choices[c.id] = chosen;
        });
      else if (!empty && !element("vault-approve").checked)
        throw Error(
          "To replace everything, turn on “Yes, remove what is on this device and use the backup”.",
        );
      const waiting = publication ? (await status(ds)).changes : 0;
      message("Saving to this device…");
      let result;
      try {
        result = await commitImport(plans[use], choices, options.signal);
      } catch (e) {
        if (e?.code !== "changed-during-review" || !form.isConnected) throw e;
        // Nothing was saved. Compare the same backup with the device as it is now and ask again.
        const again = await prepare(ds, bundle, {
          ...ctx,
          publish: publication,
          retry,
          prefer: use,
        });
        if (!form.isConnected) return;
        review(again);
        message(
          "Something was saved on this device while you were reviewing, so this was compared again. Check it, then continue.",
          "warn",
        );
        return;
      }
      if (publication) {
        try {
          checkCancel(options.signal);
          await publication.send(options, result.revision);
        } catch (error) {
          await pm().refresh();
          if (form.isConnected && element("dialog").open)
            syncUnfinished(error, result.imported, retry);
          return;
        }
      }
      if (
        options.signal.aborted ||
        !form.isConnected ||
        !element("dialog").open
      ) {
        await pm().refresh();
        return;
      }
      pm().close();
      await reveal(ds);
      pm().toast(
        github
          ? "Sync complete. " +
              (result.imported
                ? changeCount(result.imported) + " brought in."
                : waiting
                  ? "Your changes were uploaded."
                  : "Already up to date.")
          : use === "restore"
            ? "Restored. " + entryCount(incoming.length) + " loaded."
            : result.imported
              ? "Combined. " + changeCount(result.imported) + " added."
              : "Combined. Already up to date.",
      );
    });
  }

  /* ---- Sync with GitHub ---- */
  /* This device remembers three things, so the owner pastes the access key once and types nothing
     after that: the key, the repository it opens, and the backup password that locks the online
     copy. They are kept with this browser's settings, not with the records, so they are never part
     of a backup and never leave the device, apart from the key going to GitHub to sign in. */
  const setupSteps =
    '<ol class="bk-steps"><li>Create a free GitHub account, then a new <strong>private</strong> repository. Tick “Add a README”.<br><a class="bk-link" href="https://github.com/new" target="_blank" rel="noopener noreferrer">Open GitHub</a></li><li>Create an access key: Settings, Developer settings, Fine-grained tokens. Under Repository access choose Only select repositories and pick that repository. Under Permissions set Contents to Read and write.<br><a class="bk-link" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">Open the access key page</a></li><li>Copy the key and paste it here. That is all: the app finds the repository and remembers the key.</li></ol>';
  const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const submitForm = (form) =>
    form.requestSubmit ? form.requestSubmit() : element("vault-submit").click();
  /* Some browsers keep nothing between visits (a private window, for example). */
  function canRemember() {
    prefs.set(PROBE_KEY, "1");
    const kept = prefs.get(PROBE_KEY) === "1";
    prefs.set(PROBE_KEY, "");
    return kept;
  }
  /* A backup password nobody has to think up: 20 letters and digits that are hard to misread. */
  function newPassword() {
    const letters = "abcdefghjkmnpqrstuvwxyz23456789",
      out = [];
    while (out.length < 20)
      for (const n of crypto.getRandomValues(new Uint8Array(32)))
        if (n < 248 && out.length < 20) out.push(letters[n % 31]);
    return out.join("").replace(/.{5}(?=.)/g, "$&-");
  }
  /* A button that copies a password. Where the browser will not copy, the password is shown and
     selected so it can be copied by hand. */
  function copyAction(buttonId, inputId) {
    action(buttonId, async (button) => {
      const input = element(inputId);
      try {
        await navigator.clipboard.writeText(input.value);
        button.textContent = "Copied";
      } catch {
        if (input.type === "password")
          element("dialog-body")
            .querySelector('[data-reveal="' + inputId + '"]')
            ?.click();
        input.focus();
        input.select();
        message("Select the password and copy it.");
      }
    });
  }
  /* Which repository an access key is for, so the owner never types its name. The one this device
     already syncs with stays while the key can still open it. Otherwise it is the only private
     repository the key opens, or the only one that already holds a backup. When that does not
     settle it, the owner picks from the few it could be, or types the name. */
  async function locate(token, known, signal) {
    message("Finding your repository…");
    const found = await GitHubSync.find(token, signal);
    if (known && found?.some((name) => sameName(name, known))) return known;
    if (found?.length === 1) return found[0];
    if (!found?.length) {
      if (known) return known;
      throw Object.assign(
        Error(
          "The app could not tell which repository this key is for. On GitHub, check that the key is set to “Only select repositories” with your private backup repository picked. Or type the repository name.",
        ),
        { code: "repository" },
      );
    }
    const shortlist = found.slice(0, 6),
      holding = [];
    for (const name of shortlist)
      if (await GitHubSync.holds(name, token, signal)) holding.push(name);
    if (holding.length === 1) return holding[0];
    throw Object.assign(
      Error(
        "This key can open more than one private repository. Choose the one for your backup.",
      ),
      { code: "choose", repositories: shortlist, holding },
    );
  }
  /* options.start   begin the sync at once when this device already has its key and repository.
     options.note    a message to show first, for example why a saved key is being asked for again.
     options.change  ask for a key although one is saved. The saved key stays until GitHub accepts
                     the new one, because GitHub shows a key only once. */
  async function githubPanel({ pull = false, back, start = false, note = "", change = false } = {}) {
    const repository = remembered(),
      savedKey = prefs.get(KEY_KEY),
      key = change ? "" : savedKey,
      password = prefs.get(PASS_KEY);
    let chosen = "";
    const onlyDownload = unnamed(
      kit().toggle({
        label: "Only download to this device",
        help: "Use this on a device that should not upload, or with a read-only key.",
        checked: pull,
        attrs: 'id="github-pull"',
      }),
    );
    const syncingWith = repository
      ? "Syncing with <strong>" + escapeText(repository) + "</strong>"
      : "";
    const savedPassword =
      key && password
        ? secret({
            id: "github-saved",
            label: "Backup password",
            help: "Saved on this device. Keep a copy: you need it to add another device or to get your records back.",
            attrs: 'readonly value="' + escapeText(password) + '"',
          }) +
          '<div class="bk-inline"><button type="button" id="github-copy">Copy password</button></div>'
        : "";
    openPanel(
      "Sync with GitHub",
      '<form class="ui-stack bk-form" id="vault-form">' +
        lead(
          "Keep your phone and computer matched through your own private GitHub storage.",
        ) +
        (key
          ? '<div class="bk-repo"><span>' +
            (syncingWith || "Your access key is saved on this device") +
            '</span><button type="button" id="github-change">Change key</button></div>'
          : (repository
              ? '<div class="bk-repo"><span>' + syncingWith + "</span></div>"
              : kit().more("How to set this up", setupSteps, true)) +
            secret({
              id: "github-token",
              label: "GitHub access key",
              help: savedKey
                ? "Paste the new key. It takes the place of the one saved on this device."
                : "Paste the key from GitHub. It is saved on this device, so you paste it only once.",
            }) +
            (savedKey
              ? '<div class="bk-inline"><button type="button" class="ui-quiet" id="github-forget">Forget the saved key</button></div>'
              : "")) +
        '<div id="github-choose" class="ui-stack" hidden></div>' +
        '<div id="github-more">' +
        kit().more(
          "More options",
          onlyDownload +
            savedPassword +
            (key || repository ? kit().more("How to set this up", setupSteps) : ""),
          pull,
        ) +
        "</div>" +
        resultBox() +
        footer("Sync now", back) +
        "</form>",
      {
        onClose: forget("github-token", "github-saved"),
        back,
        self: SYNC,
      },
    );
    const form = element("vault-form"),
      input = element("github-token"),
      choose = element("github-choose");
    /* Shown only when the key alone did not settle which repository to use. */
    const askRepository = (names = [], holding = []) => {
      choose.innerHTML =
        (names.length
          ? '<fieldset class="ui-group ui-wide"><legend>Which repository is for your backup?</legend><div class="ui-picks">' +
            names
              .map(
                (name) =>
                  '<button type="button" class="bk-pick" data-repository="' +
                  escapeText(name) +
                  '"><span class="ui-pick-body"><b>' +
                  escapeText(name) +
                  "</b><small>" +
                  (holding.includes(name)
                    ? "Holds an online backup"
                    : "No backup here yet") +
                  "</small></span></button>",
              )
              .join("") +
            "</div></fieldset>"
          : "") +
        unnamed(
          kit().field({
            id: "github-repo",
            label: names.length ? "Or type another repository" : "Repository",
            placeholder: "your-github-name/rental-backup",
            help: "Type it as name/repository.",
            attrs:
              'autocapitalize="none" autocorrect="off" autocomplete="off" spellcheck="false"',
          }),
        );
      choose.hidden = false;
      choose.querySelectorAll("[data-repository]").forEach((button) =>
        button.addEventListener("click", () => {
          chosen = button.dataset.repository;
          submitForm(form);
        }),
      );
      if (!names.length) setTimeout(() => element("github-repo")?.focus());
    };
    wireSecrets();
    copyAction("github-copy", "github-saved");
    action("github-change", () =>
      githubPanel({ pull: element("github-pull").checked, back, change: true }),
    );
    action("github-forget", () => {
      prefs.set(KEY_KEY, "");
      return githubPanel({ pull: element("github-pull").checked, back });
    });
    // Pasting the key is all it takes: no button to find afterwards.
    input?.addEventListener("paste", () =>
      setTimeout(() => {
        if (form.isConnected && GitHubSync.looksLikeKey(input.value.trim()))
          submitForm(form);
      }),
    );
    progressForm(form, async (options) => {
      const pulling = element("github-pull").checked;
      let token = key;
      if (input) {
        token = input.value.trim();
        if (!GitHubSync.looksLikeKey(token)) {
          setTimeout(() => input.focus());
          throw Error(
            "That does not look like a GitHub access key. It should start with github_pat_.",
          );
        }
        // Kept from the moment it is entered: GitHub shows a key only once.
        prefs.set(KEY_KEY, token);
      }
      try {
        const target =
          chosen ||
          element("github-repo")?.value.trim() ||
          (input || !repository
            ? await locate(token, repository, options.signal)
            : repository);
        await syncRun(
          { repository: target, token, password: prefs.get(PASS_KEY), pulling },
          options,
          form,
        );
      } catch (e) {
        chosen = "";
        if (!form.isConnected) throw e;
        if (e?.code === "key") {
          // GitHub refused this key, so it is not kept. A key typed just now gives way to the one
          // saved before it; a saved key that stopped working is asked for again.
          prefs.set(KEY_KEY, input ? savedKey : "");
          if (!input) return githubPanel({ pull: pulling, back, note: e.message });
          setTimeout(() => input.focus());
        }
        if (e?.code === "choose") askRepository(e.repositories, e.holding);
        if (e?.code === "repository" && !element("github-repo")) askRepository();
        throw e;
      }
    });
    if (note) message(note, "error");
    else if (start && key && repository) submitForm(form);
  }
  /* One sync: connect, download and compare, then show the review (or the first upload).
     An upload always follows a download and review of what is already online. `password` is the
     one saved on this device, or "" when this device has not opened the online backup yet. */
  async function syncRun({ repository, token, password, pulling }, options, form) {
    const ds = "owner";
    message("Connecting to GitHub…");
    const remote = await GitHubSync.connect(repository, token, options.signal);
    prefs.set(REPO_KEY, remote.repository);
    const upload = async (progress, reviewedRevision, lock = password) => {
      const backup = await makeBackup(ds, lock, progress);
      if (backup.revision !== reviewedRevision)
        throw Error(
          "Something was saved while you were reviewing. Sync again to include it.",
        );
      message("Uploading…");
      await remote.upload(backup.blob, progress.signal);
      await confirmBackup(ds, backup.revision, true);
      protect(true);
    };
    if (!remote.exists && !pulling) {
      const info = await estimate(ds);
      if (!info.count && !info.files)
        throw Error(
          "This device has nothing to upload yet. If your records are on another device, sync from that one first.",
        );
      checkCancel(options.signal);
      if (form.isConnected) firstGitHubUpload(remote.repository, upload, info);
      return;
    }
    message("Downloading…");
    const blob = await remote.download(options.signal);
    /* Open what was downloaded, remember the password that opened it, and show the review. */
    const open = async (candidate, progress, target) => {
      const bundle = await readBackup(blob, candidate, ds, progress);
      password = candidate;
      prefs.set(PASS_KEY, candidate);
      const context = await prepare(ds, bundle, {
        source: "github",
        pulling,
        publish: pulling
          ? null
          : { repository: remote.repository, send: upload },
        retry: (again, next) =>
          syncRun(
            { repository: remote.repository, token, password, pulling },
            again,
            next,
          ),
      });
      checkCancel(progress.signal);
      if (target.isConnected) review(context);
    };
    let stale = false;
    if (password)
      try {
        return await open(password, options, form);
      } catch (e) {
        if (e?.code !== "password") throw e;
        stale = true;
      }
    if (form.isConnected) passwordStep(remote.repository, open, stale);
  }
  /* The online backup is there and this device cannot open it yet: a second device, or a backup
     made before the app remembered passwords. Asked once, then remembered. */
  function passwordStep(repository, open, stale) {
    openPanel(
      "Open your online backup",
      '<form class="ui-stack bk-form" id="vault-form">' +
        lead(
          repository +
            " already holds your online backup. Type or paste its backup password to open it.",
        ) +
        small(
          "If the app made the password for you, your other device shows it: Backup & sync, Sync now, More options.",
        ) +
        secret({
          id: "github-pass",
          label: "Backup password",
          help: "Saved on this device once it opens the backup, so you are asked only once.",
        }) +
        resultBox() +
        footer("Open backup", SYNC) +
        "</form>",
      {
        back: SYNC,
        onClose: () => {
          forget("github-pass")();
          open = null;
        },
      },
    );
    const form = element("vault-form");
    wireSecrets();
    if (stale)
      message(
        "The backup password saved on this device did not open the online backup. Type the right one.",
        "warn",
      );
    progressForm(form, async (options) => {
      await open?.(element("github-pass").value, options, form);
    });
  }
  /* The first backup in an empty repository. The app makes the backup password and remembers it,
     so nothing has to be typed; the owner may type their own instead. */
  function firstGitHubUpload(repository, upload, info) {
    const saved = prefs.get(PASS_KEY),
      made = saved || !canRemember() ? "" : newPassword();
    openPanel(
      "Create your online backup",
      '<form class="ui-stack bk-form" id="vault-form">' +
        lead(
          "This is the first backup in " +
            repository +
            ". It is locked with a backup password, so GitHub cannot read your records.",
        ) +
        small(
          "Uploading " +
            entryCount(info.count) +
            " and " +
            fileCount(info.files) +
            ".",
        ) +
        secret({
          id: "github-pass",
          label: "Backup password",
          shown: true,
          fresh: true,
          help: saved
            ? "Already saved on this device. Keep a copy: you need it to add another device or to get your records back."
            : made
              ? "Made for you and saved on this device. Keep a copy: you need it to add another device or to get your records back."
              : "At least 12 characters. Write it down: you need it on every device.",
          attrs: 'value="' + escapeText(saved || made) + '"',
        }) +
        (saved || made
          ? '<div class="bk-inline"><button type="button" id="github-copy">Copy password</button></div>'
          : "") +
        resultBox() +
        footer("Upload first backup", SYNC) +
        "</form>",
      {
        back: SYNC,
        onClose: () => {
          forget("github-pass")();
          upload = null;
        },
      },
    );
    const form = element("vault-form");
    wireSecrets();
    copyAction("github-copy", "github-pass");
    progressForm(form, async (options) => {
      const password = longEnough(element("github-pass"));
      // Remembered before the upload, so an online backup never exists without its password.
      prefs.set(PASS_KEY, password);
      await upload(options, info.revision, password);
      if (!options.signal.aborted) {
        pm().close();
        await pm().refresh();
        pm().toast("First online backup saved");
      }
    });
  }
  /* The other device's changes are saved here, but this device's upload did not go through.
     Trying again repeats the whole sync with the key and password still held for this dialog. */
  function syncUnfinished(error, imported, retry) {
    const reason =
      error?.name === "AbortError" ? "It was stopped." : friendly(error);
    openPanel(
      "Sync did not finish",
      '<form id="vault-form" class="ui-stack bk-form">' +
        resultBox() +
        footer("Try sync again", SYNC) +
        "</form>",
      {
        back: SYNC,
        onClose: () => {
          retry = null;
        },
      },
    );
    message(
      (imported ? "Changes from your other device were added here. " : "") +
        "Uploading this device’s changes did not finish.\n" +
        reason +
        (error?.code === "access"
          ? "\nIf this key can only read, go back and sync with “Only download to this device” turned on."
          : "") +
        "\nYour records are safe.",
      "warn",
    );
    const form = element("vault-form");
    progressForm(form, (options) =>
      retry ? retry(options, form) : githubPanel(),
    );
  }

  /* ---- Activity log ---- */
  function logNote(e) {
    const applied = /^(\d+) records applied\.$/.exec(e.info || "");
    if (applied)
      return e.action === "Restored encrypted backup"
        ? entryCount(+applied[1]) + " loaded"
        : changeCount(+applied[1]) + " added";
    return e.action === "Created encrypted backup" ? "" : e.info || "";
  }
  async function logPanel(ds = "owner", { back } = {}) {
    const items = await history(ds),
      sample = ds === "sample";
    openPanel(
      sample ? "Sample activity log" : "Activity log",
      '<div class="ui-stack bk-form">' +
        lead(
          sample
            ? "What was saved, backed up and brought in for the sample property on this device."
            : "What was saved, backed up and brought in on this device.",
        ) +
        '<div id="vault-log-days" class="ui-stack"></div>' +
        kit().more(
          "More options",
          unnamed(
            kit().toggle({
              label: "Show every saved change",
              help: "Also lists each time something was saved on this device.",
              attrs: 'id="vault-log-all"',
            }),
          ) + small("Times come from the device where each thing happened."),
        ) +
        (backButton(back)
          ? '<div class="ui-foot bk-foot">' + backButton(back) + "</div>"
          : "") +
        "</div>",
      { back },
    );
    const every = element("vault-log-all"),
      days = element("vault-log-days");
    const draw = () => {
      const shown = items
        .filter((e) => every.checked || e.action !== "Saved records")
        .slice(0, 250);
      if (!shown.length) {
        days.innerHTML = small(
          items.length
            ? "No backups, restores or syncs yet. To see each save, turn on “Show every saved change” under More options."
            : "Nothing has been saved here yet.",
        );
        return;
      }
      const groups = new Map();
      for (const e of shown) {
        const day = capital(when(e.at, { time: false })) || "Unknown date";
        if (!groups.has(day)) groups.set(day, []);
        groups.get(day).push(e);
      }
      days.innerHTML = [...groups]
        .map(
          ([day, list]) =>
            "<section><h3>" +
            escapeText(day) +
            '</h3><ul class="bk-log">' +
            list
              .map((e) => {
                const d = new Date(e.at),
                  note = logNote(e);
                return (
                  "<li><time>" +
                  (Number.isFinite(d.getTime()) ? clock(d) : "") +
                  "</time><div><strong>" +
                  escapeText(logWords[e.action] || e.action) +
                  (e.action === "Saved records" && e.ids?.length
                    ? " (" + entryCount(e.ids.length) + ")"
                    : "") +
                  "</strong>" +
                  (note ? "<small>" + escapeText(note) + "</small>" : "") +
                  "</div></li>"
                );
              })
              .join("") +
            "</ul></section>",
        )
        .join("");
    };
    every.addEventListener("change", draw);
    draw();
  }

  /* Store.panel(mode, options) opens a Backup & sync panel in the dialog.
       "storage"      the Backup & sync screen
       "backup"       Back up now
       "restore"      Restore from a backup file. If this device already has records,
                      "Replace everything" starts selected
       "merge"        the same screen with "Combine" selected
       "history"      Activity log for the records that are open
       "github-sync"  Sync with GitHub. options.pull starts with "Only download" on
     Backup, restore and sync always work on the owner's own records, whichever property is
     showing. options.ds = "sample" is how the sample-only buttons reach the sample. */
  async function panel(mode = "storage", options = {}) {
    if (mode === "github-sync") return githubPanel(options);
    if (mode === "backup") return backupPanel(options.ds || "owner", options);
    if (mode === "restore" || mode === "merge")
      return importPanel(options.ds || "owner", { ...options, prefer: mode });
    if (mode === "history")
      return logPanel(options.ds || pm().dataset(), options);
    return hub();
  }
  globalThis.Store = {
    init,
    list,
    save,
    storeBlob,
    getBlob,
    status,
    makeBackup,
    readBackup,
    planImport,
    commitImport,
    confirmBackup,
    estimate,
    history,
    planMerge,
    panel,
    describe,
    when,
    syncRepository: remembered,
    backupUI: () => panel("backup"),
    restoreUI: () => panel("restore"),
    mergeUI: () => panel("merge"),
    historyUI: () => panel("history"),
  };
})();
