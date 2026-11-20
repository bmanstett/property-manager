/* California and City of San Diego rules the lease builder applies.
   Statutory wording below was read on the official publishers' sites on the review date:
   leginfo.legislature.ca.gov, ecfr.gov and docs.sandiego.gov (Municipal Code edition 3-2024). */
(() => {
  "use strict";
  const version = "CA-SD 2026.11";
  const reviewed = "2026-11-18";

  const isDate = (v) =>
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v + "T12:00:00Z")) &&
    new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v;
  const filled = (v) => String(v ?? "").trim() !== "";
  const yn = (v) => v === "yes" || v === "no";
  const amount = (v) => {
    const text = String(v ?? "").trim();
    return /^\d{1,9}(?:\.\d{1,2})?$/.test(text) ? Number(text) : null;
  };
  function addYears(iso, years) {
    const d = new Date(iso + "T12:00:00Z");
    d.setUTCFullYear(d.getUTCFullYear() + years);
    return d.toISOString().slice(0, 10);
  }
  function addMonths(iso, months) {
    const d = new Date(iso + "T12:00:00Z");
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return d.toISOString().slice(0, 10);
  }
  function money(value) {
    const n = typeof value === "number" ? value : amount(value);
    return n === null || !Number.isFinite(n)
      ? ""
      : "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function longDate(iso) {
    return isDate(iso)
      ? new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        })
      : "";
  }

  /* ---- Wording prescribed by statute, regulation or ordinance. Do not edit. ---- */
  const texts = Object.freeze({
    // Civil Code § 1946.2(f)(3). At least 12-point type.
    stateCovered:
      "California law limits the amount your rent can be increased. See Section 1947.12 of the Civil Code for more information. California law also provides that after all of the tenants have continuously and lawfully occupied the property for 12 months or more or at least one of the tenants has continuously and lawfully occupied the property for 24 months or more, a landlord must provide a statement of cause in any notice to terminate a tenancy. See Section 1946.2 of the Civil Code for more information.",
    // Civil Code § 1946.2(e)(8)(B)(i) and § 1947.12(d)(5)(B)(i).
    stateExempt:
      "This property is not subject to the rent limits imposed by Section 1947.12 of the Civil Code and is not subject to the just cause requirements of Section 1946.2 of the Civil Code. This property meets the requirements of Sections 1947.12 (d)(5) and 1946.2 (e)(8) of the Civil Code and the owner is not any of the following: (1) a real estate investment trust, as defined by Section 856 of the Internal Revenue Code; (2) a corporation; or (3) a limited liability company in which at least one member is a corporation.",
    // San Diego Municipal Code § 98.0705(a). At least 12-point font.
    cityCovered:
      "California law limits the amount your rent can be increased. See California Civil Code section 1947.12 for more information. Local law also provides that a landlord shall provide a statement of cause in any notice to terminate a tenancy. In some circumstances, tenants who are seniors (62 years or older) or disabled may be entitled to additional tenant protections. See Chapter 9, Article 8, Division 7 of the San Diego Municipal Code for more information.",
    // San Diego Municipal Code § 98.0703(l)(2).
    cityExempt:
      "This property is not subject to the just cause requirements of Chapter 9, Article 8, Division 7 of the San Diego Municipal Code. This property meets the requirements of San Diego Municipal Code section 98.0703(l) and the landlord is not any of the following: (1) a real estate investment trust, as defined by California Internal Revenue Code section 856; (2) a corporation; (3) a limited liability company in which at least one member is a corporation; or (4) management of a mobilehome park, as defined in California Civil Code section 798.2.",
    // San Diego Municipal Code § 98.0903. Every written lease in the City, 12-point font or larger.
    cityDaycare:
      "Use of this rental property as a family daycare home is protected by state law in California Health and Safety Code sections 1597.30 – 1597.622. A family daycare home is where the daycare provider lives and provides care, protection, and supervision for 14 or fewer children for periods of less than 24 hours per day while the parents or guardians are away. The property owner or manager may not refuse to rent, or refuse to allow you to use, the rental property as a family daycare home. You may be required to provide notice to the property owner or manager that you operate or plan to operate a family daycare home. The property owner or manager may require an increased security deposit. If you believe your rights under this state law have been denied, you may file a complaint with the California Civil Rights Department.",
    // San Diego Municipal Code § 98.1204(c). Required when the landlord bills the tenant for City water, sewer, stormwater or trash.
    cityUtilityFees:
      "Equitable Fees and Right to Notice: The City of San Diego allows landlords to charge you a utility fee for water, sewer, stormwater, and trash and recycling services if (i) the utility fee is not greater than the amount the landlord pays for your utility services, (ii) you are provided written notice that a utility fee for utility services will be charged, and (iii) upon request, the landlord provides you with a copy of the utility or tax bill and the calculations used to determine the amount of the utility fee you are charged, if that applies.",
    // Civil Code § 2079.10a(a)(3). At least 8-point type.
    megan:
      "Notice: Pursuant to Section 290.46 of the Penal Code, information about specified registered sex offenders is made available to the public via an Internet Web site maintained by the Department of Justice at www.meganslaw.ca.gov. Depending on an offender’s criminal history, this information will include either the address at which the offender resides or the community of residence and ZIP Code in which the offender resides.",
    // Civil Code § 1954.603(a). At least 10-point type.
    bedbugTitle: "Information about Bed Bugs",
    bedbug: Object.freeze([
      "Bed bug Appearance: Bed bugs have six legs. Adult bed bugs have flat bodies about 1/4 of an inch in length. Their color can vary from red and brown to copper colored. Young bed bugs are very small. Their bodies are about 1/16 of an inch in length. They have almost no color. When a bed bug feeds, its body swells, may lengthen, and becomes bright red, sometimes making it appear to be a different insect. Bed bugs do not fly. They can either crawl or be carried from place to place on objects, people, or animals. Bed bugs can be hard to find and identify because they are tiny and try to stay hidden.",
      "Life Cycle and Reproduction: An average bed bug lives for about 10 months. Female bed bugs lay one to five eggs per day. Bed bugs grow to full adulthood in about 21 days.",
      "Bed bugs can survive for months without feeding.",
      "Bed bug Bites: Because bed bugs usually feed at night, most people are bitten in their sleep and do not realize they were bitten. A person’s reaction to insect bites is an immune response and so varies from person to person. Sometimes the red welts caused by the bites will not be noticed until many days after a person was bitten, if at all.",
      "Common signs and symptoms of a possible bed bug infestation:",
      "• Small red to reddish brown fecal spots on mattresses, box springs, bed frames, mattresses, linens, upholstery, or walls.",
      "• Molted bed bug skins, white, sticky eggs, or empty eggshells.",
      "• Very heavily infested areas may have a characteristically sweet odor.",
      "• Red, itchy bite marks, especially on the legs, arms, and other body parts exposed while sleeping. However, some people do not show bed bug lesions on their bodies even though bed bugs may have fed on them.",
      "For more information, see the Internet Web sites of the United States Environmental Protection Agency and the National Pest Management Association.",
    ]),
    // Civil Code § 1941.1(a)(11)(B)(i).
    fridge:
      "Under state law, the landlord is required to provide a refrigerator in good working order in your unit. By checking this box, you acknowledge that you have asked to bring your own refrigerator and that you are responsible for keeping that refrigerator in working order.",
    // Civil Code § 1785.26(c)(2). Lets the landlord report an unpaid debt to a credit bureau later.
    creditNotice:
      "As required by law, you are hereby notified that a negative credit report reflecting on your credit record may be submitted to a credit reporting agency if you fail to fulfill the terms of your credit obligations.",
    // 40 CFR § 745.113(b)(1).
    leadWarning:
      "Housing built before 1978 may contain lead-based paint. Lead from paint, paint chips, and dust can pose health hazards if not managed properly. Lead exposure is especially harmful to young children and pregnant women. Before renting pre-1978 housing, lessors must disclose the presence of known lead-based paint and/or lead-based paint hazards in the dwelling. Lessees must also receive a federally approved pamphlet on lead poisoning prevention.",
    /* Government Code § 8589.45 requires these four disclosures but does not prescribe their wording. */
    floodKnown:
      "Landlord has actual knowledge that the property is located in a special flood hazard area or an area of potential flooding.",
    flood: Object.freeze([
      "Tenant may obtain information about hazards, including flood hazards, that may affect the property from the website of the California Governor’s Office of Emergency Services. The address of its MyHazards tool is https://myhazards.caloes.ca.gov/.",
      "Landlord’s insurance does not cover the loss of Tenant’s personal possessions. It is recommended that Tenant consider purchasing renter’s insurance and flood insurance to insure Tenant’s possessions from loss due to fire, flood, or other risk of loss.",
      "Landlord is not required to provide additional information concerning the flood hazards to the property, and the information provided under Government Code section 8589.45 is deemed adequate to inform Tenant.",
    ]),
  });

  /* ---- Handouts bundled with the app. Hashes are checked before a packet is made. ---- */
  const handouts = Object.freeze({
    mold: Object.freeze({
      id: "mold",
      name: "Information on Dampness and Mold for Renters in California (state booklet)",
      path: "legal-assets/cdph-dampness-mold-en.pdf",
      hash: "4181a0d5fa091d1fc9408ec8a41fb157ca91323db26e5512738f1025a19c67b6",
      pages: 4,
    }),
    lead: Object.freeze({
      id: "lead",
      name: "Protect Your Family From Lead in Your Home (EPA pamphlet)",
      path: "legal-assets/epa-lead-en.pdf",
      hash: "a094896c4c29df8f5b7f064bef8108346f476d3fcbbca8ae950d8e9629fb0ef8",
      pages: 20,
    }),
    guide: Object.freeze({
      id: "guide",
      name: "City of San Diego Tenant Protection Guide",
      path: "legal-assets/sdhc-guide-en.pdf",
      hash: "72ad0617badb9ef9b544c6d631e5984c198f937a984a614991f6cf9e56a4c5bc",
      pages: 20,
    }),
  });

  const code = (section, book = "CIV") =>
    "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=" +
    book +
    "&sectionNum=" +
    section +
    ".";
  const sdmc = "https://docs.sandiego.gov/municode/MuniCodeChapter09/Ch09Art08Division07.pdf";
  const sdmcDaycare = "https://docs.sandiego.gov/municode/MuniCodeChapter09/Ch09Art08Division09.pdf";
  const sdmcUtility = "https://docs.sandiego.gov/municode/MuniCodeChapter09/Ch09Art08Division12.pdf";
  const sdmcLead = "https://docs.sandiego.gov/municode/MuniCodeChapter05/Ch05Art04Division10.pdf";
  const links = Object.freeze({
    // The City's own address lookup: an address inside one of the nine Council districts is inside the City.
    cityLookup: "https://www.sandiego.gov/citycouncil",
    hazards: "https://myhazards.caloes.ca.gov/",
    rentalTax: "https://www.sandiego.gov/treasurer/taxesfees/btax/rtaxinfo",
    tenantProtections: "https://sdhc.org/housing-opportunities/tenant-protections/",
  });
  /* The tenant reimburses the landlord for a City utility bill: trash is always billed to the owner
     (on the property-tax bill), water and sewer only when the account stays in the landlord's name. */
  function cityBilled(f) {
    if (f.inCity !== "yes") return [];
    const out = [];
    if (f.utilityBilling === "yes" && f.util_water === "tenant") out.push("water");
    if (f.utilityBilling === "yes" && f.util_sewer === "tenant") out.push("sewer");
    if (f.util_trash === "tenant") out.push("trash and recycling");
    return out;
  }
  const lead = "https://www.ecfr.gov/current/title-40/chapter-I/subchapter-R/part-745/subpart-F";

  /* ---- What the builder applies, for the "Legal sources" page. ---- */
  const sources = Object.freeze(
    [
      ["tenantProtections", "Rent cap and just-cause notices", "Civil Code §§ 1946.2 and 1947.12", code("1946.2"), "Decides whether California’s rent cap and just-cause rules apply and prints the notice the statute requires, in 12-point type, or the exemption statement for a house or condo owned by individuals."],
      ["city", "San Diego tenant protections", "San Diego Municipal Code §§ 98.0701–98.0710", sdmc, "Inside the City of San Diego: prints the City’s required notice or exemption statement and attaches the Tenant Protection Guide."],
      ["daycare", "Family daycare notice", "San Diego Municipal Code § 98.0903", sdmcDaycare, "Every written lease in the City of San Diego must carry this notice, in 12-point type, that state law protects a tenant’s right to run a licensed family daycare home."],
      ["utilityFees", "Passing City utility bills to the tenant", "San Diego Municipal Code §§ 98.1203–98.1205", sdmcUtility, "If you bill the tenant for City water, sewer or trash, you may charge only what you pay, the lease must carry the City’s notice, and you must show the bill within 10 days when asked."],
      ["deposit", "Security deposit", "Civil Code § 1950.5", code("1950.5"), "Limits the deposit to one month’s rent (two for qualifying small owners), bars non-refundable deposits, and states the 21-day return and inspection rules."],
      ["contacts", "Who to contact and how rent is paid", "Civil Code §§ 1962 and 1947.3", code("1962"), "Puts the owner’s or manager’s name, phone and street address in the lease, states how rent is paid, and keeps at least one payment method that is neither cash nor electronic."],
      ["entry", "Landlord’s entry", "Civil Code § 1954", code("1954"), "Limits entry to the reasons the law allows, with written notice (24 hours is presumed reasonable)."],
      ["appliances", "Stove and refrigerator", "Civil Code § 1941.1", code("1941.1"), "For leases signed in 2026 or later the landlord provides a working stove and refrigerator; a tenant may choose to bring their own refrigerator using the statutory checkbox."],
      ["megan", "Megan’s Law notice", "Civil Code § 2079.10a", code("2079.10a"), "Prints the required registered-sex-offender database notice."],
      ["flood", "Flood information", "Government Code § 8589.45", code("8589.45", "GOV"), "Tells the tenant where to look up hazards, recommends renter’s and flood insurance, and discloses a flood zone the owner actually knows about."],
      ["bedbugs", "Bed bug information", "Civil Code § 1954.603", code("1954.603"), "Adds the required bed bug information sheet and how to report a problem."],
      ["mold", "Mold booklet and known mold", "Health & Safety Code §§ 26147–26148", code("26148", "HSC"), "Attaches the state’s dampness and mold booklet and discloses mold the owner knows about."],
      ["lead", "Lead-based paint (homes built before 1978)", "40 CFR §§ 745.107 and 745.113", lead, "Adds the federal lead warning, the owner’s disclosure and the tenant’s acknowledgment, and attaches the EPA pamphlet."],
      ["smoking", "Smoking", "Civil Code § 1947.5", code("1947.5"), "States where smoking is prohibited on the property."],
      ["lateFees", "Late and returned-payment charges", "Civil Code §§ 1671(d) and 1719", code("1671"), "Keeps late charges to a reasonable estimate of the owner’s cost and returned-check charges to $25, then $35."],
      ["notices", "Ending a tenancy and raising rent", "Civil Code §§ 827 and 1946.1", code("1946.1"), "Describes the written notice periods the law sets for ending a month-to-month tenancy and for rent increases."],
      ["pest", "Pest control notices", "Civil Code § 1940.8", code("1940.8"), "If a pest company treats the home regularly, reminds the owner to give the tenant the company’s notice."],
      ["sharedMeter", "Shared utility meters", "Civil Code § 1940.9", code("1940.9"), "Discloses a gas or electric meter that also serves areas outside the tenant’s home and records who pays."],
      ["special", "Less common disclosures", "Civil Code §§ 1710.2, 1940.6, 1940.7 and 1954.07", code("1940.6"), "A recent death in the home, a demolition permit, a former military ordnance site, and the rent-reporting offer for larger or corporate owners."],
      ["void", "Terms a lease cannot contain", "Civil Code §§ 1953 and 1942.1", code("1953"), "The lease never asks a tenant to waive deposit, entry, notice, court or habitability rights, and custom clauses are checked for wording the law voids."],
    ].map(([id, title, cite, url, summary]) => Object.freeze({ id, title, cite, url, summary })),
  );

  const unitTypes = ["house", "condo", "apartment", "adu", "room"];
  const ownerKinds = ["people", "llc", "corp"];
  const buildingSizes = ["2", "3-4", "5-15", "16+"];
  const unitLabel = {
    house: "Single-family house",
    condo: "Condo or townhome",
    apartment: "Apartment or unit in a multi-unit building",
    adu: "ADU or guest house",
    room: "Room in a home",
  };
  const ownerLabel = {
    people: "Owned by individuals or a family trust",
    llc: "Owned by an LLC whose members are all people",
    corp: "Owned by a corporation, REIT, or LLC with a corporate member",
  };

  function agreementDay(f, today) {
    return isDate(f.agreementDate) ? f.agreementDate : today;
  }

  /* Certificate of occupancy within the previous 15 years (Civ. Code §§ 1946.2(e)(7), 1947.12(d)(4); SDMC § 98.0703(k)).
     Without the certificate date the 15 years are counted from the first day of the build year, the earliest the
     certificate could have been issued, so an exemption is never claimed for longer than the answers support. */
  function construction(f, day) {
    const year = /^\d{4}$/.test(String(f.built ?? "")) ? Number(f.built) : null;
    const assumed = !isDate(f.cofo);
    const from = !assumed ? f.cofo : year ? year + "-01-01" : null;
    if (!from || (year && (year < 1600 || year > Number(day.slice(0, 4)))))
      return { known: false };
    const turns15 = addYears(from, 15);
    return { known: true, year: year ?? Number(from.slice(0, 4)), isNew: day < turns15, turns15, assumed };
  }

  function classify(lease, today) {
    const f = lease?.facts || {};
    const day = agreementDay(f, today);
    const type = f.unitType,
      owner = f.ownerKind;
    const need = [];
    if (!unitTypes.includes(type)) need.push("unitType");
    if (!yn(f.inCity)) need.push("inCity");
    if (!ownerKinds.includes(owner)) need.push("ownerKind");
    const age = construction(f, day);
    if (!age.known) need.push("built");
    if ((type === "house" || type === "room") && !yn(f.otherUnitOnLot)) need.push("otherUnitOnLot");
    if (type === "apartment" && !buildingSizes.includes(f.buildingUnits)) need.push("buildingUnits");
    const duplex = type === "apartment" && f.buildingUnits === "2";
    if ((type === "adu" || type === "room" || duplex) && !yn(f.ownerOnSite)) need.push("ownerOnSite");
    if (need.length) return { known: false, need };

    const inCity = f.inCity === "yes";
    const onSite = f.ownerOnSite === "yes";
    const separate = type === "condo" || ((type === "house" || type === "room") && f.otherUnitOnLot === "no");
    const qualifying = owner !== "corp";
    /* An owner who lives on the property: just cause does not apply when the tenant shares the owner’s kitchen or
       bathroom (Civ. Code § 1946.2(e)(3)), or when the owner rents out no more than two units or bedrooms there
       (§ 1946.2(e)(4)(A); SDMC § 98.0703). Neither fact is assumed. */
    const ownerLives = (type === "adu" || type === "room") && onSite;
    const shares = type === "room" && f.sharedKitchenBath === "yes";
    if (ownerLives && !(separate && qualifying) && !age.isNew && f.coverageOverride !== "covered" && f.affordable !== "yes") {
      if (type === "room" && !yn(f.sharedKitchenBath)) return { known: false, need: ["sharedKitchenBath"] };
      if (!shares && !yn(f.ownerRentsMore)) return { known: false, need: ["ownerRentsMore"] };
    }
    const fewRented = shares || f.ownerRentsMore === "no";
    const shortTerm =
      f.kind === "Fixed term" && isDate(f.termStart) && isDate(f.end) && f.end < addMonths(f.termStart, 3);
    const facts = [unitLabel[type], ownerLabel[owner], "Built " + age.year, inCity ? "Inside the City of San Diego" : "Outside the City of San Diego"];
    const cityLaw = " and of Chapter 9, Article 8, Division 7 of the San Diego Municipal Code";
    const both = "the rent limits of California Civil Code section 1947.12 and the just cause requirements of Civil Code section 1946.2" + (inCity ? cityLaw : "");
    const causeOnly = "the just cause requirements of California Civil Code section 1946.2" + (inCity ? cityLaw : "");
    const result = (row, cap, cause, extra) => ({
      known: true,
      row,
      cap,
      cause,
      city: !inCity ? "outside" : cause === "applies" ? "applies" : "exempt",
      // A fixed term of three months or less is outside the City ordinance while it lasts (SDMC § 98.0702).
      shortTerm: Boolean(inCity && shortTerm && cause === "applies"),
      notices: [],
      statement: "",
      guide: false,
      facts,
      turns15: "",
      overridden: false,
      ...extra,
    });

    let c;
    if (f.coverageOverride === "covered") {
      c = result("override-covered", "applies", "applies", {
        overridden: true,
        title: "Treated as covered by the rent cap and just-cause rules",
        reason: "You chose to treat this home as covered. The lease gives the tenant the covered-property notices.",
      });
    } else if (f.affordable === "yes") {
      c = result("affordable", "exempt", "exempt", {
        title: "Affordable-housing program rules apply",
        reason: "Deed-restricted or subsidized affordable housing is outside the state rent cap and just-cause law and follows its own program rules. Have the program administrator review this lease.",
        statement: "This home is restricted as affordable housing by a deed, regulatory agreement or other recorded document. The rules of that program apply to rent and to ending the tenancy.",
      });
    } else if (separate && qualifying) {
      /* Checked before the 15-year rule: this exemption lasts, but only if the statements are in the lease. */
      c = result("separate", "exempt", "exempt", {
        title: "Exempt: a " + (type === "condo" ? "condo" : "house") + " owned by people, not a corporation",
        reason: "A home that can be sold on its own and is not owned by a corporation, REIT or LLC with a corporate member is exempt, but only when the lease contains the exact exemption statement" + (inCity ? "s. Both the state and the City statement are in your lease." : ". It is in your lease."),
        notices: inCity ? ["stateExempt", "cityExempt"] : ["stateExempt"],
      });
    } else if (duplex && onSite) {
      c = result("duplex", "exempt", "exempt", {
        title: "Exempt: you live in the other half of the duplex",
        reason: "A two-unit building is exempt while the owner lives in one of the units as a principal residence. The exemption ends if you move out.",
        statement: "The home is one of two dwelling units in a single structure, and Landlord lived in the other unit as Landlord’s principal residence when this tenancy began. While Landlord continues to live there, " + both + " do not apply.",
      });
    } else if (age.isNew) {
      c = result("new", "exempt", "exempt", {
        title: "Exempt for now: built within the last 15 years",
        reason: "Homes with a certificate of occupancy from the last 15 years are exempt from the rent cap and just-cause rules. This ends on " + longDate(age.turns15) + "." + (age.assumed ? " Without the date on the certificate, the 15 years are counted from January 1, " + age.year + "." : ""),
        statement: "Landlord states that this home was issued its certificate of occupancy within the previous 15 years. For that reason " + both + " do not currently apply to it. These exemptions end when the home is 15 years old, on or about " + longDate(age.turns15) + ".",
        turns15: age.turns15,
      });
    } else if (ownerLives && fewRented) {
      c = result("ownerHome", "applies", "exempt", {
        title: "Rent cap applies; just-cause rules do not",
        reason: (shares ? "Because the tenant shares your kitchen or bathroom in the home you live in" : "Because you live on the property and rent out no more than two units or bedrooms there") + ", the just-cause rules do not apply. The state rent cap still limits yearly increases.",
        statement: "The rent limits of California Civil Code section 1947.12 apply to this home. Because " + (shares ? "Tenant shares kitchen or bathroom facilities with Landlord, who lives at the property as Landlord’s principal residence" : "Landlord lives at the property as Landlord’s principal residence and rents no more than two units or bedrooms there") + ", " + causeOnly + " do not apply.",
      });
    } else {
      c = result("covered", "applies", "applies", {
        title: "Covered by the rent cap and just-cause rules",
        reason:
          (owner === "corp"
            ? "Homes owned by a corporation, REIT or LLC with a corporate member are covered. "
            : ownerLives
              ? "An owner who rents out more than two units or bedrooms on the property cannot use the owner-occupied exemption. "
              : type === "house" || type === "room"
                ? "A house that shares its lot with another rentable unit cannot use the single-home exemption. "
                : "") +
          "Yearly rent increases are capped, and ending the tenancy requires a legal reason" +
          (!inCity ? " once the tenant has lived there 12 months." : shortTerm ? " under San Diego’s ordinance if the tenant stays on after this short term." : " from the first day under San Diego’s ordinance."),
      });
    }
    if (f.coverageOverride === "exempt" && c.cap === "applies" && qualifying) {
      c = result("override-exempt", "exempt", "exempt", {
        overridden: true,
        title: "Treated as exempt at your direction",
        reason: "You told us this home is exempt. The builder could not confirm that from your answers, so check with an attorney. The lease contains the exemption statement" + (inCity ? "s." : "."),
        notices: inCity ? ["stateExempt", "cityExempt"] : ["stateExempt"],
      });
    }
    if (c.cause === "applies") {
      // Inside the City the ordinance requires its own notice and the Guide; the state notice is printed with it.
      c.notices = c.city === "applies" ? ["cityCovered", "stateCovered"] : ["stateCovered"];
      c.guide = c.city === "applies";
    }
    if (c.shortTerm)
      c.reason += " A fixed term of three months or less is outside the City ordinance while it lasts. The City notice and Guide are included because the ordinance applies if the tenancy continues.";
    return c;
  }

  /* Civil Code § 1950.5(c). */
  function depositLimit(lease) {
    const f = lease?.facts || {};
    const rent = amount(f.rent);
    const two = f.depositSmallOwner === "yes" && f.ownerKind !== "corp" && f.service !== "yes";
    const months = two ? 2 : 1;
    return {
      months,
      max: rent === null ? null : Math.round(rent * months * 100) / 100,
      reason: two
        ? "Up to two months’ rent, because you own no more than two rental properties with four units in total and no tenant is a service member."
        : f.service === "yes"
          ? "One month’s rent. The two-month exception is not available when a tenant is a service member."
          : "One month’s rent is the California limit. Small owners (no more than two rental properties and four units) may take up to two.",
    };
  }

  const STEP = { home: 0, people: 1, terms: 2, rules: 3, disclosures: 4, review: 5 };
  /* Starting values the builder offers. A late charge must be a modest estimate of cost (Civ. Code § 1671(d)):
     2% of the rent, rounded to $5, at least $25. */
  const suggest = Object.freeze({
    lateFee: (rent) => {
      const value = amount(rent);
      return value ? String(Math.max(25, Math.round((value * 0.02) / 5) * 5)) : "";
    },
    lateFeeDay: "5",
    deposit: (rent) => (amount(rent) ? String(amount(rent)) : ""),
  });

  function analyze(lease, today) {
    const f = lease?.facts || {};
    const day = agreementDay(f, today);
    const amendment = f.kind === "Amendment";
    const coverage = classify(lease, today);
    const items = [],
      blockers = [],
      warnings = [],
      attachments = [];
    const item = (id, title, kind, state, summary, why, cite, url, ask) =>
      items.push({ id, title, kind, state, summary, why, cite, url, ...(ask ? { ask } : {}) });
    const block = (step, field, message) => blockers.push({ step, field, message });

    // --- Tenant protections ---
    if (!coverage.known && !amendment) {
      const prompts = {
        unitType: "Choose what kind of home this is.",
        inCity: "Say whether the home is inside the City of San Diego.",
        ownerKind: "Say who owns the home.",
        built: "Enter the year the home was built.",
        otherUnitOnLot: "Say whether another rentable unit shares the lot.",
        buildingUnits: "Say how many homes are in the building.",
        ownerOnSite: "Say whether you live on the property.",
        sharedKitchenBath: "Say whether the tenant will share your kitchen or bathroom.",
        ownerRentsMore: "Say whether you rent out more than two units or bedrooms on the property.",
      };
      coverage.need.forEach((k) => block(STEP.home, k, prompts[k]));
      item("tenantProtections", "Rent cap and just-cause notices", "notice", "needs-answer",
        "The notice California and San Diego require about rent increases and ending a tenancy.",
        "Finish the questions about the home so we can tell which notice your lease needs.",
        "Civil Code §§ 1946.2, 1947.12; San Diego Municipal Code § 98.0705", code("1946.2"), coverage.need[0]);
    } else if (!amendment) {
      const exempt = coverage.notices.includes("stateExempt");
      item("tenantProtections", coverage.cause === "applies" ? "Rent cap and just-cause notices" : exempt ? "Exemption statement" : "Tenant-protection statement", "notice",
        coverage.row === "affordable" || coverage.row === "override-exempt" ? "attention" : "included",
        coverage.cause === "applies"
          ? "The required notice that rent increases are capped and that ending the tenancy takes a legal reason, in 12-point type."
          : exempt
            ? "The exact statement the law requires for a home to be exempt from the rent cap and just-cause rules."
            : "A plain statement of which tenant-protection rules apply to this home.",
        coverage.reason,
        coverage.city === "outside" ? "Civil Code §§ 1946.2 and 1947.12" : "Civil Code §§ 1946.2 and 1947.12; San Diego Municipal Code §§ 98.0703 and 98.0705",
        code("1946.2"));
      if (coverage.guide) {
        attachments.push({ ...handouts.guide, giveBeforeSigning: true });
        item("tpGuide", "San Diego Tenant Protection Guide", "attachment", "attached",
          "The City’s 20-page guide to tenant rights, which must be given with the notice.",
          "The home is covered by San Diego’s tenant-protection ordinance.",
          "San Diego Municipal Code § 98.0705(b)", sdmc);
      }
      /* A month-to-month tenancy has no end, so it is warned about when the date is within two years. */
      const openEnded = f.kind === "Month to month";
      const horizon = openEnded ? addYears(isDate(f.termStart) ? f.termStart : day, 2) : f.end;
      if (coverage.turns15 && isDate(horizon) && coverage.turns15 <= horizon)
        warnings.push({ id: "turns15", step: STEP.home, message: "This home turns 15 years old on " + longDate(coverage.turns15) + ", during the " + (openEnded ? "tenancy" : "lease") + ". After that date the rent cap and just-cause rules apply and you must give the tenant the required notice." });
    }
    if (coverage.known && coverage.city === "outside")
      warnings.push({ id: "outsideCity", step: STEP.home, message: "This builder is tuned for the City of San Diego. For a home in another city or the unincorporated county it applies California law only, so check whether your city has its own rental rules." });

    // --- Owner and manager details, payment (Civ. Code §§ 1962, 1947.3) ---
    const contactGaps = [
      ["landlord", "Enter the landlord’s name."],
      ["noticeAddress", "Enter a street address where the tenant can deliver notices and legal papers."],
      ["noticePhone", "Enter a phone number for the landlord or manager."],
    ].filter(([k]) => !filled(f[k]) && !(amendment && k !== "landlord"));
    contactGaps.forEach(([k, message]) => block(STEP.people, k, message));
    item("contacts", "Who to contact and where to send notices", "term", contactGaps.length ? "needs-answer" : "included",
      "The landlord’s or manager’s name, phone number and street address, which every California lease must show.",
      contactGaps.length ? "Add the missing contact details." : "Your details are in the Notices section.",
      "Civil Code § 1962", code("1962"), contactGaps[0]?.[0]);
    if (!amendment) {
      const methods = String(f.payMethods || "").split(",").filter(Boolean);
      const paper = methods.includes("check") || methods.includes("moneyorder");
      if (!paper) block(STEP.terms, "payMethods", "Accept a check or money order. California requires at least one way to pay that is neither cash nor electronic.");
      item("payment", "How rent can be paid", "term", paper ? "included" : "needs-answer",
        "The ways the tenant may pay rent, including at least one that is neither cash nor electronic.",
        paper ? "Your accepted payment methods are listed in the Rent section." : "Add a check or money order to the accepted methods.",
        "Civil Code §§ 1947.3 and 1962", code("1947.3"), paper ? "" : "payMethods");
      /* Rent that may be paid in person needs the usual days and hours (Civ. Code § 1962(a)(2)(A)). Cash can only be paid in person. */
      if (methods.includes("cash") && !filled(f.payHours))
        block(STEP.terms, "payHours", "Say on which days and at what hours the tenant can pay in person. A lease that accepts cash must state them.");

      // --- Security deposit (Civ. Code § 1950.5) ---
      const rent = amount(f.rent),
        deposit = amount(f.deposit),
        limit = depositLimit(lease);
      const above = deposit !== null && limit.max !== null && deposit > limit.max;
      /* The limit does not reach a deposit collected before July 1, 2024 (Civ. Code § 1950.5(c)(6)). On a renewal the
         deposit is the one already held, so the date the tenant first moved in decides. */
      const older = above && f.kind === "Renewal" && isDate(f.start) && f.start < "2024-07-01";
      const over = above && !older;
      if (older)
        warnings.push({ id: "depositOlder", step: STEP.terms, message: "The deposit you hold is above today’s limit of " + money(limit.max) + ". California lets you keep a deposit collected before July 1, 2024, but do not add to it." });
      if (over) block(STEP.terms, "deposit", "The deposit is more than California allows (" + limit.months + (limit.months === 1 ? " month’s" : " months’") + " rent). Lower it to " + money(limit.max) + " or less.");
      item("deposit", "Security deposit rules", "term", over ? "needs-answer" : "included",
        "The deposit limit, what it may be used for, the move-out inspection and the 21-day refund.",
        over ? "Lower the deposit to the legal limit." : limit.reason,
        "Civil Code § 1950.5", code("1950.5"), over ? "deposit" : "");
      if (f.lateFee === "yes" && rent && amount(f.lateFeeAmount) !== null && amount(f.lateFeeAmount) > rent * 0.05)
        warnings.push({ id: "lateFee", step: STEP.terms, message: "A late charge above 5% of the rent is hard to defend. California allows only a charge that reasonably estimates what a late payment costs you, and courts have struck down larger ones." });
    }

    // --- Notices printed in every lease ---
    if (!amendment) {
      item("megan", "Megan’s Law notice", "notice", "included",
        "A required notice about the state’s registered sex offender website.",
        "California requires it in residential leases.", "Civil Code § 2079.10a", code("2079.10a"));
      const floodAnswered = yn(f.floodKnown);
      if (!floodAnswered) block(STEP.disclosures, "floodKnown", "Say whether you know the home is in a flood hazard area.");
      item("flood", "Flood information", "notice", floodAnswered ? "included" : "needs-answer",
        "Tells the tenant where to check flood risk and recommends renter’s and flood insurance.",
        floodAnswered ? (f.floodKnown === "yes" ? "Includes your disclosure that the home is in a flood hazard area." : "You know of no flood hazard designation. The general information is included.") : "Answer the flood question.",
        "Government Code § 8589.45", code("8589.45", "GOV"), floodAnswered ? "" : "floodKnown");
      item("bedbugs", "Bed bug information sheet", "notice", "included",
        "The state’s information about bed bugs and how the tenant should report them.",
        "Required before a new tenancy begins.", "Civil Code § 1954.603", code("1954.603"));
      attachments.push({ ...handouts.mold, giveBeforeSigning: true });
      item("mold", "Dampness and mold booklet", "attachment", "attached",
        "The state health department’s booklet for renters" + (f.moldKnown === "yes" ? ", plus your description of the mold you know about." : "."),
        "Landlords must give it to tenants before they sign.", "Health & Safety Code §§ 26147–26148", code("26148", "HSC"));

      // --- Lead-based paint (40 CFR 745 subpart F) ---
      const age = construction(f, day);
      if (age.known && age.year < 1978) {
        const gaps = ["leadKnown", "leadRecords"].filter((k) => !yn(f[k]));
        if (gaps.includes("leadKnown")) block(STEP.disclosures, "leadKnown", "Say whether you know of any lead-based paint or lead hazards in the home.");
        if (gaps.includes("leadRecords")) block(STEP.disclosures, "leadRecords", "Say whether you have any reports or records about lead paint in the home.");
        if (f.leadKnown === "yes" && !filled(f.leadDetails)) block(STEP.disclosures, "leadDetails", "Describe the lead-based paint or hazards you know about.");
        if (f.leadRecords === "yes" && !filled(f.leadRecordsList)) block(STEP.disclosures, "leadRecordsList", "List the lead reports or records you will give the tenant.");
        attachments.push({ ...handouts.lead, giveBeforeSigning: true });
        item("lead", "Lead-based paint disclosure", "notice", gaps.length ? "needs-answer" : "included",
          "The federal warning, your disclosure, the tenant’s acknowledgment, and the EPA pamphlet.",
          "The home was built before 1978.", "40 CFR §§ 745.107 and 745.113", lead, gaps[0]);
      } else if (age.known) {
        item("lead", "Lead-based paint disclosure", "notice", "not-needed",
          "A federal disclosure for homes built before 1978.", "The home was built in " + age.year + ".",
          "40 CFR § 745.101", lead);
      }

      // --- Appliances (Civ. Code § 1941.1) ---
      item("appliances", "Working stove and refrigerator", "term", "included",
        f.ownFridge === "yes" ? "The landlord provides the stove. The tenant has asked to bring a refrigerator, so the lease has the required checkbox for the tenant to mark." : "The landlord provides and maintains a working stove and refrigerator.",
        "Required for California leases signed in 2026 or later.", "Civil Code § 1941.1", code("1941.1"));
      item("entry", "Rules for the landlord’s entry", "term", "included",
        "Entry only for the reasons the law allows, with written notice.",
        "Tenants cannot waive these rules, so the lease follows them exactly.", "Civil Code § 1954", code("1954"));
    }

    // --- City of San Diego texts that apply whatever the exemption status ---
    if (!amendment && f.inCity === "yes") {
      item("daycare", "Family daycare notice", "notice", "included",
        "A City notice that state law protects a tenant’s right to run a licensed family daycare home.",
        "Every written lease in the City of San Diego must include it, in 12-point type.", "San Diego Municipal Code § 98.0903", sdmcDaycare);
      const billed = cityBilled(f);
      if (billed.length)
        item("utilityFees", "City utility charges passed to the tenant", "notice", "included",
          "The City’s notice about billing a tenant for " + billed.join(", ") + ": you may charge only what you pay, and must show the bill within 10 days if asked.",
          f.util_trash === "tenant" ? "The City bills trash collection to the owner, so a tenant who pays for it is reimbursing you." : "The account stays in your name and the tenant reimburses you.",
          "San Diego Municipal Code §§ 98.1203–98.1205", sdmcUtility);
      item("rentalTax", "City rental unit business tax", "todo", "reminder",
        "The City charges every landlord a small yearly tax (about $55 for one home), due March 1.",
        "This is your bill, not the tenant’s. It is not part of the lease.", "San Diego Municipal Code ch. 3, art. 1", links.rentalTax);
      if ((f.unitType === "apartment" && ["5-15", "16+"].includes(f.buildingUnits)) || f.unitType === "condo" || f.hoa === "yes")
        item("recycling", "Recycling instructions at move-in", "todo", "reminder",
          "Where a private hauler or a homeowners association handles collection, give each new tenant the recycling rules at move-in, and again once a year.",
          "A City rule for apartment buildings and association-served homes. It is not part of the lease.", "San Diego Municipal Code § 66.0706(d)", "https://docs.sandiego.gov/municode/MuniCodeChapter06/Ch06Art06Division07.pdf");
      const built = construction(f, day);
      if (built.known && built.year < 1978)
        item("leadInspection", "City lead paint check between tenants", "todo", "reminder",
          "For homes built before 1978 the City requires a visual check for peeling paint each time a tenant moves out, recorded on the City’s form and kept three years.",
          "The home was built in " + built.year + ". It is not part of the lease.", "San Diego Municipal Code § 54.1009", sdmcLead);
    }

    // --- Situations that only sometimes apply ---
    if (!amendment) {
      if (f.pestService === "yes")
        item("pest", "Pest control company notice", "todo", "attention",
          "Give the tenant a copy of the notice your pest control company gave you.",
          "You have a regular pest control service. Add its notice under Attachments.", "Civil Code § 1940.8", code("1940.8"));
      if (f.sharedMeter === "yes") {
        if (!filled(f.sharedMeterDetails)) block(STEP.disclosures, "sharedMeterDetails", "Describe what the shared meter serves and who will pay for it.");
        item("sharedMeter", "Shared utility meter", "notice", filled(f.sharedMeterDetails) ? "included" : "needs-answer",
          "Discloses that the tenant’s gas or electric meter also serves another area, and who pays for that.",
          "You told us the meter serves areas outside the tenant’s home.", "Civil Code § 1940.9", code("1940.9"), "sharedMeterDetails");
      }
      if (f.deathRecent === "yes")
        item("death", "Death in the home within three years", "notice", "included",
          "Discloses that a death occurred in the home in the last three years.",
          "You told us about a recent death. Never state that anyone had HIV or AIDS.", "Civil Code § 1710.2", code("1710.2"));
      if (f.demolition === "yes") {
        if (!filled(f.demolitionDetails)) block(STEP.disclosures, "demolitionDetails", "Give the earliest approximate dates demolition may begin and the tenancy may end.");
        item("demolition", "Demolition permit", "notice", filled(f.demolitionDetails) ? "included" : "needs-answer",
          "Tells the tenant you have applied for a permit to demolish the home.",
          "Required before taking a deposit or signing.", "Civil Code § 1940.6", code("1940.6"), "demolitionDetails");
      }
      if (f.ordnance === "yes")
        item("ordnance", "Former military ordnance site", "notice", "included",
          "Tells the tenant about a former military ordnance location within one mile.",
          "You told us you know of one nearby.", "Civil Code § 1940.7", code("1940.7"));
      if (f.contamination === "yes")
        item("contamination", "Contamination order", "todo", "attention",
          "A health officer’s methamphetamine or fentanyl contamination order may bar renting the home.",
          "Speak with an attorney before renting. This builder cannot prepare that notice.", "Health & Safety Code § 25400.28", code("25400.28", "HSC"));
      if (f.ownerPesticide === "yes")
        item("ownerPesticide", "Pesticides you apply yourself", "todo", "attention",
          "If you or your manager apply pesticides in shared areas on a regular schedule, each new tenant must get a written notice with the product, the schedule and a state caution statement before signing.",
          "Give that notice before signing. This builder does not write it.", "Civil Code § 1940.8.5", code("1940.8.5"));
      if (f.waterSubmeter === "yes")
        item("waterSubmeter", "Separate water billing", "todo", "attention",
          "Billing tenants separately for submetered water needs its own written disclosure before signing.",
          "Add your water-billing disclosure under Attachments. This builder does not write it.", "Civil Code § 1954.204", code("1954.204"));
      if (f.buildingUnits === "16+" || (f.ownerKind === "corp" && f.multipleBuildings === "yes"))
        item("rentReporting", "Rent-reporting offer", "todo", "attention",
          "Larger and corporate landlords must offer tenants the option of having on-time rent reported to a credit bureau.",
          "Give the tenant the written offer at signing and once a year.", "Civil Code § 1954.07", code("1954.07"));
      if (filled(f.negotiatedLanguage) && f.negotiatedLanguage !== "english")
        item("language", "Translated copy of the lease", "todo", "attention",
          "When a lease is negotiated mainly in Spanish, Chinese, Tagalog, Vietnamese or Korean, the tenant must receive a translation before signing.",
          "Give the tenant a translation of this lease in that language before anyone signs.", "Civil Code § 1632", code("1632"));
      if (f.section8 === "yes")
        item("section8", "Housing voucher addendum", "todo", "attention",
          "A tenant with a Section 8 voucher needs HUD’s Tenancy Addendum attached, and its terms control.",
          "Attach the addendum from the housing commission and have it approve the lease.", "24 CFR § 982.308", "https://www.hud.gov/sites/dfiles/OCHCO/documents/52641A.pdf");
      if (f.rareReviewed !== "yes")
        block(STEP.disclosures, "rareReviewed", "Review the list of less common situations and confirm which apply.");
      item("copy", "Give each tenant a signed copy", "todo", "included",
        "A copy of the signed lease is due to the tenant within 15 days.",
        "We add a reminder when you record the signed lease.", "Civil Code § 1962(a)(4)", code("1962"));
      item("petPolicy", "Written pet policy for applicants", "todo", "reminder",
        "From April 1, 2027, landlords must give rental applicants a written pet policy and link to it in online listings, even when the policy is “no pets.”",
        "The Pets section of this lease can serve as your policy. It is not part of the lease.", "Civil Code § 1942.7.5 (SB 1296, 2026)", "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260SB1296");
      if (f.kind !== "Renewal")
        item("photos", "Move-in photos", "todo", "included",
          "Photograph the home right before or at move-in to support any later deposit deductions.",
          "Required for tenancies that begin on or after July 1, 2025.", "Civil Code § 1950.5(g)", code("1950.5"));
    }
    return { coverage, items, attachments, blockers, warnings };
  }

  globalThis.LeaseLaw = Object.freeze({
    version,
    reviewed,
    texts,
    handouts,
    sources,
    links,
    suggest,
    cityBilled,
    steps: Object.freeze(STEP),
    isDate,
    amount,
    money,
    addMonths,
    addYears,
    longDate,
    classify,
    depositLimit,
    analyze,
  });
})();
