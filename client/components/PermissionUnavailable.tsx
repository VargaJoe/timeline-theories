import { invalidatePermissions } from '../services/sensenet';

/** Recovery is user initiated; a content view never polls for access. */
export function PermissionUnavailable() {
  return <div role="alert" style={{ padding: 16, background: '#fef2f2', color: '#b91c1c', borderRadius: 8 }}>
    Unable to check access. The content service may be unavailable.
    <button type="button" onClick={invalidatePermissions} style={{ marginLeft: 16 }}>Try Again</button>
  </div>;
}
