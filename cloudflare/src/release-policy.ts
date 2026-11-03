export type ReleaseEnvironment = {
  ENVIRONMENT?: string;
  RELEASE_COMMIT?: string;
  RELEASE_ACCEPTANCE_COMMIT?: string;
};

// Local/staging fixtures can exercise publishing before production acceptance.
// Production requires the exact stamp written only by the accepted deploy path.
export function publishingReleaseAccepted(env: ReleaseEnvironment) {
  if (env.RELEASE_ACCEPTANCE_COMMIT === "held") return false;
  if (["staging", "development"].includes(env.ENVIRONMENT || "")) return true;
  return (
    /^[a-f0-9]{40}$/.test(env.RELEASE_COMMIT || "") &&
    env.RELEASE_ACCEPTANCE_COMMIT === env.RELEASE_COMMIT
  );
}

export const HELD_RELEASE_MESSAGE =
  "This deployment holds publishing. Complete release acceptance and run npm run deploy:production:accepted before activating a pilot.";
