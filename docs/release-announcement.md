# Release announcement workflow

The release tweet is automated through `.github/workflows/announce-release.yml`.

## Trigger

- The workflow runs when a GitHub Release is published.
- `vX.Y.0` releases (major and minor versions) are announced.
- `vX.Y.Z` where `Z` is non-zero is a patch release and is skipped.
- Prerelease and malformed tags are skipped.
- A manual `workflow_dispatch` defaults to dry-run mode.

## Required GitHub secrets

Add these repository secrets:

- `X_CONSUMER_KEY`
- `X_CONSUMER_SECRET`
- `X_ACCESS_TOKEN`
- `X_ACCESS_TOKEN_SECRET`

Create an X Developer app with **Read and Write** permissions. Generate the four OAuth 1.0a credentials for the posting account. The app must have access to POST `/2/tweets`. If an image is added later, the app also needs media upload access.

Never place these credentials in repository files or release notes.

## Normal release order

1. Merge the release PR so the npm publish workflow completes.
2. Confirm the npm version installs cleanly.
3. Publish the GitHub Release with a concise title and a `## Highlights` section.
4. Wait for the Announce release workflow.
5. Open the workflow log and verify the tweet URL.

The announcement uses the first three bullets from `## Highlights`, separated by `·`. If that section is absent, it falls back to the text before the first markdown heading. It appends the npm versions link and truncates the result to 280 characters.

Because the release event occurs after publishing, the workflow does not re-run npm validation. Keep the existing release gate: publish first, install and smoke-test the npm version, then publish the GitHub Release.

## Manual validation

Run the workflow from GitHub Actions with `dry_run` enabled. Inspect the rendered tweet in the log. To publish manually after review, rerun with `dry_run` disabled.

## Failure handling

If X rejects the tweet:

1. Check that all four secrets exist.
2. Confirm the X app has read/write permission.
3. Confirm the access token belongs to the intended account.
4. Render a dry run and inspect the generated text.
5. After fixing credentials, rerun the failed workflow job.
