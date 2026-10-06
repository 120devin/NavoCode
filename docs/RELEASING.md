# Manual npm releases

NavoCode publishes as the public npm package `navocode`. Releases and npm
publication are manual. Pushes and GitHub Release events do not publish packages.

## Configure trusted publishing

[NavoCode 0.2.0 is published on npm](https://www.npmjs.com/package/navocode).
The first publication was completed interactively. Do not rerun publication for
that version.

For subsequent workflow releases, open the package settings on npmjs.com and add
a GitHub Actions trusted publisher with:

| Field | Value |
| --- | --- |
| Organization or user | `120devin` |
| Repository | `NavoCode` |
| Workflow filename | `publish.yml` |
| Environment | Leave blank |
| Allowed action | Allow `npm publish` |

The workflow uses Node.js 24, npm's OIDC authentication, and automatic provenance.
No npm token secret is required. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

## Subsequent releases

1. Update `package.json`, both root versions in `package-lock.json`,
   `src/navocode/__init__.py`, `.claude-plugin/plugin.json`, and the README's
   version description together. `npm run test:package` checks the executable
   version and package/plugin metadata agree.
2. Run the checks above, review the changes, and commit and push them.
3. Manually create and push a tag matching the version, such as `v0.2.1`.
4. Manually create a GitHub Release for that tag, add release notes, and publish
   it. For a version such as `0.3.0-beta.1`, mark it as a prerelease.
5. Open **Actions → Publish npm package → Run workflow** on the default branch,
   enter the published release tag, and run it.

The workflow checks out the tag, requires a published GitHub Release, checks the
version, runs Python and browser tests, and verifies the actual npm tarball by
installing it and exercising all four assistant skill layouts. It then publishes
stable releases under `latest` and prereleases under `next`.

Each npm version can be published only once. The first version published locally
does not need another publishing workflow run. If publication fails, inspect the
Actions log and npm registry before retrying; use a new version for corrections
to an already published package.

## User upgrades

```sh
npm install -g navocode@latest
navocode install --host codex --project /path/to/your-project
```

Users must reinstall each copied project skill after upgrading the global CLI.
Use the appropriate host and repeat `--pr-mode always` when needed. Locally edited
skills are protected from replacement. Start a new assistant session afterward.
