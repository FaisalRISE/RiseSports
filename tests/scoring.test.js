/**
 * scoring.test.js — the live scoring engine and match timer.
 *
 * This is the code a referee drives a few hundred times per match, and the
 * score it derives is what goes into the rating engine. It has to be right.
 *
 * Extracts the real block from app.source.js, per the project convention.
 */
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "app.source.js"), "utf8");

// SPORTS registry + sportOf are prerequisites of the engine
const regStart = src.indexOf("const DEFAULT_SPORT");
const engStart = src.indexOf("/* ---------- live scoring engine");
const engEnd = src.indexOf("const hideLoading");
if (regStart < 0 || engStart < 0 || engEnd < 0) { console.error("could not extract blocks"); process.exit(1); }

const api = eval(
  src.slice(regStart, engStart) + src.slice(engStart, engEnd) +
  "\n;({ resolveRules, rallyOver, rallyGolden, rallyGamePoint, replayRallies, rallyStats," +
  " buildScoring, goldenInfo," +
  " emptyTiming, timerStart, timerPause, timerResume, timerStop, timerElapsed, fmtClock })"
);
const { resolveRules, rallyOver, rallyGolden, rallyGamePoint, replayRallies, rallyStats,
        buildScoring, goldenInfo, emptyTiming, timerStart, timerPause, timerResume, timerStop, timerElapsed, fmtClock } = api;

let pass = 0, fail = 0;
const check = (name, cond, extra) => cond ? (pass++, console.log("  PASS  " + name))
                                          : (fail++, console.log("  FAIL  " + name + "  " + (extra === undefined ? "" : extra)));
const play = (seq, m, r) => replayRallies({ server: "a", posA: 0, posB: 0, ...(m || {}), log: seq.split("") }, r);

console.log("rules resolution");
const PB = resolveRules("pb"), BD = resolveRules("bd"), TT = resolveRules("tt");
check("pickleball is 11, win by 2, side-out", PB.target === 11 && PB.winBy === 2 && PB.sideOut === true);
check("badminton is 21, cap 30, rally scoring", BD.target === 21 && BD.cap === 30 && BD.sideOut === false);
check("table tennis is 11, serve every 2", TT.target === 11 && TT.serve === "alt2" && TT.sideOut === false);
check("tennis has no point engine", resolveRules("tn") === null);
check("padel has no point engine", resolveRules("pd") === null);
check("per-tournament override wins", resolveRules("pb", { target: 15, sideOut: false }).target === 15
  && resolveRules("pb", { target: 15, sideOut: false }).sideOut === false);
check("empty override falls back to the sport default", resolveRules("pb", { target: "" }).target === 11);

console.log("\ngame end");
check("11-9 is over", rallyOver(11, 9, PB));
check("11-10 is NOT over (win by 2)", !rallyOver(11, 10, PB));
check("12-10 is over", rallyOver(12, 10, PB));
check("10-0 is not over", !rallyOver(10, 0, PB));
check("badminton 30-29 ends on the cap", rallyOver(30, 29, BD));
check("badminton 29-28 is not over", !rallyOver(29, 28, BD));
check("game point detected at 10-5", rallyGamePoint(10, 5, PB).join() === "a");
check("nobody is on game point at 10-10 (win by 2 still to come)",
  rallyGamePoint(10, 10, resolveRules("pb", { sideOut: false })).length === 0);
check("at 10-9 only the leader is on game point",
  rallyGamePoint(10, 9, resolveRules("pb", { sideOut: false })).join() === "a");

