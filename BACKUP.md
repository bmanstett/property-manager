# Back up, restore and sync your rental

Property Manager keeps your records and files inside the browser on the device you are using (IndexedDB, scoped to the browser, the installation and the site address). Nothing leaves the device unless you make a backup file or sync. The sample property is kept separately from your own records. Records on the device rely on the device's and the browser's own protection. A backup file has its own password.

Everything in this guide starts from one screen, **Backup & sync**. On a computer, choose the **Backup & sync** card at the bottom of the sidebar. On a phone, open **Settings** and choose **Backup & sync**. Backup, restore and sync always work on your own records, even while the sample property is showing.

## Is my data safe?

The top of **Backup & sync**, the sidebar card and the line at the bottom of Home all show the same status, in your device's own time:

| Status | What it means |
| --- | --- |
| Backed up | Nothing has changed since your last backup or sync. |
| Backed up, with "1 change since then" | A few things changed. No action needed yet. |
| Backup needed | Five or more changes, or two weeks with any change, since the last backup. |
| Not backed up yet | Your records exist only on this device. |
| Backup started, not finished | A backup file was made but not marked as saved, or a sync stopped before the upload. |
| Brought in from your other device | This device downloaded your records but has not uploaded or backed up from here. |
| Nothing to back up yet, or Sample property | There are no records of yours on this device. |

## Back up to a file

1. Open **Backup & sync** and choose **Back up now**. The screen lists what is included: every property, payment, lease and file.
2. Type a **Backup password** of at least 12 characters. It is shown as you type so that you can read it back; **Hide** turns it into dots. Write it down. Nobody can reset it, and the backup cannot be opened without it.
3. Choose **Create backup file**, then **Save to this computer** (or **Save to Files or share** on a phone). The file is named with the date and time, for example `Property-Manager-backup-2026-11-18-1943.pmvault`. Keep a copy off the device, such as in OneDrive, iCloud Drive or on a USB drive.
4. When you can see the file where you saved it, choose **Done, I saved it**. Only this marks the backup as made. If you started saving the file and then choose **Not now** or close the screen, the status reads "Backup started, not finished", and **Backup & sync** offers **I saved it** for that same file. If you close the screen before saving anything, make the backup again.

After the first backup the app asks your browser to protect its records from automatic clean-up. You can see this, and turn it on yourself, under **More options** on the **Backup & sync** screen. A copy outside the browser is still necessary.

## Restore, or combine two devices

1. On the device that should receive the records, open **Backup & sync** and choose **Restore from a backup file**. The same screen opens from **Restore from a backup** and **Combine with another device** in Settings, and from **Restore from a backup** on the first screen of a new installation.
2. Choose the backup file, type its password and choose **Check backup**. Nothing changes yet. The whole file is checked first.
3. The next screen depends on what is on the device:
   - **This device has no records yet.** You see when the backup was made and what it contains. Choose **Restore to this device**.
   - **This device has records.** Choose how to use the backup. **Combine** keeps what is on this device and adds what is new. **Replace everything** removes what is on this device and uses only the backup; it needs the switch "Yes, remove what is on this device and use the backup", and **Back up this device first** is offered beside it.
4. If the same item was changed on both devices, it is listed under **Changed on both devices** with what differs and when each copy was last changed. Choose **Keep this device's** or **Keep the other device's** for each one. An item that is final on this device cannot be replaced, so this device's copy is kept. The raw details are under **Technical details**.
5. Choose **Combine now** or **Replace with this backup**. Then open a document to check the result.

If you pick a file that holds the sample property while restoring your own records (or the other way round), the app says so and offers one button to carry on with the right records. A wrong password, a damaged file, pressing **Stop**, or closing the screen leaves everything as it was. If something is saved on the device while you are reviewing, the comparison is made again before anything is changed.

## Sync with GitHub

Sync keeps a phone and a computer matched through a private GitHub repository that only you control. Your records are locked with a backup password before they leave the device, so GitHub cannot read them.

Set-up, once (the same steps are shown in the app under **How to set this up**):

1. Create a free GitHub account, then a new **private** repository with "Add a README" ticked. Leave GitHub Pages off and allow direct commits to the default branch.
2. In GitHub, open **Settings → Developer settings → Personal access tokens → Fine-grained tokens**. Choose **Only select repositories** and that repository, set an expiry date, and under Permissions set **Contents → Read and write**. The app calls this token your **GitHub access key**. A read-only key works with "Only download to this device". [Fine-grained token settings](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) · [Contents API permissions](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents)
3. On the device that has your records, open **Backup & sync → Sync with GitHub** and paste the access key. That is the only thing to enter: the app remembers the key and finds the repository the key was made for. **Create your online backup** then shows a backup password the app has made for you. Keep a copy of it (**Copy password**) and choose **Upload first backup**. You can type a password of your own in its place, at least 12 characters.

