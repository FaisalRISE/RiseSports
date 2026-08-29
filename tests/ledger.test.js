/**
 * ledger.test.js — the Court Ledger money engine.
 *
 * This decides who owes whom real money, so the arithmetic has to be exact.
 * Everything is integer paise; nothing is ever held in a float.
 *
 * Extracts the real block from app.source.js, per the project convention.
 */
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "app.source.js"), "utf8");

const start = src.indexOf("/* ---------- Court Ledger: money engine");
const end = src.indexOf("/* ---------- print pack ----------");
if (start < 0 || end < 0 || end < start) { console.error("could not extract the ledger engine"); process.exit(1); }

const {
  ledgerShares, ledgerOwedMap, ledgerNet, ledgerBalances, ledgerPairs,
  ledgerSettleUp, ledgerMoney, ledgerPaise, ledgerFor, ledgerMemberName
} = eval(src.slice(start, end) +
  "\n;({ ledgerShares, ledgerOwedMap, ledgerNet, ledgerBalances, ledgerPairs," +
  " ledgerSettleUp, ledgerMoney, ledgerPaise, ledgerFor, ledgerMemberName })");

let pass = 0, fail = 0;
const check = (name, cond, extra) => cond ? (pass++, console.log("  PASS  " + name))
                                          : (fail++, console.log("  FAIL  " + name + "  " + (extra === undefined ? "" : extra)));

const M = (id, name) => ({ id, name, color: "#000", role: "DATA_OPERATOR" });
const book = (members, activities, payments) => ({ members, activities, payments: payments || [] });
const act = (id, amount, payerId, participantIds, extra) =>
  ({ id, type: "COURT_BOOKING", amount, date: "2026-08-28T10:00:00Z", payerId, participantIds, ...(extra || {}) });

const A = M("a", "Asha"), B = M("b", "Bilal"), C = M("c", "Chetan"), D = M("d", "Divya");

console.log("splitting — integer paise, no float drift");
{
  // ₹1000 three ways does not divide evenly: 33333 + 33333 + 33334
  const bk = book([A, B, C], [act("1", 100000, "a", ["a", "b", "c"])]);
  const s = ledgerShares(bk, bk.activities[0]);
  const total = Object.values(s).reduce((x, y) => x + y, 0);
  check("shares sum EXACTLY to the amount", total === 100000, `${total} vs 100000`);
  check("the odd paise go to the payer", s.a === 33334 && s.b === 33333 && s.c === 33333, JSON.stringify(s));
}
{
  const bk = book([A, B], [act("1", 260000, "a", ["a", "b"])]);
  const s = ledgerShares(bk, bk.activities[0]);
  check("an even split is exact", s.a === 130000 && s.b === 130000);
}
{
  // a participant who is not a member of the book must be ignored
  const bk = book([A, B], [act("1", 100000, "a", ["a", "b", "ghost"])]);
  const s = ledgerShares(bk, bk.activities[0]);
  check("unknown participants are dropped", Object.keys(s).length === 2 && s.a + s.b === 100000);
}
{
  const bk = book([A, B], [act("1", 100000, "a", [])]);
  check("no participants means no shares", Object.keys(ledgerShares(bk, bk.activities[0])).length === 0);
}
{
  // payer not among the participants: they fronted the money for others only
  const bk = book([A, B, C], [act("1", 90000, "a", ["b", "c"])]);
  const s = ledgerShares(bk, bk.activities[0]);
  check("payer outside the split still balances", s.b === 45000 && s.c === 45000 && s.a === undefined);
}

