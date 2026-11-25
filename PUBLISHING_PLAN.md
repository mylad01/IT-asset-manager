# GitHub Publishing & Portfolio Readiness Plan

This document outlines the complete execution plan to prepare, sanitize, and publish **Studio IT Sync (`IT-asset-manager`)** to GitHub under the profile of **mylad01** (`https://github.com/mylad01/IT-asset-manager`).

---

## 1. Pre-Publish Sanitization & Secret Scrubbing

Before any code is pushed to a public GitHub repository, all runtime artifacts, local databases, temporary logs, and secrets must be verified and stripped.

### Files & Directories to Scrub:
| Item | Reason | Action |
| :--- | :--- | :--- |
| `.env` | Holds local secrets (`JWT_SECRET`, local overrides) | **NEVER COMMIT**. Kept in `.gitignore`. Only `.env.example` is committed. |
| `database*.sqlite*` | Local SQLite databases (`database.sqlite`, `-wal`, `-shm`, `database-conversations-archive.sqlite*`) | Delete or ensure `.gitignore` excludes them. Fresh clones initialize via `npm run reset:db`. |
| `logs/` & `logs/.app.lock` | Runtime PID locks and Pino log files | Wipe clean. Gitignored. |
| `uploads/*` | Local test uploads (e.g. `dummy-seed.png`, avatar test files) | Wipe or retain only `.gitkeep`. Gitignored. |
| `dist/` | Vite production build directory | Transient output. Gitignored. |
| `.superpowers/` | Scratch directory containing agent SDD briefs and reports | Delete before final publish. |
| `node_modules/` | Local package dependencies | Never committed. Gitignored. |

### Sanitization Command Checklist:
```bash
# 1. Verify .env is NOT tracked in git (must return error: pathspec '.env' did not match any file)
git ls-files --error-unmatch .env

# 2. Check for any tracked SQLite or database files
git ls-files | grep -E "\.sqlite|\.lock|\.log"

# 3. Clean scratch SDD artifacts
rm -rf .superpowers/

# 4. Run delivery cleaner script (wipes logs, runtime databases, backups, and restores seed state)
npm run clean:delivery -- --dry-run
```

---

## 2. Repository Structuring & Directory Alignment

The project currently resides at:
`C:\Users\Storm\Documents\GitHub\IT-asset-manager\IT-asset-manager`

### Single-Root Flattening (Recommended):
If you want the repository root to be the Git root directly (so files like `package.json`, `README.md`, and `src/` sit at the top-level of `https://github.com/mylad01/IT-asset-manager` rather than inside a nested subfolder):
1. Ensure git is tracking at the desired root.
2. Verify all paths and scripts resolve from the repository root.

---

## 3. Git Author & Identity Verification

Ensure commits reflect your official GitHub author identity:

```bash
git config user.name "mylad01"
git config user.email "miladnasrollahi.mn@gmail.com"

# Verify current commit history author
git log -1 --format="Author: %an <%ae>"
```

---

## 4. Verification & Quality Gates

Run the project verification commands to guarantee zero compile errors or lint failures:

```bash
# 1. Run OxLint linter
npm run lint

# 2. Run Vite production build
npm run build

# 3. Check health and driver checks
node scripts/lib/sqlite3DriverCheck.js
```

---

## 5. Remote Configuration & Push

1. Create a new public repository on GitHub:
   - **Repository Name**: `IT-asset-manager`
   - **Visibility**: Public
   - **Initialize with**: *Do NOT check README, .gitignore, or license* (the project already contains complete versions).
2. Connect and push:

```bash
git remote add origin https://github.com/mylad01/IT-asset-manager.git
git branch -M main
git push -u origin main
```

---

## 6. GitHub Portfolio Presentation Polish

Once pushed, configure the GitHub repository page to maximize recruiter/client impact:

1. **About Section**:
   - **Description**: `Enterprise Studio IT Asset & Operations Management Platform featuring React 19, Express 5, SQLite WAL resilience, and an iOS Liquid Glass design system.`
   - **Topics / Tags**: `react19`, `vite`, `express5`, `sqlite`, `tailwindcss`, `glassmorphism`, `asset-management`, `kanban-board`, `websockets`, `portfolio-project`.
2. **Social Preview**:
   - Go to **Settings > General > Social preview** and upload the Dashboard showcase image.
3. **Repository Highlights**:
   - Prominently showcases author badge (`Author: mylad01`).
   - Includes full credentials table for test login.
   - Comprehensive system architecture diagram and feature walkthrough.
