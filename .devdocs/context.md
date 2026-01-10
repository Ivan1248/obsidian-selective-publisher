# Development Context

## ESLint Configuration
- The project uses `eslint.config.mts` which requires `jiti` to be loaded by ESLint 9+.
- The configuration depends on `eslint-plugin-obsidianmd` and `globals`.
- These were missing from `devDependencies` and were added during the session on 2026-01-10.

## External Dependencies
- Electron's `dialog` is accessed via `(window as { require }).require('electron')`. This is common in Obsidian plugins but requires careful typing with a custom `ElectronModule` interface to avoid `any`.

## Type Safety Patterns

### Criterion Decorator
- The `@RegisterCriterion` decorator uses a `CriterionClass` interface that requires `new (...args: unknown[]): Criterion` and `deserialize(data): Criterion`.
- This allows derived classes with different constructor signatures while maintaining type safety.

### Git Error Handling
- Git operations in `git-service.ts` use a custom `ExecFileError` interface with `code`, `cmd`, `stdout`, and `stderr` fields.
- Error formatting is extracted into `formatGitError()` which is reused by both `handleGitError()` (throws) and `validateRepo()` (returns result).

### Value Stringification
- A `stringifyValue(value: unknown): string` helper in `criterion.ts` handles conversion of primitives and objects consistently.
- Used for frontmatter values and tags where the type is unknown at runtime.

## Settings Persistence
- Settings are loaded/saved using Obsidian's `loadData()`/`saveData()`.
- A `SavedSettingsData` interface documents the expected shape.