console.log("\nbalances");
{
  const bk = book([A, B, C], [act("1", 90000, "a", ["a", "b", "c"])]);
  const bal = ledgerBalances(bk);
  check("payer is owed the others' shares", bal.a === 60000, String(bal.a));
  check("participants owe their share", bal.b === -30000 && bal.c === -30000);
  const sum = Object.values(bal).reduce((x, y) => x + y, 0);
  check("balances sum to zero — money is conserved", sum === 0, String(sum));
}
{
  // a confirmed payment settles; a pending one must NOT
  const base = [act("1", 90000, "a", ["a", "b", "c"])];
  const pending = book([A, B, C], base, [{ id: "p1", fromId: "b", toId: "a", amount: 30000, mode: "UPI", status: "PENDING", date: "2026-08-28T12:00:00Z" }]);
  const done = book([A, B, C], base, [{ id: "p1", fromId: "b", toId: "a", amount: 30000, mode: "UPI", status: "CONFIRMED", date: "2026-08-28T12:00:00Z" }]);
  check("a pending payment changes nothing", ledgerBalances(pending).b === -30000);
  check("a confirmed payment clears the debt", ledgerBalances(done).b === 0, String(ledgerBalances(done).b));
  check("and reduces what the payer is owed", ledgerBalances(done).a === 30000);
}

console.log("\nsettle up — fewest transfers");
{
  // Asha paid for everything; three people owe her. One transfer each.
  const bk = book([A, B, C, D], [act("1", 120000, "a", ["a", "b", "c", "d"])]);
  const plan = ledgerSettleUp(bk);
  check("three debtors, one creditor -> 3 transfers", plan.length === 3, JSON.stringify(plan));
  check("every transfer points at the creditor", plan.every(t => t.to === "a"));
  const moved = plan.reduce((s2, t) => s2 + t.amount, 0);
  check("transfers move exactly what is owed", moved === 90000, String(moved));
}
{
  // circular debt must collapse, not go round in circles
  const bk = book([A, B, C], [
    act("1", 30000, "a", ["a", "b"]),
    act("2", 30000, "b", ["b", "c"]),
    act("3", 30000, "c", ["c", "a"])
  ]);
  const plan = ledgerSettleUp(bk);
  check("a perfectly circular debt needs no transfers", plan.length === 0, JSON.stringify(plan));
}
{
  const bk = book([A, B, C], [act("1", 100000, "a", ["a", "b", "c"])]);
  const plan = ledgerSettleUp(bk);
  const bal = ledgerBalances(bk);
  // applying the plan must zero every balance
  const after = { ...bal };
  plan.forEach(t => { after[t.from] += t.amount; after[t.to] -= t.amount; });
  check("applying the plan zeroes every balance",
    Object.values(after).every(v => v === 0), JSON.stringify(after));
}

console.log("\npair detail");
{
  const bk = book([A, B], [act("1", 100000, "a", ["a", "b"]), act("2", 40000, "b", ["a", "b"])]);
  const pairs = ledgerPairs(bk);
  check("one pair with activity", pairs.length === 1);
  check("both legs are recorded", pairs[0].legAB === 20000 && pairs[0].legBA === 50000,
    JSON.stringify(pairs[0]));
  check("net is the difference", pairs[0].net === -30000, String(pairs[0].net));
}

console.log("\nstatement");
{
  const bk = book([A, B, C], [
    act("1", 90000, "a", ["a", "b", "c"], { venue: "ASC" }),
    act("2", 60000, "b", ["a", "b"], { venue: "ASC" })
  ]);
  const rows = ledgerFor(bk, "a");
  check("both activities appear for the payer/participant", rows.length === 2, String(rows.length));
  check("newest row first", new Date(rows[0].at) >= new Date(rows[1].at));
  check("running balance is carried", typeof rows[0].run === "number");
  const last = rows[rows.length - 1];
  check("the running total matches the balance",
    rows[0].run === ledgerBalances(bk).a, `${rows[0].run} vs ${ledgerBalances(bk).a}`);
}

console.log("\nmoney formatting (Indian grouping)");
check("whole rupees drop the decimals", ledgerMoney(100000) === "₹1,000");
check("paise show when present", ledgerMoney(123456) === "₹1,234.56");
check("lakh grouping is Indian", ledgerMoney(10000000) === "₹1,00,000");
check("zero", ledgerMoney(0) === "₹0");
check("negatives use a real minus sign", ledgerMoney(-50000) === "−₹500");
check("rupees convert to paise", ledgerPaise("1300") === 130000 && ledgerPaise(12.34) === 1234);
check("rubbish converts to zero", ledgerPaise("abc") === 0);
// the reason paise exist at all
check("no float drift on a third", ledgerPaise(0.1) + ledgerPaise(0.2) === ledgerPaise(0.3));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
