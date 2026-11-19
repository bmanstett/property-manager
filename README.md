# Property Manager

A buildless rental workspace for Windows and iPhone. Open the installed app to see rent status, expenses, deadlines and backup status for the selected property. The first launch opens **Juniper House**, a fictional property with its own dataset. Choose the property name in the top bar and select **Set up my rental** to start entering owner records.

## Using the app

- **Home** opens the records behind each amount. Choose a month to review its operating results or open a deadline to act on it.
- **Money** separates rent charges, cash receipts, deposit liability and operating expense. Link payments to household charges, retain receipt originals, match bank CSV rows, and reconcile a statement. **Prepare CPA packet** previews unresolved items before saving a versioned ZIP. [Financial behavior and IRS sources](MONEY.md)
- **Leases** saves drafts at each stage, evaluates a versioned California rule register and exports exact packet files. The draft assembler and the attorney-reviewed execution path have separate outputs. Record each signer’s returned evidence, then designate the executed copy. [Legal source register and package updates](LEGAL.md)
- **Documents** reviews selected files or folders before storing originals. Inspect names, metadata, hashes and duplicate warnings. PDF, supported image and text previews have a download fallback. Review file contents manually when collecting lease facts. The app performs no OCR, DOCX extraction or automated contract interpretation.
- **Tasks** covers reminders, maintenance, room inspections, photo comparisons and the tenant email outbox. Queue an email offline, review the exact recipients and attachment versions, then hand it to a mail app. Owner confirmation records actual sending. Calendar files are available for dated tasks and messages.
- **Backup & transfer** creates password-encrypted snapshots. Each device has an independent local database. Restore replaces one selected dataset after validation. Merge compares revisions and presents conflicts. [Backup, restore and device transfer](BACKUP.md)
- **Settings → GitHub sync** downloads or uploads an encrypted owner snapshot in your private data repository. Review changes and resolve conflicts before you sync a second device. [Connect your data repository](BACKUP.md#sync-personal-records-with-github)

## Delivery

The workspace root contains the complete source. The `dist` folder and `Property-Manager-static.zip` contain the installable public assets. HTTPS installation requires an initial connection. An owner can run the installed app without Node, a package manager, a subscription or a backend. [Windows, iPhone and static hosting](INSTALL.md)

The included GitHub Actions workflow builds the release and publishes its approved assets to GitHub Pages. [Publish on GitHub Pages](INSTALL.md#publish-on-github-pages)

The published release contains application files, public handouts and fictional demo data. The source allowlist excludes local inventories, rental records, exports and backup files. Owner records enter the private backup repository when the owner chooses GitHub sync.

## Implementation and licenses

| Source | Responsibility |
| --- | --- |
| `index.html`, `app.js`, `icons.js`, CSS | Navigation, property selection, setup, dashboard, dialogs, accessible controls and icons |
| `money.js` | Shared integer-cent ledger, scheduled obligations, bank matching, reconciliation, CSV and CPA reporting |
| `rules.js`, `leases.js`, `legal-assets/` | Versioned declarative rules, applicability review, draft generation, packet and signature history |
| `records.js` | Original-file review, metadata, inspections, maintenance and correspondence |
| `storage.js` | IndexedDB schema migration, revisions, merge, encrypted archive verification and atomic restore |
| `export.js`, `pdf-font.js` | Project-local selectable-text PDF and ZIP writers. PDF text uses locally bundled Liberation Sans under the SIL Open Font License. [Font license](LICENSE-Liberation.txt) |
| `manifest.webmanifest`, `sw.js`, `assets/` | Install metadata, offline cache, original icon design and bundled house illustration |
| `build-static.cjs`, `sw-template.js` | Optional maintainer tooling for producing a byte-verified static release |

Browser storage and application caching are separate. Live records use the device and browser’s access controls. Backup encryption covers metadata and files. The local history, hashes and owner attestations support review. Independent legal proof of service or identity requires appropriate external evidence.

The frontend has no third-party JavaScript runtime. The public EPA and San Diego disclosure PDFs retain original agency credits. The source register lists their origins and hashes. Default UI typefaces use locally available system fonts. The bundled house illustration was produced with built-in ImageGen for the synthetic property. Its art direction was a three-quarter California Craftsman bungalow and palms, drawn in fine ivory engraving on a forest-green field, with clear space for property information on the left. File: `assets/juniper-house.png`.

## Verification

[Acceptance test results and device limits](TESTING.md) describe the executed checks. The optional development tests use Node’s built-in test runner, Playwright Core and desktop Chrome. Runtime application files never load these tools.
