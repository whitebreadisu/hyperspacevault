import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooks,
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      // Flags async data fetching and intentional derived-state resets as
      // violations; all current instances are legitimate patterns.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // BL-154: frontend/src/api's single error convention (see
  // src/api/README.md) is a typed error class (ApiError/CodedApiError from
  // src/api/errors.ts, or a subclass) rather than a bare `throw new Error`.
  // Scoped to non-test files under src/api -- test fixtures elsewhere in the
  // app (e.g. a mocked rejection) aren't part of this convention.
  {
    files: ["src/api/**/*.ts"],
    ignores: ["src/api/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ThrowStatement > NewExpression[callee.name='Error']",
          message:
            "BL-154: frontend/src/api modules throw a typed API error (ApiError or a subclass from ./errors), not a bare `new Error(...)`. See src/api/README.md.",
        },
      ],
    },
  },
  prettierConfig,
);
