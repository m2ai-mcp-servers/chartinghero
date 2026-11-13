/**
 * Patient search query parsing shared by the backends.
 */

import { isRealDate } from '../schemas/common.js';

export interface NameQuery {
  /** Name words, in order, without punctuation. */
  tokens: string[];
  /** A YYYY-MM-DD date found in the query: name plus date of birth is the safest voice search. */
  birthDate?: string;
}

/** "Marple, Jane 1942-03-15" becomes tokens [Marple, Jane] and birthDate 1942-03-15. */
export function parseNameQuery(query: string): NameQuery {
  let birthDate: string | undefined;
  const rest = query.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (m) => {
    if (birthDate === undefined && isRealDate(m)) {
      birthDate = m;
      return ' ';
    }
    return m;
  });
  const tokens = rest.split(/[\s,]+/).filter((t) => t !== '');
  return { tokens, ...(birthDate ? { birthDate } : {}) };
}