console.log("\nside-out scoring (pickleball) — only the server scores");
{
  // a serves and wins 3 straight: 3-0, still serving
  const st = play("aaa", {}, PB);
  check("server scores on every rally it wins", st.a === 3 && st.b === 0);
  check("server keeps serving", st.serving === "a");
  // opening turn has ONE server, so the first loss is an immediate side-out
  const so = play("b", {}, PB);
  check("receiver winning scores nothing", so.a === 0 && so.b === 0, JSON.stringify([so.a, so.b]));
  check("first fault of the game is an immediate side-out", so.serving === "b");
  // once b is serving normally, its first loss goes to the second server
  const s2 = play("ba", {}, PB);
  check("second server takes over rather than siding out", s2.serving === "b" && s2.serverNum === 2,
    "serving=" + s2.serving + " num=" + s2.serverNum);
  const s3 = play("baa", {}, PB);
  check("losing on the second serve sides out", s3.serving === "a", "serving=" + s3.serving);
}
{
  // partners swap on every point their side wins, so geometry follows the score
  const st = play("a", {}, PB);
  check("partners swap after the serving side scores", st.pos.a[0] === 1 && st.pos.a[1] === 0);
  const two = play("aa", {}, PB);
  check("two points swaps back", two.pos.a[0] === 0 && two.pos.a[1] === 1);
}
{
  // server always delivers from the right when their own score is even
  const even = play("aa", {}, PB);              // a on 2 -> right
  check("serve is from the right on an even score", even.servePos === "R", even.servePos + " at " + even.a);
  const odd = play("a", {}, PB);                // a on 1 -> left
  check("serve is from the left on an odd score", odd.servePos === "L", odd.servePos + " at " + odd.a);
}
{
  const st = play("aaaaaaaaaaa", {}, PB);       // 11 straight
  check("11 straight wins", st.over && st.winner === "a" && st.a === 11);
  const gp = play("aaaaaaaaaa", {}, PB);        // 10-0, serving
  check("server on game point at 10-0", gp.gamePoint.join() === "a");
}
{
  // under side-out the non-serving side can never be on game point
  const r = PB;
  const st = replayRallies({ server: "a", log: "aaaaaaaaaa".split("") }, r);   // 10-0, a serving
  check("only the serving side shows game point", st.gamePoint.every(t => t === st.serving));
}

console.log("\nrally scoring (badminton) — every rally is a point");
{
  const st = play("ab", {}, BD);
  check("both sides score", st.a === 1 && st.b === 1);
  check("winner of the rally serves next", st.serving === "b");
  const held = play("a", {}, BD);
  check("holding serve swaps the partners", held.pos.a[0] === 1);
  check("two holds swap back", play("aa", {}, BD).pos.a[0] === 0);
  const won = play("aaaaaaaaaaaaaaaaaaaaa", {}, BD);   // 21 straight
  check("21 straight wins badminton", won.over && won.a === 21);
}

console.log("\nevery-2 serve (table tennis)");
{
  const at0 = play("", {}, TT);
  check("a serves first", at0.serving === "a");
  check("still a after 1 point", play("a", {}, TT).serving === "a");
  check("serve changes after 2 points", play("aa", {}, TT).serving === "b");
  check("and back after 4", play("aaaa", {}, TT).serving === "a");
  // at 10-10 the serve alternates every point
  const deuce = "aaaaaaaaaa" + "bbbbbbbbbb";           // 10-10
  const d1 = play(deuce, {}, TT), d2 = play(deuce + "a", {}, TT);
  check("serve alternates every point at deuce", d1.serving !== d2.serving,
    d1.serving + " -> " + d2.serving);
}

console.log("\nundo is exact (the reason the log is the source of truth)");
{
  const seq = "aababbaaab";
  const full = play(seq, {}, PB);
  const shorter = play(seq.slice(0, -1), {}, PB);
  const redone = play(seq, {}, PB);
  check("replaying the same log gives the same state", JSON.stringify(full) === JSON.stringify(redone));
  check("dropping the last rally rewinds cleanly",
    JSON.stringify(shorter) === JSON.stringify(play(seq.slice(0, -1), {}, PB)));
  check("undo then redo returns to the original", JSON.stringify(play(seq, {}, PB)) === JSON.stringify(full));
}
{
  // a long random game must never exceed the cap or go past game over
  let log = "", seed = 7;
  for (let i = 0; i < 400; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const st = play(log, {}, BD);
    if (st.over) break;
    log += seed % 2 ? "a" : "b";
  }
  const end = play(log, {}, BD);
  check("a full random badminton game terminates", end.over, `${end.a}-${end.b} after ${end.rallies}`);
  check("score never passes the cap", end.a <= BD.cap && end.b <= BD.cap, `${end.a}-${end.b}`);
}

console.log("\nrally stats");
{
  const stats = rallyStats({ server: "a", log: "aabba".split("") }, PB, { a: ["p1", "p2"], b: ["p3", "p4"] });
  check("rallies won and lost balance", stats.a.won + stats.b.won === 5 && stats.a.won === stats.b.lost);
  check("serve-hold percentage is computed", typeof stats.a.serveHoldPct === "number" || stats.a.serveHoldPct === null);
  check("per-player rows exist", Object.keys(stats.players).length === 4);
  check("clutch splits are counted", "clutchWon" in stats.a);
}

