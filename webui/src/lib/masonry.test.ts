import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { columnCountForWidth } from "./masonry.ts";

describe("columnCountForWidth", () => {
  it("returns 2 columns at mobile widths", () => {
    assert.equal(columnCountForWidth(375), 2);
    assert.equal(columnCountForWidth(640), 2);
  });

  it("returns 4 columns at tablet widths", () => {
    assert.equal(columnCountForWidth(641), 4);
    assert.equal(columnCountForWidth(900), 4);
  });

  it("returns 6 columns at desktop widths", () => {
    assert.equal(columnCountForWidth(901), 6);
    assert.equal(columnCountForWidth(1440), 6);
  });
});