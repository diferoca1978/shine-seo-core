// The one list of LocalBusiness subtypes. The schema generators (src/types.ts) and
// check-seo's local-address rule both read it, so they cannot drift apart.
// Plain .mjs because check-seo runs in Node, which does not strip types in node_modules.

// The subtypes a `local` business may use. Add the most specific one a client's brief
// needs (reference §6.3); `business-types.d.mts` declares the same list for TypeScript,
// and test/business-types.test.mjs fails if the two differ.
export const LOCAL_BUSINESS_TYPES = ['LocalBusiness', 'LegalService', 'Dentist'];

// Deprecated types that legacy sites still emit (reference §6.7). The generators never
// emit them; local-address checks them too.
export const LEGACY_LOCAL_BUSINESS_TYPES = ['Attorney', 'ProfessionalService'];
