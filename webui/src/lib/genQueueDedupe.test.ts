import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findDuplicatePendingJob, generationRequestFingerprint, queuedJobCount } from "./genQueueDedupe.ts";
import type { GenJob } from "../state/types.ts";

const caption = { high_level_description: "mug" };

function job(status: GenJob["status"], id: string): GenJob {
  return {
    id,
    label: "mug",
    status,
    msg: "",
    progress: 0,
    totalSteps: 12,
    createdAt: 1,
    historyLinkMode: "new",
    formSnapshot: {} as GenJob["formSnapshot"],
    request: {
      caption,
      width: 1024,
      height: 1024,
      preset: "V4_TURBO_12",
      seed: 1,
      format: "webp",
    },
  };
}

describe("genQueueDedupe", () => {
  it("finds duplicate queued job with same caption", () => {
    const fp = generationRequestFingerprint(caption, 1024, 1024, "V4_TURBO_12", "webp", "new");
    const found = findDuplicatePendingJob([job("done", "a"), job("queued", "b")], fp);
    assert.equal(found?.id, "b");
  });

  it("ignores done jobs", () => {
    const fp = generationRequestFingerprint(caption, 1024, 1024, "V4_TURBO_12", "webp", "new");
    const found = findDuplicatePendingJob([job("done", "a")], fp);
    assert.equal(found, undefined);
  });

  it("counts only queued and waiting jobs toward queue capacity", () => {
    assert.equal(
      queuedJobCount([
        job("done", "a"),
        job("error", "b"),
        job("running", "c"),
        job("submitting", "d"),
        job("queued", "e"),
        job("waiting", "f"),
      ]),
      2,
    );
  });
});
