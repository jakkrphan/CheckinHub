import assert from "node:assert/strict";
import test from "node:test";

import { pageWindow, readPage } from "./pagination.ts";

test("page parameter: only positive whole numbers count", () => {
  assert.equal(readPage("3"), 3);
  assert.equal(readPage("0"), 1);
  assert.equal(readPage("-2"), 1);
  assert.equal(readPage("2.5"), 1);
  assert.equal(readPage("abc"), 1);
  assert.equal(readPage(["2"]), 1);
  assert.equal(readPage(undefined), 1);
  assert.equal(readPage("99999999"), 1);
});

test("window bounds for a middle and a last, partly filled page", () => {
  assert.deepEqual(pageWindow(2, 25, 60), { current: 2, pageCount: 3, skip: 25, take: 25, from: 26, to: 50, total: 60 });
  assert.deepEqual(pageWindow(3, 25, 60), { current: 3, pageCount: 3, skip: 50, take: 25, from: 51, to: 60, total: 60 });
});

test("a page past the end falls back to the last page", () => {
  assert.equal(pageWindow(9999, 50, 120).current, 3);
  assert.equal(pageWindow(9999, 50, 120).skip, 100);
});

test("an empty list is one empty page", () => {
  assert.deepEqual(pageWindow(4, 20, 0), { current: 1, pageCount: 1, skip: 0, take: 20, from: 0, to: 0, total: 0 });
});

test("an exactly full page does not create an empty next page", () => {
  assert.equal(pageWindow(1, 25, 25).pageCount, 1);
  assert.equal(pageWindow(1, 25, 26).pageCount, 2);
});
