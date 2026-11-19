# Back up and transfer your rental

Property Manager stores records and original files in IndexedDB, scoped to the browser, installation, and site origin. The sample property has a separate dataset. The live database is covered by your operating system and browser protections. Password encryption applies to exported backup files.

## Create and confirm a backup

1. In the intended workspace, open **Settings → Encrypted backup**. Check the record count, file count, and estimated size. Every property in that dataset is included.
2. Enter and confirm a password of at least 12 characters. Keep it somewhere recoverable. Losing the password makes the encrypted archive unrecoverable.
3. Choose **Create backup**, then **Download encrypted file** or the file-sharing option provided by your device. Save the `.pmvault` file outside browser storage, such as in Files, OneDrive, or on a removable drive.
4. Open the destination to check that the file exists and has the expected size. Return to the app, select the confirmation checkbox, and choose **Confirm backup saved**. An initiated download or canceled share leaves the confirmation date untouched.
5. For a stronger check, import the file on a second device and complete **Restore backup** into its matching dataset. Compare the records and open a retained original. Review replacement carefully if the destination already contains work. Keep the prior archive while verifying the new one.

**Settings → Storage & history** shows the confirmed date, changes since confirmation, the last archive creation, the last transfer and the browser’s storage estimate. The change count measures committed save batches and new binary objects. Persistent storage depends on browser permission. Copies outside the browser remain necessary.

## Move between desktop and iPhone

Create a backup on the source device. Move it through a location you select in Files or OneDrive, or use a supported file share. Open the matching sample or personal workspace at the destination. The same URL on two devices opens independent databases.

- **Restore backup** replaces the whole destination dataset. Verification happens before replacement. Review the source date and counts, then explicitly confirm replacement. If desired, make and save a backup of the destination first. A successful restore records the archive as restore-tested on that device.
- **Merge device changes** compares stable record IDs and ancestry. The preview shows additions, updates, already-present records, and simultaneous edits. Expand both versions of each conflict and choose which to keep. Committing a choice records both parents. Frozen local versions can stay in place or the entire transfer can be canceled. Repeating a transfer recognizes revisions already incorporated.
- Review the result and open a supporting document at the destination. Create a fresh encrypted backup after reconciling devices.

If local work changes while an import preview is open, the comparison must be reopened. A failed validation, wrong password, cancellation, or interrupted atomic replacement preserves the previously committed dataset.

## Sync personal records with GitHub

1. Create a **private** repository for data in your own GitHub account. Initialize it with a README so it has a default branch. Leave Pages off and allow direct commits to the default branch.
2. In GitHub, open **Settings → Developer settings → Personal access tokens → Fine-grained tokens**. Select your resource owner, choose **Only select repositories** and the private data repository, set an expiration, and grant **Contents → Read and write**. GitHub includes metadata read access. A read-only Contents token works for downloads. [Fine-grained token settings](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) · [Contents API permissions](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents)
3. Open **Settings → GitHub sync** on the device with your owner records. Enter `owner/repository`, the token, and a vault password of at least 12 characters. Save the password securely for every device. Choose **Merge and upload encrypted snapshot** and review the destination. Confirm your password on the first upload.
4. On another device open the same app and sync settings. **Download and merge into this device** previews new, updated, and conflicting records before applying them locally. **Merge and upload encrypted snapshot** lets you review incoming data, merge it, and publish the combined workspace. If another device updates the file first, reopen sync to compare the latest revision. A local merge that completed before an upload failure remains available on that device.

Each sync transfers the complete owner vault, including all properties, history, and originals. The default branch stores `property-manager/owner.pmvault` with encrypted revisions in Git history. After an upload, the app compares GitHub's file hash with the encrypted bytes and records the confirmed backup in **Storage & history**. The app remembers the repository name. It requests the token and vault password for each sync, sends the token only to GitHub's API, and uses the password locally. GitHub sync accepts a vault of up to 100 MB. Larger workspaces can use the portable backup and transfer process above. [GitHub file access limits](https://docs.github.com/en/rest/repos/contents#get-repository-content)

## File format and limits

Format `PMVAULT2` uses the browser’s Web Crypto implementation of PBKDF2-HMAC-SHA-256 with 600,000 iterations, a fresh random 128-bit salt, and a 256-bit AES-GCM key. Each authenticated frame has a distinct nonce made from a fresh 64-bit prefix and a frame counter, plus a 128-bit authentication tag. Additional authenticated data binds frames to their header and sequence. The encrypted manifest includes the schema, revisions, ancestry, history, records, file types, lengths, and SHA-256 digests. The archive contains no password or plaintext encryption key.

Original-file frames are processed in 1 MiB chunks. SHA-256 checks handle one bounded original at a time. Browser Blob storage holds verified pieces while the app validates the complete archive. Only after confirmation are records and files installed in one IndexedDB transaction. Each file is limited to 32 MiB, structured metadata to 20 MiB, and a portable archive to 256 MiB. The review surface shows progress and supports cancellation. Device free space and browser memory can impose smaller practical limits.

The database migrates in place. Dataset tombstones and revision ancestry remain available for later merges. The activity history records local event times. Device clocks, recorded history, and SHA-256 values provide traceability within this application.

## Offline export components

| Component | Purpose | License |
| --- | --- | --- |
| `storage.js` | IndexedDB, record revisions, authenticated backups, explicit restore and merge | Original application code |
| `export.js` | UTF-8 ZIP with per-file CRC-32, embedded-font U.S. Letter PDF with selectable text and page numbering | Original application code |
| `pdf-font.js` | Locally embedded Liberation Sans regular for PDF text | SIL Open Font License 1.1, see [LICENSE-Liberation.txt](LICENSE-Liberation.txt) |

PDF generation reports unsupported glyphs so names and terms can be preserved through the printable HTML path. The native PDF writer supports left-to-right text with the glyphs present in Liberation Sans. For a lease using complex scripts, use the printable HTML version and verify the generated pages.
