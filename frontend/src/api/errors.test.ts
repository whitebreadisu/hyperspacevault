import { describe, it, expect } from "vitest";
import { ApiError, CodedApiError } from "./errors";

// BL-154: the shared base every frontend/src/api module's typed error now
// extends (see README.md). No dedicated test file existed for any of the
// per-module error classes' base behavior before this -- each module's own
// class was tested indirectly through its call sites. These are new,
// additive tests (not a port/replace/retire of anything -- ApiError and
// CodedApiError didn't exist before BL-154).

describe("ApiError", () => {
  it("is a real Error subclass carrying status", () => {
    const err = new ApiError("Something failed: 500", 500);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.name).toBe("ApiError");
    expect(err.message).toBe("Something failed: 500");
    expect(err.status).toBe(500);
  });

  it("supports subclassing with a fixed name (the pattern every module's typed error follows)", () => {
    class WidgetApiError extends ApiError {
      constructor(status: number) {
        super(`Widget fetch failed: ${status}`, status);
        this.name = "WidgetApiError";
      }
    }
    const err = new WidgetApiError(404);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(WidgetApiError);
    expect(err.name).toBe("WidgetApiError");
    expect(err.status).toBe(404);
  });
});

describe("CodedApiError", () => {
  it("is an ApiError subclass additionally carrying a machine-readable code", () => {
    const err = new CodedApiError("not_found", "Widget not found", 404);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(CodedApiError);
    expect(err.name).toBe("CodedApiError");
    expect(err.code).toBe("not_found");
    expect(err.status).toBe(404);
    expect(err.message).toBe("Widget not found");
  });

  it("supports subclassing with a closed code union and a fixed name (deckCheck.ts/inventoryImportExport.ts's pattern)", () => {
    type WidgetErrorCode = "locked" | "unknown";
    class WidgetApiError extends CodedApiError<WidgetErrorCode> {
      constructor(code: WidgetErrorCode, message: string, status: number) {
        super(code, message, status);
        this.name = "WidgetApiError";
      }
    }
    const err = new WidgetApiError("locked", "Widget is locked", 423);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(CodedApiError);
    expect(err).toBeInstanceOf(WidgetApiError);
    expect(err.name).toBe("WidgetApiError");
    expect(err.code).toBe("locked");
    expect(err.status).toBe(423);
  });
});
