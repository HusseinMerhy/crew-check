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
];

// States with their own OSHA plan covering private employers (osha.gov, checked 2026-10-15).
// complete: true only once that state's rule cards are loaded and verified.
export const PLAN_STATES = {
  AK: false, AZ: false, CA: false, HI: false, IN: false, IA: false, KY: false, MD: false,
  MI: false, MN: false, NV: false, NM: false, NC: false, OR: false, SC: false, TN: false,
  UT: false, VT: false, VA: false, WA: false, WY: false, PR: false,
};
