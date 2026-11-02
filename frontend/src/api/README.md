# frontend/src/api conventions

## Error convention

**Rule: every module in this folder throws a typed error class -- never a
bare `throw new Error(...)`.**

The convention is the typed-error-class pattern: a base class in
`errors.ts` that carries the HTTP `status`, and a coded variant for
endpoints whose backend raises a closed union of typed errors. Every
module's typed error extends one of the two classes there. Never throw a plain `Error` with the status in its message.

### The base classes (`errors.ts`)

```ts
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { ... }
}

export class CodedApiError<C extends string = string> extends ApiError {
  code: C;
  constructor(code: C, message: string, status: number) { ... }
}
```

- Extend **`ApiError`** directly when the caller only needs pass/fail plus
  the HTTP status (no machine-readable code) -- e.g. `LimitsApiError`,
  `EmailNotVerifiedError`.
- Extend **`CodedApiError<C>`** when the backend router raises a closed
  union of typed errors the frontend needs to `switch`/`instanceof`-branch
  on -- e.g. `DeckCheckApiError`, `ImportApiError`. `C` is that module's own
  closed string union; codes are endpoint-specific, not shared across
  modules.

### Example

A module with no error code, just status:

```ts
import { authedFetch } from "./authedFetch";
import { ApiError } from "./errors";

export class WidgetApiError extends ApiError {
  constructor(action: string, status: number) {
    super(`${action} failed: ${status}`, status);
    this.name = "WidgetApiError";
  }
}

export async function getWidget(id: number): Promise<Widget> {
  const res = await authedFetch(`/api/widgets/${id}`);
  if (!res.ok) throw new WidgetApiError("Fetching widget", res.status);
  return res.json();
}
```

A module whose router raises a closed set of typed errors (parsed-body
pattern -- see `deckCheck.ts` or `inventoryImportExport.ts` for full
worked examples):

```ts
import { CodedApiError } from "./errors";

export type WidgetErrorCode = "not_found" | "locked" | "unknown";

export class WidgetApiError extends CodedApiError<WidgetErrorCode> {
  constructor(code: WidgetErrorCode, message: string, status: number) {
    super(code, message, status);
    this.name = "WidgetApiError";
  }
}
```

Always set `this.name` in the subclass constructor -- callers and test
fixtures match on it (`toMatchObject({ name: "WidgetApiError", ... })`),
and it's what shows up in stack traces / unhandled-rejection logs.

### Migration policy

Incremental, not a rip-and-replace:

- **New modules must comply** from day one -- extend `ApiError` or
  `CodedApiError`, never throw a bare `Error`.
- **Existing modules migrate opportunistically** -- when a module under
  this convention needs a substantive change anyway, bring any remaining
  `throw new Error(...)` in that file onto the shared base in the same
  change. A `// migrate on next touch` marker comment flags a throw site
  that was left alone because the surrounding change was small and
  unrelated; migrate it the next time that file is edited.
- Every module in this folder is currently migrated; the marker is a
  mechanism for a future module that needs one, not a description of
  current state.

### Enforcement

An eslint rule (`no-restricted-syntax`, scoped to `src/api/**/*.ts` and
excluding `*.test.ts`, see `eslint.config.js`) flags any `throw new
Error(...)` in this folder at lint time -- `npm run lint` fails on a new
violation. It only catches the literal `new Error(...)` callee name, so a
typed subclass throw (`throw new ApiError(...)`, `throw new
WidgetApiError(...)`) always passes; there's nothing further to check by
hand beyond "does this really need `ApiError`/`CodedApiError` and not some
ad hoc shape."
