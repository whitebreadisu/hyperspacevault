import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DeckCheckEntry } from "./DeckCheckEntry";

// DISPOSITION (BL-142 design pull, REPLACE): the original build of this
// component (before the Claude Design deck-check-entry file could be
// pulled -- see DeckCheckEntry.tsx's doc comment) used a two-input shape
// (a URL field + a separate paste-JSON expander) with a client-facing
// pricing-mode radio group. The pulled design's saved default is the
// smart-single variant (ONE field, URL-or-JSON auto-detected) with NO mode
// control anywhere in the template -- every test below is rewritten against
// that shape; none of the old two-input/mode-toggle behavior survives (it
// was never shipped, so there's nothing to port forward).
describe("DeckCheckEntry (BL-142)", () => {
  it("disables (aria-disabled) the submit button until the field has content, and submits { url } for a plain URL", () => {
    const onSubmit = vi.fn();
    render(<DeckCheckEntry loading={false} error={null} onSubmit={onSubmit} />);

    const submitBtn = screen.getByRole("button", { name: "Check deck" });
    expect(submitBtn).toHaveAttribute("aria-disabled", "true");

    fireEvent.change(screen.getByLabelText(/deck url/i), {
      target: { value: "https://swubase.com/deck/abc" },
    });
    expect(submitBtn).not.toHaveAttribute("aria-disabled");

    fireEvent.click(submitBtn);
    expect(onSubmit).toHaveBeenCalledWith({ url: "https://swubase.com/deck/abc" });
  });

  it("submits { deck_json } when the field's content starts with {", () => {
    const onSubmit = vi.fn();
    render(<DeckCheckEntry loading={false} error={null} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/deck url/i), {
      target: { value: '{"leader": {"id": "SOR_001"}, "deck": []}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check deck" }));

    expect(onSubmit).toHaveBeenCalledWith({ deck_json: { leader: { id: "SOR_001" }, deck: [] } });
  });

  it("shows a local coach error and does not submit for unparseable JSON", () => {
    const onSubmit = vi.fn();
    render(<DeckCheckEntry loading={false} error={null} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/deck url/i), { target: { value: "{not valid json" } });
    fireEvent.click(screen.getByRole("button", { name: "Check deck" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't parse that as json/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // The design's own detection rule is literally "starts with {" -- an
  // array literal like "[1,2,3]" never enters the JSON branch at all, so
  // it's submitted as a (nonsensical, but not this component's job to
  // reject) URL string instead, same as any other non-"{" text. There is
  // no reachable input that starts with "{", parses successfully, and
  // isn't a plain object -- JSON.parse of a "{"-prefixed string can only
  // ever produce an object or throw -- so the component's defensive
  // non-object guard is intentionally untested here (dead code kept only
  // as a type-narrowing safety net, not a reachable product behavior).
  it("treats a leading-bracket array literal as a URL, not JSON (matches the design's starts-with-{ rule)", () => {
    const onSubmit = vi.fn();
    render(<DeckCheckEntry loading={false} error={null} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/deck url/i), { target: { value: "[1,2,3]" } });
    fireEvent.click(screen.getByRole("button", { name: "Check deck" }));

    expect(onSubmit).toHaveBeenCalledWith({ url: "[1,2,3]" });
  });

  it("shows the loading state with a provider-specific fetching message and no submit button", () => {
    const { rerender } = render(<DeckCheckEntry loading={false} error={null} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/deck url/i), {
      target: { value: "https://swubase.com/deck/abc" },
    });

    rerender(<DeckCheckEntry loading={true} error={null} onSubmit={vi.fn()} />);
    expect(screen.getByText(/fetching deck from swubase/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check deck" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/deck url/i)).toBeDisabled();
  });

  it("falls back to a generic loading message for pasted JSON (no provider to name)", () => {
    const { rerender } = render(<DeckCheckEntry loading={false} error={null} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/deck url/i), { target: { value: '{"leader": {}}' } });

    rerender(<DeckCheckEntry loading={true} error={null} onSubmit={vi.fn()} />);
    expect(screen.getByText(/fetching deck from your deck source/i)).toBeInTheDocument();
  });

  it("shows the blue shortcut coach box for an unsupported_url server error", () => {
    render(
      <DeckCheckEntry
        loading={false}
        error={{ code: "unsupported_url", message: "melee.gg isn't supported" }}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByText(/that site can't be fetched directly/i)).toBeInTheDocument();
    expect(screen.getByText(/copy deck json/i)).toBeInTheDocument();
  });

  it("shows a red coach box for a fetch_failed server error", () => {
    render(
      <DeckCheckEntry
        loading={false}
        error={{ code: "fetch_failed", message: "provider timed out" }}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByText(/couldn't fetch that deck/i)).toBeInTheDocument();
  });

  it("shows a red coach box for an invalid_deck_json server error", () => {
    render(
      <DeckCheckEntry
        loading={false}
        error={{ code: "invalid_deck_json", message: "missing deck key" }}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByText(/that json isn't a deck/i)).toBeInTheDocument();
  });

  it("shows the server's own message for an unknown-code error", () => {
    render(
      <DeckCheckEntry
        loading={false}
        error={{ code: "unknown", message: "Something went wrong checking your deck." }}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByText(/something went wrong checking your deck/i)).toBeInTheDocument();
  });

  it("prefers the local JSON-syntax error over a stale server error", () => {
    render(
      <DeckCheckEntry
        loading={false}
        error={{ code: "fetch_failed", message: "provider timed out" }}
        onSubmit={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText(/deck url/i), { target: { value: "{not valid json" } });
    fireEvent.click(screen.getByRole("button", { name: "Check deck" }));

    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't parse that as json/i);
  });
});
