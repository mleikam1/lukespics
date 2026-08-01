import {describe, expect, it} from "vitest";
import {isPublishedRequestReplay} from "../src/services/weeks.js";

describe("publish hardening", () => {
  it("settles a concurrent same-request replay after the week advances", () => {
    const requestId = "publish_request_0001";
    for (const status of [
      "open",
      "inProgress",
      "review",
      "finalized",
      "reopened",
    ]) {
      expect(
        isPublishedRequestReplay(
          {status, publishedRequestId: requestId},
          requestId,
        ),
      ).toBe(true);
    }
    expect(
      isPublishedRequestReplay(
        {status: "draft", publishedRequestId: requestId},
        requestId,
      ),
    ).toBe(false);
    expect(
      isPublishedRequestReplay(
        {status: "review", publishedRequestId: "another_request"},
        requestId,
      ),
    ).toBe(false);
  });
});
