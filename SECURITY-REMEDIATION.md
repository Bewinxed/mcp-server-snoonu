# Action required: leaked session credential

`src/snoonu-session.json` was committed to this repository and contains a live
Snoonu session. It has been **untracked and deleted from the working tree**, but
it is still present in git history and therefore still public on GitHub.

## What leaked

Introduced in commit `badcec4` ("successfully scraped main search page"), the
file contained:

| Item | Notes |
| ---- | ----- |
| `authToken` cookie for `snoonu.com` | The account session token |
| `locationToken` cookie | Encodes the saved delivery address and coordinates |
| `deviceId` (localStorage) | Ties requests to a specific device identity |
| `afUserId`, `_ga`, `_clck`, AppsFlyer/Clarity ids | Analytics identifiers |

Anyone who cloned or forked the repo, and anyone browsing GitHub history, can
read these.

## Step 1 — Revoke the session (do this first, and now)

History rewriting does not help if the token is still valid. Log out of
snoonu.com in every browser and app session for that account, which invalidates
the `authToken`. If the account supports "sign out of all devices", use that.

Rotating the credential is the only step that is strictly irreversible in your
favour. Everything below is cleanup.

## Step 2 — Purge it from history

This rewrites every commit SHA from `badcec4` onward and requires a force-push.
Coordinate with anyone else working on the repo: they will need to re-clone or
hard-reset, because their local history will have diverged.

```bash
# Back up first — this is destructive.
git clone --mirror https://github.com/Bewinxed/mcp-server-snoonu.git backup.git

# Install the tool (recommended over the deprecated filter-branch)
pipx install git-filter-repo    # or: brew install git-filter-repo

# From a fresh clone of the repo:
git filter-repo --path src/snoonu-session.json --invert-paths

# Re-add the remote (filter-repo drops it deliberately) and force-push
git remote add origin https://github.com/Bewinxed/mcp-server-snoonu.git
git push --force --all
git push --force --tags
```

Then ask GitHub Support to purge cached views, and delete any forks — a force
push does not remove the blob from forks or from GitHub's cached commit views.

## Step 3 — Verify

```bash
# Should print nothing
git log --all --oneline -- src/snoonu-session.json

# Should find no blob containing the token
git rev-list --all --objects | git cat-file --batch-check='%(objectname) %(rest)' \
  | grep -i snoonu-session
```

## What is already fixed

- The file is untracked and removed from the working tree.
- `.gitignore` now also matches `*session*.json`.
- `.dockerignore` now excludes `*session*.json`, so `COPY . .` no longer bakes
  credentials into the container image.
- Real sessions live only in `~/.mcp-server-snoonu/`, written with mode `0600`.

## Why this mattered more than usual

The README's opening promise is that credentials never leave the user's machine.
A committed session file contradicts that claim directly, so this is worth
fixing loudly rather than quietly.
