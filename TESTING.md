# Test results

Checked on Windows with desktop Chrome, throwaway browser profiles and made-up records. The November 19, 2026 run reported **154 passed, 0 failed, 0 skipped**. The count includes suite-level entries. Browser tests work through the app's own screens and use the real IndexedDB, service worker, Web Crypto, PDF and ZIP code.

## What the lease tests cover

- **The law behind the builder** (`lease-law-tests.cjs`). Every notice the law prescribes word for word is pinned by a digest, so an accidental edit fails the test. The rules that decide which notices apply are tested fact by fact: a house or condo owned by people, apartments, duplexes, owner-occupied homes, homes under fifteen years old, inside and outside the City of San Diego. Unanswered facts block the lease instead of being guessed.
- **The lease document** (`lease-document-tests.cjs`). A covered apartment built before 1978, an exempt house and a home outside the City are each built and read back. The tests check that each has every notice it needs and none it should not have, that money and dates are worked out as the lease states them, that every clause in the library produces clean wording, and that no configuration produces wording California voids. The finished PDF is parsed to confirm each notice prints at its required size: 12 points for the tenant-protection, City and daycare notices, 10 or more for bed bugs, 8 or more for Megan's Law and flood.
- **The PDF and web-page writers** (`document-tests.cjs`). Page breaks, boxed notices that never split, signature blocks that stay together, page numbers, the draft watermark, text that never leaves the margins, and the web-page fallback for names the PDF font cannot draw.
- **The six-step builder** (`lease-tests.cjs`). A complete lease is written through the real screens: the questions that decide which rules apply, the landlord and tenants, dates, rent, deposit limit, late fee, utilities, appliances, recommended and optional clauses, the owner's own clauses with warnings for wording California does not allow, disclosures, and the final review. The tests also cover leaving and returning to a draft, saving in the background, getting typed answers back after a save has failed, Fix buttons, deleting and restoring a draft, a draft carried over from the earlier lease tool, renewals and amendments. Every step is checked at phone, zoomed and desktop widths for touch-target size, contrast, labels and sideways scrolling, and for having no dropdowns.
- **Finished leases** (`lease-packets-tests.cjs`). Making a lease final writes the lease, its booklets, the owner's attachments and one ZIP in a single save. The tests then record signed copies one person at a time, check that the lease becomes the active lease with its reminders, add an amendment and a renewal, make a lease with a co-signer final, add a lease the owner already has, work through a deposit return, open records from the earlier lease tool, and confirm that damaged lease records in a backup are refused. One more test opens the app from a file on the computer, where the browser refuses to let a page read the booklet PDFs, and makes a lease final from the booklets' script copies; a missing or damaged copy stops the lease in plain words and writes nothing.

These tests show how the software behaves for the facts tested. They are not legal advice, and they do not replace an attorney's review of an unusual situation.

## Other checks in the same run

| Check | What was observed |
| --- | --- |
| Install and open offline | Installed the full cache, closed the browser and reopened the same profile with the server unavailable. All five sections and the sample PDF opened. |
| Set up a rental offline | Entered a property, tenant, $3,000 rent and a deposit through the setup form. The ledger showed the rent owed, the deposit held and no income. |
| Partial and full rent | Recorded $1,000 and $2,000 through the payment form. The amount owed fell to $2,000, then zero. |
| Write a lease offline | Opened the builder offline, made a lease final with its three bundled booklets and reached the signing page. |
| Receipts | Attached three images to one expense and read back their exact bytes. The ledger counted one expense. |
| Mortgage and escrow | Split principal, interest and escrow, and recorded a payment the lender made from escrow, without counting anything twice. |
| Refunds and corrections | Returned part of a rent payment on its own date. The original entry and a tax packet made earlier were unchanged. |
| Bank matching | Matched a CSV line to an existing payment. Importing the same file again added nothing. Checked a statement from its opening to its closing balance. |
| Year-end packet | Read the ZIP back: totals, monthly tables, receipts and checksums matched the ledger. |
| Encrypted backup | Backed up and restored on a second profile, including large binary files. A wrong password, a tampered file, a truncated file and a cancelled restore each left existing records untouched. |
| Two devices | Combined records from two devices, surfaced a conflicting edit and counted one month's rent once. |
| GitHub sync | Used simulated GitHub responses. Pasting the access key was the only thing entered: the key was remembered, the repository was found from it, and the app made and remembered the backup password. A second device was asked for that password once, and later syncs asked for nothing. Also covered: a key for several repositories, a key GitHub will not list repositories for, an expired key, changing and forgetting a key, the same set-up with the app opened from a file, encrypted upload, a rejected password and the check that the repository is private. |
| Storage failures | Simulated a full device and a rejected save. Saved records and typed text survived, and a retry saved once. |
| App updates | Upgraded an older database, applied a waiting update only after other tabs closed, and repaired a damaged cache. |
| Documents, tasks, inspections, email | Added and edited documents, completed and reopened tasks, finished a room-by-room inspection with photos, and cancelled an email hand-off without losing the draft. |
| Accessibility | Audited 50 screens and dialogs and 715 controls at 375, 390 and 430 pixel widths, desktop width and 200% zoom, for touch-target size, labels, contrast and sideways scrolling. Checked focus on opening and closing dialogs and the Escape key. |
| Windows launcher | Served every packaged file byte for byte and refused a request for a private file. |

## Speed observed

Validating five years of rent charges, 6,000 ledger entries and 10,000 document records took about 30 ms, and totalling one year about 3 ms. Writing 2,504 records to the browser database took 217 ms and reading them back 35 ms, while other browser checks were running. A sample lease is 6 pages and about 197 KB as a PDF.

## Running the tests

Run `node build-static.cjs` after changing any app file, then `node build-static.cjs --check`. The browser suites need `playwright-core` and desktop Chrome. Reading PDFs back needs Python with `pypdf` and `pypdfium2`. Set `PLAYWRIGHT_CORE`, `CHROME_PATH` or `PYTHON_PATH` if the defaults in the test files do not fit your computer.

```text
node --test --test-concurrency=2 accessibility-tests.cjs app-tests.cjs document-tests.cjs github-sync-tests.cjs launcher-tests.cjs lease-document-tests.cjs lease-law-tests.cjs lease-packets-tests.cjs lease-tests.cjs money-browser-tests.cjs money-tests.cjs pwa-tests.cjs records-browser-tests.cjs storage-tests.cjs
```

## What still needs a person

- Installing on a real iPhone, taking a photo with its camera, the Files and OneDrive pickers, Apple Mail, VoiceOver and Windows Narrator. Browser emulation covered phone layouts only.
- No email was actually delivered and no real signature was collected. The sample leases use made-up people.
- Sync was tested against simulated GitHub answers, never with a real access key. GitHub's real service was only asked, without a key, whether it accepts these requests from a browser page, and it does. The first time you paste a real key, check that the app names the right repository before you upload. If it asks for the repository name instead, type it; GitHub's documentation does not say whether a key lists only the repositories it was made for.
- The lease builder follows California and City of San Diego requirements as reviewed on November 18, 2026. [What it covers and where it stops](LEGAL.md) lists the sources. Have an attorney look over anything unusual.
- Check that **Offline ready** appears on the address where you install the app. Tests run on this computer cannot vouch for a different host. See [the installation guide](INSTALL.md) and [the money notes](MONEY.md).
