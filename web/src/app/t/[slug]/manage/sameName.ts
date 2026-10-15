/* Does what the organiser typed name this category? (step 8's "Start this
 * category again", which is confirmed by typing the category's name.)
 *
 * One function for the button and the server, so the two cannot disagree. It
 * forgives what a keyboard cannot help: "Men’s" — the name the Men's starting
 * point gives a category — has a curly apostrophe that a laptop or an Android
 * keyboard never types, and an iPhone types a curly one where a laptop typed a
 * straight one. Case, the spaces around the name and runs of spaces inside it
 * do not matter either. Anything else does: the point is that the organiser
 * looked at which category they were about to clear.
 *
 * Lives beside the manage page rather than in lib/, because the button runs in
 * the browser and lib/ allows only four modules there (bundle-leak.test.ts).
 * It holds nothing worth protecting. */

/* Quote shapes folded BEFORE NFKC as well as after it: NFKC takes ´ apart
   into a space and a combining accent, and ″ into two primes, so folded only
   afterwards they never matched ("Men´s" is how a Spanish or Portuguese
   keyboard types an apostrophe). */
const SINGLE = /[\u2018\u2019\u201B\u02BC\u0060\u00B4\u2032]/g;
const DOUBLE = /[\u201C\u201D\u201F\u2033]/g;
const quotes = (s: string) => s.replace(SINGLE, "'").replace(DOUBLE, '"');

const normal = (s: string) =>
  quotes(quotes(s).normalize("NFKC"))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export function sameCategoryName(typed: string, name: string): boolean {
  return normal(typed) !== "" && normal(typed) === normal(name);
}
