/* The token and decrypted vault stay on the device. Only ciphertext is committed. */
(() => {
  "use strict";
  const limit = 100_000_000;
  const path = "property-manager/owner.pmvault";
  const jsonType = "application/vnd.github+json";

  function checkSize(size) {
    if (!Number.isSafeInteger(size) || size < 32 || size > limit)
      throw Error("GitHub sync supports encrypted vaults up to 100 MB. Use an encrypted file transfer for a larger workspace.");
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

  async function connect(repository, token, signal) {
    const parts = repository.trim().split("/");
    if (parts.length !== 2 || !/^[a-z0-9-]+$/i.test(parts[0]) ||
        !/^[a-z0-9_.-]+$/i.test(parts[1]) || [".", ".."].includes(parts[1]))
      throw Error("Enter a GitHub repository as owner/repository.");
    if (!/^github_pat_[a-z0-9_]+$/i.test(token))
      throw Error("Enter a fine-grained GitHub personal access token.");
    const base = "https://api.github.com/repos/" + parts.join("/");

    async function request(suffix, signal, {body, accept = jsonType, allowMissing = false} = {}) {
      const response = await fetch(base + suffix, {
        method: body ? "PUT" : "GET", cache: "no-store", credentials: "omit",
        referrerPolicy: "no-referrer", redirect: "error", signal,
        headers: {
          Accept: accept, Authorization: "Bearer " + token,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body ? {"Content-Type": "application/json"} : {}),
        },
        ...(body ? {body: JSON.stringify(body)} : {}),
      });
      if (response.ok) return response;
      if (response.status === 404 && allowMissing) return null;
      if (response.status === 409 || response.status === 422)
        throw Error("GitHub declined this revision. Check the branch rules and reopen GitHub sync to compare the latest changes.");
      if ([401, 403, 404].includes(response.status))
        throw Error("GitHub denied access. Check the repository, token expiry, repository access and Contents permission.");
      throw Error("GitHub returned HTTP " + response.status + ". Reopen sync to check the latest snapshot before retrying.");
    }

    async function verifyRepository(signal) {
      const repo = await (await request("", signal)).json();
      if (repo.private !== true || repo.visibility !== "private" || repo.has_pages !== false)
        throw Error("Use a private data repository with GitHub Pages turned off. Publish the app from its separate hosting repository.");
      if (repo.full_name?.toLowerCase() !== parts.join("/").toLowerCase() ||
          !Number.isSafeInteger(repo.id) || !repo.default_branch)
        throw Error("GitHub returned an unexpected repository. Reopen sync with its current owner and name.");
      return repo;
    }
    const repo = await verifyRepository(signal);
    const file = "/contents/" + path;
    const response = await request(file + "?ref=" + encodeURIComponent(repo.default_branch), signal,
      {allowMissing: true, accept: "application/vnd.github.object+json"});
    const metadata = response ? await response.json() : null;
    if (metadata) {
      if (metadata.type !== "file" || metadata.path !== path || !/^[0-9a-f]{40}$/.test(metadata.sha))
        throw Error("The sync path contains an unexpected file. Check the data repository.");
      checkSize(metadata.size);
    }
    return {
      repository: repo.full_name,
      exists: !!metadata,
      async download(signal) {
        if (!metadata) throw Error("This repository has no owner snapshot yet. Sync your source device first.");
        const raw = await request("/git/blobs/" + metadata.sha, signal, {accept: "application/vnd.github.raw+json"});
        const blob = await raw.blob();
        if (blob.size !== metadata.size) throw Error("The downloaded vault is incomplete. Reopen sync to retry.");
        return blob;
      },
      async upload(blob, signal) {
        checkSize(blob.size);
        if (await blob.slice(0, 8).text() !== "PMVAULT2")
          throw Error("GitHub sync requires an encrypted Property Manager backup.");
        const content = await asBase64(blob, signal);
        const header = "blob " + blob.size + "\0";
        const digest = await crypto.subtle.digest("SHA-1", await new Blob([header, blob]).arrayBuffer());
        const expected = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
        const current = await verifyRepository(signal);
        if (current.id !== repo.id || current.default_branch !== repo.default_branch)
          throw Error("The data repository or default branch changed. Reopen sync to review it.");
        const written = await request(file, signal, {body: {
          message: "Sync encrypted Property Manager vault", branch: repo.default_branch, content,
          ...(metadata ? {sha: metadata.sha} : {}),
        }});
        const receipt = await written.json();
        if (receipt.content?.sha !== expected || receipt.content?.path !== path)
          throw Error("GitHub did not confirm the expected vault bytes. Reopen sync to check the saved revision.");
      },
    };
  }
  globalThis.GitHubSync = {connect};
})();
