/* Offline source register and a deliberately finite, data-only applicability language. */
(() => {
  "use strict";
  const verified = "2026-11-18";
  const dre =
    "https://www.dre.ca.gov/Publications/ResourceGuidebook/2026_Landlord_Tenant_Guide.pdf";
  const enacted =
    "https://www.dre.ca.gov/Newsroom/DRE_Updates/2026_05_06_EOY_Bill_Summaries_2025.html";
  const upcoming =
    "https://www.dre.ca.gov/Newsroom/DRE_Updates/2026_11_03_Real_Estate_Related_Bill_Summaries_of_Chaptered_Legislation_2026.html";
  const city =
    "https://docs.sandiego.gov/municode/MuniCodeChapter09/Ch09Art08Division07.pdf";
  const federalLead =
    "https://www.ecfr.gov/current/title-40/chapter-I/subchapter-R/part-745/subpart-F";
  const code = (section, book = "CIV") =>
    "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=" +
    book +
    "&sectionNum=" +
    section +
    ".";
  const bill = (id) =>
    "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260" +
    id;
  const required = "Required",
    unknown = "More information needed",
    na = "Not applicable",
    review = "Review needed";
  const truth = ["Yes", "No"];
  const fields = {
    jurisdiction: [
      "Municipal boundary",
      ["City of San Diego", "Other incorporated city", "Unincorporated county"],
    ],
    propertyType: [
      "Housing type",
      [
        "Separately transferable home or condo",
        "Duplex",
        "Apartment",
        "Shared owner home",
        "Other or special housing",
      ],
    ],
    ownerType: [
      "Ownership",
      [
        "Natural person",
        "LLC owned only by natural persons",
        "REIT, corporation or corporate LLC member",
        "Trust or other entity",
      ],
    ],
    ownerOccupied: ["Owner occupied throughout", truth],
    exemptionNotice: ["Statutory exemption notice verified", truth],
    titleSeparate: ["Separately transferable title verified", truth],
    regulated: ["Subsidy, rent restriction or special housing", truth],
    capCoverage: ["State rent cap determination", ["Covered", "Exempt"]],
    causeCoverage: ["State just-cause determination", ["Covered", "Exempt"]],
    sdCoverage: ["San Diego ordinance determination", ["Covered", "Exempt"]],
    leadExemption: ["Federal target-housing exception documented", truth],
    applianceException: [
      "Statutory special-housing appliance exception",
      truth,
    ],
    ownFridge: ["Tenant requested their refrigerator", truth],
    internet: ["Bulk third-party internet subscription", truth],
    electronic: ["Electronic rent or deposit received", truth],
    service: ["Servicemember among prospective tenants", truth],
    higherDeposit: ["Above advertised deposit requested", truth],
    smallOwner: [
      "No more than two rental properties / four offered units",
      truth,
    ],
    flood: ["Known special flood hazard or potential flooding", truth],
    pest: ["Ongoing contracted pest treatments", truth],
    hazards: ["Known or suspected hazard or special disclosure trigger", truth],
    smoking: ["Smoking restricted on the premises", truth],
    sharedMeter: ["Shared utility meter serving outside the unit", truth],
    language: [
      "Principal language of negotiations",
      [
        "English",
        "Spanish",
        "Chinese",
        "Tagalog",
        "Vietnamese",
        "Korean",
        "Other",
      ],
    ],
    accommodation: ["Accommodation request pending", truth],
    econsent: ["Electronic records proposed", truth],
    populationChange: [
      "Adult household members added after commencement",
      truth,
    ],
    rentChange: ["Rent increase proposed", truth],
    periodic: ["Continuing periodic tenancy", truth],
    fee: ["Separate charge or fee proposed", truth],
    meganHousing: ["Housing classification for Megan’s Law", [
      "Single-family residential property", "Multiunit property with more than four dwellings",
      "Multiunit property with two to four dwellings", "Other or uncertain",
    ]],
    waterSubmeter: ["Landlord will bill separately for water measured by a submeter", truth],
    buildingSize: ["Dwellings in this rental building", ["15 or fewer", "More than 15"]],
    multipleBuildings: ["Owner owns more than one residential rental building", truth],
    ownerPesticides: ["Owner or agent routinely applies pesticides in common areas", truth],
    demolition: ["Landlord or agent applied for a demolition permit", truth],
    ordnance: ["Known former military ordnance location within one mile", truth],
    recentDeath: ["Known death in the rental unit within three years before the offer", truth],
    conversion: ["Property subject to a proposed or approved condominium conversion", truth],
    contaminationOrder: ["Health authority issued a methamphetamine or fentanyl contamination order", truth],
  };
  const register = [];
  function rule(
    id,
    title,
    section,
    url,
    text,
    inputs = [],
    trigger = "always",
    opts = {},
  ) {
    register.push({
      id,
      title,
      section,
      url,
      text,
      inputs,
      trigger,
      jurisdiction: "California",
      effective: null,
      sunset: null,
      verified,
      reviewStatus:
        "Agency guidance reviewed; compare current statute for exact wording",
      reference: dre,
      ...opts,
    });
  }
  rule(
    "boundary",
    "Local jurisdiction",
    "Municipal and county protections",
    "https://oag.ca.gov/tenants",
    "Verify the parcel against an official boundary map. For this address, document a dated local review of rent stabilization, registration, tenant protections, required notices or handbooks, licensing and local rules. Outside the City of San Diego this package supplies no municipal rule set.",
    ["jurisdiction", "county", "boundarySource"],
    "manual",
  );
  rule(
    "cap",
    "State rent limit",
    "Civil Code § 1947.12",
    code("1947.12"),
    "Check exclusions, rolling 15-year certificate of occupancy, ownership, statutory exemption notice, local limits and the lowest gross rent in the preceding 12 months. For a covered unit the state ceiling generally is the lesser of 10% or 5% plus the applicable CPI. Preserve rent history, effective dates, geography and local review.",
    [
      "propertyType",
      "ownerType",
      "firstOccupancy",
      "regulated",
      "capCoverage",
      "capBasis",
    ],
    "cap",
    {
      effective: "2020-01-01",
      sunset: "2030-01-01",
      reference:
        "https://www.oag.ca.gov/news/press-releases/attorney-general-bonta-shares-updated-resources-statewide-and-local-rent",
    },
  );
  rule(
    "cause",
    "Just cause and statutory notices",
    "Civil Code § 1946.2, as amended by AB 1529",
    code("1946.2"),
    "Determine coverage separately from the rent limit. Test continuous occupancy, household changes, special housing and exemptions. Check the prescribed 12-point covered-property notice, or the required exemption wording and timing. For an intended owner or family move-in, review the contract provision or written agreement required under § 1946.2(b)(2)(A) and additional state and city conditions.",
    [
      "propertyType",
      "ownerType",
      "firstOccupancy",
      "start",
      "populationChange",
      "regulated",
      "causeCoverage",
      "causeBasis",
    ],
    "cause",
    {
      effective: "2020-01-01",
      sunset: "2030-01-01",
      reference: bill("AB1529"),
    },
  );
  rule(
    "sd",
    "San Diego tenant protections",
    "SDMC §§ 98.0701–98.0709",
    city,
    "For covered tenancies review city just cause, exemption notices, the written protection notice plus Tenant Protection Guide, no-fault relocation, buyouts and current registry status. Confirm the parcel is inside city limits. County residence alone is insufficient.",
    ["jurisdiction", "boundarySource"],
    "sd",
    {
      jurisdiction: "City of San Diego",
      effective: "2023-06-24",
      reference: "https://sdhc.org/housing-opportunities/tenant-protections/",
      reviewStatus: "Municipal code and administering agency reviewed",
    },
  );
  rule(
    "deposit",
    "New security requested",
    "Civil Code § 1950.5(c)",
    code("1950.5"),
    "Compare the full security demand to monthly rent. Generally one month, or up to two months for qualifying small owners with no prospective servicemember. Separately review permitted advance payment arrangements and historical deposits collected before July 2024.",
    ["deposit", "rent", "depositWhen"],
    "deposit",
    { effective: "2024-07-01" },
  );
  rule(
    "return",
    "Return method and itemization",
    "Civil Code § 1950.5(h) / AB 414",
    code("1950.5"),
    "Electronic receipts can require electronic return and written notice of the right. Account for multiple adults, written alternatives and special termination rules. Document how the refund and itemization will reach each recipient.",
    ["electronic"],
    "always",
    { effective: "2026-01-01", reference: enacted },
  );
  rule(
    "photos",
    "Deposit photographs and inspections",
    "Civil Code § 1950.5(f)–(h)",
    code("1950.5"),
    "Record inspection rights and the opportunity to remedy findings. Photograph before and after deductible post-possession work from April 1, 2025. For tenancies starting July 1, 2025 or later, photograph immediately before or at commencement.",
    ["start"],
    "always",
    {
      effective: "2025-04-01",
      reference:
        "https://www.dre.ca.gov/Publications/ResourceGuidebook/gb10_movingout.html",
    },
  );
  rule(
    "stove",
    "Working stove and refrigerator",
    "Civil Code § 1941.1 / AB 628",
    code("1941.1"),
    "For agreements entered, extended or amended from January 2026, furnish safe functioning appliances subject to statutory special-housing exceptions. Review recalls and 30-day remedy. A tenant-supplied refrigerator requires a voluntary agreement with the statutory checkbox and replacement option. No equivalent stove exception.",
    ["agreementDate", "applianceException"],
    "appliance",
    { effective: "2026-01-01", reference: enacted },
  );
  rule(
    "internet",
    "Internet subscription choice",
    "Civil Code § 1942.8 / AB 1414",
    code("1942.8"),
    "For a commenced, renewed or continuing periodic tenancy within the statute, allow the tenant to opt out of a bundled third-party subscription. Review charges, deduction remedy and anti-retaliation protections.",
    ["internet"],
    "internet",
    { effective: "2026-01-01", reference: enacted },
  );
  rule(
    "lead",
    "Lead information before obligation",
    "40 CFR §§ 745.101, 745.103, 745.107 and 745.113",
    federalLead,
    "For covered pre-1978 target housing provide the correct-language pamphlet, known information and available reports, and the prescribed warning and signed acknowledgments. Check statutory exceptions and renewal circumstances.",
    ["built"],
    "lead",
    {
      jurisdiction: "United States",
      reference:
        "https://www.epa.gov/lead/real-estate-disclosures-about-potential-lead-hazards",
      reviewStatus: "Federal regulation and EPA instructions reviewed",
    },
  );
  rule(
    "bedbugs",
    "Bedbug information",
    "Civil Code § 1954.603",
    code("1954.603"),
    "For a new tenancy, provide the mandated information with landlord reporting instructions before signing. On renewal, confirm the prior notice and investigate any suspected infestation.",
    ["kind"],
    "bedbugs",
    { effective: "2017-07-01" },
  );
  rule(
    "megan",
    "Megan’s Law notice",
    "Civil Code § 2079.10a",
    code("2079.10a"),
    "Include the statutory notice in at least 8-point type for covered single-family property or a leasehold in a multiunit property with more than four dwellings. Verify classification of other forms of housing and the version on the agreement date.",
    ["meganHousing"],
    "meganHousing",
    {
      effective: "1999-07-01",
      reference: "https://dre.ca.gov/files/pdf/relaw/excerpts.pdf",
    },
  );
  rule(
    "contacts",
    "Landlord, manager and rent payment",
    "Civil Code §§ 1962 and 1947.3",
    code("1962"),
    "Identify the manager, owner or authorized recipient for service, their addresses and phone numbers, and the person or entity to receive rent. Specify where and how rent may be paid, including usual days and hours for personal payments if applicable. Offer a lawful noncash, nonelectronic method subject to statutory exceptions. Deliver a signed copy to the tenant within 15 days of execution and honor the annual copy request.",
    ["landlord", "noticeContact", "methods"],
    "always",
  );
  rule(
    "pest",
    "Periodic pest control notice",
    "Civil Code § 1940.8 and Business & Professions Code § 8538",
    code("1940.8"),
    "Provide affected new tenants a copy of the pest control operator’s notice under an ongoing service contract. Owner-applied pesticides have separate advance notification rules.",
    ["pest"],
    "whenYes",
  );
  rule(
    "flood",
    "Flood-hazard information",
    "Government Code § 8589.45",
    code("8589.45", "GOV"),
    "If the owner knows the property is in a special flood hazard area or area of potential flooding, disclose that fact. Check agency notices, lender insurance requirements and the owner's flood policy. Review the general flood information separately.",
    ["flood"],
    "whenYes",
    { effective: "2018-07-01" },
  );
  rule(
    "hazards",
    "Property-specific disclosures",
    "DRE 2026 Guide, landlord disclosures",
    dre,
    "Check known hazards, including asbestos, dampness or mold and any additional site-specific disclosure or correction obligations. For qualifying business exposures, review Proposition 65 tenant warnings, timing, translations and signage. Keep protected medical information private.",
    ["hazards"],
    "whenYes",
  );
  rule(
    "smoking",
    "Smoking restrictions",
    "Civil Code § 1947.5",
    code("1947.5"),
    "If smoking is prohibited in any portion, identify those areas in the applicable lease. Check local rules.",
    ["smoking"],
    "whenYes",
  );
  rule(
    "utilities",
    "Shared-meter arrangements",
    "Civil Code § 1940.9",
    code("1940.9"),
    "When the tenant's gas or electric meter serves another area, disclose it before tenancy and follow § 1940.9 on payment or a written cost-sharing agreement. Water submeters have a separate rule.",
    ["sharedMeter"],
    "whenYes",
  );
  rule(
    "translation",
    "Negotiation language",
    "Civil Code § 1632",
    code("1632"),
    "For covered negotiations primarily in a listed language, assess the pre-execution translation requirement, term and qualified-interpreter exceptions. Keep the exact translated copy delivered.",
    ["language", "kind"],
    "language",
  );
  rule(
    "entry",
    "Entry and access",
    "Civil Code § 1954",
    code("1954"),
    "Use a permitted purpose and the applicable timing, method and contents. Twenty-four hours is generally presumed reasonable for qualifying written notice, with specific exceptions. An appointment or ordinary email alone does not establish statutory service.",
    [],
    "always",
  );
  rule(
    "fees",
    "Proposed additional charges",
    "Civil Code §§ 1671(d), 1950.5 and 1950.6",
    code("1950.6"),
    "Review each charge and its actual basis, including screening process and refund requirements, restrictions on liquidated damages, and the prohibitions on fees for paying rent or security by check and for serving specified notices. Preserve the basis for each permitted fee.",
    ["fee"],
    "whenYes",
  );
  rule(
    "accommodation",
    "Reasonable accommodation",
    "California FEHA / Government Code § 12955",
    code("12955", "GOV"),
    "Review accommodation requests individually, including assistance animals and modifications. Avoid pet fees for assistance animals. Keep sensitive supporting information outside shared lease packets.",
    ["accommodation"],
    "whenYes",
    {
      reference:
        "https://calcivilrights.ca.gov/wp-content/uploads/sites/32/2026/02/Reasonable-Accommodations_ENG.pdf",
    },
  );
  rule(
    "scra",
    "Military orders and lease termination",
    "50 USC § 3955",
    "https://uscode.house.gov/us/usc/119-120/t50/s3955/",
    "Qualifying entry into service, PCS, deployment and certain other orders can permit early termination. Review written notice, orders or certification, delivery, termination date and prorated refunds. Do not demand sensitive orders to prepare an ordinary lease.",
    ["service"],
    "whenYes",
    {
      jurisdiction: "United States",
      reviewStatus: "US Code text reviewed",
      reference:
        "https://oag.ca.gov/sites/all/files/agweb/pdfs/consumers/tips-servicemember-housing.pdf",
    },
  );
  rule(
    "serviceDeposit",
    "Servicemember deposit protections",
    "Civil Code § 1950.5(c)(4)–(5)",
    code("1950.5"),
    "The small-landlord exception cannot increase the deposit for a prospective servicemember. From April 2025 a higher-than-advertised qualifying deposit within the normal cap can trigger written reasons at signing and a return date within six months if rent remains current.",
    ["service"],
    "whenYes",
    { effective: "2025-04-01" },
  );
  rule(
    "militaryCA",
    "State military protections",
    "Military & Veterans Code § 406",
    code("406", "MVC"),
    "Review California court protections for an occupied dwelling of a servicemember’s dependents, including potential stays. Obtain case-specific review before any enforcement involving active duty.",
    ["service"],
    "whenYes",
    {
      reference:
        "https://oag.ca.gov/sites/all/files/agweb/pdfs/consumers/tips-servicemember-housing.pdf",
    },
  );
  rule(
    "esign",
    "Electronic records consent",
    "15 USC §§ 7001(c), 7003",
    "https://uscode.house.gov/us/usc/119-134/t15/s7001/",
    "Review demonstrable consumer consent, access, retention, withdrawal and paper alternatives. Federal exclusions cover certain primary-residence default or eviction notices. Signature tracking and ordinary email are independent of service.",
    ["econsent"],
    "whenYes",
    {
      jurisdiction: "United States",
      reference: "https://uscode.house.gov/us/usc/119-134/t15/s7003/",
      reviewStatus: "US Code text reviewed",
    },
  );
  rule(
    "ueta",
    "Mutual consent and notice exceptions",
    "Civil Code §§ 1633.3, 1633.5, 1633.8",
    code("1633.3"),
    "Assess mutual agreement to transact electronically, statutory exclusions, and whether the record can be retained. Review service requirements separately for each notice.",
    ["econsent"],
    "whenYes",
  );
  rule(
    "futurePets",
    "Pet-policy advertising and applications",
    "SB 1296, Chapter 1025 (2026)",
    bill("SB1296"),
    "Beginning April 1, 2027 review published rental listings and electronic access to the written pet policy. Provide the policy with applications and check the fee-refund procedure.",
    ["agreementDate"],
    "manual",
    { effective: "2027-04-01", reference: upcoming },
  );
  rule(
    "futureEmergency",
    "Emergency rent-price limits",
    "Penal Code § 396 / SB 1365",
    bill("SB1365"),
    "Check the amended emergency pricing rules, including asking rent for a new rental and duration of the rental term. Confirm geography, applicable declarations/extensions, the reference price and any statutory exception.",
    ["agreementDate"],
    "manual",
    { effective: "2027-01-01", reference: upcoming },
  );
  // The original core remains necessary to validate a saved 1.0 package in an archive.
  const originalCoreIds = register.map((r) => r.id);
  rule("floodBaseline", "General flood and insurance information", "Government Code § 8589.45(a)(2)–(4)",
    code("8589.45", "GOV"),
    "For every residential lease entered into from July 1, 2018, include the Cal OES MyHazards address, the required personal-property insurance information and recommendation, and the statement about the extent of the disclosure, in at least 8-point type.",
    [], "always", {effective: "2018-07-01", reference: "https://www.caloes.ca.gov/wp-content/uploads/Legal-Affairs/Cal-OES-Yellow-Book.pdf"});
  rule("moldBooklet", "Dampness and mold booklet before agreement", "Health and Safety Code § 26148",
    code("26148", "HSC"), "Give the CDPH dampness and mold booklet to prospective residential tenants before entering the rental agreement. Record when and how it was delivered. Review language needs and any separate property-condition disclosure.",
    ["kind"], "prospective", {effective: "2022-01-01", reference: "https://www.cdph.ca.gov/Programs/cls/dehl/ehl/Pages/AQS/Mold.aspx"});
  rule("waterBilling", "Separate water submeter billing", "Civil Code §§ 1954.201–1954.219, especially § 1954.204",
    code("1954.204"), "Check chapter coverage and exemptions. If covered, give the pre-execution water-billing disclosures in at least 10-point type, including the estimated bill, calculation method, billing contact and tenant rights. A shared gas or electric meter has a separate rule.",
    ["waterSubmeter"], "whenYes", {reference: "https://leginfo.public.ca.gov/pub/15-16/bill/sen/sb_0001-0050/sb_7_bill_20160925_chaptered.htm"});
  rule("rentReporting", "Written offer to report positive rent payments", "Civil Code § 1954.07",
    code("1954.07"), "For covered housing, give each tenant obligated on the lease the written election at signing for leases entered into from April 1, 2025, and at least annually. Check the existing-lease deadline, opt-in/withdrawal process and fee limits. Review assisted housing separately.",
    ["buildingSize", "regulated"], "rentReporting", {effective: "2025-04-01", reference: "https://calcivilrights.ca.gov/wp-content/uploads/sites/32/2024/12/2024-Legislative-Summary.pdf"});
  rule("ownerPesticides", "Scheduled pesticide use in common areas", "Civil Code § 1940.8.5(d)",
    code("1940.8.5"), "Check the written notice for scheduled owner or agent pesticide treatments in a common area before a new tenant enters a lease. Review the common-interest-development exception and other application-specific notices.",
    ["ownerPesticides"], "whenYes");
  rule("demolition", "Pending demolition permit", "Civil Code § 1940.6", code("1940.6"),
    "Disclose a demolition permit application before taking a fee from the prospective tenant or entering a rental agreement. Include the earliest approximate dates demolition and termination may occur. Existing tenants have separate advance notice rights.",
    ["demolition"], "whenYes");
  rule("ordnance", "Former military ordnance location", "Civil Code § 1940.7", code("1940.7"),
    "For actual knowledge of a qualifying former federal or state ordnance location within one mile, give written notice before the prospective tenant signs.", ["ordnance"], "whenYes");
  rule("recentDeath", "Recent death at the unit", "Civil Code § 1710.2", code("1710.2"),
    "Review disclosure of a known death and the manner of death in the three years before the offer. Protect HIV/AIDS-related information. A direct inquiry can require a truthful response even for an older event. Keep protected details out of the packet.", ["recentDeath"], "whenYes");
  rule("conversion", "Condominium conversion", "Government Code § 66459 and applicable conversion provisions", code("66459", "GOV"),
    "Check the conversion approval stage, unit count, statutory exceptions, local rules and prescribed notice before accepting a prospective tenant. Address termination, notice of sale and purchase rights where applicable.", ["conversion"], "whenYes");
  rule("contamination", "Government contamination order", "Health and Safety Code §§ 25400.10–25400.47", code("25400.28", "HSC"),
    "Verify any use or occupancy restriction and the status of remediation with the local health authority. Review the required notice or order, acknowledgment and timing before entering an agreement. Disclosure alone cannot authorize occupancy.", ["contaminationOrder"], "whenYes");
  rule("waivers", "Lease terms and nonwaivable rights", "Civil Code §§ 1942.1, 1942.5, 1946.7, 1946.8 and 1953", code("1953"),
    "Review base terms, addenda and each custom clause together. Check deposit, habitability, entry, duty of care, notice and hearing rights, survivor and emergency assistance protections, fair housing and retaliation. Review special format and signature placement for automatic renewals (§ 1945.5) and restrictions on political signs and personal mobility devices (§§ 1940.4, 1940.41). Identify conflicts and how the signing copy resolves them.", [], "manual");
  rule("emergencyPricing", "Current emergency pricing restrictions", "Penal Code § 396", code("396", "PEN"),
    "Check active state and local declarations or extensions at the property on the pricing date. Evaluate asking rent, existing rent and re-rental prices, limits and any documented exception. Emergency restrictions can reach an initial rental offer.", [], "manual",
    {reference: "https://oag.ca.gov/consumers/pricegougingduringdisasters"});
  rule("specialHousing", "Subsidized and special housing addenda", "Housing program requirements and local covenants", "https://www.hud.gov/vawa",
    "Identify the actual housing program, administering agency, governing documents and applicable addenda before execution. For a Housing Choice Voucher review the HUD tenancy addendum and PHA approval. Check VAWA notices and confidentiality where applicable.", ["regulated"], "whenYes",
    {reference: "https://www.hud.gov/sites/dfiles/OCHCO/documents/52641A.pdf"});
  const base = {
    format: "pm-legal-1",
    version: "CA-2026.11.18.2",
    verified,
    jurisdiction: "California",
    summary:
      "California residential intake, federal disclosures and City of San Diego review.",
    rules: register,
  };
  const policies = new Set([
    "always",
    "manual",
    "whenYes",
    "whenLastYes",
    "lead",
    "sd",
    "deposit",
    "cap",
    "cause",
    "internet",
    "appliance",
    "bedbugs",
    "language",
    "prospective",
    "meganHousing",
    "rentReporting",
  ]);
  const isDate = (v) =>
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v + "T12:00:00Z")) &&
    new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v;
  const has = (v) => v !== undefined && v !== null && String(v).trim() !== "";
  const sourceHosts = [
    "leginfo.legislature.ca.gov",
    "dre.ca.gov",
    "oag.ca.gov",
    "sdhc.org",
    "sandiego.gov",
    "epa.gov",
    "ecfr.gov",
    "govinfo.gov",
    "uscode.house.gov",
    "calcivilrights.ca.gov",
    "courts.ca.gov",
    "gov.ca.gov",
    "hud.gov",
    "justice.gov",
    "dir.ca.gov",
    "ca.gov",
    "congress.gov",
  ];
  function trusted(url) {
    try {
      const u = new URL(url);
      return (
        u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        !u.port &&
        sourceHosts.some(
          (h) => u.hostname === h || u.hostname.endsWith("." + h),
        )
      );
    } catch {
      return false;
    }
  }
  function validate(pkg, { historical = false } = {}) {
    const short = (v, max) =>
      typeof v === "string" && v.trim().length > 0 && v.length <= max;
    if (
      !pkg ||
      pkg.format !== base.format ||
      pkg.jurisdiction !== "California" ||
      !short(pkg.version, 40) ||
      !/^[a-zA-Z0-9._-]+$/.test(pkg.version) ||
      !isDate(pkg.verified) ||
      !short(pkg.summary, 2000) ||
      !Array.isArray(pkg.rules) ||
      !pkg.rules.length ||
      pkg.rules.length > 150
    )
      throw Error("Invalid California package header.");
    const ids = new Set();
    const allowedInputs = new Set([
      ...Object.keys(fields),
      "county",
      "boundarySource",
      "firstOccupancy",
      "capBasis",
      "causeBasis",
      "start",
      "rent",
      "deposit",
      "depositWhen",
      "agreementDate",
      "built",
      "kind",
      "landlord",
      "noticeContact",
      "methods",
      "sdBasis",
    ]);
    for (const r of pkg.rules) {
      if (
        !r ||
        !short(r.id, 48) ||
        !/^[A-Za-z][\w-]*$/.test(r.id) ||
        ["constructor", "prototype", "__proto__"].includes(r.id) ||
        ids.has(r.id) ||
        !short(r.title, 160) ||
        !short(r.section, 200) ||
        !short(r.text, 2000) ||
        !short(r.reviewStatus, 160) ||
        !["California", "United States", "City of San Diego"].includes(
          r.jurisdiction,
        ) ||
        !isDate(r.verified) ||
        !trusted(r.url) ||
        !trusted(r.reference) ||
        !policies.has(r.trigger) ||
        !Array.isArray(r.inputs) ||
        r.inputs.length > 20 ||
        !r.inputs.every((k) => allowedInputs.has(k)) ||
        ![r.effective, r.sunset].every((d) => d === null || isDate(d)) ||
        (r.effective && r.sunset && r.effective >= r.sunset)
      )
        throw Error("Invalid rule or source in the selected package.");
      ids.add(r.id);
    }
    const requiredIds = historical && pkg.version !== base.version ? originalCoreIds : register.map((r) => r.id);
    if (requiredIds.some((id) => !ids.has(id)))
      throw Error(
        "A core review topic is missing. Retain its entry and document superseding law in the review notes.",
      );
    return JSON.parse(JSON.stringify(pkg));
  }
  function evaluate(r, f = {}) {
    const result = (status, why) => ({ id: r.id, title: r.title, status, why });
    if (!has(f.state)) return result(unknown, "Confirm the state of the rental property.");
    if (
      f.state &&
      !["CA", "CALIFORNIA"].includes(String(f.state).trim().toUpperCase())
    )
      return result(
        review,
        "This package covers a California residential rental only.",
      );
    if ((f.agreementDate || r.effective || r.sunset) && !isDate(f.agreementDate))
      return result(
        unknown,
        "Confirm the agreement date to determine which version applies.",
      );
    if (f.agreementDate && r.sunset && f.agreementDate >= r.sunset)
      return result(
        review,
        "The installed rule reaches its sunset before this agreement. Check successor law.",
      );
    if (
      f.agreementDate &&
      r.effective &&
      f.agreementDate < r.effective &&
      ![
        "deposit",
        "photos",
        "serviceDeposit",
        "return",
        "internet",
        "cap",
        "cause",
        "rentReporting",
      ].includes(r.id)
    )
      return result(
        na,
        "The agreement date precedes this provision’s effective date.",
      );
    if (r.trigger === "deposit" && /^0+(?:\.0{1,2})?$/.test(f.deposit))
      return result(na, "No refundable security is being demanded. Confirm any other amounts that count as security.");
    const missing = r.inputs.filter((k) => !has(f[k]) || (fields[k] && !fields[k][1].includes(f[k])));
    if (missing.length)
      return result(
        unknown,
        "Confirm " +
          missing.map((k) => fields[k]?.[0] || labels[k] || k).join(", ") +
          ".",
      );
    const yes = (v) =>
      v === "Yes"
        ? result(required, r.text)
        : v === "No"
          ? result(na, "The confirmed triggering condition is absent.")
          : result(unknown, "Confirm the triggering condition.");
    switch (r.trigger) {
      case "whenYes":
        return yes(f[r.inputs[0]]);
      case "whenLastYes":
        return yes(f[r.inputs.at(-1)]);
      case "manual":
        return result(review, r.text);
      case "prospective":
        return ["Renewal", "Amendment"].includes(f.kind)
          ? result(review, "Check whether there are new prospective tenants and verify prior delivery. " + r.text)
          : result(required, r.text);
      case "meganHousing":
        if (f.meganHousing === "Multiunit property with two to four dwellings")
          return result(na, "The confirmed multiunit classification falls outside the leasehold categories in § 2079.10a(a).");
        if (!fields.meganHousing[1].slice(0, 2).includes(f.meganHousing))
          return result(review, r.text);
        return result(required, r.text);
      case "rentReporting":
        if (f.agreementDate < r.effective || f.regulated !== "No")
          return result(review, "Check the existing tenancy, statutory timelines, and whether an assisted-housing provision or exception governs. " + r.text);
        if (f.buildingSize === "More than 15") return result(required, r.text);
        if (f.buildingSize !== "15 or fewer" || !f.ownerType)
          return result(unknown, "Confirm building size and ownership.");
        if (["Natural person", "LLC owned only by natural persons"].includes(f.ownerType) || f.multipleBuildings === "No")
          return result(na, "The small-building exclusion applies on the recorded ownership facts.");
        if (!f.multipleBuildings) return result(unknown, "Confirm whether this owner owns more than one residential rental building.");
        return f.ownerType === "REIT, corporation or corporate LLC member" && f.multipleBuildings === "Yes"
          ? result(required, r.text) : result(review, r.text);
      case "cap":
      case "cause": {
        const determination = f[r.trigger + "Coverage"];
        if (
          determination === "Exempt" &&
          f.propertyType === "Separately transferable home or condo" &&
          (f.exemptionNotice !== "Yes" ||
            f.titleSeparate !== "Yes" ||
            !f[r.trigger + "Basis"])
        )
          return result(
            review,
            "A separately transferable home needs evidence of title, ownership eligibility and proper exemption notice.",
          );
        if (determination === "Exempt")
          return result(
            review,
            "Review the independently documented exemption and its notice in " +
              f[r.trigger + "Basis"] +
              ".",
          );
        return result(required, r.text);
      }
      case "sd":
        return f.jurisdiction !== "City of San Diego"
          ? result(na, "The confirmed boundary lies outside the city.")
          : !fields.sdCoverage[1].includes(f.sdCoverage) || !has(f.sdBasis)
            ? result(
                unknown,
                "Record the city coverage determination and its basis.",
              )
            : f.sdCoverage === "Exempt"
              ? result(
                  review,
                  "Verify the city-specific exemption and required notice.",
                )
              : result(required, r.text);
      case "lead":
        if (!/^\d{4}$/.test(f.built) || Number(f.built) < 1600 || Number(f.built) > new Date().getFullYear())
          return result(unknown, "Confirm a valid, completed year of construction.");
        if (Number(f.built) < 1978 && !truth.includes(f.leadExemption))
          return result(unknown, "Verify federal target-housing exceptions for the pre-1978 unit.");
        return Number(f.built) >= 1978
          ? result(na, "Construction year is 1978 or later.")
          : f.leadExemption === "Yes" ||
                ["Renewal", "Amendment"].includes(f.kind)
              ? result(
                  review,
                  "Check documented target-housing or renewal exceptions and delivery history.",
                )
              : result(required, r.text);
      case "deposit": {
        if (![f.deposit, f.rent].every((v) => /^\d{1,9}(?:\.\d{1,2})?$/.test(v)) || Number(f.rent) <= 0 || !isDate(f.depositWhen))
          return result(unknown, "Confirm rent, refundable security and its original demand date.");
        if (f.depositWhen < "2024-07-01")
          return result(
            review,
            "Review historical collection under the law in force on its original date.",
          );
        if (Number(f.deposit) <= Number(f.rent))
          return result(
            required,
            "Document the total refundable security and original collection date. " +
              r.text,
          );
        if (Number(f.deposit) > 2 * Number(f.rent))
          return result(review, "The proposed security exceeds even the two-month small-owner ceiling. Correct the demand or document a fact-specific statutory classification with counsel.");
        if (!truth.includes(f.smallOwner) || !truth.includes(f.service) || !fields.ownerType[1].includes(f.ownerType))
          return result(
            unknown,
            "Verify owner, property/unit counts and servicemember applicability before exceeding one month.",
          );
        if (f.service === "Yes" || f.smallOwner === "No" || f.ownerType === "REIT, corporation or corporate LLC member")
          return result(review, "The recorded facts disqualify this demand from the small-owner exception. Correct the proposed security or review a separate statutory provision with counsel.");
        return result(
          review,
          "Proposed security exceeds one month. Confirm every statutory condition and any separate arrangement before using these terms.",
        );
      }
      case "internet":
        return f.internet === "No"
          ? yes("No")
          : f.agreementDate >= "2026-01-01" || f.periodic === "Yes"
            ? result(required, r.text)
            : result(
                review,
                "Determine whether the tenancy continues periodically or renews after January 1, 2026.",
              );
      case "appliance":
        if (f.applianceException === "No" && !truth.includes(f.ownFridge))
          return result(unknown, "Confirm whether the landlord supplies the refrigerator or the tenant voluntarily requested to supply one.");
        if (f.applianceException === "No" && f.ownFridge === "Yes")
          return result(required, "Record the tenant’s voluntary choice with the statutory checkbox and signed agreement. Explain written notice to end the arrangement and the landlord’s 30-day refrigerator installation duty. The landlord must still provide the stove.");
        return f.applianceException === "Yes"
          ? result(
              review,
              "Verify statutory special-housing status and the appliance exception.",
            )
          : result(required, r.text);
      case "bedbugs":
        return ["Renewal", "Amendment"].includes(f.kind)
          ? result(review, "Verify prior delivery and any current infestation.")
          : result(required, r.text);
      case "language":
        return [
          "Spanish",
          "Chinese",
          "Tagalog",
          "Vietnamese",
          "Korean",
        ].includes(f.language)
          ? result(review, r.text)
          : result(
              na,
              "The stated principal negotiation language is outside the five languages listed in § 1632. Check other language-access obligations separately.",
            );
      default:
        return result(required, r.text);
    }
  }
  const labels = {
    boundarySource: "boundary evidence",
    firstOccupancy: "certificate of occupancy date",
    capBasis: "rent-cap evidence",
    causeBasis: "just-cause evidence",
    depositWhen: "security demand date",
    built: "construction year",
    noticeContact: "notice contact",
    methods: "payment options",
    agreementDate: "agreement date",
    start: "tenancy start",
    kind: "agreement type",
  };
  const attached = {
    moldBooklet: [
      {name: "CDPH dampness and mold booklet (English)", path: "legal-assets/cdph-dampness-mold-en.pdf", hash: "4181a0d5fa091d1fc9408ec8a41fb157ca91323db26e5512738f1025a19c67b6"},
    ],
    lead: [
      {
        name: "EPA lead pamphlet (English)",
        path: "legal-assets/epa-lead-en.pdf",
        hash: "a094896c4c29df8f5b7f064bef8108346f476d3fcbbca8ae950d8e9629fb0ef8",
      },
      {
        name: "EPA lessor disclosure form (English)",
        path: "legal-assets/epa-lead-lessor-en.pdf",
        draftOnly: true,
        hash: "abf50bc2bd2dac206f3354e1d5980eb9b769d06cf466e64fb1f17a053d8a3022",
      },
    ],
    sd: [
      {
        name: "San Diego Tenant Protection Guide (English)",
        path: "legal-assets/sdhc-guide-en.pdf",
        hash: "72ad0617badb9ef9b544c6d631e5984c198f937a984a614991f6cf9e56a4c5bc",
      },
    ],
  };
  globalThis.LeaseRules = {
    base,
    fields,
    evaluate,
    validate,
    isDate,
    trusted,
    attached,
    required,
    unknown,
    na,
    review,
  };
})();
