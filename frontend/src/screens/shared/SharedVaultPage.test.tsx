import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SharedVaultPage } from "./SharedVaultPage";
import { ShareResolveError } from "../../api/sharedView";

// BL-205: resolveShare is the only real dependency this suite drives --
// CardsPage/LimitsProvider have their own dedicated coverage for the
// shareToken seam (CardsPage.test.tsx, LimitsContext.test.tsx), so both are
// stubbed here the same way App.test.tsx stubs CardsPage, keeping this file
// focused on SharedVaultPage's own job: resolve -> loading/ready/invalid/
// rate-limited, and reporting the resolved name back up via onResolved.
const { resolveShare } = vi.hoisted(() => ({ resolveShare: vi.fn() }));
vi.mock("../../api/sharedView", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/sharedView")>("../../api/sharedView");
  return { ...actual, resolveShare };
});

vi.mock("../cards/CardsPage", () => ({
  CardsPage: ({ shareToken }: { shareToken?: string }) => <p>cards-page:{shareToken}</p>,
}));

vi.mock("../../context/LimitsContext", () => ({
  LimitsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("SharedVaultPage (BL-205)", () => {
  beforeEach(() => {
    resolveShare.mockReset();
  });

  it("shows a loading state while resolving", () => {
    resolveShare.mockReturnValue(new Promise(() => {})); // never resolves
    render(<SharedVaultPage token="tok-1" onResolved={vi.fn()} />);
    expect(screen.getByText(/loading shared vault/i)).toBeInTheDocument();
  });

  it("renders the read-only CardsPage with shareToken once resolved, and reports the name up", async () => {
    resolveShare.mockResolvedValue({ name: "Bobs big vault", scope: "inventory" });
    const onResolved = vi.fn();
    render(<SharedVaultPage token="tok-1" onResolved={onResolved} />);

    await waitFor(() => expect(screen.getByText("cards-page:tok-1")).toBeInTheDocument());
    expect(onResolved).toHaveBeenCalledWith("tok-1", "Bobs big vault");
  });

  it("shows the friendly invalid state on a 404 (invalid or revoked, indistinguishable) -- no crash", async () => {
    resolveShare.mockRejectedValue(new ShareResolveError("not_found", 404));
    render(<SharedVaultPage token="bad-token" onResolved={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/no longer available/i)).toBeInTheDocument());
    expect(screen.queryByText(/cards-page/)).not.toBeInTheDocument();
  });

  it("shows the friendly invalid state for any non-rate-limit error, not just not_found", async () => {
    resolveShare.mockRejectedValue(new ShareResolveError("unknown", 500));
    render(<SharedVaultPage token="tok-1" onResolved={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/no longer available/i)).toBeInTheDocument());
  });

  it("shows a distinct rate-limited state on 429", async () => {
    resolveShare.mockRejectedValue(new ShareResolveError("rate_limited", 429));
    render(<SharedVaultPage token="tok-1" onResolved={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/a lot of traffic/i)).toBeInTheDocument());
    expect(screen.queryByText(/no longer available/i)).not.toBeInTheDocument();
  });

  it("re-resolves when the token prop changes", async () => {
    resolveShare.mockResolvedValue({ name: "First", scope: "inventory" });
    const onResolved = vi.fn();
    const { rerender } = render(<SharedVaultPage token="tok-1" onResolved={onResolved} />);
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith("tok-1", "First"));

    resolveShare.mockResolvedValue({ name: "Second", scope: "inventory" });
    rerender(<SharedVaultPage token="tok-2" onResolved={onResolved} />);
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith("tok-2", "Second"));

    expect(resolveShare).toHaveBeenCalledTimes(2);
  });
});
