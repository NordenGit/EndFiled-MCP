/**
 * Parsetree parser tests.
 *
 * Pure-function tests over realistic MediaWiki parsetree XML shapes. No
 * network, no wiki client binding — just the XML → object transform.
 *
 * The fixtures are hand-crafted to mirror the shapes PRTS-MCP's parser has
 * historically seen (nested templates, positional + named params, comments).
 * If `getTemplateData` ever returns wrong data, start the diagnosis here.
 */

import { describe, it, expect } from "bun:test";
import { parseParsetreeXml } from "../src/api/parsetreeParser.js";

describe("parseParsetreeXml", () => {
  it("returns empty object for empty input", () => {
    expect(parseParsetreeXml("")).toEqual({});
  });

  it("returns empty object when no <template> tags present", () => {
    expect(parseParsetreeXml("<root>just text</root>")).toEqual({});
  });

  it("parses a single named-parameter template", () => {
    const xml =
      "<root><template><title>CharInfobox</title>" +
      "<part><name>name</name><value>Angelic</value></part>" +
      "<part><name>rarity</name><value>5</value></part>" +
      "</template></root>";

    const result = parseParsetreeXml(xml);
    expect(result["CharInfobox"]).toEqual({
      name: "Angelic",
      rarity: "5",
    });
  });

  it("parses positional parameters into _positional array", () => {
    const xml =
      "<root><template><title>Icon</title>" +
      "<part><value>item_001</value></part>" +
      "<part><value>32</value></part>" +
      "</template></root>";

    const result = parseParsetreeXml(xml);
    expect(result["Icon"]).toEqual({
      _positional: ["item_001", "32"],
    });
  });

  it("mixes named and positional parameters in one template", () => {
    const xml =
      "<root><template><title>Mixed</title>" +
      "<part><value>positional_first</value></part>" +
      "<part><name>named</name><value>yes</value></part>" +
      "<part><value>positional_second</value></part>" +
      "</template></root>";

    const result = parseParsetreeXml(xml);
    expect(result["Mixed"]).toEqual({
      named: "yes",
      _positional: ["positional_first", "positional_second"],
    });
  });

  it("captures template-level comments in _comment", () => {
    const xml =
      "<root><template><title>Commented</title>" +
      "<comment>this is a note</comment>" +
      "<part><name>x</name><value>1</value></part>" +
      "</template></root>";

    const result = parseParsetreeXml(xml);
    expect(result["Commented"]).toEqual({
      x: "1",
      _comment: "this is a note",
    });
  });

  it("handles multiple top-level templates", () => {
    const xml =
      "<root>" +
      "<template><title>First</title><part><name>a</name><value>1</value></part></template>" +
      "<template><title>Second</title><part><name>b</name><value>2</value></part></template>" +
      "</root>";

    const result = parseParsetreeXml(xml);
    expect(Object.keys(result).sort()).toEqual(["First", "Second"]);
    expect(result["First"]!.a).toBe("1");
    expect(result["Second"]!.b).toBe("2");
  });

  it("strips newlines (but not internal spaces) in template title", () => {
    // MediaWiki sometimes emits titles with embedded newlines after subst.
    // The parser removes newlines via `replace(/\n/g, "")` and trims edges,
    // but does NOT collapse runs of spaces. So `"Char\n  Infobox"` (one
    // trailing space before the newline + two-space indent after) becomes
    // `"Char  Infobox"` — two spaces where the newline used to be.
    const xml =
      "<root><template><title>\n  Char\n  Infobox  \n</title>" +
      "<part><name>x</name><value>1</value></part>" +
      "</template></root>";

    const result = parseParsetreeXml(xml);
    expect(Object.keys(result)).toEqual(["Char  Infobox"]);
  });

  it("documents nested-template handling in parameter values (known limitation)", () => {
    // The parser uses non-greedy regexes throughout (`<value>([\s\S]*?)</value>`
    // and `<template[\s\S]*?<\/template>`). When a parameter value contains
    // a nested template that itself has `<value>` tags, VALUE_RE matches up
    // to the *inner* `</value>`, truncating the outer value mid-stream and
    // leaking raw inner-template XML into it.
    //
    // This matches PRTS-MCP's behaviour verbatim and is accepted because
    // real Endfield infobox values rarely nest templates-with-values. The
    // test pins the actual output so a future proper fix (depth-aware XML
    // parse instead of regex) is a deliberate change rather than an
    // accidental regression.
    const xml =
      "<root><template><title>Outer</title>" +
      "<part><name>desc</name><value>prefix <template><title>Inner</title>" +
      "<part><name>n</name><value>v</value></part>" +
      "</template> suffix</value></part>" +
      "</template></root>";

    const result = parseParsetreeXml(xml);
    // VALUE_RE stopped at the inner `</value>`, so desc is truncated and
    // still contains the un-closed inner template XML.
    const desc = result["Outer"]!.desc as string;
    expect(desc.startsWith("prefix <template>")).toBe(true);
    // The outer "suffix" and the closing tags are lost — they fall outside
    // the inner </value> that VALUE_RE matched.
    expect(desc.endsWith("v")).toBe(true);
    expect(desc.includes("suffix")).toBe(false);
    // Inner template does NOT become its own entry — it was consumed inside
    // the outer template's span by splitTopLevelTags.
    expect("Inner" in result).toBe(false);
  });

  it("skips templates with no extractable parts", () => {
    const xml =
      "<root><template><title>Empty</title></template>" +
      "<template><title>Real</title><part><name>x</name><value>1</value></part></template>" +
      "</root>";

    const result = parseParsetreeXml(xml);
    expect(result["Empty"]).toBeUndefined();
    expect(result["Real"]).toEqual({ x: "1" });
  });

  it("last template wins when two share the same name", () => {
    // Matches MediaWiki semantics: later invocation overrides earlier display.
    const xml =
      "<root>" +
      "<template><title>Dup</title><part><name>v</name><value>first</value></part></template>" +
      "<template><title>Dup</title><part><name>v</name><value>second</value></part></template>" +
      "</root>";

    const result = parseParsetreeXml(xml);
    expect(result["Dup"]).toEqual({ v: "second" });
  });

  it("ignores empty parameter values", () => {
    const xml =
      "<root><template><title>T</title>" +
      "<part><name>kept</name><value>yes</value></part>" +
      "<part><name>dropped</name><value>   </value></part>" +
      "</template></root>";

    const result = parseParsetreeXml(xml);
    expect(result["T"]).toEqual({ kept: "yes" });
  });

  it("handles a realistic infobox-style template", () => {
    // Mirrors the shape endfield.wiki.gg character pages emit.
    const xml =
      "<root><template>" +
      "<title>Character</title>" +
      "<comment>auto-generated</comment>" +
      "<part><name>name</name><value>Angelic</value></part>" +
      "<part><name>rarity</name><value>★★★★★★</value></part>" +
      "<part><name>class</name><value>Guard</value></part>" +
      "<part><name>faction</name><value>Endfield Industries</value></part>" +
      "</template></root>";

    const result = parseParsetreeXml(xml);
    expect(result["Character"]).toEqual({
      name: "Angelic",
      rarity: "★★★★★★",
      class: "Guard",
      faction: "Endfield Industries",
      _comment: "auto-generated",
    });
  });
});
