/**
 * Wikitext sanitiser tests.
 *
 * Verifies the stripWikitext rules port correctly from PRTS-MCP. These are
 * deterministic pure-function tests.
 */

import { describe, it, expect } from "bun:test";
import { stripWikitext } from "../src/utils/sanitizer.js";

describe("stripWikitext", () => {
  it("strips {{template}} blocks", () => {
    expect(stripWikitext("Hello {{Infobox|foo=bar}} World")).toBe(
      "Hello  World",
    );
  });

  it("strips nested-but-single-level templates (non-greedy)", () => {
    // The regex is single-level: it will leave behind fragments if templates
    // are genuinely nested. This documents the known limitation rather than
    // asserting perfection.
    const out = stripWikitext("A {{T1|{{T2}}}} B");
    // Outer template is matched non-greedy up to first }}; inner {{T2}} is
    // consumed first by the same pass, so result depends on iteration order.
    // Just verify B survives and no {{ remains.
    expect(out).toContain("B");
    expect(out.includes("{{")).toBe(false);
  });

  it("removes [[File:...]] and [[文件:...]] image links", () => {
    expect(
      stripWikitext("Text [[File:icon.png|thumb|An icon]] more"),
    ).toBe("Text  more");
    expect(
      stripWikitext("文本 [[文件:图.png]] 结尾"),
    ).toBe("文本  结尾");
  });

  it("converts [[link|display]] to display", () => {
    expect(stripWikitext("See [[Endfield|the game]] here")).toBe(
      "See the game here",
    );
  });

  it("converts [[link]] to the bare link text", () => {
    expect(stripWikitext("Visit [[Endfield]] now")).toBe("Visit Endfield now");
  });

  it("strips HTML tags", () => {
    expect(stripWikitext("a <b>bold</b> <span class='x'>c</span> d")).toBe(
      "a bold c d",
    );
  });

  // Note: in the current implementation, the [[link]] -> link rule runs
  // before the [[Category:...]] removal rule, so a Category link gets
  // converted to the bare text "Category:Name" rather than being stripped.
  // This matches PRTS-MCP's behaviour verbatim (the source of this port);
  // the Category-stripping rule only fires on text that survives the link
  // pass intact (e.g. already-decategorised source). Pinning the actual
  // behaviour here so a future refactor is deliberate about the change.
  it("leaves Category text in place (documents current order)", () => {
    expect(stripWikitext("Lead [[Category:Characters]] tail")).toBe(
      "Lead Category:Characters tail",
    );
  });

  it("collapses runs of blank lines", () => {
    const input = "para1\n\n\n\n\npara2";
    expect(stripWikitext(input)).toBe("para1\n\npara2");
  });

  it("trims leading/trailing whitespace", () => {
    expect(stripWikitext("  \n hello \n  ")).toBe("hello");
  });
});
