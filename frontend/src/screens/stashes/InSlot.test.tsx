import { render } from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, it } from "vitest";
import { InSlot } from "./InSlot";

// InSlot (R1-5 fold-in): the FilterPanel moves between the Vault's place and
// the Stashes page's list corner without remounting, so its open state and
// loaded data survive every move.

let mounts = 0;
function Child() {
  const [n] = useState(() => ++mounts);
  useEffect(() => undefined, []);
  return <span data-testid="child">mount {n}</span>;
}

function Harness({ inSlot }: { inSlot: boolean }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <div>
      <div className="home">
        <InSlot slot={inSlot ? slot : null}>
          <Child />
        </InSlot>
      </div>
      <div className="away" ref={setSlot} />
    </div>
  );
}

describe("InSlot", () => {
  it("moves its children between places and never remounts them", () => {
    mounts = 0;
    const r = render(<Harness inSlot={false} />);
    const child = () => r.getByTestId("child");
    expect(child().closest(".home")).not.toBeNull();
    r.rerender(<Harness inSlot />);
    expect(child().closest(".away")).not.toBeNull();
    r.rerender(<Harness inSlot={false} />);
    expect(child().closest(".home")).not.toBeNull();
    r.rerender(<Harness inSlot />);
    expect(child().closest(".away")).not.toBeNull();
    expect(mounts).toBe(1);
    expect(child().textContent).toBe("mount 1");
  });

  it("returns home when the slot element leaves the page", () => {
    mounts = 0;
    function Gone({ show }: { show: boolean }) {
      const [slot, setSlot] = useState<HTMLElement | null>(null);
      return (
        <div>
          <div className="home">
            <InSlot slot={show ? slot : null}>
              <Child />
            </InSlot>
          </div>
          {show ? <div className="away" ref={setSlot} /> : null}
        </div>
      );
    }
    const r = render(<Gone show />);
    expect(r.getByTestId("child").closest(".away")).not.toBeNull();
    // React drops the slot element; the host goes back home with its child.
    r.rerender(<Gone show={false} />);
    expect(r.getByTestId("child").closest(".home")).not.toBeNull();
    expect(mounts).toBe(1);
  });

  it("hidden hides the host without remounting; shown again keeps state", () => {
    mounts = 0;
    const r = render(
      <InSlot slot={null} hidden>
        <Child />
      </InSlot>
    );
    const host = () => r.getByTestId("child").closest<HTMLElement>(".filter-host")!;
    expect(host().style.display).toBe("none");
    r.rerender(
      <InSlot slot={null}>
        <Child />
      </InSlot>
    );
    expect(host().style.display).toBe("contents");
    r.rerender(
      <InSlot slot={null} hidden>
        <Child />
      </InSlot>
    );
    expect(host().style.display).toBe("none");
    expect(mounts).toBe(1);
  });
});
