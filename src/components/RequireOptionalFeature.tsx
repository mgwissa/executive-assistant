import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import type { OptionalFeatureId } from '../lib/optionalFeatures';
import { isOptionalFeatureEnabled } from '../lib/optionalFeatures';
import { useProfileStore } from '../store/useProfileStore';

export function RequireOptionalFeature({
  featureId,
  children,
}: {
  featureId: OptionalFeatureId;
  children: ReactNode;
}) {
  const hydrated = useProfileStore((s) => s.hydrated);
  const profile = useProfileStore((s) => s.profile);

  if (!hydrated) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">Loading…</div>
    );
  }

  if (!isOptionalFeatureEnabled(profile, featureId)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
