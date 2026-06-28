import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasSubstantiveCaptionJson, magicPromptBlockingReason } from "./quickPromptFlow.ts";

describe("hasSubstantiveCaptionJson", () => {
  it("rejects empty and non-objects", () => {
    assert.equal(hasSubstantiveCaptionJson(""), false);
    assert.equal(hasSubstantiveCaptionJson("[]"), false);
    assert.equal(hasSubstantiveCaptionJson('"text"'), false);
  });

  it("rejects object without high_level_description", () => {
    assert.equal(hasSubstantiveCaptionJson("{}"), false);
    assert.equal(hasSubstantiveCaptionJson('{"style_description":{}}'), false);
  });

  it("accepts object with non-empty high_level_description", () => {
    assert.equal(hasSubstantiveCaptionJson('{"high_level_description":"A cat"}'), true);
  });
});

describe("magicPromptBlockingReason", () => {
  it("returns null when configured", () => {
    assert.equal(
      magicPromptBlockingReason({
        enabled: true,
        configured: true,
        missing_env: [],
        llm_error: null,
      }),
      null,
    );
  });

  it("blocks when disabled", () => {
    assert.ok(
      magicPromptBlockingReason({
        enabled: false,
        configured: false,
        missing_env: [],
        llm_error: null,
      })?.includes("disabled"),
    );
  });
});