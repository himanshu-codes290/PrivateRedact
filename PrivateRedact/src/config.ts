/** App-wide constants. No secrets live here: the app has no backend. */
export const APP_NAME = 'PrivateRedact';
export const REPO_URL = 'https://github.com/himanshu-codes290/PrivateRedact';
export const DOCS_URL = `${REPO_URL}/tree/main/docs`;
export const ISSUES_URL = `${REPO_URL}/issues`;
/**
 * Where every "support the project" link goes. One place to change the
 * platform: GitHub Sponsors pays out to India and takes cards from anywhere.
 * Always a plain outbound link, never an embedded widget: the CSP
 * (script-src 'self') and the privacy page both rule out third-party scripts.
 */
export const SUPPORT = {
  url: 'https://github.com/sponsors/himanshu-codes290',
  /** Button text. */
  label: 'Sponsor on GitHub',
  /** Host named in the privacy copy. */
  host: 'github.com',
} as const;
