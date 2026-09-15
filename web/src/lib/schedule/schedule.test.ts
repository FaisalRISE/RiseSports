import { describe, it, expect } from "vitest";
import {
  buildSchedule, busyKey, floatingInstant, floatingTime, floatingDay, floatingInputValue,
  type ScheduleMatch,
} from "./index";

const AT = new Date("2026-09-20T09:00:00.000Z");

const m = (
  id: string,
  people: string[] = [],
  dependsOn: string[] = [],
  started = false,
): ScheduleMatch => ({ id, people, dependsOn, started, decided: people.length > 0 });

const plan = (matches: ScheduleMatch[], courts = 2, matchMinutes = 20) =>
  buildSchedule({ matches, courts, startsAt: AT, matchMinutes });

const slotOf = (p: ReturnType<typeof plan>, id: string) =>
  p.placements.find((x) => x.matchId === id)?.slot;

describe("who is the same person", () => {
  it("uses the person, not the entry", () => {
    /* The whole point: one human entered in two categories is two `players`
       rows with different ids and one personId. */
    const md = busyKey({ personId: "p1", name: "Rahul", id: "row-md" });
    const mx = busyKey({ personId: "p1", name: "Rahul", id: "row-mx" });
    expect(md).toBe(mx);
  });

  it("falls back to the name when nobody linked a profile", () => {
    expect(busyKey({ personId: null, name: " Rahul  Menon ", id: "a" }))
      .toBe(busyKey({ personId: null, name: "rahul menon", id: "b" }));
  });

  it("falls back to the row itself when there is no name either", () => {
    expect(busyKey({ personId: null, name: "  ", id: "a" }))
      .not.toBe(busyKey({ personId: null, name: "", id: "b" }));
  });
});

describe("nobody is on two courts at once", () => {
  it("separates two matches sharing a player, even with a court free", () => {
    const p = plan([m("m1", ["ann", "bob"]), m("m2", ["ann", "cat"])], 4);
    expect(slotOf(p, "m1")).not.toBe(slotOf(p, "m2"));
  });

  it("runs two independent matches at the same time", () => {
    const p = plan([m("m1", ["ann", "bob"]), m("m2", ["cat", "dan"])], 2);
    expect(slotOf(p, "m1")).toBe(0);
    expect(slotOf(p, "m2")).toBe(0);
    expect(p.slots).toBe(1);
  });

  it("holds ACROSS categories, which is the reason this exists", () => {
    /* Ann plays Men's Doubles with Bob and Mixed with Cat. Two divisions, two
       teams, two player rows, one human — and one body. */
    const p = plan(
      [m("md1", ["ann", "bob"]), m("mx1", ["ann", "cat"]), m("md2", ["dan", "eve"])],
      3,
    );
    expect(slotOf(p, "md1")).not.toBe(slotOf(p, "mx1"));
  });
});

describe("a match never starts before what it waits for has finished", () => {
  it("puts a final after its semi-finals", () => {
    const p = plan(
      [m("sf1", ["a", "b"]), m("sf2", ["c", "d"]), m("final", [], ["sf1", "sf2"])],
      4,
    );
    expect(slotOf(p, "final")).toBeGreaterThan(slotOf(p, "sf1")!);
    expect(slotOf(p, "final")).toBeGreaterThan(slotOf(p, "sf2")!);
  });

  it("will not play a dependency in the SAME slot, with courts to spare", () => {
    /* Four free courts and no shared players — a scheduler that only avoided
       clashes would happily run the semi-final and the final at 9:00. */
    const p = plan([m("sf1", ["a", "b"]), m("final", [], ["sf1"])], 4);
    expect(slotOf(p, "sf1")).toBe(0);
    expect(slotOf(p, "final")).toBe(1);
  });

  it("stacks a whole knockout in order", () => {
    const p = plan(
      [
        m("qf1", ["a", "b"]), m("qf2", ["c", "d"]), m("qf3", ["e", "f"]), m("qf4", ["g", "h"]),
        m("sf1", [], ["qf1", "qf2"]), m("sf2", [], ["qf3", "qf4"]),
        m("final", [], ["sf1", "sf2"]),
      ],
      4,
    );
    expect(slotOf(p, "qf1")).toBe(0);
    expect(Math.max(slotOf(p, "sf1")!, slotOf(p, "sf2")!)).toBeLessThan(slotOf(p, "final")!);
    expect(p.provisional.sort()).toEqual(["final", "sf1", "sf2"]);
  });

  it("ignores a dependency that is already finished", () => {
    /* A played group match is not something to wait for — it is a result. */
    const p = plan([m("group", ["a", "b"], [], true), m("ko", ["a", "c"], ["group"])], 2);
    expect(slotOf(p, "group")).toBeUndefined();
    expect(slotOf(p, "ko")).toBe(0);
  });

  it("ignores a reference to a match that is not there", () => {
    const p = plan([m("ko", ["a", "b"], ["never-existed"])], 2);
    expect(slotOf(p, "ko")).toBe(0);
    expect(p.skipped).toEqual([]);
  });
});

