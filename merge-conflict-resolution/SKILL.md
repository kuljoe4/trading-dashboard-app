---
name: merge-conflict-resolution
description: Procedures and patterns for identifying, isolating, and resolving git merge conflicts, including post-merge cleanup and validation to restore repository integrity.
---

# Merge Conflict Resolution

This skill provides a systematic workflow for handling complex git merge conflicts that arise during repository maintenance or feature integration.

## Systematic Resolution Workflow

1. **Identification**: Use `git status` to identify conflicted files.
2. **Analysis**: Use `read_file` to inspect the files and understand the merge markers (`<<<<<<<`, `=======`, `>>>>>>>`).
3. **Isolate**: Focus on the specific conflicted blocks. Do not attempt to re-read the entire file.
4. **Resolution**: Apply `replace` or `write_file` to keep the correct code and remove markers.
5. **Validation**: Check for compilation or syntax errors immediately after resolution.
6. **Finalize**: Stage the files with `git add` and commit with a clear, descriptive message (e.g., "Merge branch X into Y with conflict resolution").

## Key Patterns

### Pattern 1: Code Conflict
When two branches modify the same code, evaluate both versions against the project's architectural requirements.

- Keep the most up-to-date implementation.
- If unsure, use `git log` to inspect the history of the conflicting commits.

### Pattern 2: Syntax/Residual Marker Conflict
If code is clean but merge markers remain (often caused by incomplete manual resolution), perform a final pass:

1. Use `grep_search` to find any leftover `<<<<<<<` markers.
2. Clean them using `write_file` or `replace` to rewrite that section correctly.
3. Commit the cleanup as a dedicated "Fix residual merge conflict markers" commit to preserve history.

## Examples

### Case Study: Backend Logic Conflict (signalEngine.ts)
When merging `feat-advanced-ema-signals`, a conflict occurred where the `signalHandlers` definition and `checkEntry` logic were heavily modified.

- **Resolution**: Kept the feature branch version that introduced `side` and `purpose` parameters into `signalHandlers` as this was the architectural requirement.
- **Cleanup**: Fixed residual markers by cleaning the function signatures and properly removing the `<<<<<<<` headers.

### Case Study: Frontend Component Conflict (SettingsView.jsx)
When merging `palette-settings-ux-enhancement`, conflicting button styling and input field configurations appeared.

- **Resolution**: Adopting the more concise, performant button configuration from the feature branch.
- **Key Strategy**: Used `write_file` to rewrite the entire component to ensure no invisible, orphaned marker syntax remained, preventing the `TS1185` error.

- [ ] `git status` shows no unmerged paths.
- [ ] Project compiles (run `npm run build` or the project-specific build command).
- [ ] Tests pass (run `npm test` or the project-specific test suite).
