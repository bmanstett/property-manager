/* The decrypted vault stays on the device. Only ciphertext is committed, and the access key is sent
   only to GitHub's API. */
(() => {
  "use strict";
  const limit = 100_000_000;
  const path = "property-manager/owner.pmvault";
  const api = "https://api.github.com";
  const jsonType = "application/vnd.github+json";
  /* Messages are written for the owner. `code` tells the panel what a message is about:
     "key" the access key itself, "repository" which repository, "access" what the key may do. */
  const problem = (message, code) => Object.assign(Error(message), {code});
  const changed = "Something about the repository changed. Check its name and settings on GitHub, then sync again.";
  const unfinished = "The transfer did not finish cleanly. Sync again.";

  function checkSize(size) {
    if (!Number.isSafeInteger(size) || size < 32 || size > limit)
      throw Error("Your records are larger than the 100 MB that sync allows. Use a backup file instead.");
  }

  async function asBase64(blob, signal) {
    const chunks = [];
    // Each chunk except the last must encode a whole number of three-byte groups.
    const chunkSize = 3 * 8192;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    for (let i = 0; i < bytes.length; i += chunkSize) {
      signal?.throwIfAborted();
      chunks.push(btoa(String.fromCharCode(...bytes.subarray(i, i + chunkSize))));
    }
    return chunks.join("");
  }

  /* "name/repository" as its two parts, or null when it is not written that way. */
  function nameParts(repository) {
    const parts = String(repository ?? "").trim().split("/");
    return parts.length === 2 && /^[a-z0-9-]+$/i.test(parts[0]) &&
      /^[a-z0-9_.-]+$/i.test(parts[1]) && ![".", ".."].includes(parts[1]) ? parts : null;
  }
  const looksLikeKey = token => /^github_pat_[a-z0-9_]+$/i.test(String(token ?? ""));
  function checkKey(token) {
    if (!looksLikeKey(token))
      throw problem("That does not look like a GitHub access key. It should start with github_pat_.", "key");
  }

  /* One request to GitHub. `missing` lists the answers that mean "not there" instead of a failure;
     for those the result is null. */
  async function call(url, token, signal, {body, accept = jsonType, missing = []} = {}) {
    let response;
    try {
      response = await fetch(url, {
        method: body ? "PUT" : "GET", cache: "no-store", credentials: "omit",
        referrerPolicy: "no-referrer", redirect: "error", signal,
        headers: {
          Accept: accept, Authorization: "Bearer " + token,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body ? {"Content-Type": "application/json"} : {}),
        },
        ...(body ? {body: JSON.stringify(body)} : {}),
      });
    } catch (error) {
      // Stopping is passed on as it is.
      if (error?.name === "AbortError" || signal?.aborted) throw error;
      // A download that fails changed nothing. An upload may have arrived before the connection dropped.
      throw problem(body
        ? "The connection to GitHub dropped during the upload, so the online copy may or may not have been updated. Nothing on this device was lost. Sync again to check."
        : "Could not reach GitHub. Check your internet connection and try again. Nothing was changed.", "offline");
    }
    if (response.ok) return response;
    // GitHub answers 401 only when the key itself is no good: mistyped, expired or deleted.
    if (response.status === 401)
      throw problem("GitHub did not accept the access key. It may have expired or been deleted. Create a new key on GitHub and paste it here.", "key");
    if (missing.includes(response.status)) return null;
    if (response.status === 409 || response.status === 422)
      throw problem("GitHub did not accept the upload, usually because your other device synced a moment ago. Sync again.", "busy");
    if ([403, 404].includes(response.status))
      throw problem("GitHub did not let the app in. Check that the repository name is right and that the access key allows Contents: Read and write for that repository.", "access");
    throw Error("GitHub had a problem (error " + response.status + "). " + (body ? "The upload may not have gone through. Sync again in a few minutes to check." : "Nothing was changed. Try again in a few minutes."));
  }

  /* The private repositories an access key can open, most recently used first, or null when GitHub
     will not list them for this key. A key made for one repository lists only that one, which is
     how the app learns where to sync without being told. */
  async function find(token, signal) {
    checkKey(token);
    const response = await call(api + "/user/repos?visibility=private&sort=pushed&per_page=100", token, signal, {missing: [403, 404]});
    if (!response) return null;
    const list = await response.json();
    return (Array.isArray(list) ? list : [])
      .filter(repo => repo?.private === true && nameParts(repo.full_name))
      .map(repo => repo.full_name);
  }

  /* Whether a repository already holds an online backup. */
  async function holds(repository, token, signal) {
    const parts = nameParts(repository);
    checkKey(token);
    return !!parts && !!(await call(api + "/repos/" + parts.join("/") + "/contents/" + path, token, signal, {missing: [403, 404]}));
  }

  async function connect(repository, token, signal) {
    const parts = nameParts(repository);
    if (!parts)
      throw problem("Type the repository as name/repository, for example pat-smith/rental-backup.", "repository");
    checkKey(token);
    const base = api + "/repos/" + parts.join("/");
    const request = (suffix, signal, {allowMissing = false, ...options} = {}) =>
      call(base + suffix, token, signal, {...options, missing: allowMissing ? [404] : []});

    async function verifyRepository(signal) {
      const repo = await (await request("", signal)).json();
      if (repo.private !== true || repo.visibility !== "private" || repo.has_pages !== false)
        throw problem("For your privacy, sync needs a private repository with GitHub Pages turned off. Check the repository's settings on GitHub.", "repository");
      if (repo.full_name?.toLowerCase() !== parts.join("/").toLowerCase() ||
          !Number.isSafeInteger(repo.id) || !repo.default_branch)
        throw problem(changed, "repository");
      return repo;
    }
    const repo = await verifyRepository(signal);
    const file = "/contents/" + path;
    const response = await request(file + "?ref=" + encodeURIComponent(repo.default_branch), signal,
      {allowMissing: true, accept: "application/vnd.github.object+json"});
    const metadata = response ? await response.json() : null;
    if (metadata) {
      if (metadata.type !== "file" || metadata.path !== path || !/^[0-9a-f]{40}$/.test(metadata.sha))
        throw Error(changed);
      checkSize(metadata.size);
    }
    return {
      repository: repo.full_name,
      exists: !!metadata,
      async download(signal) {
        if (!metadata) throw Error("There is no online backup in this repository yet. Sync from the device that has your records first.");
        const raw = await request("/git/blobs/" + metadata.sha, signal, {accept: "application/vnd.github.raw+json"});
        const blob = await raw.blob();
        if (blob.size !== metadata.size) throw Error(unfinished);
        return blob;
      },
      async upload(blob, signal) {
        checkSize(blob.size);
        if (await blob.slice(0, 8).text() !== "PMVAULT2")
          throw Error("Only a Property Manager backup can be uploaded.");
        const content = await asBase64(blob, signal);
        const header = "blob " + blob.size + "\0";
        const digest = await crypto.subtle.digest("SHA-1", await new Blob([header, blob]).arrayBuffer());
        const expected = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
        const current = await verifyRepository(signal);
        if (current.id !== repo.id || current.default_branch !== repo.default_branch)
          throw Error(changed);
        const written = await request(file, signal, {body: {
          message: "Sync encrypted Property Manager vault", branch: repo.default_branch, content,
          ...(metadata ? {sha: metadata.sha} : {}),
        }});
        const receipt = await written.json();
        if (receipt.content?.sha !== expected || receipt.content?.path !== path)
          throw Error(unfinished);
      },
    };
  }
  globalThis.GitHubSync = {connect, find, holds, looksLikeKey};
})();
