# The lease builder and the law

Law review **CA-SD 2026.11**, completed November 18, 2026. The lease builder writes a complete residential lease for a home in the **City of San Diego, California**. It applies the state and City rules below for you and shows what it added and why. For a home outside the City it applies California law only and tells you so.

This is software, not a law firm. It follows the requirements listed here as they read on the review date. For anything unusual (subsidized or deed-restricted housing, mobilehomes, a home outside the City of San Diego, a dispute already under way), have a California attorney look over the lease before anyone signs.

## How the wording was checked

Every notice whose wording is set by law is stored once, in `lease-law.js`, and was compared on November 18, 2026 with the official publisher's text:

- **California codes** on the Legislature's site (leginfo.legislature.ca.gov). The stored text of each statutory notice was matched to the official page character for character.
- **San Diego Municipal Code** PDFs from the City Clerk (docs.sandiego.gov): Chapter 9, Article 8, Division 7 (edition 3-2024), Division 9 (1-2024) and Division 12 (8-2025), plus Chapter 6, Article 6, Division 7 (6-2022).
- **Federal lead rules** on eCFR (40 CFR part 745, subpart F).

`lease-law-tests.cjs` fails if any of those texts changes by a single character, so a change can only be deliberate. `lease-document-tests.cjs` reads the finished PDF and checks that each notice is printed at its required size.

## What goes into every lease

| Requirement | What the builder does | Source |
|---|---|---|
| Owner, manager and payment details | Prints the name, phone number and street address of the person who manages the home and accepts notices and legal papers, who rent is paid to, and how. Paying in person is offered only with the days and hours, which are required when cash is accepted. Will not finalize without them. | [Civil Code § 1962](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1962.) |
| A way to pay that is neither cash nor electronic | Keeps a check or money order among the accepted methods. No fee for paying by check. | [Civil Code § 1947.3](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1947.3.) |
| Security deposit | Limits the deposit to one month's rent (two for an individual owner with no more than two rental properties and four units, never for a service member). States what the deposit may be used for, the move-out inspection, the 21-day itemized refund, photographs, and electronic refunds. Never calls any charge non-refundable. A renewal records the deposit you already hold instead of asking for it again; a deposit collected before July 1, 2024 may stay above today's limit (§ 1950.5(c)(6)). | [Civil Code § 1950.5](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1950.5.) |
| Late and returned payments | One flat late charge described as an estimate of cost. The builder suggests about 2 percent of the rent (at least $25) and warns when the charge is more than 5 percent. When a weekend or holiday moves the day rent is due, the late deadline moves with it. Returned payments: $25, then $35. | [Civil Code §§ 1671(d)](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1671.), [1719](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1719.) |
| Stove and refrigerator | The landlord provides both. If the tenant asks to bring a refrigerator, the lease prints the statutory statement as an unchecked box for the tenant to mark, with the 30-day right to change back. | [Civil Code § 1941.1](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1941.1.) (AB 628, in force January 1, 2026) |
| Landlord's entry | Entry only for the listed reasons, written notice, 24 hours presumed reasonable (six days by mail), business hours. | [Civil Code § 1954](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1954.) |
| Megan's Law notice | Printed word for word in every lease. | [Civil Code § 2079.10a](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=2079.10a.) |
| Flood information | The hazard-lookup address, the insurance recommendation and the adequacy statement in every lease; the flood-zone statement when you say you know of one. | [Government Code § 8589.45](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=8589.45.) |
| Bed bug information | The statutory information sheet as an attachment, in at least 10-point type, with how to report. | [Civil Code § 1954.603](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1954.603.) |
| Mold booklet | Attaches the state health department's booklet and records the tenant's receipt; prints your description of any mold you know about. | [Health & Safety Code §§ 26147–26148](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=HSC&sectionNum=26148.) |
| Smoking | Names where smoking is prohibited. | [Civil Code § 1947.5](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1947.5.) |
| Signed copy to the tenant | States the 15-day duty and creates a reminder when you record the signed lease. | Civil Code § 1962(a)(4) |

## Rent cap and just-cause rules

The builder works out which rules apply from a few facts: the kind of home, whether another unit shares the lot, when it was built, who owns it, whether you live there, and whether it is inside the City.

