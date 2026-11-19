# Money and CPA records

Property Manager keeps each household’s monthly rent obligation separate from its receipts. An opening refundable deposit carries a liability forward. Its effective date comes from the balance-as-of field when supplied, or the setup date. The initial entry contributes zero income and zero cash movement.

## Posting and reviewing entries

- **Record payment** records the cash receipt date. Enter amounts against one or more open months, then review the unapplied balance. In **Money → Rent → Unapplied credit**, select a payment to apply its remaining credit. Reopening the app catches up monthly charges through the next billing month.
- **Add expense** records the vendor, accounting date, total, account, business purpose, category splits, and attachments. A single split can use the entire amount. Multiple split amounts must total the invoice. A split can belong to another property in the same dataset.
- **Photograph receipt** accepts the device camera, photo library, or a selection of images and PDFs. Originals are retained in the receipt inbox as each file commits. Close and reopen the expense form during the same session to resume its text. After a restart, select an inbox item to finish posting. The expense can include several originals.
- Open a posted expense to **Correct categories** or **Link receipts**. Each category correction retains its earlier values, reason, and time. Use **Record reversal** for a full dated correction. Vendor refunds can also be posted as separate dated receipts against expense categories. A write-off requires an explicit charge allocation and reason.
- Open the original rent receipt and choose **Refund or return rent**. Enter the actual return date and amount, identify any rent allocations to reopen, and document the reference. You can return part of a receipt, multiple times, up to the remaining allocated and unapplied amounts. The original receipt stays in its receipt year. The return appears as a separate entry in its actual year. Cross-year returns are also listed for CPA review.
- A documented rent change updates eligible future obligations under their existing monthly IDs. Ending a tenancy cancels unallocated obligations due after the confirmed end date. Extending the tenancy can reinstate a canceled future period. Open **Money → Rent → Rent schedule history** for each affected period, previous and revised amounts, effective date and reason. Historical or payment-linked charges require separate review before a schedule edit can proceed.
- **Money → Deposits** records receipts, refunds, adjustments, and applications. A rent application must allocate the exact liability reduction to a charge. It recognizes income without a second cash receipt. For a retained amount with uncertain tax treatment, select the review classification.
- For a mortgage, choose **Mortgage payment** and split the total among principal, interest, and escrow. Record an actual tax or insurance payment from escrow as **Escrow tax / insurance disbursement**. Use **Credit-card purchase** when recognizing an expense paid by card, and the **Credit-card balance payment** category for the later payment of the bill.
- **Reports → Reporting details** retains ownership, rental-use and personal-use data for the chosen year and property. The export presents full property amounts and provides these facts for the CPA’s allocation. Capital costs, insurance recoveries, reimbursements, and uncertain classification remain visible for review.

## Bank statements

Import a CSV from **Money → Reconciliation**. Select a date format and map the date, description, signed dollar amount, and optional unique bank identifier. An inflow is positive. Use a single account per file. The preview validates every line before import. Files can contain up to 5,000 activity rows and 2 MiB.

Each line has a stable identity based on property, account, and the supplied bank identifier, or on the file hash and source row. Repeating the same import skips entries already present. A changed CSV without bank identifiers may represent the same activity under new file identities. Review the possible duplicates before matching. Matching links a bank line to a separately posted ledger entry. An owner confirmation is required even for identical amounts and dates.

The reconciliation form selects a statement period and account. Check the cleared ledger entries and enter the actual opening and closing balances. A difference requires an explanation. The reconciliation retains the cleared IDs, imported net, balances, and difference as a snapshot. A period that overlaps an existing statement for the account is rejected.

## Reporting assumptions and source register

The installed financial mapping was reviewed November 18, 2026. It models an individual residential rental on a calendar-year cash basis. Review entity-specific reporting, personal use, capital and depreciation decisions, income timing questions, and allocations with the CPA.

| Source | Verified scope | Application behavior |
| --- | --- | --- |
| IRS Topic 414, Rental income and expenses | Rental receipts, refundable deposits, and operating expense treatment | Separates refundable deposits and income. [IRS Topic 414](https://www.irs.gov/taxtopics/tc414) |
| IRS Publication 527, 2025 edition, chapter 1 | Advance rent, costs paid by a tenant, uncollected rent, repairs, and improvements | Books advance rent in its receipt year, separately displays tenant-paid costs and their income, and keeps operational write-offs outside cash-basis expenses. [2025 Publication 527](https://www.irs.gov/pub/irs-prior/p527--2025.pdf) |
| IRS Schedule E, 2025 edition, Part I | Rent on line 3, expense categories on lines 5–19, fair rental and personal-use days | Provides a fixed-year category crosswalk. Other years use an explicitly provisional crosswalk. [2025 Schedule E](https://www.irs.gov/pub/irs-prior/f1040se--2025.pdf) |
| IRS Schedule E instructions, 2025 edition | Auto/travel, interest, repairs, improvements, personal use, and depreciation | Preserves supporting detail for CPA treatment. Depreciation requires a CPA-approved entry, and mileage records carry the trip facts. [2025 Instructions for Schedule E](https://www.irs.gov/pub/irs-prior/i1040se--2025.pdf) |

The IRS Schedule E page and instructions available during research pointed to the 2025 edition. The app labels the 2026 crosswalk provisional. It also labels other years provisional unless their own mapping has been reviewed. Each retained report identifies the version used. [IRS Schedule E index](https://www.irs.gov/forms-pubs/about-schedule-e-form-1040)

## CPA ZIP

**Prepare CPA packet** lets you choose the property and calendar year, inspect outstanding questions, and select supporting files. A preliminary packet includes a review list. A property’s transaction splits, monthly results, tax categories, bank statements, deposits, capital costs, mortgage components, travel, and ownership/use information have dedicated CSVs. Monetary CSV columns use signed integer cents. The annual summary is a selectable-text U.S. Letter PDF.

The report distinguishes the operating result from checking/cash movement. Cash movement recognizes the mortgage payment, including escrow funding, and the later payment of a credit-card balance. The operating expense subtotal recognizes eligible underlying costs. It excludes principal, internal transfers, and capital purchases. Accumulated depreciation and ownership/use adjustments remain separate.

The packet includes linked financial evidence by default. Unrelated tenant files stay outside the packet. Owners can explicitly add other retained financial files in review. The archive manifest identifies its contents and a fingerprint of source record revisions. A retained immutable ZIP can be downloaded again from **Reports**. Subsequent corrections produce a separate snapshot.

## Verification

Run `node --test money-tests.cjs money-browser-tests.cjs` from the source directory when maintaining the app. The browser suite needs Chromium and Playwright Core. Ordinary desktop and iPhone use requires neither. The suites exercise actual IndexedDB, receipt bytes, offline navigation, CSV import and matching, statement balancing, expense classification corrections, ZIP download, and snapshot retrieval. Decimal arithmetic, month-end charge dates, partial and advance rent, opening deposits, refunds, splits, escrow, card payments, CSV safety, and annual totals also have direct tests.

On the development computer, one synthetic run validated five years of obligations, 6,000 expense entries, and 10,000 document metadata records in about 29 ms, then aggregated one reporting year in about 3 ms. This measures the in-memory financial checks. The browser run used a 390-pixel Chromium viewport. Camera hardware, iPhone Files, Safari’s Home Screen storage, and the share sheet still require device testing.
