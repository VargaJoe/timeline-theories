import { environment } from './configuration';
import { canonicalLocalAppUrl } from './utils/localAppOrigin';

const canonicalUrl = canonicalLocalAppUrl(
  window.location.href,
  import.meta.env.DEV || environment.mode === 'm0-local'
);

// The API and OIDC callbacks use one local origin. Do this before loading App,
// whose imports initialize authentication and can start repository requests.
if (canonicalUrl) window.location.replace(canonicalUrl);
else void import('./renderApp');
