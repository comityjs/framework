# Contributing to Comity

Thank you for your interest in contributing to Comity! This document provides guidelines for development, testing, and contributing to the project.

## 🚀 Getting Started

### Prerequisites

- Node.js 24+
- pnpm 12.16.1 (pinned by `packageManager`; enable with `corepack enable`)

### Setup

```bash
git clone https://github.com/comityjs/framework.git
cd framework
pnpm install
pnpm test
```

## 📁 Project Structure

```
packages/          # Framework modules
├── core/         # @comity/core - Main framework
└── [modules]/    # Additional framework modules

examples/         # Example applications
├── admin/        # Admin interface example
└── [demos]/      # Other demo applications
```

## 🧪 Testing Standards

### Running Tests

```bash
pnpm test              # Run all tests
pnpm test:watch        # Watch mode
pnpm test:coverage     # With coverage
```

### Writing Tests

- **Location**: Tests go in `__tests__/` folders next to source code
- **Naming**: `*.test.ts` for test files
- **Structure**: Use `describe` > `it` hierarchy
- **Coverage**: Aim for comprehensive coverage of public APIs

### Test Categories

1. **Unit Tests**: Test individual functions/classes
2. **Integration Tests**: Test module interactions
3. **Real-world Scenarios**: Test common use cases
4. **Edge Cases**: Test error conditions and boundaries

Example test structure:

```typescript
describe("functionName", () => {
  describe("basic functionality", () => {
    it("should handle normal case", () => {
      // Test implementation
    });
  });

  describe("edge cases", () => {
    it("should handle error conditions", () => {
      // Test implementation
    });
  });
});
```

## 💻 Coding Standards

### TypeScript

- Use strict TypeScript configuration
- Export types and interfaces for public APIs
- Prefer explicit types over `any`

### Code Style

- Use consistent naming conventions
- Add JSDoc comments for public APIs
- Keep functions focused and small

### File Organization

- Group related functionality in modules
- Use index files for clean exports
- Keep test files adjacent to source

## 🔧 Development Workflow

### 1. Setup Development Environment

```bash
cd packages/core
pnpm dev                # Watch mode compilation
```

### 2. Making Changes

- Create feature branch from `main`
- Write tests first (TDD approach)
- Implement functionality
- Ensure all tests pass

### 3. Pull Request Process

- Update documentation if needed
- Ensure tests pass: `pnpm test`
- Add changeset: `pnpm changeset`
- Create PR with clear description

## 📖 Architecture Guidelines

### Module Design

- Each package should have a single responsibility
- Use dependency injection patterns
- Design for extensibility and modularity

### Framework Principles

- Build on Hono for web functionality
- Support multiple deployment targets
- Maintain backwards compatibility

## 📦 Releasing

Releases run from `.github/workflows/release.yml` through `changesets/action`:

```bash
pnpm version     # changeset version (opens/updates the "Version Packages" PR)
pnpm release     # pnpm -r publish … && changeset tag
```

`pnpm release` delegates publication to pnpm's recursive publisher, which already
provides what this pipeline needs:

- publishes **one package at a time**;
- publishes in **workspace dependency order**, so a dependency's `dist/` is rebuilt by
  its own `prepublishOnly` before any dependent type-checks against it;
- **skips versions already on the registry** (`--force` would override that; it is never
  used) and skips `private` packages;
- **streams `prepublishOnly` output**, so a real build error is visible instead of being
  reduced to `run the prepublishOnly script`;
- records what it published in `pnpm-publish-summary.json` (`--report-summary`), which
  also lists uploads the registry accepted before a later failure;
- waits for each version to become installable (`--publish-wait-timeout`) before moving
  on, which separates _accepted but not yet visible_ from _failed_.

`changeset tag` then creates the git tags and prints the `New tag: <name>@<version>`
lines `changesets/action` parses. It runs only when every package published (`&&`),
because it tags every untagged package **without** consulting the registry.

Run `pnpm build` before `pnpm release` (the workflow does). Already-published packages
are skipped, so their `dist/` comes from that build rather than from `prepublishOnly`.

### Why this replaced `changeset publish`

`changeset publish` publishes up to 10 packages concurrently. Every `pnpm publish` runs
`prepublishOnly`, and that script deletes and rebuilds the package `dist/` before
publishing. Concurrent publishes delete the `dist/` another package is type-checking
against, so a random subset failed on each run with:

```
src/router.ts(1,72): error TS2307: Cannot find module '@comity/router'
[ELIFECYCLE] Command failed with exit code 1.
```

pnpm reported that as `ERR_PNPM_EXECUTOR_LIFECYCLE_SCRIPT_FAILED`, and because
`changeset publish` passes `--json` the underlying TypeScript error never reached the
log. Releases needed several workflow re-runs to finish.

Sequential publishing removes the race. No delay between packages is required, and no
registry rate limiting was ever observed.

### Registry states

| Condition                         | Result                                                                  | Action                                                                                                                                                       |
| --------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Version published                 | success                                                                 | none                                                                                                                                                         |
| Version already published         | skipped by pnpm                                                         | none; re-running is safe                                                                                                                                     |
| `409 … previously staged version` | `ERR_PNPM_FAILED_TO_PUBLISH`, exit 1, registry body printed             | **stop — human decision.** Resolve the staged version outside this pipeline (`npm stage list/view/approve/reject`). Never bump the version to work around it |
| Upload accepted, not yet visible  | `ERR_PNPM_PUBLISH_AVAILABILITY_TIMEOUT`, exit 1, version in the summary | **do not republish.** Wait for the version to appear, then re-run (it will be skipped)                                                                       |
| `429` or other transient error    | exit 1 (pnpm does not retry an upload)                                  | re-run the workflow; already-published packages are skipped                                                                                                  |
| Build / lifecycle failure         | exit 1 with the full compiler output                                    | fix the build; never retried                                                                                                                                 |
| Authentication / metadata error   | exit 1 with the registry message                                        | fix the token or the manifest                                                                                                                                |

pnpm never approves, rejects, deletes, unpublishes, overwrites or retags a registry
version, and neither does this pipeline.

### Recovery

A failed run is resumable by re-running the workflow unchanged: versions already on the
registry are skipped, and nothing is tagged until a run publishes everything. After a
partial failure, `pnpm-publish-summary.json` lists which uploads the registry accepted.

### Verifying before an authorised release

```bash
pnpm build
pnpm -r publish --dry-run --access public --no-git-checks --report-summary
```

The dry run resolves every package against the registry and prints either the versions it
would publish or `There are no new packages that should be published`. It does not run
`changeset tag`, and it never uploads.

## 🐛 Reporting Issues

When reporting issues:

1. Use issue templates
2. Provide minimal reproduction
3. Include environment details
4. Add relevant error messages

## 📝 Documentation

- Keep README files updated
- Add examples for new features
- Document breaking changes
- Use TypeScript for API documentation

## 🎯 Performance

- Consider bundle size impact
- Write performance tests for critical paths
- Profile before optimizing
- Avoid premature optimization

---

Questions? Feel free to open an issue or start a discussion!
