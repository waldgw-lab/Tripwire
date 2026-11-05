// Access is supplied by the workspace / Private publishing, not a second app login.
// Everyone admitted to Tripwire has the same editing permissions.
export function useWorkspaceAccess() {
  return { canEdit: true };
}
