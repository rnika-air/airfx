/**
 * Everything the About page says that may change without a code change.
 *
 * Contact details are deliberately empty until official ones exist. Set them at
 * build time (GitHub repository variables, or .env.local for development):
 *   VITE_CONTACT_EMAIL   e.g. hello@yourdomain.com
 *   VITE_CONTACT_URL     e.g. a contact form, portfolio or social profile
 *   VITE_CONTACT_LABEL   how that link is shown, e.g. "Instagram"
 */
const env = import.meta.env;

export const CONTACT = {
  email: (env.VITE_CONTACT_EMAIL as string | undefined)?.trim() || '',
  url: (env.VITE_CONTACT_URL as string | undefined)?.trim() || '',
  urlLabel: (env.VITE_CONTACT_LABEL as string | undefined)?.trim() || 'Contact page',
};

export const CREATOR = {
  /** The creator's working name, shown largest in the credits. */
  alias: 'MIKAIR',
  name: 'Iman Mikhail',
  role: 'Independent Creative Developer & Motion Designer',
  from: 'Malaysia',
};

export const COPYRIGHT_YEAR = 2026;

/** What AirFx is, in the creator's words: the splash and the About page. */
export const INTRO_TEXT = 'A creative playground for experimental visuals, image manipulation, motion graphics and digital art. Explore new techniques, distort reality and create your own visual language.';
