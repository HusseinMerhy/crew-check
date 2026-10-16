// Rule library (RAG cards). One rule per card: condition + consequence together.
// Every card is federal (state: "FED") and was checked on eCFR / osha.gov on the date shown.
// State cards get added later with state: "CA", "OR", etc.
export const CARDS = [
  {
    id: "fed-1910-146", state: "FED", layer: "OSHA", citation: "29 CFR 1910.146",
    title: "Attendant for a permit-required confined space",
    text: "A second person (attendant) must stay outside for the whole entry when someone ENTERS a permit-required confined space: a space big enough to enter, with limited entry or exit, not designed for continuous occupancy, AND with a hazard (hazardous atmosphere, engulfment, trapping shape, or other serious hazard). A confined space with no hazard needs no attendant.",
    keywords: ["confined space", "vault", "manhole", "pit", "tank", "lift station", "went down into", "entered", "enter", "inside the", "crawl space", "sewer", "permit"],
    source: "ecfr.gov", checked: "2026-10-15",
  },
  {
    id: "fed-1910-252-b4iv", state: "FED", layer: "OSHA", citation: "29 CFR 1910.252(b)(4)(iv)",
    title: "Attendant while welding inside a confined space",
    text: "When a welder works INSIDE a confined space entered through a manhole or other small opening, an attendant must be stationed outside, watching the welder at all times and ready to remove them in an emergency, for the whole time the welder is inside.",
    keywords: ["weld", "welding", "torch", "cutting", "braze", "brazing", "inside", "tank", "vault", "manhole"],
    source: "ecfr.gov", checked: "2026-10-15",
  },
  {
    id: "fed-1910-252-a2iii", state: "FED", layer: "OSHA", citation: "29 CFR 1910.252(a)(2)(iii)",
    title: "Fire watch",
    text: "A fire watch is required during welding or cutting when ANY of these is true: combustible material within 35 ft; combustibles farther than 35 ft but easily ignited by sparks; wall or floor openings within 35 ft exposing combustibles; combustibles against the other side of a metal wall. The fire watch stays at least 30 minutes after the work ends. If combustibles were moved more than 35 ft away and none of the other triggers apply, no fire watch is required.",
    keywords: ["weld", "welding", "torch", "torched", "cut", "cutting", "braze", "brazing", "solder", "hot work", "sparks", "cardboard", "combustible", "flammable"],
    source: "ecfr.gov", checked: "2026-10-15",
  },
  {
    id: "fed-1910-269-l2i", state: "FED", layer: "OSHA", citation: "29 CFR 1910.269(l)(2)(i)",
    title: "Two employees for work over 600 volts (utility only)",
    text: "At least two employees must be present for work on power generation, transmission or distribution lines or equipment energized over 600 V. This rule does NOT cover store wiring, panels, breakers or store transformers (excluded by 1910.269(a)(1)(ii)(B)). Never cite the outdated number 1910.269(l)(1)(i).",
    keywords: ["600", "volt", "volts", "high voltage", "utility", "primary", "transformer", "power line", "substation", "480", "energized"],
    source: "ecfr.gov", checked: "2026-10-15",
  },
  {
    id: "fed-1926-502-h1", state: "FED", layer: "OSHA", citation: "29 CFR 1926.502(h)(1)",
    title: "Safety monitor for low-slope roofing",
    text: "In construction roofing work on a low-slope roof with an edge 6 ft or more above a lower level, if a safety monitoring system is the fall protection used, a competent person must monitor the roofer and warn of fall hazards while the roofer is exposed. A monitor alone is allowed only on roofs 50 ft wide or less (1926.501(b)(10)). If guardrails, nets or a harness are used instead, this rule does not apply.",
    keywords: ["roof", "roofing", "safety monitor", "edge", "flat roof", "low-slope"],
    source: "ecfr.gov / osha.gov", checked: "2026-10-16",
  },
  {
    id: "fed-not-height", state: "FED", layer: "NOT_OSHA", citation: "29 CFR 1910.28(b)(1); 1926.501(b)(1)",
    title: "Height is not a two-person rule",
    text: "From 4 ft (6 ft in construction) OSHA requires fall protection: guardrail, safety net or personal fall protection such as a harness. It does not require a second person. Height alone is never an OSHA two-person requirement.",
    keywords: ["height", "high", "ft", "feet", "ceiling", "lift", "scissor lift", "ladder", "fixture", "overhead", "fall"],
    source: "osha.gov", checked: "2026-10-16",
  },
  {
    id: "fed-ladder-traffic", state: "FED", layer: "SAFETY", citation: "29 CFR 1910.23(c)(7)",
    title: "Ladder in a passageway, doorway or driveway",
    text: "There is no ladder-holder rule. A ladder placed in a passageway, doorway or driveway where traffic can displace it must be secured or guarded by a barricade (cones, caution tape). A second person keeping traffic away is one way to comply: a safety reason, not an OSHA two-person requirement.",
    keywords: ["ladder", "aisle", "doorway", "driveway", "passageway", "sales floor", "store open", "customers", "traffic"],
    source: "osha.gov", checked: "2026-10-16",
  },
  {
    id: "fed-not-weight", state: "FED", layer: "NOT_OSHA", citation: "OSHA letter of interpretation, June 4, 2013",
    title: "Weight is not an OSHA rule (51 lb is NIOSH guidance)",
    text: "OSHA has no standard limiting how much a person may lift or carry. 51 lb (23 kg) is the NIOSH lifting equation load constant: guidance, not an OSHA rule. A stated weight over 51 lb is a safety reason for a second person, never an OSHA requirement. Refrigerant charge weights (for example 15 lb of refrigerant) are not lifts.",
    keywords: ["lb", "lbs", "pound", "pounds", "kg", "heavy", "weight", "weighs", "lift", "carry", "door", "glass", "unit", "motor"],
    source: "osha.gov / CCOHS", checked: "2026-10-16",
  },
  {
    id: "fed-harness-rescue", state: "FED", layer: "SAFETY", citation: "29 CFR 1910.140(c)(21)",
    title: "Harness in use: prompt rescue",
    text: "When a personal fall arrest system (harness) is used, the employer must provide for prompt rescue. A second person on site is one way to do that: a safety reason, not an OSHA two-person requirement. A wiring harness is electrical wiring, not fall protection.",
    keywords: ["harness", "fall arrest", "lanyard", "tie off", "tied off"],
    source: "ecfr.gov", checked: "2026-10-15",
  },
  {
    id: "fed-gdc", state: "FED", layer: "NOT_OSHA", citation: "OSH Act Section 5(a)(1)",
    title: "General Duty Clause",
    text: "The General Duty Clause is a broad duty to protect workers from recognized serious hazards. It never names a second person. It can be the basis of a safety reason, never of an 'OSHA requires two techs' claim.",
    keywords: ["general duty", "hazard", "unsafe", "safety"],
    source: "osha.gov", checked: "2026-10-15",
  },
  // ---------------- California (Cal/OSHA, Title 8). Checked on dir.ca.gov 2026-10-16. ----------------
  // In California, Cal/OSHA enforces Title 8. Where a CA card covers a topic, it is the rule to cite for a CA store.
  {
    id: "ca-5157-d6", state: "CA", layer: "OSHA", citation: "Cal. Code Regs. tit. 8, §5157(d)(6)",
    title: "California: attendant for a permit-required confined space (general industry)",
    text: "For general industry work in California (not construction or the other operations listed in §5156(b)(2)), the employer must provide at least one attendant outside a permit-required confined space for the duration of entry operations. A permit space is a confined space with a hazard such as a hazardous atmosphere or engulfment material. A non-permit confined space (no hazard) needs no attendant. Same structure as federal 1910.146.",
    keywords: ["confined space", "vault", "manhole", "pit", "tank", "lift station", "went down into", "entered", "enter", "crawl space", "sewer"],
    source: "dir.ca.gov/title8/5157.html, 5156.html", checked: "2026-10-16",
  },
  {
    id: "ca-5158-e1d", state: "CA", layer: "OSHA", citation: "Cal. Code Regs. tit. 8, §5158(e)(1)(D)",
    title: "California: standby person for confined spaces in construction",
    text: "For construction operations in California (and the other operations listed in §5156(b)(2)), when an atmosphere free of dangerous air contamination or oxygen deficiency or enrichment cannot be ensured by the pre-entry measures, or in an emergency: at least one employee must stand by outside the confined space ready to assist, and at least one additional employee (who may have other duties) must be within sight or call of the standby employee. If testing shows no hazard, this standby requirement does not apply.",
    keywords: ["confined space", "vault", "manhole", "pit", "tank", "renovation", "construction", "remodel", "went down into", "entered", "enter"],
    source: "Cornell LII copy of 8 CCR 5158; scope from dir.ca.gov/title8/5156.html", checked: "2026-10-16",
  },
  {
    id: "ca-2940-cd", state: "CA", layer: "OSHA", citation: "Cal. Code Regs. tit. 8, §2940(c) and (d)",
    title: "California: no working alone on energized high voltage (over 600 V)",
    text: "California's High-Voltage Electrical Safety Orders: only qualified electrical workers may work on energized conductors or equipment connected to high-voltage systems (high voltage = more than 600 volts, §2700), and no such employee may be assigned to work alone, except for replacing fuses, operating switches or other work not requiring contact with energized high-voltage parts, clearing trouble, or emergencies. During work on exposed energized high-voltage parts, a qualified worker or trainee must be in close proximity as an observer. Unlike federal 1910.269, this is not limited to utility work in its wording; verify that the specific store equipment falls under the High-Voltage Electrical Safety Orders before citing.",
    keywords: ["600", "volt", "volts", "high voltage", "transformer", "switchgear", "energized", "primary", "480", "4160", "utility"],
    source: "dir.ca.gov/title8/2940.html, 2700.html", checked: "2026-10-16",
  },
  {
    id: "ca-4848-hotwork", state: "CA", layer: "OSHA", citation: "Cal. Code Regs. tit. 8, §4848",
    title: "California: fire prevention procedure for welding and cutting",
    text: "California requires the employer to establish a fire prevention and suppression procedure for welding, cutting and similar operations, and incorporates NFPA 51B-2009 Chapters 3 to 7 and ANSI Z49.1 by reference. The fire watch triggers and how long the watch must stay are in NFPA 51B, which is not reproduced here: say a fire watch is likely required under §4848 / NFPA 51B and to verify the exact NFPA 51B fire watch terms before citing a duration for a California store.",
    keywords: ["weld", "welding", "torch", "torched", "cut", "cutting", "braze", "brazing", "hot work", "sparks", "cardboard", "combustible", "flammable"],
    source: "dir.ca.gov/title8/4848.html", checked: "2026-10-16",
  },
  {
    id: "ca-1730-roof", state: "CA", layer: "NOT_OSHA", citation: "Cal. Code Regs. tit. 8, §1730; §1724",
    title: "California roofing: fall protection above 20 ft, no safety monitor provision found",
    text: "California construction roofing rules (§1730) require protection from falls for low-slope roof work more than 20 feet high (warning lines, personal fall protection, railings and similar). Sections 1730 and 1724 contain no safety monitor or safety monitoring system provision and no 50 ft roof width rule. Do not cite the federal safety monitor rule (1926.502(h)) as the California requirement.",
    keywords: ["roof", "roofing", "safety monitor", "edge", "flat roof", "low-slope"],
    source: "dir.ca.gov/Title8/1730.html, 1724.html", checked: "2026-10-16",
  },
  {
    id: "ca-3276-ladder", state: "CA", layer: "SAFETY", citation: "Cal. Code Regs. tit. 8, §3276(e)(14), (e)(9)",
    title: "California: ladders in passageways and doorways",
    text: "Ladders must not be placed in passageways, doorways, driveways or any location where they may be displaced unless protected by barricades or guards (§3276(e)(14)). A ladder must be placed to prevent slipping, or be tied, blocked, held or otherwise secured (§3276(e)(9)): holding is one option, so no person is required to hold it. A second person guarding the ladder is a safety reason, not a two-person requirement.",
    keywords: ["ladder", "aisle", "doorway", "driveway", "passageway", "sales floor", "store open", "customers", "traffic"],
    source: "dir.ca.gov/dosh/etools/08-001/regs.htm", checked: "2026-10-16",
  },
];

// States with their own OSHA plan covering private employers (osha.gov, checked 2026-10-15).
// Library status per plan state: "none" (no cards yet), "partial" (some topics verified), "complete" (all topics verified).
export const PLAN_STATES = {
  AK: "none", AZ: "none", CA: "partial", HI: "none", IN: "none", IA: "none", KY: "none", MD: "none",
  MI: "none", MN: "none", NV: "none", NM: "none", NC: "none", OR: "none", SC: "none", TN: "none",
  UT: "none", VT: "none", VA: "none", WA: "none", WY: "none", PR: "none",
};
// California "partial": confined spaces, high voltage, welding (fire watch details in NFPA 51B not verified), roofing, ladders.
// Not yet researched for CA: welding inside a confined space attendant, lifting, harness rescue.
