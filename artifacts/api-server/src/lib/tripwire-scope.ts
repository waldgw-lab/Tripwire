// Roles and relevance supplied by the user; not a live office-holder registry.
export const positionScope: Record<string, [organization: string, position: string, relevance: string]> = {
  "Donald Trump": ["White House", "President", "Ultimate decision authority; assessment of the war; confidence in advisers; personnel decisions."],
  "Pete Hegseth": ["Department of War / Department of Defense", "Secretary of War", "War strategy; operational representations; leadership performance; accountability; potential replacement."],
  "Gen. Dan Caine": ["Joint Staff", "Chairman, Joint Chiefs of Staff", "Principal military adviser; strategic advice; military assessments; performance scrutiny."],
  "Adm. Brad Cooper": ["U.S. Central Command", "Commander, U.S. Central Command", "Theater command; military execution; operational outcomes; reported accountability."],
  "JD Vance": ["White House", "Vice President", "Iran policy deliberations; negotiations; political assessments; senior-leader consultations."],
  "Marco Rubio": ["Department of State", "Secretary of State", "Diplomatic strategy; negotiations; national security coordination."],
  "Steve Witkoff": ["White House", "U.S. special envoy", "Negotiations; diplomatic assessments; advice to the President."],
  "Jared Kushner": ["White House", "Presidential adviser", "Iran policy discussions; reported influence on decisions."],
  "Benjamin Netanyahu": ["Israeli strategic actors", "Israeli prime minister", "U.S.–Israel strategic coordination; requests for military action; differences over Iran strategy."],
  "Stephen Feinberg": ["Department of War / Department of Defense", "Deputy Secretary of War", "Departmental management; munitions and sustainment; reported internal blame."],
  "Elbridge Colby": ["Department of War / Department of Defense", "Under Secretary of War for Policy", "Defense policy; military strategy; reported disagreements within Pentagon leadership."],
  "Lt. Gen. Brett Sylvia": ["Joint Staff", "Former Joint Staff J5 director", "Removal; alleged leaks; institutional relationships; internal decision-making."],
  "Adam Telle": ["Department of War / Department of Defense", "Acting Secretary of the Army in the reporting", "Disputed Joint Staff statement coordination."],
  "Sean Parnell": ["Department of War / Department of Defense", "Chief Pentagon spokesperson", "Official responses and rebuttals to leadership allegations."],
  "Anna Kelly": ["White House", "White House spokesperson", "Presidential confidence statements; official rebuttals."],
  "Hakeem Jeffries": ["Congressional oversight", "House Democratic leadership", "Oversight priorities; investigations; appropriations; senior-leader confidence; civil-military relationships."],
  "Mike Johnson": ["Congressional oversight", "House Republican leadership", "Congressional responses; investigations; appropriations; senior-leader confidence; civil-military relationships."],
  "Thom Tillis": ["Congressional oversight", "U.S. senator", "Public Republican criticism of Hegseth; defense funding."],
  "Thomas Massie": ["Congressional oversight", "U.S. representative", "Public calls for Hegseth's removal or impeachment."],
  "Mark Kelly": ["Congressional oversight", "U.S. senator", "Criticism of military leadership removals; institutional consequences."],
  "Shri Thanedar": ["Congressional oversight", "U.S. representative", "Reported impeachment initiatives."],
  "Yassamin Ansari": ["Congressional oversight", "U.S. representative", "Reported impeachment initiatives concerning Iran."],
  "Suhas Subramanyam": ["Congressional oversight", "U.S. representative", "Congressional oversight interest."],
  "Melanie Stansbury": ["Congressional oversight", "U.S. representative", "Public support for investigations or impeachment."],
};

export const unassignedPositions = [
  ["National Security Council", "National Security Adviser", "National security coordination; advice; leadership confidence.", 2],
  ["National Security Council", "Deputy National Security Adviser", "Policy deliberations; advice; internal differences.", 2],
  ["Joint Staff", "Vice Chairman, Joint Chiefs of Staff", "Military advice; institutional relationships; leadership accountability.", 3],
  ["Joint Staff", "J3 Operations", "Military operations; operational assessments.", 3],
  ["Joint Staff", "J5 Strategy, Plans and Policy", "Strategic planning; internal coordination; institutional relationships.", 3],
  ["Intelligence Community", "Director of National Intelligence", "Intelligence assessments; national security advice.", 3],
  ["Iranian leadership", "Senior national security and military leadership", "Iranian decisions; strategic assessments; military execution.", 2],
] as const;

export const organizationParents: Record<string, string> = {
  "National Security Council": "White House",
  "Joint Staff": "Department of War / Department of Defense",
  "U.S. Central Command": "Department of War / Department of Defense",
};

export const organizationRelevance: Record<string, string> = {
  "White House": "Presidential decision-making; Executive Office of the President; senior White House advisers.",
  "Department of War / Department of Defense": "Department leadership; Office of the Secretary of War; Office of the Under Secretary for Policy; Army leadership.",
  "Joint Staff": "Military advice; Joint Chiefs of Staff; J3 Operations; J5 Strategy, Plans and Policy.",
  "U.S. Central Command": "Military execution; component commanders; U.S. Navy Fifth Fleet; U.S. Air Forces Central; Joint Force commanders.",
  "National Security Council": "Influence; strategy; internal differences; national security coordination.",
  "Department of State": "Foreign policy; diplomacy; negotiations; national security coordination.",
  "Intelligence Community": "Intelligence and assessments; CIA; DIA; Joint Staff J2; intelligence officials; senior national security officials.",
  "Congressional oversight": "House and Senate Armed Services Committees; defense appropriations committees; inspectors general; DOJ; military investigative organizations. Investigations; impeachment; appropriations; senior-leader confidence; civil-military relationships.",
  "Israeli strategic actors": "Israeli Prime Minister's Office; Israel Defense Forces; Israeli Ministry of Defense; U.S.–Israel consultations.",
  "Iranian leadership": "Iran's senior national security and military leadership; strategic decisions; military operations.",
  "National / Defense Industrial Base": "National and defense industrial capacity; munitions; sustainment; defense funding.",
};

export function scopeDefaults(title: string) {
  const scope = positionScope[title];
  if (scope) return { watchType: "position" as const, organization: scope[0], position: scope[1], individual: title, summary: scope[2] };
  if (organizationRelevance[title]) return { organization: organizationParents[title] ?? "", summary: organizationRelevance[title] };
  return {};
}
