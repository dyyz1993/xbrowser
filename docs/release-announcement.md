# Release announcement workflow

The release tweet is rendered by `.github/workflows/announce-release.yml`.

## Trigger

- The workflow runs when a GitHub Release is published.
- `vX.Y.0` releases (major and minor versions) render an announcement.
- `vX.Y.Z` where `Z` is non-zero is a patch release and is skipped.
- Prerelease and malformed tags are skipped.
- Manual runs require a `tag` input and also render in dry-run mode.

CI never publishes to X. It has no browser, no X web login state, and no X API credentials.
The rendered tweet is printed in the job log, added to the workflow summary, and uploaded as
the `release-tweet` artifact.

## Local publishing

Publish from the logged-in browser session on your own machine:

```bash
gh workflow run announce-release.yml \
  --repo dyyz1993/xbrowser \
  --ref master \
  -f tag=v1.30.0
gh run watch
```

Download the tweet from the workflow artifact, then post it locally:

```bash
gh run download <run-id> --repo dyyz1993/xbrowser --name release-tweet --path output/twitter
xbrowser twitter post --text "$(cat output/twitter/tweet.txt)"
```

The local command uses the existing X/Twitter browser login state. It does not require
`X_CONSUMER_KEY`, `X_CONSUMER_SECRET`, `X_ACCESS_TOKEN`, or `X_ACCESS_TOKEN_SECRET`.

## Announcement format

The workflow uses the first three bullets from `## Highlights`, separated by `·`.
If that section is absent, it falls back to the text before the first markdown heading.
It appends the npm versions link and truncates the result to 280 characters.

## Normal release order

1. Merge the release PR so the npm publish workflow completes.
2. Confirm the npm version installs cleanly.
3. Publish the GitHub Release with a concise title and a `## Highlights` section.
4. Wait for the render workflow and copy the tweet from the summary.
5. Publish the reviewed tweet from a logged-in local browser.
