export const WORKSPACE_OWNER = "workspace";
// A single workspace for everyone admitted by Replit. Deliberately no in-app
// login, user roles, or development-only authentication bypass.
export function workspaceIdentity(_request?: unknown) {
  return { userId: WORKSPACE_OWNER };
}
