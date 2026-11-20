/* Recommended and optional lease clauses for a California home in the City of San Diego.
   Each entry is written to stay inside California law: nothing here waives a right the Civil Code
   makes non-waivable (§§ 1942.1, 1950.5, 1953, 1954). Reviewed with lease-law.js. */
(() => {
  "use strict";
  const law = () => globalThis.LeaseLaw;
  const filled = (v) => String(v ?? "").trim() !== "";
  const p = (text, extra) => ({ t: "p", text, ...extra });
  /* A paragraph that opens with a bold run-in title, used when a clause joins a larger section. */
  const titled = (title, text) => ({ t: "p", runs: [{ text: title + ". ", bold: true }, { text }] });
  const tenantNames = (lease) => (lease.tenants || []).map((t) => String(t.name || "").trim()).filter(Boolean);
  const coverage = (lease) => law().classify(lease, lease?.facts?.agreementDate || "");

  const groups = Object.freeze([
    { id: "living", title: "Everyday living", blurb: "The house rules most landlords set." },
    { id: "money", title: "Money and protection", blurb: "Insurance, the deposit refund, and what happens in a dispute." },
    { id: "care", title: "Taking care of the home", blurb: "Who looks after what, in plain terms." },
    { id: "extras", title: "The building and extras", blurb: "Only what fits this home." },
    { id: "plans", title: "Your plans as owner", blurb: "Rights you keep only if the lease says so." },
  ]);

  /* slot: where the wording goes in the lease.
       "pets" | "smoking" | "sublet" | "insurance" | "parking"   → the clause is that whole numbered section
       "occupancy" | "deposit" | "care" | "changes" | "conduct" | "ending" | "protections" | "general"
                                                               → added to that section under a bold title
     level: "policy" (every lease answers it; no on/off switch) | "recommended" (on by default) | "optional". */
  const library = [
    {
      id: "pets",
      group: "living",
      slot: "pets",
      level: "policy",
      title: "Pets",
      summary: "Say whether pets are allowed and on what terms.",
      options: [
        { key: "policy", label: "Are pets allowed?", type: "choice", def: "none", choices: [["none", "No pets"], ["approved", "Only the pets I list"], ["allowed", "Pets welcome"]] },
        { key: "details", label: "Pets you approve", type: "text", def: "", when: (o) => o.policy === "approved", help: "For example: one cat, or one dog under 40 pounds named Scout." },
        { key: "petRent", label: "Monthly pet rent (optional)", type: "money", optional: true, def: "", when: (o) => o.policy !== "none", help: "Leave blank for none. A pet deposit counts toward the deposit limit, so include it in the security deposit." },
      ],
      section(lease, o) {
        const blocks = [];
        if (o.policy === "none")
          blocks.push(p("No pets or other animals may be kept in the home or on the property without Landlord’s prior written consent."));
        else {
          blocks.push(
            p(
              o.policy === "approved"
                ? "Tenant may keep only the following animals: " + (filled(o.details) ? o.details.trim().replace(/\.$/, "") : "[list the approved pets]") + ". Any other animal needs Landlord’s prior written consent."
                : "Tenant may keep common household pets. Tenant will tell Landlord in writing what animals live in the home.",
            ),
            p("Tenant will keep each animal under control, clean up after it promptly, prevent noise that disturbs neighbors, follow all licensing, leash and vaccination laws, and pay for any damage the animal causes beyond ordinary wear and tear."),
          );
          if (law().amount(o.petRent))
            blocks.push(p("Tenant will pay pet rent of " + law().money(o.petRent) + " each month, due with the rent."));
        }
        blocks.push(
          titled(
            "Assistance animals",
            "A service animal or support animal that a person with a disability needs is not a pet. The limits in this section do not apply to it, and Landlord will not charge a deposit, pet rent or other fee for it. Tenant remains responsible for any damage the animal causes beyond ordinary wear and tear.",
          ),
        );
        return { heading: "Pets and animals", blocks };
      },
      note: "Service and emotional-support animals are never “pets” under fair housing law, so the lease says so in every version.",
      cite: "Gov. Code § 12955; Cal. Code Regs., tit. 2, § 12185",
    },
    {
      id: "smoking",
      group: "living",
      slot: "smoking",
      level: "policy",
      title: "Smoking and vaping",
      summary: "California asks the lease to name where smoking is not allowed.",
      options: [
        { key: "policy", label: "Is smoking allowed?", type: "choice", def: "none", choices: [["none", "Not allowed anywhere"], ["outside", "Outdoors in one spot only"], ["allowed", "Allowed"]] },
        { key: "area", label: "Where smoking is allowed", type: "text", def: "", when: (o) => o.policy === "outside", help: "For example: the back patio, at least 20 feet from doors and windows." },
        { key: "grow", label: "Growing cannabis", type: "choice", def: "no", choices: [["no", "Not allowed"], ["yes", "Allowed"]] },
      ],
      section(lease, o) {
        const what = "“Smoking” means inhaling, exhaling, burning or carrying any lighted or heated tobacco, cannabis or other plant product, and using an electronic smoking device.";
        const blocks =
          o.policy === "allowed"
            ? [p("This Lease does not prohibit smoking. Tenant will put out and dispose of smoking materials safely and is responsible for smoke damage or odor that goes beyond ordinary wear and tear.")]
            : [
                p(
                  o.policy === "outside"
                    ? "Smoking is prohibited inside the home and everywhere else on the property except this outdoor area: " + (filled(o.area) ? o.area.trim().replace(/\.$/, "") : "[describe the area]") + "."
                    : "Smoking is prohibited everywhere on the property: inside the home, on balconies, patios and porches, in any garage or storage area, and in all yards and common areas.",
                ),
                p(what + " The rule applies to Tenant and to Tenant’s household and guests. Tenant is responsible for the cost of removing smoke residue or odor caused by a violation, to the extent it goes beyond ordinary wear and tear."),
              ];
        if (o.grow !== "yes") blocks.push(p("Growing cannabis in the home or on the property is not allowed."));
        return { heading: "Smoking", blocks };
      },
      note: "If smoking is banned on any part of the property, the lease must say where.",
      cite: "Civil Code § 1947.5",
    },
    {
      id: "sublet",
      group: "living",
      slot: "sublet",
      level: "policy",
      title: "Subletting and short-term rentals",
      summary: "Keeps you in control of who lives in the home and rules out vacation rentals.",
      options: [
        { key: "policy", label: "May the tenant sublet?", type: "choice", def: "consent", choices: [["consent", "Only with my written OK"], ["never", "Not allowed"]] },
      ],
      section(lease, o) {
        return {
          heading: "Subletting and short-term rentals",
          blocks: [
            p(
              o.policy === "never"
                ? "Tenant will not sublet any part of the home or assign this Lease."
                : "Tenant will not sublet any part of the home or assign this Lease without Landlord’s prior written consent. Landlord may ask a proposed subtenant or new tenant to apply and qualify in the same way as any other applicant.",
            ),
            p("Tenant will not advertise or offer the home, or any part of it, for short stays or vacation rental, for example through Airbnb or Vrbo."),
            p("A person who moves in with Landlord’s consent does not become a tenant until Landlord and that person sign a written agreement."),
          ],
        };
      },
    },
    {
      id: "insurance",
      group: "money",
      slot: "insurance",
      level: "policy",
      title: "Renters insurance",
      summary: "Your insurance does not cover the tenant’s belongings. Decide whether a policy is required.",
      options: [
        { key: "policy", label: "Is renters insurance required?", type: "choice", def: "required", choices: [["required", "Required"], ["recommended", "Recommended"]] },
        { key: "liability", label: "Minimum liability coverage", type: "money", def: "100000", when: (o) => o.policy === "required", help: "$100,000 is the usual minimum and adds little to the premium." },
      ],
      section(lease, o) {
        const blocks = [p("Landlord’s insurance does not cover Tenant’s belongings or Tenant’s liability to others.")];
        blocks.push(
          o.policy === "required"
            ? p("Tenant will carry renter’s insurance for the whole tenancy with personal liability coverage of at least " + (law().money(o.liability).replace(/\.00$/, "") || "$100,000") + " for each occurrence, and will give Landlord proof of coverage within 30 days after the tenancy starts and whenever Landlord reasonably asks.")
            : p("Landlord strongly recommends that Tenant carry renter’s insurance that covers Tenant’s belongings and personal liability."),
        );
        return { heading: "Renters insurance", blocks };
      },
    },
    {
      id: "guests",
      group: "living",
      slot: "occupancy",
      level: "recommended",
      title: "Guests",
      summary: "Visitors are welcome; long stays need your OK so a guest does not quietly become a tenant.",
      options: [{ key: "nights", label: "Nights a guest may stay in any six months", type: "number", def: "14", min: 7, max: 60 }],
      section(lease, o) {
        const nights = /^\d{1,2}$/.test(String(o.nights)) ? Number(o.nights) : 14;
        return {
          heading: "Guests",
          blocks: [titled("Guests", "A guest may stay up to " + nights + " nights in any six-month period. A longer stay needs Landlord’s written consent, which Landlord will not unreasonably withhold. Tenant is responsible for the conduct of guests while they are on the property.")],
        };
      },
    },
    {
      id: "depositReturn",
      group: "money",
      slot: "deposit",
      level: "recommended",
      title: "How the deposit comes back",
      summary: "Agree now on who gets the refund and how the itemized statement is sent, so move-out is simple.",
      options: [
        { key: "refund", label: "With more than one tenant, the refund goes", type: "choice", def: "joint", when: (o, lease) => tenantNames(lease).length > 1, choices: [["joint", "One payment to all tenants"], ["equal", "Split equally"], ["first", "To the first tenant listed"]] },
        { key: "statement", label: "Send the itemized statement by", type: "choice", def: "email", choices: [["email", "Email"], ["mail", "First-class mail"]] },
      ],
      section(lease, o) {
        const names = tenantNames(lease);
        const many = names.length > 1;
        const who = many ? "Landlord and every adult Tenant agree" : "Landlord and Tenant agree";
        const parts = [];
        if (many && o.refund === "equal") parts.push("any refund of the security deposit will be divided equally among the Tenants named in this Lease, each by check mailed first class or by electronic deposit to an account that Tenant designates in writing");
        if (many && o.refund === "first") parts.push("any refund of the security deposit will be paid to " + names[0] + ", by check or, where the law calls for an electronic refund, by transfer to the account " + names[0] + " designates in writing");
        if (many && o.refund === "joint") parts.push("any refund of the security deposit will be paid to all of the Tenants named in this Lease together, by one check payable to all of them or, where the law calls for an electronic refund, by one transfer to the account they designate in writing");
        parts.push(
          o.statement === "mail"
            ? "Landlord will send the itemized statement by first-class mail to the forwarding address " + (many ? "each Tenant" : "Tenant") + " gives in writing"
            : "Landlord may send the itemized statement by email to the address " + (many ? "each Tenant" : "Tenant") + " has given Landlord in this Lease or later gives in writing",
        );
        return {
          heading: "Returning the deposit",
          blocks: [titled("Returning the deposit", who + " that when the tenancy ends " + parts.join(", and ") + ".")],
        };
      },
      note: "California lets a landlord and all adult tenants agree in writing, at the start of the tenancy, on how the refund is divided and on emailing the statement.",
      cite: "Civil Code § 1950.5(h)(1)(B)–(C)",
    },
    {
      id: "alterations",
      group: "care",
      slot: "changes",
      level: "recommended",
      title: "No changes without asking",
      summary: "No painting, remodeling or new locks without your written OK. Picture hooks are fine.",
      options: [],
      section() {
        return {
          heading: "Changes to the home",
          blocks: [
            p("Tenant will not paint, wallpaper, install fixtures, remove or add appliances, or make other alterations without Landlord’s prior written consent. Hanging pictures with small nails or hooks is fine."),
            p("Tenant will not change or add locks without Landlord’s prior written consent and will promptly give Landlord a key to any lock that is changed. This does not limit the right the law gives a tenant to change locks for protection from abuse or violence, or the right of a person with a disability to make reasonable modifications."),
          ],
        };
      },
      cite: "Civil Code §§ 1941.5, 1941.6; Gov. Code § 12927(c)(1)",
    },
    {
      id: "mold",
      group: "care",
      slot: "care",
      level: "recommended",
      title: "Moisture and mold",
      summary: "The tenant airs out the home and tells you about leaks right away.",
      options: [],
      section() {
        return { heading: "Moisture and mold", blocks: [titled("Moisture and mold", "Tenant will keep the home ventilated, use the kitchen and bathroom fans, wipe up standing water, and tell Landlord promptly in writing about any leak, water intrusion or visible mold.")] };
      },
    },
    {
      id: "pests",
      group: "care",
      slot: "care",
      level: "recommended",
      title: "Pests",
      summary: "The tenant reports pests promptly and cooperates with treatment.",
      options: [],
      section() {
        return { heading: "Pests", blocks: [titled("Pests", "Tenant will keep the home free of conditions that attract pests, will promptly report signs of pests, including bed bugs, in writing, and will cooperate with inspection and treatment, including preparing the home as the pest control operator instructs.")] };
      },
      cite: "Civil Code § 1954.604",
    },
    {
      id: "alarms",
      group: "care",
      slot: "care",
      level: "recommended",
      title: "Smoke and carbon monoxide alarms",
      summary: "The tenant leaves the alarms working and tells you if one fails.",
      options: [],
      section() {
        return { heading: "Smoke and carbon monoxide alarms", blocks: [titled("Smoke and carbon monoxide alarms", "The home has smoke alarms and carbon monoxide alarms that work at move-in. Tenant will not disconnect or disable them and will tell Landlord promptly if one is not working.")] };
      },
      cite: "Health & Safety Code §§ 13113.7, 17926.1",
    },
    {
      id: "quiet",
      group: "living",
      slot: "conduct",
      level: "optional",
      title: "Quiet hours",
      summary: "Sets hours when noise should not carry to the neighbors.",
      defaultOn: (lease) => ["apartment", "condo", "adu", "room"].includes(lease?.facts?.unitType),
      options: [
        { key: "from", label: "Quiet from", type: "text", def: "10:00 p.m." },
        { key: "to", label: "Until", type: "text", def: "7:00 a.m." },
      ],
      section(lease, o) {
        return { heading: "Quiet hours", blocks: [titled("Quiet hours", "From " + (o.from || "10:00 p.m.") + " to " + (o.to || "7:00 a.m.") + " Tenant and guests will keep noise low enough that it cannot be heard in neighboring homes.")] };
      },
    },
    {
      id: "hoa",
      group: "extras",
      slot: "conduct",
      level: "recommended",
      title: "Homeowners association rules",
      summary: "The tenant follows the HOA’s rules and covers fines they cause.",
      show: (lease) => lease?.facts?.hoa === "yes" || lease?.facts?.unitType === "condo",
      options: [],
      section() {
        return { heading: "Association rules", blocks: [titled("Association rules", "The home is part of a homeowners association. Tenant has received a copy of the association’s rules and will follow them. Tenant will reimburse Landlord for any fine the association charges because Tenant, or a member of Tenant’s household or a guest, broke those rules.")] };
      },
    },
    {
      id: "parking",
      group: "living",
      slot: "parking",
      level: "recommended",
      title: "Vehicles and parking",
      summary: "Names where the tenant may park and keeps broken-down cars off the property.",
      show: (lease) => filled(lease?.facts?.parking),
      options: [],
      section(lease) {
        return {
          heading: "Vehicles and parking",
          blocks: [p("Tenant may park here: " + String(lease.facts.parking).trim().replace(/\.$/, "") + ". Vehicles kept at the property must be operable and currently registered. Tenant will not repair vehicles at the property, store vehicles that do not run, or park on landscaping or in spaces assigned to others.")],
        };
      },
    },
    {
      id: "possession",
      group: "money",
      slot: "term",
      level: "recommended",
      title: "If the home is not ready on time",
      summary: "No rent is owed until the tenant can move in, and either side can cancel if the delay drags on.",
      show: (lease) => lease?.facts?.kind !== "Renewal",
      options: [{ key: "days", label: "Days of delay before either side may cancel", type: "number", def: "7", min: 3, max: 30 }],
      section(lease, o) {
        const days = /^\d{1,2}$/.test(String(o.days)) ? Number(o.days) : 7;
        return { heading: "If the home is not ready", blocks: [titled("If the home is not ready", "If Landlord cannot give Tenant the home on the start date, Tenant owes no rent until Landlord does. If the home is still not available " + days + " days after the start date, either Landlord or Tenant may cancel this Lease by written notice, and Landlord will promptly return everything Tenant has paid.")] };
      },
    },
    {
      id: "concession",
      group: "money",
      slot: "rent",
      level: "optional",
      title: "Move-in discount",
      summary: "Records a one-time discount separately from the rent, as the rent-cap law requires.",
      options: [
        { key: "amount", label: "Discount", type: "money", def: "" },
        { key: "what", label: "What the discount is for", type: "text", def: "", when: () => true, help: "For example: half off the first month’s rent." },
      ],
      section(lease, o) {
        return { heading: "Move-in discount", blocks: [titled("Move-in discount", "Landlord gives Tenant a one-time discount of " + (law().money(o.amount) || "[amount]") + ": " + (filled(o.what) ? o.what.trim().replace(/\.$/, "") : "[describe the discount]") + ". The monthly rent stated above does not change.")] };
      },
      note: "For homes under the rent cap, a discount must be listed separately in the lease so it is not counted against the rent later.",
      cite: "Civil Code § 1947.12(a)(1)",
    },
    {
      id: "guarantor",
      group: "money",
      slot: "general",
      level: "optional",
      title: "Co-signer (guarantor)",
      summary: "Adds someone who promises to pay if the tenant does not. They sign the lease but do not live in the home.",
      options: [{ key: "name", label: "Co-signer’s full name", type: "text", def: "", when: () => true }],
      section(lease, o) {
        const name = filled(o.name) ? o.name.trim() : "[co-signer’s name]";
        return { heading: "Guaranty", blocks: [titled("Guaranty", name + " (“Guarantor”) guarantees that Tenant will pay the rent and every other amount due under this Lease, and will pay Landlord on request if Tenant does not. Guarantor has no right to live in the home. This guaranty lasts for as long as Tenant lives in the home under this Lease, including any month-to-month period after the term, unless Landlord releases Guarantor in writing.")] };
      },
    },
    {
      id: "absence",
      group: "living",
      slot: "occupancy",
      level: "optional",
      title: "Time away",
      summary: "A courtesy heads-up when the home will sit empty, so leaks and break-ins are caught early.",
      options: [{ key: "days", label: "Tell me about absences longer than (days)", type: "number", def: "14", min: 7, max: 60 }],
      section(lease, o) {
        const days = /^\d{1,2}$/.test(String(o.days)) ? Number(o.days) : 14;
        return { heading: "Time away", blocks: [titled("Time away", "Tenant will let Landlord know when everyone will be away from the home for more than " + days + " days, so that Landlord can respond to problems such as a leak.")] };
      },
    },
    {
      id: "cotenants",
      group: "living",
      slot: "occupancy",
      level: "optional",
      title: "Changing roommates",
      summary: "Any change in who is on the lease is put in writing first.",
      show: (lease) => tenantNames(lease).length > 1,
      options: [],
      section() {
        return { heading: "Changing tenants", blocks: [titled("Changing tenants", "If a Tenant plans to move out or another adult is to move in, Landlord and all Tenants will first sign a written change to this Lease. The security deposit stays with the home and is settled when the last Tenant moves out, unless everyone agrees otherwise in writing.")] };
      },
    },
    {
      id: "keys",
      group: "care",
      slot: "changes",
      level: "recommended",
      title: "Keys and lockouts",
      summary: "Records how many keys the tenant gets and who pays for lost keys or a locksmith.",
      options: [{ key: "sets", label: "Sets of keys you hand over", type: "number", def: "2", min: 1, max: 10 }],
      section(lease, o) {
        const sets = /^\d{1,2}$/.test(String(o.sets)) ? Number(o.sets) : 2;
        const handover = lease?.facts?.kind === "Renewal" ? "Tenant already has the keys to the home. " : "Landlord will give Tenant " + sets + (sets === 1 ? " set" : " sets") + " of keys at move-in. ";
        return { heading: "Keys", blocks: [titled("Keys", handover + "Tenant will pay the actual cost of replacing lost keys or remotes, and the actual cost of a locksmith if Tenant is locked out.")] };
      },
    },
    {
      id: "storage",
      group: "extras",
      slot: "care",
      level: "recommended",
      title: "Storage",
      summary: "Says where the tenant may store things and keeps hazardous materials out.",
      show: (lease) => filled(lease?.facts?.storage),
      options: [],
      section(lease) {
        return { heading: "Storage", blocks: [titled("Storage", "Tenant may store belongings here: " + String(lease.facts.storage).trim().replace(/\.$/, "") + ". Tenant will not store gasoline, propane or other hazardous materials there.")] };
      },
    },
    {
      id: "leadSafe",
      group: "care",
      slot: "care",
      level: "recommended",
      title: "Older paint",
      summary: "In a home built before 1978, the tenant leaves painted surfaces alone and reports peeling paint.",
      show: (lease) => /^\d{4}$/.test(String(lease?.facts?.built ?? "")) && Number(lease.facts.built) < 1978,
      options: [],
      section() {
        return { heading: "Older paint", blocks: [titled("Older paint", "Because the home was built before 1978, Tenant will not sand, scrape or strip painted surfaces, and will tell Landlord promptly about paint that is peeling or chipping.")] };
      },
    },
    {
      id: "pool",
      group: "extras",
      slot: "conduct",
      level: "recommended",
      title: "Pool and spa",
      summary: "Basic safety rules for a pool or spa.",
      show: (lease) => lease?.facts?.pool === "yes",
      options: [],
      section(lease) {
        const who = lease.facts.util_pool === "tenant" ? "Tenant" : "Landlord";
        return { heading: "Pool and spa", blocks: [titled("Pool and spa", who + " will arrange and pay for regular pool service. Tenant will keep the gate and any safety cover or barrier closed and latched, will not let children use the pool or spa without an adult present, and will tell Landlord promptly about anything that is broken or unsafe.")] };
      },
    },
    {
      id: "sharedAreas",
      group: "extras",
      slot: "conduct",
      level: "optional",
      title: "Shared spaces",
      summary: "Names the areas the tenant shares, such as a laundry room, yard or driveway.",
      show: (lease) => ["apartment", "adu", "room"].includes(lease?.facts?.unitType) || lease?.facts?.otherUnitOnLot === "yes",
      options: [{ key: "what", label: "Areas the tenant shares", type: "text", def: "", when: () => true, help: "For example: the laundry room, the back yard and the driveway." }],
      section(lease, o) {
        return { heading: "Shared spaces", blocks: [titled("Shared spaces", "Tenant shares these areas with other residents: " + (filled(o.what) ? o.what.trim().replace(/\.$/, "") : "[list the shared areas]") + ". Tenant will leave them clean after use and will not block them or store belongings there.")] };
      },
    },
    {
      id: "grills",
      group: "extras",
      slot: "conduct",
      level: "optional",
      title: "Grills",
      summary: "Keeps charcoal and propane grills away from balconies and walls.",
      defaultOn: (lease) => ["apartment", "condo"].includes(lease?.facts?.unitType),
      options: [],
      section() {
        return { heading: "Grills", blocks: [titled("Grills", "Tenant will not use or store charcoal or propane grills on balconies, under overhangs, or within 10 feet of the building.")] };
      },
    },
    {
      id: "ebikes",
      group: "extras",
      slot: "conduct",
      level: "optional",
      title: "E-bikes and scooters",
      summary: "Tenants may keep them, as state law provides, with a few battery-safety rules.",
      options: [],
      section() {
        return { heading: "E-bikes and scooters", blocks: [titled("E-bikes and scooters", "Tenant may keep and charge personal e-bikes and e-scooters in the home as California Civil Code section 1940.41 allows. Tenant will use the charger made for the device, will not charge a damaged battery or leave a charging device where it blocks an exit, and will not repair or modify batteries or motors inside the home.")] };
      },
      note: "A lease cannot ban a tenant’s e-bike or scooter outright, but it can set safety rules.",
      cite: "Civil Code § 1940.41",
    },
    {
      id: "satellite",
      group: "extras",
      slot: "changes",
      level: "optional",
      title: "Satellite dishes",
      summary: "Tenants may install a small dish in their own space; this protects the roof and walls.",
      options: [],
      section() {
        return { heading: "Satellite dishes", blocks: [titled("Satellite dishes", "Tenant may install a satellite dish or antenna no larger than one meter across within an area that only Tenant uses, such as a patio or balcony, as federal rules allow. Tenant will not attach it to the roof, exterior walls or railings in a way that requires drilling without Landlord’s written consent, and will repair any damage when it is removed.")] };
      },
      cite: "47 CFR § 1.4000",
    },
    {
      id: "waterbed",
      group: "extras",
      slot: "conduct",
      level: "optional",
      title: "Waterbeds",
      summary: "State law lets tenants have a waterbed if they insure it; this says so.",
      options: [],
      section() {
        return { heading: "Waterbeds", blocks: [titled("Waterbeds", "Tenant may keep a waterbed or other liquid-filled furniture only after giving Landlord proof of the insurance, and meeting the other conditions, in California Civil Code section 1940.5.")] };
      },
      cite: "Civil Code § 1940.5",
    },
    {
      id: "sale",
      group: "plans",
      slot: "general",
      level: "optional",
      title: "Selling or re-renting the home",
      summary: "The tenant cooperates with showings; a sale does not end the lease.",
      options: [],
      section() {
        return { heading: "Sale or re-renting", blocks: [titled("Sale or re-renting", "If the home is offered for sale, or for rent near the end of the tenancy, Tenant will allow showings at reasonable times after the notice the law requires. A sale does not end this Lease; the new owner takes Landlord’s place.")] };
      },
      cite: "Civil Code § 1954",
    },
    {
      id: "mediation",
      group: "money",
      slot: "general",
      level: "optional",
      title: "Try mediation first",
      summary: "Before a lawsuit over the lease, both sides try a mediator. Evictions and small claims are not affected.",
      options: [],
      section() {
        return { heading: "Mediation", blocks: [titled("Mediation", "Before filing a lawsuit about this Lease, other than an eviction case or a small claims case, Landlord and Tenant will first try to resolve the dispute with a neutral mediator, such as the National Conflict Resolution Center in San Diego, and will share the mediator’s fee equally. Either may go to court if the dispute is not resolved within 30 days after mediation is requested.")] };
      },
    },
    {
      id: "ownerMoveIn",
      group: "plans",
      slot: "protections",
      level: "recommended",
      title: "Keep the right to move in yourself",
      summary: "Without this sentence in the lease, you cannot end the tenancy to live in the home yourself or house a close family member.",
      show: (lease) => {
        const c = coverage(lease);
        return c.known && c.cause === "applies" && lease?.facts?.ownerKind !== "corp";
      },
      options: [],
      section(lease) {
        const city = coverage(lease).city === "applies";
        return {
          heading: "Owner or family move-in",
          blocks: [
            titled(
              "Owner or family move-in",
              "Landlord may terminate this Lease if the owner unilaterally decides to occupy the home for the owner or the owner’s spouse, domestic partner, child (by blood or adoption), grandchild (by blood or adoption), parent or grandparent as that person’s primary residence. Landlord will give the written notice and the relocation assistance that California Civil Code section 1946.2" + (city ? " and Chapter 9, Article 8, Division 7 of the San Diego Municipal Code require." : " requires."),
            ),
          ],
        };
      },
      note: "For leases signed after mid-2020 (state) and June 24, 2023 (City), an owner move-in is a lawful reason to end a covered tenancy only if the lease expressly allows it or the tenant agrees in writing.",
      cite: "Civil Code § 1946.2(b)(2)(A)(ii); San Diego Municipal Code § 98.0704(b)(1)(A)",
    },
    {
      id: "creditNotice",
      group: "money",
      slot: "general",
      level: "recommended",
      title: "Credit reporting notice",
      summary: "One sentence that keeps your option to report an unpaid debt to a credit bureau.",
      options: [],
      section() {
        return { heading: "Credit reporting", blocks: [titled("Credit reporting", law().texts.creditNotice)] };
      },
      note: "A landlord may report unpaid rent or damages to a credit bureau only after giving this written notice. Including it does not oblige you to report anything.",
      cite: "Civil Code § 1785.26",
    },
    {
      id: "attorneyFees",
      group: "money",
      slot: "general",
      level: "policy",
      title: "Legal costs in a dispute",
      summary: "Under California law a “loser pays” clause always works both ways, so many small landlords have each side pay its own lawyer.",
      options: [
        { key: "policy", label: "Who pays attorney’s fees after a dispute?", type: "choice", def: "own", choices: [["own", "Each side pays its own"], ["prevailing", "Loser pays, up to a cap"]] },
        { key: "cap", label: "Cap on fees", type: "money", def: "1500", when: (o) => o.policy === "prevailing" },
      ],
      section(lease, o) {
        return {
          heading: "Attorney’s fees",
          blocks: [
            titled(
              "Attorney’s fees",
              o.policy === "prevailing"
                ? "In any legal action to enforce this Lease, the prevailing party may recover reasonable attorney’s fees and costs from the other party, up to " + (law().money(o.cap).replace(/\.00$/, "") || "$1,500") + "."
                : "In any legal action about this Lease, each party pays its own attorney’s fees, unless a law provides otherwise.",
            ),
          ],
        };
      },
      cite: "Civil Code § 1717",
    },
  ];

  const byId = new Map(library.map((c) => [c.id, c]));
  const visible = (clause, lease) => (typeof clause.show === "function" ? Boolean(clause.show(lease)) : true);
  function defaults(clause, lease) {
    const on = clause.level === "policy" ? true : typeof clause.defaultOn === "function" ? Boolean(clause.defaultOn(lease)) : clause.level === "recommended";
    return { on, opts: Object.fromEntries((clause.options || []).map((o) => [o.key, String(o.def ?? "")])) };
  }
  /* The owner's saved choices merged over the defaults, for every clause that fits this home. */
  function state(lease) {
    const saved = lease?.clauses || {};
    const result = {};
    for (const clause of library) {
      if (!visible(clause, lease)) continue;
      const base = defaults(clause, lease),
        mine = saved[clause.id];
      const opts = { ...base.opts };
      if (mine?.opts && typeof mine.opts === "object")
        for (const o of clause.options || []) if (typeof mine.opts[o.key] === "string") opts[o.key] = mine.opts[o.key];
      for (const o of clause.options || [])
        if (o.type === "choice" && !o.choices.some(([v]) => v === opts[o.key])) opts[o.key] = String(o.def);
      result[clause.id] = { on: clause.level === "policy" ? true : typeof mine?.on === "boolean" ? mine.on : base.on, opts };
    }
    return result;
  }
  /* Wording for every clause that is switched on, in library order. */
  function active(lease) {
    const current = state(lease);
    return library
      .filter((clause) => current[clause.id]?.on)
      .map((clause) => ({ id: clause.id, slot: clause.slot, ...clause.section(lease, current[clause.id].opts) }));
  }
  /* Options to show for a clause given its current answers. */
  function fields(clause, lease, opts) {
    return (clause.options || []).filter((o) => (typeof o.when === "function" ? o.when(opts, lease) : true));
  }

  /* Wording California law does not allow, or that usually backfires. Shown as a gentle warning on custom clauses. */
  const flags = [
    [/non[-\s]?refundable/i, "California does not allow any deposit or move-in fee to be called non-refundable.", "Civil Code § 1950.5(n)"],
    [/\bwaive[sd]?\b|\bwaiver\b|\bgives? up (the|any|all|their|his|her) right/i, "A tenant cannot waive rights the law protects, such as deposit, entry, repair, notice and court rights. A clause that tries is void.", "Civil Code §§ 1942.1, 1953"],
    [/\bas[-\s]is\b/i, "A landlord must keep the home habitable no matter what the lease says, so an “as is” clause does not shift repairs to the tenant.", "Civil Code §§ 1941, 1942.1"],
    [/cash only|only (in )?cash|must pay (in )?cash/i, "You must accept at least one form of payment that is neither cash nor electronic.", "Civil Code § 1947.3"],
    [/enter (the (home|unit|premises|property) )?(at any time|without notice|whenever)|any time without notice/i, "Entry is limited to the reasons the law lists and needs written notice except in an emergency.", "Civil Code § 1954"],
    [/no (children|kids|minors)|adults? only|no famil(y|ies)/i, "Rules that exclude or single out children are familial-status discrimination.", "Gov. Code § 12955"],
    [/section\s*8|voucher/i, "Refusing or treating tenants differently because they use a housing voucher is source-of-income discrimination.", "Gov. Code § 12955; San Diego Municipal Code § 98.0800"],
    [/immigration|citizenship|\bICE\b|deport/, "A landlord may not ask about, or threaten to report, a tenant’s immigration status.", "Civil Code §§ 1940.3, 1940.35"],
    [/jury/i, "A lease cannot take away a tenant’s right to a jury trial.", "Civil Code § 1953(a)(4)"],
    [/arbitrat/i, "A lease cannot force a residential tenant to give up going to court over tenant rights.", "Civil Code § 1953(a)(4)"],
    [/call(ing)? (the )?police|911|emergency (services|assistance)/i, "A lease may not limit or penalize calling the police or emergency services.", "Civil Code § 1946.8"],
    [/(lock ?out|change the locks|shut ?off|cut ?off|remove (the )?(doors?|belongings|property))/i, "Lockouts, utility shutoffs and removing a tenant’s belongings are illegal ways to end a tenancy.", "Civil Code § 789.3"],
    [/(fee|charge|fine|penalt)\w*[^.]{0,60}(per day|each day|daily)/i, "A daily or stacking late charge is likely an illegal penalty. Use one reasonable late charge.", "Civil Code § 1671(d)"],
    [/(forfeit|keep|retain)\w*[^.]{0,40}deposit/i, "A deposit can be used only for unpaid rent, damage beyond normal wear, and cleaning. It cannot be forfeited automatically.", "Civil Code § 1950.5(e)"],
    [/last month'?s rent/i, "Money collected as last month’s rent counts toward the deposit limit.", "Civil Code § 1950.5(b), (c)"],
    [/automatic(ally)? renew/i, "An automatic renewal for a new term must be printed in bold in the lease and again just above the tenant’s signature, or the tenant can cancel it.", "Civil Code § 1945.5"],
    [/(clothesline|drying rack|political sign|campaign sign|satellite dish|religious)/i, "Tenants have limited legal rights to clotheslines, political signs, satellite dishes and religious items on their door. A flat ban may not hold up.", "Civil Code §§ 1940.4, 1940.20, 1940.45; 47 CFR § 1.4000"],
    [/(day ?care|childcare|child care)/i, "A tenant may run a licensed family child care home after giving notice. A lease cannot forbid it.", "Health & Safety Code § 1597.41"],
    [/professional(ly)? (carpet )?clean|carpet[- ]clean|steam[- ]clean/i, "You can charge for cleaning only what it takes to return the home to its move-in condition. A blanket professional or carpet cleaning charge is not allowed.", "Civil Code § 1950.5(e)(2)(C)"],
    [/(fee|charge)\w*[^.]{0,50}(serv|post|deliver)\w*[^.]{0,30}notice|notice (fee|charge)/i, "You may not charge a fee for serving, posting or delivering a notice.", "Civil Code § 1946.1(i)"],
    [/(fee|charge|surcharge)\w*[^.]{0,40}(pay(ing|ment)? by|for) (a )?(personal )?check/i, "You may not charge a fee for paying by check.", "Civil Code § 1947.3(b)"],
    [/not (be )?(liable|responsible) for (any|all)|hold[s]? (the )?(landlord|owner) harmless|indemnif|release[s]? (the )?(landlord|owner)/i, "A lease cannot excuse a landlord from the duty of care the law imposes, so a blanket “not liable” or “hold harmless” clause is void.", "Civil Code § 1953(a)(5)"],
    [/tenant (pays|is responsible) for all repairs|all repairs (are|shall be) (the )?tenant|repair deductible|first \$?\d+ of (any|each|every) repair/i, "Repairs needed to keep the home livable are the landlord’s job. Charge the tenant only for damage the tenant or guests cause.", "Civil Code §§ 1941, 1942.1"],
    [/declaw|devocal|de-bark|debark/i, "A landlord may not require a pet to be declawed or devocalized.", "Civil Code § 1942.7"],
    [/(must|shall|required to) (use|subscribe|pay for)[^.]{0,40}(internet|cable|wi-?fi)/i, "A tenant may opt out of paying for an internet or cable subscription the landlord arranges.", "Civil Code § 1942.8"],
    [/no (e-?bikes?|electric (bikes?|bicycles?|scooters?)|scooters?)/i, "A lease cannot flatly ban a tenant’s e-bike or scooter, though it can set safety rules.", "Civil Code § 1940.41"],
    [/(double|triple|twice|two times|2x|200%)[^.]{0,30}rent/i, "Charging a multiple of the rent as a penalty is likely void, and holdover rent cannot exceed the rent cap on a covered home.", "Civil Code §§ 1671(d), 1947.12"],
    [/(fine|penalty) of \$|\$\s?\d[\d,]*(\.\d\d)?[^.]{0,25}(fine|penalty)\b/i, "A fixed fine for breaking a rule is treated as a penalty and is usually void. Charge only the actual cost of any damage.", "Civil Code § 1671(d)"],
    [/guest (fee|charge)|(fee|charge) (per|for each|for every) guest/i, "A fee for having guests is treated as a penalty and can interfere with the tenant’s right to enjoy the home.", "Civil Code §§ 1671(d), 1927"],
    [/(negative|bad|online) reviews?|not (post|publish|complain|report)|disparag/i, "A lease cannot stop a tenant from complaining to you or to a government agency, organizing with neighbors, or posting an honest review.", "Civil Code §§ 1942.5, 1942.6; 15 U.S.C. § 45b"],
    [/\b(no|only)\s+(couples|singles|students|families|men|women|males|females|seniors)\b/i, "Wording that prefers or excludes people by family status, sex, age or another protected trait is housing discrimination.", "Gov. Code § 12955"],
    [/(60|sixty|90|ninety)[- ]days?’?'?( written| advance| prior)* notice[^.]{0,60}(tenant|vacat|mov(e|ing) out)|tenant[^.]{0,60}(60|sixty|90|ninety)[- ]days?’?'?( written| advance| prior)* notice/i, "A month-to-month tenant may leave on 30 days’ written notice. A longer notice period for the tenant is unlikely to hold.", "Civil Code §§ 1946, 1946.1(b)"],
    [/notices?[^.]{0,40}(only|solely|exclusively)[^.]{0,20}(e-?mail|text|electronic)/i, "Some notices must be delivered in person or by mail. Email or text cannot replace them.", "Code Civ. Proc. § 1162; Civil Code § 1946.1(f)"],
    [/(administrative|admin|processing|move-?in|redecorat)\w* (fee|charge)/i, "Any fee charged at move-in, other than the first month’s rent and a screening fee, counts as security deposit and must be refundable.", "Civil Code § 1950.5(b), (n)"],
  ];
  function redFlags(text) {
    const value = String(text ?? "");
    const seen = new Set();
    return flags
      .filter(([pattern]) => pattern.test(value))
      .map(([, message, cite]) => ({ message, cite }))
      .filter((f) => !seen.has(f.message) && seen.add(f.message));
  }

  globalThis.LeaseClauses = Object.freeze({ groups, library, get: (id) => byId.get(id), state, active, fields, defaults, visible, redFlags });
})();
