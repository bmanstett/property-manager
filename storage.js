/* Local record store, authenticated portable archives and explicit device merges. */
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
      ? "Browser storage is full. Your existing records are intact. Free storage and retry."
      : e?.message ||
        "Storage was unavailable. Retry after checking browser storage.";
  function init() {
    if (db) return Promise.resolve();
    if (opening) return opening;
    opening = (async () => {
      if (!globalThis.indexedDB || !globalThis.crypto?.subtle)
        throw Error(
          "Local records require IndexedDB and Web Crypto. Use HTTPS or localhost in a supported browser.",
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
              "Close other Property Manager tabs to finish the database update.",
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
        reject(tx.error || Error("Storage transaction canceled."));
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
            "This saved version is immutable. Create a new version to change it.",
          );
        if (old && r._rev !== old._rev)
          throw Error(
            "This record changed on another screen. Reopen its current version and review your edits.",
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
        "Each original must be 32 MiB or smaller. The source file is unchanged.",
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
        "This original is missing from local storage. Restore a backup containing the original file.",
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
    const [meta, estimate, persistent] = await Promise.all([
      transact(["meta"], "readonly", (tx) => summary(tx, ds)),
      navigator.storage?.estimate?.().catch(() => ({})),
      navigator.storage?.persisted?.().catch(() => false),
    ]);
    return {
      ...meta,
      changes: Math.max(0, meta.revision - (meta.confirmedRevision || 0)),
      usage: estimate?.usage,
      quota: estimate?.quota,
      persistent: !!persistent,
    };
  }
  function checkCancel(signal) {
    if (signal?.aborted)
      throw new DOMException(
        "Operation canceled. Existing records are intact.",
        "AbortError",
      );
  }
  async function derive(password, salt) {
    if (!password || password.length > 2048)
      throw Error("Enter a backup password.");
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
    if (password.length < 12)
      throw Error("Use at least 12 characters for a new backup password.");
    const data = await snapshot(ds);
    checkCancel(signal);
    const files = data.blobs.map(({ hash, blob }) => ({
      hash,
      size: blob.size,
      mime: blob.type,
    }));
    const bytes = files.reduce((total, b) => total + b.size, 0);
    if (bytes > MAX_ARCHIVE)
      throw Error("The dataset exceeds the 256 MiB portable archive limit.");
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
      throw Error(
        "Structured records exceed the 20 MiB archive metadata limit.",
      );
    const meta = enc.encode(
      JSON.stringify({ hash: await digest(encoded), body }),
    );
    const totalFrames =
      1 + files.reduce((n, f) => n + Math.ceil(f.size / CHUNK), 0);
    if (meta.length + bytes + 32 + totalFrames * 20 > MAX_ARCHIVE)
      throw Error(
        "The complete backup exceeds the 256 MiB portable archive limit.",
      );
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
      throw Error("Choose a Property Manager backup of at most 256 MiB.");
    let at = 32,
      index = 0;
    const head = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
    if (!MAGIC.every((b, i) => head[i] === b))
      throw Error(
        "This file is not a supported Property Manager encrypted backup.",
      );
    const key = await derive(password, head.subarray(8, 24));
    async function next(limit, expected) {
      checkCancel(signal);
      if (at + 4 > blob.size) throw Error("The backup is truncated.");
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
        throw Error("The backup frame has an invalid length.");
      const cipher = await blob.slice(at, at + size).arrayBuffer();
      at += size;
      try {
        return await crypto.subtle.decrypt(
          sealParams(head, index++),
          key,
          cipher,
        );
      } catch {
        throw Error(
          "Unable to authenticate the backup. Check the password and the integrity of the file.",
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
      throw Error("Unsupported backup manifest.");
    if ((await digest(enc.encode(JSON.stringify(body)))) !== manifest.hash)
      throw Error("The backup manifest failed its integrity check.");
    if (body.dataset !== ds)
      throw Error(
        "This is a " +
          (body.dataset === "sample" ? "sample" : "personal") +
          " backup. Switch to its matching workspace before import.",
      );
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
        throw Error("Invalid file inventory.");
      hashes.add(f.hash);
      const parts = [];
      for (let i = 0; i < f.size; i += CHUNK) {
        parts.push(new Blob([await next(CHUNK, Math.min(CHUNK, f.size - i))]));
        progress("Checking originals", at, blob.size);
      }
      const original = new Blob(parts, { type: f.mime });
      if ((await digest(await original.arrayBuffer())) !== f.hash)
        throw Error("An original file failed its integrity check.");
      blobs.push({ dataset: ds, hash: f.hash, blob: original });
    }
    if (at !== blob.size)
      throw Error("The backup contains unexpected trailing data.");
    validateBundle(body, hashes);
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
      mode === "merge" ? planMerge(local.records, bundle.body.records) : null;
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
          throw Error("Choose a version for every conflicting record.");
        const selected = c[choices[c.id]];
        if (c.local.immutable && !equal(plain(c.local), plain(selected)))
          throw Error("A frozen local version cannot be overwritten.");
        return revised(selected, [c.local, c.incoming]);
      });
      records = [...merge.additions, ...merge.updates, ...resolved];
      const combined = new Map(local.map((r) => [r.id, r]));
      records.forEach((r) => combined.set(r.id, r));
      const hashSet = new Set([
        ...plan.localHashes,
        ...bundle.blobs.map((b) => b.hash),
      ]);
      validateRelations(active([...combined.values()]), hashSet);
    }
    return transact(
      ["records", "blobs", "meta", "history"],
      "readwrite",
      async (tx) => {
        const meta = await summary(tx, ds);
        if (meta.revision !== baseline)
          throw Error(
            "Local records changed during review. Reopen the transfer to compare the latest revisions.",
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
          "A later backup was created. Confirm the latest copy instead.",
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

  const sizeLabel = (bytes) =>
    bytes >= MIB
      ? (bytes / MIB).toFixed(1) + " MiB"
      : Math.ceil(bytes / 1024) + " KiB";
  const dateLabel = (value) =>
    value ? new Date(value).toLocaleString() : "Never";
  const pm = () => globalThis.PM;
  const element = (id) => document.getElementById(id);
  const escapeText = (value) => pm().esc(String(value ?? ""));
  const row = (label, value) =>
    "<p><strong>" +
    escapeText(label) +
    "</strong><br>" +
    escapeText(value) +
    "</p>";
  function showResult(message, isError = false) {
    const output = element("vault-result");
    if (output) {
      output.textContent = message;
      output.setAttribute("role", isError ? "alert" : "status");
    }
  }
  function resultBox() {
    return '<p class="notice" role="status" aria-live="polite" id="vault-result" hidden></p>';
  }
  function message(text, isError = false) {
    const out = element("vault-result");
    if (out) out.hidden = false;
    showResult(text, isError);
  }
  function action(id, handler) {
    const button = element(id);
    if (button)
      button.addEventListener("click", async () => {
        try {
          await handler();
        } catch (e) {
          message(friendly(e), true);
        }
      });
  }
  function progressForm(form, operation) {
    let ctrl;
    const cancel = element("vault-cancel"),
      dialog = element("dialog");
    const abort = () => ctrl?.abort();
    dialog?.addEventListener("close", abort, { once: true });
    cancel?.addEventListener("click", abort);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (ctrl) return;
      ctrl = new AbortController();
      const controls = [...form.elements].filter((el) => el !== cancel);
      controls.forEach((el) => {
        el.disabled = true;
      });
      if (cancel) cancel.hidden = false;
      const options = {
        signal: ctrl.signal,
        progress: (label, n, total) => {
          if (!form.isConnected) return;
          message(
            label +
              (total
                ? " · " + Math.min(100, Math.round((n * 100) / total)) + "%"
                : "…"),
          );
        },
      };
      try {
        await operation(options);
      } catch (e) {
        if (form.isConnected) message(friendly(e), true);
      } finally {
        controls.forEach((el) => {
          el.disabled = false;
        });
        if (cancel) cancel.hidden = true;
        ctrl = null;
      }
    });
  }
  function buttons(caption) {
    return (
      '<div class="form-actions"><button type="button" id="vault-cancel" hidden>Cancel operation</button><button type="submit">' +
      caption +
      "</button></div>"
    );
  }
  async function backupPanel(ds) {
    const info = await estimate(ds);
    pm().modal(
      "Create encrypted backup",
      '<form class="stack" id="vault-form"><p>Include all ' +
        (ds === "sample" ? "sample" : "personal") +
        " properties, records, history, and originals in one password-protected file.</p>" +
        row(
          "Backup contents",
          info.count +
            " records · " +
            info.files +
            " files · approximately " +
            sizeLabel(info.size),
        ) +
        '<label class="field">Backup password<input id="vault-pass" type="password" autocomplete="new-password" minlength="12" maxlength="2048" required placeholder="At least 12 characters"></label>' +
        '<label class="field">Confirm password<input id="vault-repeat" type="password" autocomplete="new-password" required></label>' +
        '<p class="hint">Keep the password in a safe place. Recovery requires the original password.</p>' +
        resultBox() +
        buttons("Create backup") +
        "</form>",
    );
    const form = element("vault-form");
    progressForm(form, async (options) => {
      const password = element("vault-pass").value;
      if (password !== element("vault-repeat").value)
        throw Error("Enter matching passwords.");
      const backup = await makeBackup(ds, password, options);
      checkCancel(options.signal);
      if (!form.isConnected) return;
      const name =
        "Property-Manager-" + ds + "-" + backup.at.slice(0, 10) + ".pmvault";
      pm().modal(
        "Save your backup",
        '<div class="stack"><p>The encrypted file is ready. Save it to Files, OneDrive, or a removable drive. Open that location to confirm the file is there.</p>' +
          row(
            name,
            sizeLabel(backup.blob.size) +
              " · " +
              backup.records +
              " records · " +
              backup.files +
              " originals",
          ) +
          '<div class="actions"><button class="primary" id="vault-download">Download encrypted file</button><button id="vault-share" hidden>Share file</button></div>' +
          '<label class="field"><span><input type="checkbox" id="vault-checked"> I checked the saved file at its destination.</span></label><button disabled id="vault-confirm">Confirm backup saved</button>' +
          resultBox() +
          "</div>",
      );
      const savedCheck = element("vault-checked"),
        confirm = element("vault-confirm");
      savedCheck.addEventListener("change", () => {
        confirm.disabled = !savedCheck.checked;
      });
      action("vault-download", () => {
        pm().download(backup.blob, name);
        message(
          "Download requested. Confirm the file after you see it in the destination folder.",
        );
      });
      if (typeof File === "function" && navigator.canShare) {
        const payload = {
          files: [
            new File([backup.blob], name, { type: "application/octet-stream" }),
          ],
        };
        if (navigator.canShare(payload)) {
          element("vault-share").hidden = false;
          action("vault-share", async () => {
            try {
              await navigator.share(payload);
              message(
                "Share completed. Verify the saved copy at its destination.",
              );
            } catch (e) {
              if (e.name === "AbortError")
                message("Share canceled. The backup is available to download.");
              else throw e;
            }
          });
        }
      }
      action("vault-confirm", async () => {
        if (!savedCheck.checked) return;
        await confirmBackup(ds, backup.revision);
        pm().close();
        await pm().refresh();
        pm().toast("Backup confirmed");
      });
    });
  }
  function describeConflict(r) {
    const title = r.title || r.name || r.vendor || r.subject || r.id;
    return r.type + " · " + String(title);
  }
  function review(plan, publish = null) {
    const { ds, bundle, mode, local, merge } = plan,
      replace = mode === "restore";
    const conflictRows = (merge?.conflicts || [])
      .map(
        (c, i) =>
          '<section class="notice"><h3>' +
          escapeText(describeConflict(c.local)) +
          '</h3><div class="dialog-split">' +
          [c.local, c.incoming]
            .map(
              (r, j) =>
                "<details><summary>" +
                (j ? "Incoming version" : "This device") +
                '</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">' +
                escapeText(JSON.stringify(plain(r), null, 2)) +
                "</pre></details>",
            )
            .join("") +
          "</div>" +
          '<label class="field">Version to retain<select id="vault-choice-' +
          i +
          '" required><option value="">Select a version</option><option value="local">Keep this device’s version</option>' +
          (c.local.immutable
            ? ""
            : '<option value="incoming">Keep incoming version</option>') +
          "</select></label></section>",
      )
      .join("");
    const text = replace
      ? "Replace the entire " +
        (ds === "sample" ? "sample" : "personal") +
        " dataset on this device. A backup of your current records lets you reverse this replacement."
      : "Each incoming record has been compared with this device. Review the changes before merging.";
    const details = replace
      ? row(
          "Replacement",
          active(local).length +
            " current records → " +
            active(bundle.body.records).length +
            " restored records",
        )
      : row(
          "Comparison",
          merge.additions.length +
            " new · " +
            merge.updates.length +
            " updates · " +
            merge.unchanged +
            " already present · " +
            merge.conflicts.length +
            " conflicts",
        );
    pm().modal(
      replace ? "Review backup replacement" : "Review device merge",
      '<form id="vault-form" class="stack"><p>' +
        text +
        "</p>" +
        row(
          "Verified backup",
          dateLabel(bundle.body.at) +
            " · " +
            bundle.blobs.length +
            " original files",
        ) +
        details +
        conflictRows +
        (publish ? row("GitHub destination", publish.repository + " · Save the merged owner workspace as an encrypted snapshot.") : "") +
        (replace
          ? '<label class="field"><span><input id="vault-approve" type="checkbox" required> Replace all existing ' +
            (ds === "sample" ? "sample" : "personal") +
            " records with this backup.</span></label>"
          : "") +
        resultBox() +
        buttons(publish ? "Merge and upload encrypted snapshot" : replace ? "Restore verified backup" : "Apply reviewed merge") +
        "</form>",
      { onClose: () => { publish = null; } },
    );
    const form = element("vault-form");
    progressForm(form, async (options) => {
      const publication = publish;
      const choices = Object.create(null);
      (merge?.conflicts || []).forEach((c, i) => {
        choices[c.id] = element("vault-choice-" + i).value;
      });
      message("Committing records and original files…");
      const result = await commitImport(plan, choices, options.signal);
      if (publication) {
        try {
          checkCancel(options.signal);
          await publication.send(options, result.revision);
        } catch (error) {
          await pm().refresh();
          if (form.isConnected && element("dialog").open) {
            form.querySelector('[type="submit"]').hidden = true;
            message("The local merge was saved. GitHub upload is unconfirmed. " + friendly(error), true);
            const retry = document.createElement("button");
            retry.type = "button";
            retry.textContent = "Review GitHub sync again";
            retry.addEventListener("click", () => pm().action("github-sync"));
            form.append(retry);
          }
          return;
        }
      }
      if (options.signal.aborted || !form.isConnected || !element("dialog").open) {
        await pm().refresh();
        return;
      }
      pm().close();
      await pm().refresh();
      pm().toast(
        (publication ? "GitHub sync complete" : replace ? "Restore complete" : "Merge complete") +
          " · " +
          result.imported +
          " records",
      );
    });
  }
  async function importPanel(ds, mode) {
    const restore = mode === "restore",
      info = await estimate(ds);
    pm().modal(
      restore ? "Restore a backup" : "Merge device changes",
      '<form id="vault-form" class="stack"><p>' +
        (restore
          ? "Choose a backup to replace this device’s " +
            (ds === "sample" ? "sample" : "personal") +
            " dataset. You will review its contents before replacement."
          : "On your other device, create an encrypted backup and save it to Files or OneDrive. Select that file here to compare record versions.") +
        "</p>" +
        row(
          "On this device",
          info.count + " records · " + info.files + " originals",
        ) +
        '<label class="field">Encrypted backup<input id="vault-file" type="file" accept=".pmvault,application/octet-stream" required></label>' +
        '<label class="field">Backup password<input id="vault-pass" type="password" autocomplete="off" maxlength="2048" required></label>' +
        resultBox() +
        buttons("Verify and preview") +
        "</form>",
    );
    const form = element("vault-form");
    progressForm(form, async (options) => {
      const file = element("vault-file").files[0],
        password = element("vault-pass").value;
      const bundle = await readBackup(file, password, ds, options);
      const plan = await planImport(ds, bundle, mode);
      checkCancel(options.signal);
      if (form.isConnected) review(plan);
    });
  }
  function firstGitHubUpload(repository, upload, info) {
    pm().modal(
      "Create GitHub snapshot",
      '<form class="stack" id="vault-form">' +
        row("Private repository", repository) +
        row("First encrypted snapshot", info.count + " owner records and their originals") +
        '<label class="field">Confirm your vault password<input id="github-confirm" type="password" autocomplete="off" required></label>' +
        resultBox() + buttons("Upload encrypted snapshot") + "</form>",
      { onClose: () => { element("github-confirm").value = ""; upload = null; } },
    );
    const form = element("vault-form");
    progressForm(form, async (options) => {
      await upload(options, info.revision, element("github-confirm").value);
      if (!options.signal.aborted) {
        pm().close();
        await pm().refresh();
        pm().toast("Encrypted GitHub snapshot saved");
      }
    });
  }
  async function githubPanel(ds) {
    if (ds !== "owner") throw Error("Open the owner workspace to sync personal records.");
    const info = await estimate(ds);
    let repository = "";
    try { repository = localStorage.getItem("propertymanager.githubRepository") || ""; } catch {}
    pm().modal(
      "GitHub sync",
      '<form class="stack" id="vault-form">' +
        row("Personal workspace on this device", info.count + " owner records · " + info.files + " originals") +
        '<label class="field">Private data repository<input id="github-repo" required autocapitalize="none" spellcheck="false" placeholder="owner/repository" value="' + escapeText(repository) + '"></label>' +
        '<label class="field">Fine-grained GitHub token<input id="github-token" type="password" autocomplete="off" required></label>' +
        '<label class="field">Vault password<input id="github-pass" type="password" autocomplete="off" minlength="12" maxlength="2048" required></label>' +
        '<label class="field">Operation<select id="github-mode"><option value="sync">Merge and upload encrypted snapshot</option><option value="pull">Download and merge into this device</option></select></label>' +
        '<p class="hint">Use a separate private repository with a default branch. Give the token Contents access to that repository. Uploads require write access. The vault password encrypts all owner records and originals on this device. Keep it for use on your other devices.</p>' +
        resultBox() + buttons("Review GitHub sync") + "</form>",
      { onClose: () => { element("github-token").value = ""; element("github-pass").value = ""; } },
    );
    const form = element("vault-form");
    progressForm(form, async (options) => {
      const password = element("github-pass").value;
      const pulling = element("github-mode").value === "pull";
      message("Checking private repository…");
      const remote = await GitHubSync.connect(element("github-repo").value, element("github-token").value.trim(), options.signal);
      try { localStorage.setItem("propertymanager.githubRepository", remote.repository); } catch {}
      const upload = async (progress, reviewedRevision, confirmation) => {
        if (confirmation !== undefined && confirmation !== password)
          throw Error("The vault passwords do not match. Enter the original password again.");
        const backup = await makeBackup(ds, password, progress);
        if (backup.revision !== reviewedRevision)
          throw Error("Local records changed after review. Reopen GitHub sync to compare the latest workspace.");
        message("Uploading encrypted snapshot…");
        await remote.upload(backup.blob, progress.signal);
        await confirmBackup(ds, backup.revision, true);
      };
      if (!remote.exists && !pulling) {
        if (!info.count && !info.files) throw Error("Add owner records on this device before creating the first snapshot.");
        checkCancel(options.signal);
        return firstGitHubUpload(remote.repository, upload, info);
      }
      message("Downloading encrypted snapshot…");
      const blob = await remote.download(options.signal);
      const bundle = await readBackup(blob, password, ds, options);
      const plan = await planImport(ds, bundle, "merge");
      checkCancel(options.signal);
      review(plan, pulling ? null : { repository: remote.repository, send: upload });
    });
  }
  async function panel(mode = "storage") {
    const ds = pm().dataset();
    if (mode === "github-sync") return githubPanel(ds);
    if (mode === "backup") return backupPanel(ds);
    if (mode === "restore" || mode === "merge") return importPanel(ds, mode);
    if (mode === "history") {
      const entries = await history(ds);
      pm().modal(
        "Record history",
        '<div class="stack"><p class="hint">Activity times come from the device that recorded each action.</p>' +
          (entries.length
            ? entries
                .slice(0, 250)
                .map(
                  (e) =>
                    '<div class="notice"><strong>' +
                    escapeText(e.action) +
                    "</strong><br>" +
                    escapeText(dateLabel(e.at)) +
                    (e.ids?.length ? " · " + e.ids.length + " records" : "") +
                    (e.info ? "<br>" + escapeText(e.info) : "") +
                    "</div>",
                )
                .join("")
            : "<p>Your first saved change will appear here.</p>") +
          "</div>",
      );
      return;
    }
    const [s, info] = await Promise.all([status(ds), estimate(ds)]);
    pm().modal(
      "Backup and storage",
      '<div class="stack"><p>Private records live in this browser on this device. Backups use password-based encryption. The live database relies on your device and browser protections.</p>' +
        row(
          "Stored locally",
          info.count +
            " records · " +
            info.files +
            " originals · " +
            sizeLabel(info.size),
        ) +
        row(
          "Backup confirmed",
          s.lastBackup
            ? dateLabel(s.lastBackup) + " · " + s.backupEvidence
            : "No confirmed backup",
        ) +
        row("Changes since confirmation", s.changes + " saved changes") +
        (s.lastCreated
          ? row("Backup file created", dateLabel(s.lastCreated))
          : "") +
        row(
          "Last device transfer",
          s.lastTransfer
            ? dateLabel(s.lastTransfer) + " · " + s.transferMethod
            : "No transfers yet",
        ) +
        '<div class="actions"><button class="primary" id="vault-make">Create encrypted backup</button><button id="vault-merge">Merge device changes</button><button id="vault-restore">Restore backup</button></div>' +
        '<details><summary>Browser storage and recovery</summary><div class="stack">' +
        row(
          "Storage permission",
          s.persistent ? "Persistent storage granted" : "Best-effort storage",
        ) +
        (s.quota
          ? row(
              "Origin storage",
              sizeLabel(s.usage || 0) +
                " used of approximately " +
                sizeLabel(s.quota),
            )
          : "") +
        "<p>Removing app data, changing origin, or browser eviction can make these local records unavailable. Transfer using a verified encrypted backup. Each source file may be up to 32 MiB. A complete portable archive can be up to 256 MiB.</p>" +
        (!s.persistent && navigator.storage?.persist
          ? '<button id="vault-persist">Request persistent storage</button>'
          : "") +
        '<button id="vault-log">View record history</button></div></details>' +
        resultBox() +
        "</div>",
    );
    action("vault-make", () => panel("backup"));
    action("vault-restore", () => panel("restore"));
    action("vault-merge", () => panel("merge"));
    action("vault-log", () => panel("history"));
    action("vault-persist", async () => {
      const granted = await navigator.storage.persist();
      if (granted) await panel();
      else
        message(
          "The browser kept best-effort storage. Keep a current encrypted backup in another location.",
        );
    });
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
    backupUI: () => panel("backup"),
    restoreUI: () => panel("restore"),
    mergeUI: () => panel("merge"),
    historyUI: () => panel("history"),
  };
})();
