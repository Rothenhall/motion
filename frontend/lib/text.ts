/**
 * AI-written text sometimes contains em dashes. The product does not use them, so they are replaced with a comma
 * wherever generated text is shown. Only em dashes change: en dashes in ranges like 0:24\u20130:29 are left alone.
 */
export const plain = <T extends string | null | undefined>(text: T): T => (text ? (text.replace(/\s*\u2014\s*/g, ', ') as T) : text);
