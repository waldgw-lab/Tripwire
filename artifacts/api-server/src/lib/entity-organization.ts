type Parent = { type: string; redirectId: string | null; organizationId: string | null };

/** Organizational context is analyst structure, not an employment assertion. */
export async function validateOrganizationParent(subjectId: string, organizationId: string | null,
  load: (id: string) => Promise<Parent>) {
  const seen = new Set([subjectId]);
  let id = organizationId;
  while (id) {
    if (seen.has(id)) throw new Error("Organization links cannot contain a cycle");
    seen.add(id);
    const parent = await load(id);
    if (parent.type !== "organization" || parent.redirectId) throw new Error("Choose an unredirected organization in this workspace");
    id = parent.organizationId;
  }
}