| Your situation | Result | What the lease prints |
|---|---|---|
| A house or condo that can be sold on its own, owned by people, a family trust or an LLC of people | Exempt from the state rent cap and from state and City just-cause rules, **only because the lease contains the exemption statements** | The state statement ([Civil Code §§ 1946.2(e)(8), 1947.12(d)(5)](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1946.2.)) and the City statement ([SDMC § 98.0703(l)](https://docs.sandiego.gov/municode/MuniCodeChapter09/Ch09Art08Division07.pdf)), word for word |
| Built within the last 15 years (and not a house or condo covered by the first row) | Exempt for now. The 15 years run from the date on the certificate of occupancy. Without that date the builder counts from January 1 of the year built, so the exemption is never stretched | A plain statement with the date the exemption ends, and a warning if that date falls inside the lease or within two years of a month-to-month start |
| A duplex where you live in the other unit | Exempt while you live there | A plain statement |
| A room in your home, or an ADU behind it | Just-cause rules do not apply when the tenant shares your kitchen or bathroom, or when you live on the property and rent out no more than two units or bedrooms there. The builder asks; it does not assume. The state rent cap still applies, unless the home qualifies under the first row | A plain statement, or the exemption statements |
| Everything else: apartments, a duplex you do not live in, a house with a second unit on the lot, any home owned by a corporation, REIT or LLC with a corporate member | Covered. Rent increases are capped at 5 percent plus inflation, never more than 10 percent, in any 12 months. Inside the City a legal reason is needed to end the tenancy from its first day | The City notice ([SDMC § 98.0705](https://docs.sandiego.gov/municode/MuniCodeChapter09/Ch09Art08Division07.pdf)) and the state notice ([Civil Code § 1946.2(f)](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1946.2.)), each in 12-point type, with the City's Tenant Protection Guide attached. A fixed term of three months or less is outside the City ordinance while it lasts; the notice and Guide are still included because the ordinance applies if the tenant stays on |

Three points the builder handles that are easy to miss:

- **A new house or condo.** The first row is checked before the second: a new house or condo owned by people gets the exemption statements from the start, so it stays exempt after it turns 15.
- **Moving in yourself.** For a covered home, you can later end the tenancy to live there yourself or house a close family member only if the lease says so (state leases from July 1, 2020; City leases from June 24, 2023). The recommended clause "Keep the right to move in yourself" is on by default for covered homes owned by people.
- **Both notices.** Inside the City, the City ordinance governs when a covered tenancy can end. The builder prints the City notice, which is required, and the state notice as well, with a sentence explaining that the City's rules apply from the start of the tenancy.

## City of San Diego items

| Requirement | What the builder does | Source |
|---|---|---|
| Tenant protection notice and Guide, or the City exemption statement | See the table above. | [SDMC §§ 98.0703, 98.0705](https://docs.sandiego.gov/municode/MuniCodeChapter09/Ch09Art08Division07.pdf) |
| Family daycare notice | Printed word for word, in 12-point type, in every lease for a home in the City. | [SDMC § 98.0903](https://docs.sandiego.gov/municode/MuniCodeChapter09/Ch09Art08Division09.pdf) (in force January 1, 2024) |
| Passing City utility bills to the tenant | The City bills trash collection to the owner on the property-tax bill. If the tenant is to pay for trash, or for water or sewer on an account in your name, the lease says the tenant reimburses the actual charge with nothing added, prints the City's "Equitable Fees and Right to Notice" paragraph, and promises the bill within 10 days of a written request. | [SDMC §§ 98.1203–98.1205](https://docs.sandiego.gov/municode/MuniCodeChapter09/Ch09Art08Division12.pdf) (in force August 17, 2025) |
| Short-term rentals | The subletting clause rules out vacation rentals unless you agree in writing. | SDMC Chapter 5, Article 10 |

Reminders the builder shows you that are **not** part of the lease: the City's yearly Rental Unit Business Tax (due March 1); for homes built before 1978, the City's visual lead-paint check each time a tenant moves out ([SDMC § 54.1009](https://docs.sandiego.gov/municode/MuniCodeChapter05/Ch05Art04Division10.pdf)); recycling instructions at move-in for apartment buildings and association-served homes ([SDMC § 66.0706(d)](https://docs.sandiego.gov/municode/MuniCodeChapter06/Ch06Art06Division07.pdf)).

## Asked only when it applies

| Situation | What the builder does | Source |
|---|---|---|
| Home built before 1978 | Adds the federal Lead Warning Statement, your disclosure, the tenant's acknowledgment and signature lines, and attaches the EPA pamphlet. | [40 CFR §§ 745.107, 745.113](https://www.ecfr.gov/current/title-40/chapter-I/subchapter-R/part-745/subpart-F) |
| Regular pest control service | States it and reminds you to attach the pest company's notice. | [Civil Code § 1940.8](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1940.8.) |
| Gas or electric meter that also serves another area | Prints the disclosure and the arrangement you describe. | [Civil Code § 1940.9](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1940.9.) |
| A death in the home within three years | Prints your statement. Never mention HIV or AIDS. | [Civil Code § 1710.2](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1710.2.) |
| Demolition permit applied for | Prints the disclosure with your dates. | [Civil Code § 1940.6](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1940.6.) |
| Former military ordnance site within a mile | Prints the disclosure. | [Civil Code § 1940.7](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1940.7.) |
| Tenant uses a housing voucher | States that HUD's Tenancy Addendum is attached and controls; reminds you to attach it. | 24 CFR § 982.308 |

The builder flags these but does not write the paperwork: a methamphetamine or fentanyl contamination order (Health & Safety Code § 25400.28), separately billed submetered water (Civil Code § 1954.204 and SDMC § 67.0605), pesticides you apply yourself on a schedule (Civil Code § 1940.8.5), the rent-reporting offer that larger or corporate landlords must make (Civil Code § 1954.07), and a lease negotiated mainly in Spanish, Chinese, Tagalog, Vietnamese or Korean, which needs a translation before signing (Civil Code § 1632).

## Renewals and amendments

A renewal is written for a tenant who already lives in the home. It keeps the original move-in date, records the deposit already held, leaves out the move-in terms (first payment, key handover, what happens if the home is not ready) and repeats every required notice. An amendment is one page that changes the parts you name and leaves the rest of the lease in force.

## Recommended clauses and your own clauses

The Rules step offers a library of clauses as cards you switch on or off, each with a one-line explanation and its exact wording: pets, smoking, subletting, renters insurance, guests, how the deposit comes back, changes to the home, keys, moisture and mold, pests, alarms, parking, storage, quiet hours, association rules, pool, grills, e-bikes, satellite dishes, waterbeds, a co-signer, a move-in discount, what happens if the home is not ready, time away, changing roommates, selling the home, mediation, attorney's fees, the credit-reporting notice ([Civil Code § 1785.26](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1785.26.)) and the owner move-in right. Only the clauses that fit the home are shown.

You can add your own clauses in your own words. The builder warns, without blocking you, when wording looks like something California does not allow: a non-refundable deposit or fee, a waiver of tenant rights, "as is", cash-only rent, entry without notice, limits on children, blanket "not liable" language, daily late fees, automatic deposit forfeiture, mandatory professional cleaning, fees for notices or for paying by check, and similar terms (Civil Code §§ 1942.1, 1946.1, 1947.3, 1950.5, 1953, 1954 and others). The lease itself never uses that wording; a test checks every configuration.

## How this compares with Avail

Avail builds a lease from the property's address in a short series of steps, turns plain choices into clauses, adds local attachments, and lets paying customers add clauses of their own. This builder follows the same shape: six short steps, choices that write the wording, a live view of the real document, and a clause library. It differs in three ways. Custom clauses and the whole library are always available. Each required item names the law it comes from and the date it was checked. And City of San Diego requirements are built in alongside the state ones. No Avail lease wording was used.

## Coming changes

- **April 1, 2027:** landlords must give rental applicants a written pet policy and link to it in online listings (SB 1296, Statutes of 2026, chapter 1025). The Pets section of your lease can serve as that policy. The builder shows a reminder.
- **January 1, 2030:** the state rent cap and just-cause sections are scheduled to expire unless the Legislature extends them.
- The City was considering an ordinance limiting rental fees in 2026. It had not been adopted on the review date.

When the law changes, the texts and rules in `lease-law.js` are updated in a new release, with a new review version and date. Leases you have already finalized keep their original files.

## Handouts bundled with the app

| File | What it is | SHA-256 |
|---|---|---|
| `legal-assets/sdhc-guide-en.pdf` | City of San Diego Tenant Protection Guide, San Diego Housing Commission, updated July 2025, 20 pages. [Source](https://sdhc.org/housing-opportunities/tenant-protections/) | `72ad0617badb9ef9b544c6d631e5984c198f937a984a614991f6cf9e56a4c5bc` |
| `legal-assets/cdph-dampness-mold-en.pdf` | Information on Dampness and Mold for Renters in California, California Department of Public Health, 4 pages. [Source](https://www.cdph.ca.gov/Programs/cls/dehl/ehl/Pages/AQS/Mold.aspx) | `4181a0d5fa091d1fc9408ec8a41fb157ca91323db26e5512738f1025a19c67b6` |
| `legal-assets/epa-lead-en.pdf` | Protect Your Family From Lead in Your Home, U.S. EPA, 20 pages. [Source](https://www.epa.gov/lead/protect-your-family-lead-your-home-real-estate-disclosure) | `a094896c4c29df8f5b7f064bef8108346f476d3fcbbca8ae950d8e9629fb0ef8` |

The app checks each file against its hash before adding it to the files for a lease. Each PDF also ships as a script copy beside it (`legal-assets/*.pdf.js`, written from the PDF by `build-static.cjs`), because a browser does not let the app read a PDF directly when the app is opened from a file on the computer. A copy is checked against the same hash, so it is used only when it holds the same bytes. The agencies publish these documents for distribution to tenants; their credits and logos are unchanged. Give the tenant these handouts before the lease is signed. The handouts are in English; if you negotiated the lease mainly in another language, get that language's version from the agency.

## Limits

- The builder covers ordinary residential leases. It does not cover mobilehome parks, subsidized or deed-restricted housing programs, student or institutional housing, stays under 30 days, commercial space, or other cities' ordinances.
- Names written with characters the built-in PDF font cannot draw (for example Vietnamese or Chinese) produce a printable web-page lease instead of a PDF. The content is the same; print it or save it as a PDF from your browser.
- Signing is on paper or with any e-signature service you already use. The app records the signed copy you upload; it does not collect signatures itself.
- Emergency price-gouging limits (Penal Code § 396) can cap rent after a declared emergency. The builder does not track declarations; check before setting or raising rent after a local emergency.