Every sync after that:

1. Open **Backup & sync → Sync now** and choose **Sync now**. Nothing is typed. When a backup is needed, **Sync now** on Home opens the same screen and starts by itself.
2. The app downloads what is online and compares it with this device.
3. **Review and finish sync** says what will come in from your other device and resolves anything changed on both devices, exactly as described above. Choose **Finish sync** to bring the changes in and upload this device's records.

On a second device, paste the same access key. The repository already holds your online backup, so the app asks once for the backup password; your first device shows it under **Backup & sync → Sync now → More options**. Its first sync downloads everything. **Only download to this device**, under **More options**, brings changes in without uploading; a device that has only downloaded shows "Brought in from your other device" until it uploads or makes its own backup. On a new device you can also start from **Restore from a backup file → My records are on GitHub instead**.

What the app remembers: the access key, the name of the repository and the backup password. They are kept with this browser's settings on this device, next to your records. They are not part of your records, of a backup file or of the online backup, and the key is sent only to GitHub's API. Whoever can use this browser on this device can read them, just as they can read your records. Keep your own copy of the backup password: without it the online backup cannot be opened on another device.

- **A key that expires.** The app says GitHub no longer accepts the key and asks you to paste a new one. The repository and the backup password stay remembered.
- **Change key** asks for another key. GitHub shows a key only once, so the saved key stays until GitHub has accepted the new one. **Forget the saved key** removes it from this device.
- **A key made for several repositories.** The app uses the one that already holds an online backup. If none does, it lists them and you choose. If GitHub will not list them, you can type the name as `your-github-name/rental-backup`.
- **A device that synced with an earlier version of the app** remembers its repository only. Paste the key once and type the backup password once.

If the upload does not go through, for example because your other device synced a moment ago, the changes that were brought in stay on this device, the screen says "Sync did not finish", and **Try sync again** repeats the sync without asking for the key and password a second time.

Each sync transfers one complete backup of your records, including every property, the activity log and all files. The repository's default branch holds `property-manager/owner.pmvault`, with earlier versions in its Git history. After an upload the app compares GitHub's file hash with the bytes it sent and only then records the backup. The access key is sent only to GitHub's API. Sync handles up to 100 MB; use a backup file for more. [GitHub file access limits](https://docs.github.com/en/rest/repos/contents#get-repository-content)

## More options

**More options** on the **Backup & sync** screen shows how much is stored on this device, the last backup and the last time records were brought in, protection from automatic clean-up, the space the app uses, the address this copy of the app lives at, the limits, and the **Activity log**. The activity log lists backups, restores and syncs by day; **Show every saved change** adds each save. While the sample property is showing, the same place has **Back up the sample property**, **Use a backup file with the sample property** and **Sample activity log**. These work on the sample only.

## File format and limits

Format `PMVAULT2` uses the browser's Web Crypto implementation of PBKDF2-HMAC-SHA-256 with 600,000 iterations, a fresh random 128-bit salt, and a 256-bit AES-GCM key. Each authenticated frame has a distinct nonce made from a fresh 64-bit prefix and a frame counter, plus a 128-bit authentication tag. Additional authenticated data binds frames to their header and sequence. The encrypted manifest includes the schema, revisions, ancestry, history, records, file types, lengths, and SHA-256 digests. The file contains no password or plaintext encryption key.

Files are processed in 1 MiB chunks. SHA-256 checks handle one bounded file at a time. Browser Blob storage holds verified pieces while the app validates the complete backup. Only after confirmation are records and files installed in one IndexedDB transaction. Each file is limited to 32 MiB, structured metadata to 20 MiB, and a backup file to 256 MiB; the app shows these as 32 MB and 256 MB. The screens show progress and a **Stop** button. Device free space and browser memory can impose smaller practical limits.

The database migrates in place. Removed-record markers and revision ancestry remain available for later combining. The activity log records local event times. Device clocks, the recorded log, and SHA-256 values provide traceability within this application. A backup only goes back into the records it came from: your own records or the sample property.

## Offline export components

| Component | Purpose | License |
| --- | --- | --- |
| `storage.js` | IndexedDB, record revisions, authenticated backups, explicit restore and combine, and the Backup & sync screens | Original application code |
| `github-sync.js` | Upload and download of the encrypted backup through the GitHub API | Original application code |
| `export.js` | UTF-8 ZIP with per-file CRC-32, embedded-font U.S. Letter PDF with selectable text and page numbering | Original application code |
| `pdf-font.js` | Locally embedded Liberation Sans regular for PDF text | SIL Open Font License 1.1, see [LICENSE-Liberation.txt](LICENSE-Liberation.txt) |

PDF generation reports unsupported glyphs so names and terms can be preserved through the printable HTML path. The native PDF writer supports left-to-right text with the glyphs present in Liberation Sans. For a lease using complex scripts, use the printable HTML version and verify the generated pages.
