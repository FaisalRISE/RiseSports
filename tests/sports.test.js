/**
 * sports.test.js — the SPORTS registry and its accessors.
 *
 * Follows the project convention: pull the real block out of app.source.js by
 * text and evaluate it, so this tests what ships rather than a retyped copy.
 */
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "app.source.js"), "utf8");

// the registry runs from `const DEFAULT_SPORT` down to the end of rtg()
const start = src.indexOf("const DEFAULT_SPORT");
const end = src.indexOf("const hideLoading");
if (start < 0 || end < 0 || end < start) { console.error("could not extract SPORTS registry"); process.exit(1); }
const block = src.slice(start, end);

// the block declares consts, so hand the bindings back as the eval's value
const { DEFAULT_SPORT, SPORTS, sportOf, skillsFor, tagsFor, formatsFor, ratingKey, rtg } =
  eval(block + "\n;({ DEFAULT_SPORT, SPORTS, sportOf, skillsFor, tagsFor, formatsFor, ratingKey, rtg })");

let pass = 0, fail = 0;
const check = (name, cond, extra) => cond ? (pass++, console.log("  PASS  " + name))
                                          : (fail++, console.log("  FAIL  " + name + "  " + (extra === undefined ? "" : extra)));

console.log("SPORTS registry");
const ids = Object.keys(SPORTS);
check("has all 7 sports", ids.length === 7, ids.join(","));
check("default sport is pickleball", DEFAULT_SPORT === "pb" && SPORTS.pb.name === "Pickleball");

// structural invariants every sport must satisfy
const VALID_FMT = ["ms", "ws", "md", "wd", "mx", "gn"];
let structural = true, why = [];
for (const id of ids) {
  const s = SPORTS[id];
  if (s.id !== id) { structural = false; why.push(id + ": id mismatch"); }
  if (!s.name || !s.emoji || !s.court) { structural = false; why.push(id + ": missing name/emoji/court"); }
  if (s.skills.length !== 13) { structural = false; why.push(id + ": " + s.skills.length + " skills, want 13"); }
  if (s.tags.length !== 15) { structural = false; why.push(id + ": " + s.tags.length + " tags, want 15"); }
  if (new Set(s.skills).size !== 13) { structural = false; why.push(id + ": duplicate skills"); }
  if (!s.formats.length || !s.formats.every(f => VALID_FMT.includes(f))) { structural = false; why.push(id + ": bad formats"); }
  if (!(s.playersPerCourt > 0)) { structural = false; why.push(id + ": bad playersPerCourt"); }
  const pointBased = !s.setBased;
  if (pointBased && (!s.scoring || !(s.scoring.target > 0))) { structural = false; why.push(id + ": point sport without a target"); }
  if (s.setBased && s.scoring !== null) { structural = false; why.push(id + ": setBased must carry scoring:null"); }
}
check("every sport is structurally valid", structural, why.join(" | "));

// 13 skills matters: RadarChart is built for exactly 13 axes
check("skill count matches RadarChart's 13 axes", ids.every(i => SPORTS[i].skills.length === 13));

console.log("\naccessors");
check("sportOf resolves by id string", sportOf("bd").name === "Badminton");
check("sportOf resolves from a record", sportOf({ sport: "tt" }).name === "Table Tennis");
check("sportOf defaults an undated record to pickleball", sportOf({}).id === "pb");
check("sportOf survives null", sportOf(null).id === "pb");
check("sportOf falls back on an unknown sport", sportOf("zz").id === "pb");
check("skillsFor is sport-specific", skillsFor("tt").includes("Topspin") && !skillsFor("tt").includes("Dink"));
check("tagsFor is sport-specific", tagsFor("ch").includes("Tactician"));
check("formatsFor limits chess", formatsFor("ch").length === 3 && !formatsFor("ch").includes("md"));

console.log("\nrating keys");
check("ratingKey namespaces", ratingKey("bd", "md") === "bd:md");
check("ratingKey defaults the sport", ratingKey(null, "ms") === "pb:ms");

const modern = { sport: "bd", ratings: { "bd:md": 1100, "pb:md": 800 }, bestRating: 1100 };
check("rtg reads the namespaced key", rtg(modern, "md") === 1100);
check("rtg does not cross sports", rtg(modern, "md", "pb") === 800);

// the compatibility case that matters: data written before the rebrand
const legacy = { ratings: { md: 950, ms: 700 }, bestRating: 950 };
check("rtg falls back to a pre-rebrand flat key", rtg(legacy, "md") === 950);
check("rtg falls back to bestRating when the format is absent", rtg(legacy, "wd") === 950);
check("rtg returns 0 for a null player", rtg(null, "md") === 0);
check("rtg survives a player with no ratings map", rtg({ bestRating: 800 }, "md") === 800);

// a real 0 must not be swallowed by the fallback chain
check("rtg preserves a genuine zero", rtg({ ratings: { "pb:md": 0 }, bestRating: 900 }, "md") === 0);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
