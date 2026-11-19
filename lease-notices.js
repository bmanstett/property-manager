/* Tenant-facing California notices, verified November 18, 2026. */
(() => {
  "use strict";

  // Civil Code § 2079.10a(a)(1)–(3), reproduced in the 2026 DRE code excerpts.
  // https://www.dre.ca.gov/files/pdf/relaw/excerpts.pdf
  const registryNotice = "Notice: Pursuant to Section 290.46 of the Penal Code, information about specified registered sex offenders is made available to the public via an Internet Web site maintained by the Department of Justice at www.meganslaw.ca.gov. Depending on an offender’s criminal history, this information will include either the address at which the offender resides or the community of residence and ZIP Code in which the offender resides.";
  const historicalRegistryNotice = [
    "Notice: The California Department of Justice, sheriff’s departments, police departments serving jurisdictions of 200,000 or more, and many other local law enforcement authorities maintain for public access a database of the locations of persons required to register pursuant to subdivision (a) of Section 290.4 of the Penal Code. The database is updated on a quarterly basis and is a source of information about the presence of these individuals in any neighborhood.",
    "The Department of Justice also maintains a Sex Offender Identification Line through which inquiries about individuals may be made. This is a “900” telephone service. Callers shall have specific information about individuals they are checking. Information regarding neighborhoods is not available through the “900” telephone service.",
  ];

  // Civil Code § 1954.603(a), chaptered AB 551, followed by the procedure under (b).
  // https://www.leginfo.ca.gov/pub/15-16/bill/asm/ab_0551-0600/ab_551_bill_20160925_chaptered.htm
  const bedbugNotice = [
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
  ];

  // Government Code § 8589.45(a)(2)–(4) requires all three statements. Only
  // (a)(1), the property's flood designation, depends on the owner's knowledge.
  const floodNotice = [
    "You can look up hazards, including flood hazards, that may affect this property using the California Governor’s Office of Emergency Services MyHazards tool at https://myhazards.caloes.ca.gov/.",
    "The owner’s insurance does not cover loss of your personal possessions. Consider purchasing renter’s insurance and flood insurance to protect your belongings against fire, flood, and other risks of loss.",
    "California Government Code § 8589.45 does not require the owner to provide additional information about flood hazards to this property. The information provided under this section is deemed adequate to inform the tenant.",
  ];

  // Civil Code § 1946.2(f)(1)(A), (f)(3), as amended by AB 1529 (2025, ch. 203).
  // The covered-property notice may be in the agreement for an ordinary residential tenancy.
  // https://www.dre.ca.gov/files/pdf/relaw/excerpts.pdf
  const coveredPropertyNotice = "California law limits the amount your rent can be increased. See Section 1947.12 of the Civil Code for more information. California law also provides that after all of the tenants have continuously and lawfully occupied the property for 12 months or more or at least one of the tenants has continuously and lawfully occupied the property for 24 months or more, a landlord must provide a statement of cause in any notice to terminate a tenancy. See Section 1946.2 of the Civil Code for more information.";

  function printCoveredPropertyNotice(f, status) {
    const currentTerm = f.kind === "Renewal" ? f.termStart : f.start;
    return f.agreementDate >= "2026-01-01" && f.agreementDate < "2030-01-01" &&
      ["Fixed term", "Month to month", "Renewal"].includes(f.kind) &&
      globalThis.LeaseRules.isDate(currentTerm) && currentTerm >= "2020-07-01" &&
      f.regulated === "No" &&
      ["Separately transferable home or condo", "Duplex", "Apartment"].includes(f.propertyType) &&
      Boolean(f.jurisdiction && f.boundarySource) &&
      (f.jurisdiction !== "City of San Diego" || f.sdCoverage === "Exempt") &&
      f.capCoverage === "Covered" && status.get("cap") === "Required" &&
      f.causeCoverage === "Covered" && status.get("cause") === "Required";
  }

  // Civil Code § 1941.1(a)(10)–(11), added by AB 628 (2025, ch. 342).
  // https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260AB628
  function appliances(tenantRequestedFridge) {
    const lines = ["The landlord will provide and maintain a working stove capable of safely generating heat for cooking."];
    if (tenantRequestedFridge) {
      lines.push(
        "You may choose to supply your own refrigerator if you and the landlord agree at signing. This choice is voluntary. If you leave the box blank, the landlord will provide and maintain a working refrigerator capable of safely storing food.",
        "□ Under state law, the landlord is required to provide a refrigerator in good working order in your unit. By checking this box, you acknowledge that you have asked to bring your own refrigerator and that you are responsible for keeping that refrigerator in working order.",
        "If you choose to supply your own refrigerator, you may later give the landlord 30 days’ written notice that you no longer wish to keep it in the unit. At the end of that notice period, the landlord will install a refrigerator in good working order in the unit and maintain it.",
      );
    } else {
      lines.push("The landlord will provide and maintain a working refrigerator capable of safely storing food.");
    }
    return { heading: "Kitchen appliances", lines, bodySize: 12, keepTogether: true };
  }

  function sections(draft, outcomes) {
    const f = draft.facts;
    const status = new Map(outcomes.map((outcome) => [outcome.id, outcome.status]));
    if (
      !status.has("floodBaseline") ||
      !["CA", "CALIFORNIA"].includes(String(f.state || "").trim().toUpperCase()) ||
      !globalThis.LeaseRules.isDate(f.agreementDate)
    ) return [];

    const result = [];
    if (status.get("floodBaseline") === "Required") {
      const lines = [...floodNotice];
      if (f.flood === "Yes") {
        lines.unshift("The owner has actual knowledge that this property is located in a special flood hazard area or an area of potential flooding.");
      } else if (f.flood !== "No") {
        lines.unshift("[Draft pending the owner’s confirmation of a known flood hazard designation.]");
      }
      result.push({ heading: "Flood hazard disclosure", lines });
    }
    if (status.get("megan") === "Required") {
      const historical = f.agreementDate < "2005-09-01";
      result.push({
        heading: historical ? "Megan’s Law notice for the historical agreement date" : "Megan’s Law notice",
        lines: historical ? [...historicalRegistryNotice] : [registryNotice],
      });
    }
    const bedbugStatus = status.get("bedbugs");
    if (bedbugStatus === "Required" || (
      bedbugStatus === "More information needed" &&
      f.agreementDate >= "2017-07-01" &&
      ["Fixed term", "Month to month"].includes(f.kind)
    )) {
      const contact = String(f.bedbugContact || "").trim() || String(f.noticeContact || "").trim();
      result.push({
        heading: "Information about Bed Bugs",
        lines: [
          ...bedbugNotice,
          "Promptly report suspected bed bugs to the landlord in writing. Send the report to " +
            (contact || "[written reporting contact pending]") +
            ". Give your unit and the location where you saw signs of bed bugs.",
          "Early reporting and cooperation help prevent the spread of bed bugs. Cooperate with the pest control operator’s inspection and follow preparation and treatment instructions.",
        ],
      });
    }
    if (printCoveredPropertyNotice(f, status)) {
      result.push({ heading: "California Tenant Protection Act notice", lines: [coveredPropertyNotice], bodySize: 12, keepTogether: true });
    }
    if (status.get("stove") === "Required" && f.agreementDate >= "2026-01-01" &&
      f.applianceException === "No" && ["No", "Yes"].includes(f.ownFridge)) {
      result.push(appliances(f.ownFridge === "Yes"));
    }
    return result;
  }
  globalThis.LeaseNotices = { sections };
})();
