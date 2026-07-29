# frontend/src/api conventions

## Error convention (BL-154)

**Rule: every module in this folder throws a typed error class -- never a
bare `throw new Error(...)`.**

Before BL-154, three conventions coexisted in this folder (repo-review
finding A3-07):

1. status-string throws -- `throw new Error(\`Failed to fetch X: ${res.status}\`)`
   (account.ts, baseCards.ts, feedback.ts, inventory.ts, sets.ts)
2. a typed error class carrying `status` (settingsLimits.ts's `LimitsApiError`)
3. parsed-body typed errors that read the response's `detail` for a
   machine-readable code (deckCheck.ts's `DeckCheckApiError`,
   inventoryImportExport.ts's `ImportApiError`)

BL-154 picked (2)/(3) -- the typed-error-class pattern -- as the single
convention and generalized it into a shared base in `errors.ts`. Every
module's typed error now extends one of the two classes there, and the
status-string modules were migrated onto it too.

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
- **Existing modules migrate opportunistically** -- when a module already
  under this convention needs a substantive change anyway, bring any
  remaining `throw new Error(...)` in that file onto the shared base in the
  same change. A module left with a `// BL-154: migrate on next touch`
  marker comment is flagging a throw site that wasn't touched because the
  surrounding change was small and unrelated -- migrate it the next time
  that file is edited for something else.
- (As of BL-154 landing, every module in this folder is already migrated --
  the marker comment is a mechanism for the _next_ module that needs one,
  not a description of current state.)

### Enforcement

An eslint rule (`no-restricted-syntax`, scoped to `src/api/**/*.ts` and
excluding `*.test.ts`, see `eslint.config.js`) flags any `throw new
Error(...)` in this folder at lint time -- `npm run lint` fails on a new
violation. It only catches the literal `new Error(...)` callee name, so a
typed subclass throw (`throw new ApiError(...)`, `throw new
WidgetApiError(...)`) always passes; there's nothing further to check by
hand beyond "does this really need `ApiError`/`CodedApiError` and not some
ad hoc shape."
