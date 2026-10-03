import assert from "node:assert/strict";
import test from "node:test";

import { answerProblemMessage, checkRegistrationAnswers, formPageLayout, formPages, readRegistrationFields, readRegistrationForm, sectionHeadings, TEL_ANSWER_PATTERN } from "./registration-fields.ts";

const text = (key) => ({ key, label: key, type: "text", required: true });
const page = (key, label = "") => ({ key, type: "page", label });

test("page breaks are layout only: answer fields never include them", () => {
  const stored = [text("name"), page("p1", "หน่วยงาน"), text("unit")];
  assert.deepEqual(readRegistrationFields(stored).map((field) => field.key), ["name", "unit"]);
  assert.deepEqual(readRegistrationForm(stored).map((item) => item.type), ["text", "page", "text"]);

  const formData = new FormData();
  formData.set("answer:name", "สมชาย");
  formData.set("answer:unit", "อายุรกรรม");
  assert.deepEqual(checkRegistrationAnswers(readRegistrationFields(stored), formData), { answers: { name: "สมชาย", unit: "อายุรกรรม" } });
});

test("a form without breaks is one page", () => {
  assert.deepEqual(formPageLayout([text("a"), text("b")]), [{ title: "", keys: ["a", "b"] }]);
});

test("breaks split pages and empty pages are dropped", () => {
  const items = [page("lead", "ส่วนตัว"), text("a"), page("p2", "งาน"), page("p3", "ว่าง"), text("b"), text("c"), page("tail", "ท้าย")];
  assert.deepEqual(formPages(items).map((item) => [item.title, item.fields.map((field) => field.key)]), [["ส่วนตัว", ["a"]], ["ว่าง", ["b", "c"]]]);
});

test("section headings sit on the first visible field of each page", () => {
  const pages = formPageLayout([text("a"), page("p2", "งาน"), text("b"), text("c"), page("p3", ""), text("d")]);
  assert.deepEqual([...sectionHeadings(pages, ["a", "c", "d"])], [["a", "ข้อมูลผู้ลงทะเบียน"], ["c", "งาน"], ["d", "ข้อมูลผู้ลงทะเบียน"]]);
  assert.equal(sectionHeadings(formPageLayout([text("a"), text("b")]), ["a", "b"]).size, 0);
});

test("a stored form with a malformed item is rejected", () => {
  assert.throws(() => readRegistrationForm([{ key: "x", type: "page" }]));
});

test("phone answers: one rule for the server and the browser pattern", () => {
  const phone = { key: "phone", label: "เบอร์โทร", type: "tel", required: false };
  const check = (value) => { const data = new FormData(); data.set("answer:phone", value); return checkRegistrationAnswers([phone], data); };
  // `v` is the flag browsers compile <input pattern> with.
  const browser = new RegExp(`^(?:${TEL_ANSWER_PATTERN})$`, "v");
  for (const value of ["0812345678", "081-234-5678", "+66 81 234 5678", "(02) 123-4567"]) {
    assert.deepEqual(check(value), { answers: { phone: value } }, value);
    assert.equal(browser.test(value), true, value);
  }
  for (const value of ["สนใจเข้าร่วมครับ", "12345", "call me", "0812345678x"]) {
    assert.deepEqual(check(value), { problem: { fieldKey: "phone", reason: "invalid" } }, value);
    assert.equal(browser.test(value), false, value);
  }
  assert.deepEqual(check(""), { answers: { phone: "" } });
});

test("problem messages name the field and what it expects", () => {
  assert.equal(answerProblemMessage({ label: "ชื่อ", type: "text" }, "required"), "กรุณากรอก “ชื่อ”");
  assert.match(answerProblemMessage({ label: "ความคิดเห็น", type: "tel" }, "invalid"), /^“ความคิดเห็น” ต้องเป็นเบอร์โทรศัพท์/);
});