console.log("\nmatch timer");
{
  const t0 = emptyTiming();
  check("starts empty", t0.startedAt === null && t0.pauseCount === 0);
  check("elapsed is 0 before the first rally", timerElapsed(t0) === 0);
  const t1 = timerStart(t0);
  check("start records a wall-clock stamp", !!t1.startedAt);
  check("start is idempotent (auto-start on first point only)", timerStart(t1).startedAt === t1.startedAt);
  const t2 = timerPause(t1, "injury");
  check("pause records the reason and counts", t2.pauseReason === "injury" && t2.pauseCount === 1);
  check("pausing twice does not double-count", timerPause(t2, "rain").pauseCount === 1);
  const t3 = timerResume(t2);
  check("resume clears the pause", t3.pauseMono === null && t3.pauseReason === null);
  const t4 = timerStop(t3);
  check("stop records an end time", !!t4.endedAt);
  check("stop is idempotent", timerStop(t4).endedAt === t4.endedAt);
  check("playing time excludes paused time", t4.playingMs >= 0 && t4.playingMs <= 5000, String(t4.playingMs));
  check("elapsed after stop is frozen", timerElapsed(t4) === t4.playingMs);
  check("pausing a stopped match does nothing", timerPause(t4, "x").pauseCount === t4.pauseCount);
}
check("clock formats as m:ss", fmtClock(0) === "0:00" && fmtClock(61000) === "1:01" && fmtClock(600000) === "10:00");
check("clock never shows a negative", fmtClock(-5000) === "0:00");

console.log("\ntournament scoring rules (the CreateTab controls)");
{
  // pickleboss ran to 15, win by 2, golden at 17, cap 18 — the exact shape
  const pboss = buildScoring(15, true, "17", "8");
  check("reproduces the pickleboss rule set", pboss.winBy === 2 && pboss.golden === 17 && pboss.cap === 18,
    JSON.stringify(pboss));
  check("ends change is carried through", pboss.switchAt === 8);

  const auto = buildScoring(11, true, "auto", "");
  check("auto cap is target + 2", auto.golden === 13 && auto.cap === 14, JSON.stringify(auto));

  // "Golden point" (was mislabelled sudden death): first to the target takes
  // it, so the target point IS the golden point and the cap sits on it.
  const sudden = buildScoring(11, false, "auto", "");
  check("golden point is win by 1, capped at the target",
    sudden.winBy === 1 && sudden.cap === 11 && sudden.golden === 10, JSON.stringify(sudden));

  // scoring type: rally vs service points
  check("service points sets side-out", buildScoring(11, true, "auto", "", "service").sideOut === true);
  check("rally points clears side-out", buildScoring(11, true, "auto", "", "rally").sideOut === false);
  check("unset scoring type defers to the sport", buildScoring(11, true, "auto", "", "").sideOut === undefined);
  check("resolveRules honours an explicit rally choice",
    resolveRules("pb", { target: 11, ...buildScoring(11, true, "auto", "", "rally") }).sideOut === false);
  check("resolveRules falls back to the sport when unset",
    resolveRules("pb", { target: 11, ...buildScoring(11, true, "auto", "", "") }).sideOut === true);

  const nocap = buildScoring(21, true, "none", "");
  check("no-cap keeps win by 2 and drops the ceiling",
    nocap.winBy === 2 && nocap.cap === null && nocap.golden === null);

  // and the rules must actually reach the engine
  const r = resolveRules("pb", { target: 15, ...pboss });
  check("engine honours the tournament cap", rallyOver(18, 17, r) && !rallyOver(17, 16, r));
  check("17-17 is the golden point", rallyGamePoint(17, 17, r).length === 2);
  const sd = resolveRules("pb", { target: 11, ...sudden });
  check("golden point ends at the target", rallyOver(11, 10, sd));
  check("target-1 all is the golden point", rallyGolden(10, 10, sd));
}
check("the rule summary reads as plain English",
  /two-point rule stops at 17/i.test(goldenInfo(15, true, "17")), goldenInfo(15, true, "17"));
check("golden point is described differently", /First to 11/.test(goldenInfo(11, false, "auto")));
check("the summary names the scoring type",
  /Service points/.test(goldenInfo(11, true, "auto", "service")) &&
  /Rally scoring/.test(goldenInfo(11, true, "auto", "rally")));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
