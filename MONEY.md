# Money and CPA records

The Money section keeps what your tenant owes each month separate from what they have paid, so you can always see who owes what. A security deposit is tracked as the tenant's money, never as income, until you keep or return it.

## Everyday entries

- **Record rent** asks for the amount, the date the money reached you and how it was paid. The amount is filled in from what is owed and applied to the oldest unpaid month first. **More options** holds the account it went into, a note, and **Choose months yourself** for a payment meant for a particular month. Anything left over is kept as a credit toward future rent. It appears on the **Rent** tab under **Credit not yet applied**, where you can apply it to a month.
- **Add expense** asks who you paid, how much, when and what it was for. Pick a category pill, or **Not sure** and let your CPA decide. **More options** covers the less common cases: paying by credit card, splitting one bill between categories, miles driven, and the install date of a large purchase.
- **Snap a receipt** takes a photo or accepts a saved file. The original is stored the moment you choose it, so you can fill in the details later. One expense can hold several receipts.
- **Other entry** lists the things you record only now and then: a mortgage payment (split into principal, interest and escrow), a refund from a vendor, other money in, a bill your tenant paid for you, tax or insurance your lender paid from escrow, a depreciation figure from your CPA, a security deposit change, and forgiving unpaid rent.

## Looking things up and fixing them

- **Activity** lists everything recorded in the year. Open a line to see it in plain words. From there, **Change category** keeps the earlier category in the history, **Add a receipt** attaches one, **Undo this entry** adds an opposite entry and keeps the original, and **Undo and enter again** opens a new form with the same details. On a rent payment, **Refund rent** records money you gave back, on the date you gave it.
- **Rent** shows each month's charge and whether it is paid. **Rent changes** lists every change with its date and reason. To change the rent, choose **Change rent** on Home. Months already paid are never repriced.
- **Deposit** shows what you hold for each tenant, with **Deposit received**, **Return deposit** and **Other change**. Applying part of a deposit to unpaid rent counts as income without a second cash receipt.
- Nothing is ever erased. A correction is a new dated entry, so a packet you already sent to your CPA still matches the records behind it.

## Bank statements

The **Bank** tab is optional. It checks your records against your bank in three steps.

1. **Import your bank file.** Download a CSV from your bank's website. The app works out which columns hold the date, description and amount and shows a preview; choose **Columns look wrong? Change them** if it guessed wrong. Use one account per file. The preview checks every line before anything is saved. A file can hold up to 5,000 lines and 2 MiB.
2. **Match transactions.** Each bank line is matched to an entry you recorded. You confirm every match, even when the amount and date are identical. Importing the same file again adds nothing twice.
3. **Check the statement balance.** Pick the statement period, tick the entries that appear on it and enter the opening and closing balances. A difference needs an explanation. A saved check cannot be changed later, and a period that overlaps an earlier check for the same account is refused.

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

**Tax time → Year-end packet for my CPA** asks for the tax year, shows the totals and a short list of things to double-check, and lets you choose which receipts and documents to include. You can create the packet with open questions; they are listed inside it for your CPA. **Ownership and rental days** on the same tab holds the facts your CPA needs to divide the figures. A property’s transaction splits, monthly results, tax categories, bank statements, deposits, capital costs, mortgage components, travel, and ownership/use information have dedicated CSVs. Monetary CSV columns use signed integer cents. The annual summary is a selectable-text U.S. Letter PDF.

The report distinguishes the operating result from checking/cash movement. Cash movement recognizes the mortgage payment, including escrow funding, and the later payment of a credit-card balance. The operating expense subtotal recognizes eligible underlying costs. It excludes principal, internal transfers, and capital purchases. Accumulated depreciation and ownership/use adjustments remain separate.

The packet includes linked financial evidence by default. Unrelated tenant files stay outside the packet. Owners can explicitly add other retained financial files in review. The archive manifest identifies its contents and a fingerprint of source record revisions. Every packet you make is kept and can be downloaded again under **Packets you have made**. Subsequent corrections produce a separate snapshot.

## Verification

Run `node --test money-tests.cjs money-browser-tests.cjs` from the source directory when maintaining the app. The browser suite needs Chromium and Playwright Core. Ordinary desktop and iPhone use requires neither. The suites exercise actual IndexedDB, receipt bytes, offline navigation, CSV import and matching, statement balancing, expense classification corrections, ZIP download, and snapshot retrieval. Decimal arithmetic, month-end charge dates, partial and advance rent, opening deposits, refunds, splits, escrow, card payments, CSV safety, and annual totals also have direct tests.

On the development computer, one synthetic run validated five years of obligations, 6,000 expense entries, and 10,000 document metadata records in about 29 ms, then aggregated one reporting year in about 3 ms. This measures the in-memory financial checks. The browser run used a 390-pixel Chromium viewport. Camera hardware, iPhone Files, Safari’s Home Screen storage, and the share sheet still require device testing.