describe("courts and times", () => {
  it("fills every court before opening a new slot", () => {
    const ms = Array.from({ length: 6 }, (_, i) => m(`m${i}`, [`p${i}a`, `p${i}b`]));
    const p = plan(ms, 3);
    expect(p.slots).toBe(2);
    expect(p.placements.filter((x) => x.slot === 0).map((x) => x.court).sort()).toEqual([1, 2, 3]);
  });

  it("never puts two matches on one court in one slot", () => {
    const ms = Array.from({ length: 9 }, (_, i) => m(`m${i}`, [`p${i}a`, `p${i}b`]));
    const p = plan(ms, 4);
    const seen = new Set<string>();
    for (const x of p.placements) {
      const key = `${x.slot}/${x.court}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("steps the clock by the match length", () => {
    const ms = Array.from({ length: 4 }, (_, i) => m(`m${i}`, [`p${i}a`, `p${i}b`]));
    const p = plan(ms, 2, 25);
    const at = (id: string) => p.placements.find((x) => x.matchId === id)!.startsAt.toISOString();
    expect(at("m0")).toBe("2026-09-20T09:00:00.000Z");
    expect(p.placements.filter((x) => x.slot === 1)[0].startsAt.toISOString())
      .toBe("2026-09-20T09:25:00.000Z");
  });

  it("refuses a nonsense court count or match length rather than dividing by it", () => {
    const p = buildSchedule({
      matches: [m("m1", ["a", "b"])], courts: 0, startsAt: AT, matchMinutes: 0,
    });
    expect(p.placements[0].court).toBe(1);
    expect(p.slots).toBe(1);
  });

  it("leaves a match that has started exactly where it is", () => {
    const p = plan([m("live", ["a", "b"], [], true), m("next", ["a", "c"])], 2);
    expect(p.placements.map((x) => x.matchId)).toEqual(["next"]);
  });
});

describe("back-to-back", () => {
  it("lets another match go first rather than make a pair play twice running", () => {
    /* One court. Ann and Bob play twice, and Cat and Dan once. Taken in the
       order they arrive, Ann and Bob would play slots 0 and 1 back to back; the
       penalty puts Cat and Dan between them instead. Nothing is delayed — the
       day is three slots either way. */
    const p = plan(
      [m("ab1", ["ann", "bob"]), m("ab2", ["ann", "bob"]), m("cd", ["cat", "dan"])],
      1,
    );
    expect(slotOf(p, "ab1")).toBe(0);
    expect(slotOf(p, "cd")).toBe(1);
    expect(slotOf(p, "ab2")).toBe(2);
    expect(p.slots).toBe(3);
  });

  it("but never leaves a court empty to give someone a rest", () => {
    /* A rest is a preference; finishing the day is the job. With nothing else
       to play, the pair plays twice running. */
    const p = plan([m("ab1", ["ann", "bob"]), m("ab2", ["ann", "bob"])], 2);
    expect(p.slots).toBe(2);
  });
});

describe("refusing rather than hanging", () => {
  it("reports a circular wait instead of spinning", () => {
    const p = plan([m("x", ["a", "b"], ["y"]), m("y", ["c", "d"], ["x"])], 2);
    expect(p.placements).toEqual([]);
    expect(p.skipped.map((s) => s.matchId).sort()).toEqual(["x", "y"]);
    expect(p.skipped[0].reason).toMatch(/waits on/);
  });

  it("still schedules everything the cycle does not touch", () => {
    const p = plan(
      [m("x", ["a", "b"], ["y"]), m("y", ["c", "d"], ["x"]), m("ok", ["e", "f"])],
      2,
    );
    expect(slotOf(p, "ok")).toBe(0);
    expect(p.skipped).toHaveLength(2);
  });

  it("schedules nothing out of nothing", () => {
    const p = plan([], 3);
    expect(p).toEqual({ placements: [], slots: 0, provisional: [], skipped: [] });
  });
});

describe("the two invariants, over a spread of generated events", () => {
  /* Hand-built cases check the cases I thought of. This checks the ones I did
     not: many categories, shared people, knockouts hanging off groups. */
  const rnd = (seed: number) => {
    let x = seed;
    return () => ((x = (x * 1103515245 + 12345) & 0x7fffffff), x / 0x7fffffff);
  };

  for (let seed = 1; seed <= 25; seed++) {
    it(`holds for event ${seed}`, () => {
      const r = rnd(seed);
      const people = Array.from({ length: 12 }, (_, i) => `person${i}`);
      const ms: ScheduleMatch[] = [];

      /* Three categories, each a small group stage feeding one knockout. */
      for (let d = 0; d < 3; d++) {
        const groupIds: string[] = [];
        for (let g = 0; g < 4; g++) {
          const four = [...people].sort(() => r() - 0.5).slice(0, 4);
          const id = `d${d}g${g}`;
          groupIds.push(id);
          ms.push(m(id, four));
        }
        ms.push(m(`d${d}sf`, [], groupIds.slice(0, 2)));
        ms.push(m(`d${d}final`, [], [`d${d}sf`, ...groupIds.slice(2)]));
      }

      const courts = 1 + Math.floor(r() * 4);
      const p = buildSchedule({ matches: ms, courts, startsAt: AT, matchMinutes: 20 });

      expect(p.skipped).toEqual([]);
      expect(p.placements).toHaveLength(ms.length);

      /* One: nobody is on two courts at once. */
      const bySlot = new Map<number, Set<string>>();
      for (const x of p.placements) {
        const who = ms.find((y) => y.id === x.matchId)!.people;
        const set = bySlot.get(x.slot) ?? new Set<string>();
        for (const person of who) {
          expect(set.has(person)).toBe(false);
          set.add(person);
        }
        bySlot.set(x.slot, set);
        expect(x.court).toBeLessThanOrEqual(courts);
      }

      /* Two: nothing starts before what it waits for has finished. */
      const at = new Map(p.placements.map((x) => [x.matchId, x.slot]));
      for (const match of ms) {
        for (const dep of match.dependsOn) {
          expect(at.get(match.id)!).toBeGreaterThan(at.get(dep)!);
        }
      }
    });
  }

  it("gives the same answer twice", () => {
    const ms = Array.from({ length: 10 }, (_, i) => m(`m${i}`, [`p${i % 5}`, `q${i}`]));
    const a = plan(ms, 3);
    const b = plan(ms, 3);
    expect(a.placements).toEqual(b.placements);
  });
});

describe("wall-clock times survive the server's timezone", () => {
  /* The legacy app stored a date derived one way and read it another, and every
     Indian user saw the strip a day out. These tests are the guard: what the
     organiser typed is what everybody reads, wherever the server happens to be.
     They fail under TZ=Asia/Kolkata if anything here starts converting. */

  it("reads back exactly what was typed", () => {
    const at = floatingInstant("2026-09-20T09:00")!;
    expect(floatingTime(at)).toBe("09:00");
    /* Sept, not Sep — ICU's en-GB abbreviation for September has four letters
       and has changed between Node releases, so this is matched loosely rather
       than pinning the test to one build's locale data. */
    expect(floatingDay(at)).toMatch(/^Sun 20 Sept?$/);
    expect(floatingInputValue(at)).toBe("2026-09-20T09:00");
  });

  it("keeps the clock across a whole day of slots", () => {
    const at = floatingInstant("2026-09-20T08:30")!;
    const ms = Array.from({ length: 8 }, (_, i) => m(`m${i}`, [`p${i}a`, `p${i}b`]));
    const p = buildSchedule({ matches: ms, courts: 2, startsAt: at, matchMinutes: 45 });
    const times = [...new Set(p.placements.map((x) => floatingTime(x.startsAt)))].sort();
    expect(times).toEqual(["08:30", "09:15", "10:00", "10:45"]);
  });

  it("crosses midnight without losing the date", () => {
    const at = floatingInstant("2026-09-20T23:40")!;
    const ms = Array.from({ length: 2 }, (_, i) => m(`m${i}`, [`p${i}a`, `p${i}b`]));
    const p = buildSchedule({ matches: ms, courts: 1, startsAt: at, matchMinutes: 30 });
    const late = p.placements.find((x) => x.slot === 1)!.startsAt;
    expect(floatingTime(late)).toBe("00:10");
    expect(floatingDay(late)).toMatch(/^Mon 21 Sept?$/);
  });

  it("refuses something that is not a date and time", () => {
    for (const junk of ["", "nonsense", "2026-09-20", "20/09/2026 09:00"]) {
      expect(floatingInstant(junk)).toBeNull();
    }
  });
});
