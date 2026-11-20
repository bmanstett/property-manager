# Property Manager

A private rental workspace for Windows and iPhone. It keeps rent, expenses, leases, documents and to-dos for your rental, works without an internet connection, and stores everything on your own device.

The first launch opens **Juniper House**, a sample rental with made-up data, so you can look around. Choose **Set up my rental** on the banner to start your own records.

## What each section is for

- **Home** shows today at a glance: this month's rent, what needs your attention, and one-tap shortcuts for the things you do most.
- **Money** tracks rent, bills, the security deposit and taxes. Record a rent payment, add an expense or snap a receipt, match your bank statement, and prepare a year-end packet for your accountant. [How the numbers work](MONEY.md)
- **Leases** writes a complete California lease for a home in the City of San Diego. Answer six short steps, pick from recommended clauses, add your own, watch the real document take shape, then download the PDF and record the signed copy. [What the lease builder covers](LEGAL.md)
- **Documents** keeps your files, receipts and photos, with the originals preserved.
- **Tasks** holds reminders, repairs, move-in and move-out inspections with photos, and emails to your tenant.
- **Backup** saves a password-protected copy of everything, restores it on another device, and can keep an encrypted copy in your own private GitHub repository. [Backup, restore and moving between devices](BACKUP.md)

## The lease builder

1. **Home**: the address, the kind of home, when it was built and who owns it. From these the builder works out which California and San Diego rules apply and tells you in plain words.
2. **People**: the landlord, where notices go, and the tenants.
3. **Rent & term**: dates, rent, deposit (checked against California's limit), how rent is paid, utilities and appliances.
4. **Rules**: recommended clauses as cards you switch on or off (pets, smoking, renters insurance, guests, parking and more), each with its exact wording. Add your own clauses; the builder warns about wording California does not allow.
5. **Disclosures**: the notices the law requires are added for you, with a few yes-or-no questions.
6. **Review & sign**: a checklist of anything missing, then **Finalize lease**. You get the lease as a PDF with the required handouts, and a simple page to record the signed copy.

The builder follows California and City of San Diego requirements as reviewed on November 18, 2026. It is not legal advice. [Sources, coverage and limits](LEGAL.md)

## Installing

The ready-to-use app is in `dist/` and `Property-Manager-static.zip`. It needs only a browser: no account, subscription or server. On Windows, double-click **Open Property Manager.cmd**. [Windows, iPhone and hosting instructions](INSTALL.md)

Your records stay in the browser on your device. Nothing is uploaded unless you make a backup or turn on sync. Browsers can clear stored data when a device runs low on space, so keep a recent backup somewhere else.

## For maintainers

The app is plain HTML, CSS and JavaScript with no build step and no third-party runtime code.

| Files | Responsibility |
| --- | --- |
| `index.html`, `app.js`, `icons.js`, `style.css`, `accessibility.css` | Navigation, Home, setup, property and tenant details, settings, help, search |
| `ui.js`, `ui.css` | Shared design tokens and form components (fields with help text, pill choices, switches, notes) |
| `money.js`, `money.css` | Integer-cent ledger, rent schedule, payments, expenses, bank matching, reconciliation, tax packet |
| `lease-law.js` | Statutory notice texts, the rules that decide which apply, bundled handouts, source list |
| `lease-clauses.js` | Recommended and optional clause library, custom-clause warnings |
| `lease-document.js` | Builds the lease document from the answers |
| `leases.js`, `lease.css` | Leases workspace and the six-step builder |
| `lease-packets.js`, `lease-sign.css` | Finalized leases, signing records, history, deposit return, import checks |
| `records.js`, `records.css` | Documents, tasks, inspections, tenant email |
| `storage.js`, `github-sync.js`, `backup.css` | Local database, revisions, encrypted backup and restore, merge, GitHub sync |
| `export.js`, `pdf-font.js` | PDF and ZIP writers. PDFs embed Liberation Sans under the SIL Open Font License. [Font license](LICENSE-Liberation.txt) |
| `manifest.webmanifest`, `sw.js`, `sw-template.js`, `assets/`, `legal-assets/` | Install metadata, offline cache with integrity checks, icons, bundled public handouts (each PDF with a generated `.pdf.js` copy for when the app is opened from a file) |
| `build-static.cjs` | Produces and verifies `dist/`, `sw.js`, the handout script copies and the ZIP |

Run `node build-static.cjs` after changing any app file, then `node build-static.cjs --check`. The included GitHub Actions workflow publishes `dist/` to GitHub Pages. Tests and what they cover are in [TESTING.md](TESTING.md).

The sample house illustration (`assets/juniper-house.png`) was generated for the fictional sample property. The EPA, California Department of Public Health and San Diego Housing Commission handouts keep their original credits.
