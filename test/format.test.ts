import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunk, formatDuration, parseTimeToMs, progressBar, truncate } from "../src/lib/format.js";

describe("formatDuration", () => {
  it("shows 0:00 for zero, negative and non-finite input (streams report Infinity)", () => {
    for (const ms of [0, -1, -60_000, Number.NaN, Infinity, -Infinity]) {
      assert.equal(formatDuration(ms), "0:00", `input ${ms}`);
    }
  });

  it("drops partial seconds instead of rounding up", () => {
    assert.equal(formatDuration(999), "0:00");
    assert.equal(formatDuration(1_000), "0:01");
    assert.equal(formatDuration(59_999), "0:59");
  });

  it("switches from m:ss to h:mm:ss at one hour", () => {
    assert.equal(formatDuration(60_000), "1:00");
    assert.equal(formatDuration(3_599_999), "59:59");
    assert.equal(formatDuration(3_600_000), "1:00:00");
    assert.equal(formatDuration(3_661_000), "1:01:01");
  });

  it("lets hours grow past 24 (long mixes, 24/7 streams with a known length)", () => {
    assert.equal(formatDuration(100 * 3_600_000), "100:00:00");
  });
});

describe("progressBar", () => {
  const KNOB = "🔘";
  const knobAt = (bar: string) => [...bar].indexOf(KNOB);

  it("shows LIVE when the duration is unknown or unusable", () => {
    for (const d of [0, -1, Number.NaN, Infinity]) assert.equal(progressBar(1_000, d), "🔴 LIVE", `duration ${d}`);
  });

  it("has `size` segments with exactly one knob", () => {
    const bar = [...progressBar(30_000, 200_000)];
    assert.equal(bar.length, 18);
    assert.equal(bar.filter((c) => c === KNOB).length, 1);
    assert.equal([...progressBar(1, 2, 7)].length, 7);
  });

  it("clamps the knob to the ends for positions outside the track", () => {
    assert.equal(knobAt(progressBar(0, 10_000, 10)), 0);
    assert.equal(knobAt(progressBar(-5_000, 10_000, 10)), 0);
    assert.equal(knobAt(progressBar(10_000, 10_000, 10)), 9);
    assert.equal(knobAt(progressBar(99_000, 10_000, 10)), 9);
  });

  it("puts the knob in the middle half-way through", () => {
    assert.equal(knobAt(progressBar(5_000, 10_000, 11)), 5);
  });

  it("is just the knob when size is 1", () => {
    assert.equal(progressBar(5_000, 10_000, 1), KNOB);
  });
});

describe("truncate", () => {
  it("returns an empty string for empty input", () => {
    assert.equal(truncate(""), "");
    assert.equal(truncate("", 5), "");
  });

  it("leaves text that fits, including text exactly max long", () => {
    assert.equal(truncate("abc", 4), "abc");
    assert.equal(truncate("abcd", 4), "abcd");
    const sixty = "x".repeat(60);
    assert.equal(truncate(sixty), sixty);
  });

  it("counts the ellipsis inside the max budget", () => {
    // Callers pass Discord field limits as max, so the result must never exceed it.
    assert.equal(truncate("abcdef", 4), "abc…");
    assert.equal(truncate("abcdefghij", 5), "abcd…");
    assert.equal(truncate("x".repeat(61)), `${"x".repeat(59)}…`);
    for (let max = 1; max <= 12; max++) {
      const out = truncate("The quick brown fox jumps", max);
      assert.ok(out.length <= max, `max ${max} gave ${JSON.stringify(out)}`);
      assert.ok(out.endsWith("…"));
    }
  });

  it("does not leave a space before the ellipsis", () => {
    assert.equal(truncate("ab cdef", 4), "ab…");
  });

  it("is only the ellipsis when max is 1", () => {
    assert.equal(truncate("hello", 1), "…");
  });
});

describe("chunk", () => {
  it("returns no pages for an empty list", () => {
    assert.deepEqual(chunk([], 10), []);
  });

  it("returns one page for a single item or a list shorter than the page", () => {
    assert.deepEqual(chunk(["a"], 10), [["a"]]);
    assert.deepEqual(chunk([1, 2, 3], 10), [[1, 2, 3]]);
  });

  it("does not add an empty trailing page when the list fills pages exactly", () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5, 6], 3), [
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it("puts the remainder on the last page and keeps queue order", () => {
    const queue = Array.from({ length: 25 }, (_, i) => i + 1);
    const pages = chunk(queue, 10);
    assert.deepEqual(
      pages.map((p) => p.length),
      [10, 10, 5],
    );
    assert.equal(pages[1][0], 11); // page 2 starts at the 11th track
    assert.deepEqual(pages.flat(), queue);
  });

  it("does not modify the input", () => {
    const queue = [1, 2, 3, 4];
    chunk(queue, 3);
    assert.deepEqual(queue, [1, 2, 3, 4]);
  });
});

describe("parseTimeToMs", () => {
  it("reads plain seconds", () => {
    assert.equal(parseTimeToMs("90"), 90_000);
    assert.equal(parseTimeToMs("0"), 0);
    assert.equal(parseTimeToMs("  45 "), 45_000);
  });

  it("reads mm:ss and h:mm:ss", () => {
    assert.equal(parseTimeToMs("1:30"), 90_000);
    assert.equal(parseTimeToMs("0:05"), 5_000);
    assert.equal(parseTimeToMs("1:02:03"), 3_723_000);
    assert.equal(parseTimeToMs("01:02:03"), 3_723_000);
  });

  it("tolerates spaces around the parts", () => {
    assert.equal(parseTimeToMs(" 1 : 30 "), 90_000);
  });

  it("rejects malformed input with null", () => {
    for (const input of ["", "   ", "1:30:", ":30", "1::30", "a:b", "1m30s", "-5", "1.5", "1:2:3:4", "1:-30"]) {
      assert.equal(parseTimeToMs(input), null, `input ${JSON.stringify(input)}`);
    }
  });
});
