# Acceptance results

Verified on Windows with desktop Chrome, disposable browser profiles and synthetic records. The November 18, 2026 release run reported **65 passed, 0 failed, 0 skipped**. The count includes suite-level test nodes. Browser tests operated through the application forms and used the actual IndexedDB, service worker, Web Crypto, PDF and ZIP implementations.

The lease tests exercised adding, editing, ordering and removing clauses, saving and reopening drafts, extracting the PDF and HTML from the actual packet ZIP, missing reviewed-contract references, amendments, historical package upgrades and the printable HTML path for unsupported scripts. Separate tests checked the TPA notice at 12 points, bedbug notice at 10 points or larger, flood coverage with and without a known designation, the unchecked refrigerator election, official handout hashes and conditional rule inputs. These assertions establish the behavior of the preparation software for the tested facts. Property-specific legal review remains a signing step.

GitHub sync tests used two browser workspaces and simulated GitHub API responses. They exercised encrypted upload, recovery of an original file on another device, password rejection, private repository checks, concurrent changes and cleanup of the credentials entered in the form.

| Requested check | Executed observation |
| --- | --- |
| 1. Install and cold-open offline | Installed the complete cache, closed Chromium and reopened the same profile in a new browser process with the server unavailable. All five workspaces and the original sample PDF opened, including workspaces first visited offline. |
| 2. Existing tenancy and opening deposit | Set up a $3,000 monthly schedule and $2,400 opening refundable deposit. The ledger showed $3,000 owed, $2,400 held and zero income. |
| 3. Partial and full rent | Submitted $1,000 and $2,000 receipts through the payment form. The outstanding balance fell to $2,000, then zero. Rent income totaled $3,000. |
| 4. Refundable deposit | Recorded a separate deposit and checked cash, liability and rent totals independently. Tested later application against rent. |
| 5. Advance rent | Allocated a December receipt to January’s obligation. December’s cash-basis year included the receipt. |
| 6. Imported bank payment | Matched a CSV line to an existing receipt. Repeating the CSV retained one bank line and one receipt. |
| 7. Three receipt images | Attached three image originals to one offline expense and verified their bytes. The ledger counted one expense. |
| 8. Mortgage and escrow | Split principal, interest and escrow. Verified actual escrow disbursement and card settlement classifications without counting both funding and expense. |
| 9. Returns and corrections | Confirmed full and partial returns preserve the original receipt and use the refund date. A $126.75 partial return reopened that amount. Prior exported ZIP bytes were unchanged. |
| 10. Unresolved legal facts | Generated and reopened an expressly marked draft PDF and ZIP offline. Unknown jurisdiction and applicability facts remained unresolved in review. |
| 11. Amendment history | Created an amendment after designating a reviewed, signed packet operative. Verified the earlier packet’s hash and revision. |
| 12. Cancel mail handoff | Canceled the handoff and simulated a rejected native share. Retained Ready status. A late share completion after the review dialog closed also preserved status. |
| 13. Partial signature | Recorded one returned signer out of two and verified partially signed status. Added the second signer with evidence, then designated the operative copy. |
| 14. Annual CPA reconciliation | Checked transaction detail, split and monthly tables against annual totals. Reconciled a statement from $1,250 to $4,450. Read ZIP members, checked CRCs and retrieved the exact retained export. |
| 15. Encrypted backup round trip | Verified binary originals, relationships and generated packets through encrypted export, validation and restore, including a multi-frame binary file. |
| 16. Rejected damaged backups | Tested wrong password, tampering, truncation, wrong dataset, cancellation and interrupted commit. Existing records survived each failure. |
| 17. Device merge | Replayed an import, exposed simultaneous edits, resolved a conflict and counted independently generated monthly rent once. Tested a concurrent allocation against a proposed schedule change. |
| 18. Storage failure and retry | Injected a quota failure and a rejected save. Existing committed data and form input survived. A retry saved once. Rapid repeated submission also produced one record. |
| 19. Updates | Upgraded a populated version 1 database, retained original bytes, exercised a staged service-worker update, and verified cache failure and repair. |
| 20. Mobile/accessibility/documents | Checked 375, 390 and 430 CSS-pixel mobile widths, desktop layout and native Chrome 200% zoom. Audited 24 screen/dialog states and 457 visible controls for touch size, accessible names, solid-background contrast, and overflow. Checked modal focus, keyboard traversal, Escape restoration and status announcements. Rendered all three generated sample lease pages and the sample CPA summary, checked selectable text, Letter dimensions, signature pagination and footer placement. |

Additional end-to-end checks exercised a future rent change, move-out, reinstatement under the original monthly charge ID, and creation of a successor household. Cross-property and sample/owner scope checks covered interrupted file imports, delayed inspections and email handoffs. The local Windows launcher served every packaged asset byte-for-byte and refused requests for the private inventory.

## Observed performance

One combined run validated five years of expected charges, 6,000 financial entries and 10,000 document metadata records in about 30 ms. Calendar-year aggregation took about 3 ms. A separate IndexedDB fixture with 2,504 records took 369 ms to commit and 40 ms to read while other browser checks were running. These measurements describe that Windows run.

## Repeat the checks

Run `node build-static.cjs` after a source change, then `node build-static.cjs --check`. For the test suite, provide `playwright-core`, a desktop Chrome executable and the PDF inspection dependencies described in the individual test files. `PLAYWRIGHT_CORE` and `CHROME_PATH` can override the local development defaults.

```text
node --test --test-concurrency=2 accessibility-tests.cjs app-tests.cjs github-sync-tests.cjs launcher-tests.cjs lease-tests.cjs lease-notices-tests.cjs rules-tests.cjs money-browser-tests.cjs money-tests.cjs pwa-tests.cjs records-browser-tests.cjs storage-tests.cjs
```

## Device and review limits

Physical iPhone Safari/Home Screen installation, on-device camera capture, Files/OneDrive transfer dialogs, Apple Mail, VoiceOver, Windows Narrator and device storage eviction still require hands-on verification. Browser emulation exercised mobile layout and cancellation behavior. No actual tenant email was delivered, and no real signatures or property-specific legal exemptions were inferred. The sample packets used synthetic parties.

Verify **Offline ready** on the intended installation origin. Source hashes and local browser test results cannot establish the behavior of a different HTTPS host. Setup, source and CPA decision boundaries are recorded in [the installation guide](INSTALL.md), [the legal register](LEGAL.md), and [the reporting notes](MONEY.md).
