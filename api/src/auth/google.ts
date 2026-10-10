import * as oidc from 'openid-client';
import type { GoogleIdentity } from './loginPolicy.js';

// One-time values we create when login starts and check when Google sends
// the user back. They live in the encrypted session cookie in between.
//   state:        proves the callback answers a login *we* started (stops CSRF)
//   nonce:        ties the ID token to this login (stops replaying an old token)
//   codeVerifier: PKCE. Only we know it, so a stolen ?code= is useless to others
export interface LoginChecks {
  state: string;
  nonce: string;
  codeVerifier: string;
}

// The two steps of "Sign in with Google". Routes depend on this interface,
// so tests can swap in a fake Google.
export interface GoogleAuth {
  start(): Promise<{ url: string; checks: LoginChecks }>;
  // `query` is the callback's query string, e.g. "code=...&state=...".
  finish(query: string, checks: LoginChecks): Promise<GoogleIdentity>;
}

export interface GoogleSettings {
  clientId: string;
  clientSecret: string;
  // Must exactly match a redirect URI in the Google Cloud console.
  redirectUri: string;
}

export function createGoogleAuth({ clientId, clientSecret, redirectUri }: GoogleSettings): GoogleAuth {
  // "Discovery" downloads Google's settings (endpoints and signing keys) from
  // https://accounts.google.com/.well-known/openid-configuration.
  // We do it on the first login, not at startup, so the API (and /healthz)
  // still starts when there is no internet.
  let config: Promise<oidc.Configuration> | undefined;
  const getConfig = () => {
    config ??= oidc.discovery(new URL('https://accounts.google.com'), clientId, clientSecret).catch((err) => {
      config = undefined; // try again on the next login
      throw err;
    });
    return config;
  };

  return {
    async start() {
      const checks: LoginChecks = {
        state: oidc.randomState(),
        nonce: oidc.randomNonce(),
        codeVerifier: oidc.randomPKCECodeVerifier(),
      };
      const url = oidc.buildAuthorizationUrl(await getConfig(), {
        redirect_uri: redirectUri,
        scope: 'openid email profile',
        state: checks.state,
        nonce: checks.nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(checks.codeVerifier),
        code_challenge_method: 'S256',
        // Always show the account picker, so people with both a SIIT and a
        // personal Google account can choose. We don't send `hd` (ADR 0007).
        prompt: 'select_account',
      });
      return { url: url.href, checks };
    },

    async finish(query, checks) {
      // Behind Caddy, the API sees "http://api:3000/auth/callback", but Google
      // only knows the public address. Rebuild the URL from the configured
      // redirect URI so the address we send back to Google matches exactly.
      const callbackUrl = new URL(redirectUri);
      callbackUrl.search = query;

      // This one call does the security work: checks `state`, swaps the code
      // for tokens (sending the PKCE verifier), verifies the ID token's
      // signature, issuer, audience, expiry and `nonce`. Any problem throws.
      const tokens = await oidc.authorizationCodeGrant(await getConfig(), callbackUrl, {
        expectedState: checks.state,
        expectedNonce: checks.nonce,
        pkceCodeVerifier: checks.codeVerifier,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims || typeof claims.email !== 'string') {
        throw new Error('Google ID token has no email');
      }
      return {
        sub: claims.sub,
        email: claims.email,
        emailVerified: claims.email_verified === true,
        name: typeof claims.name === 'string' ? claims.name : undefined,
      };
    },
  };
}
