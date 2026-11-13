# macbid-ts-api

Unofficial TypeScript client for the [Mac.Bid](https://www.mac.bid) API.

## Requirements

Node.js **>= 16**

## Install

```bash
npm install macbid-ts-api
```

## Usage

```typescript
import MacBid, { type SerializableAuthState } from "macbid-ts-api";

const api = new MacBid();
let state: SerializableAuthState = {};

state = await api.authenticate({
  email: "you@example.com",
  password: "your-password",
  ...state,
});

const watchlist = await api.get_watchlist();
```

`authenticate()` returns persistable state (tokens and `device_id`, never credentials). Pass it back in on the next call with `...state`.

### Two-factor authentication

If SMS verification is required, the first call throws after sending a code. Set `state` from `api.getAuthState()` and call again with the code:

```typescript
let state: SerializableAuthState = {};

try {
  state = await api.authenticate({ email, password, ...state });
} catch {
  state = api.getAuthState();
}

// User receives SMS, then retry:
state = await api.authenticate({
  email,
  password,
  validation_code: "123456",
  ...state,
});
```

If `device_id` is set but there are no tokens and no `validation_code`, a code was already sent and a new SMS will not be requested.

For JSON storage, use `MacBid.serializeAuthState` / `MacBid.parseAuthState`.

`AuthInfo` is the type for `authenticate()` params (credentials, `validation_code`, etc.). `SerializableAuthState` is what comes back — safe to persist.

### Upgrading from 1.x

- Node 22 or newer; no runtime dependencies (`node-fetch` is gone).
- `get_watchlist`, `get_active`, `get_buildings` and `get_locations` throw on an HTTP error instead of returning the error body as data. See [Errors](#errors).
- `get` / `post` return a `MacBidApiResponse` (`status`, `statusText`, `ok`, `headers`, `text()`, `json()`, `arrayBuffer()`), not a `Response`: there is no `clone()`, `body`, `blob()` or `formData()`. The body is read in full under the request timeout.

### Errors

- `MacBidUnavailableError`: Mac.Bid could not be reached, timed out, or answered with a 5xx or 429 (`retryAfterMs` is set when it sent `Retry-After`). The session is unaffected: keep the saved state and retry later.
- `MacBidAuthError`: Mac.Bid refused the session (`status` is 400, 401 or 403), for example after the password was changed or the session was revoked, or when it refused the refresh token. The client has already dropped the tokens: discard the saved state and sign in again. Before raising it for a rejected data request, the client refreshes the access token once and retries, and parallel calls share that one refresh. `get_buildings` and `get_locations` never raise it: they do not depend on the user's session.
- `MacBidNotFoundError`: `get_lot` got a 404 (`path` says for what): no such lot, for example one that was removed. The session is unaffected. Other calls throw a plain `Error` on 404, since there it more likely means the endpoint moved.

Other errors mean the request or response was not what the client expected.

`get_watchlist` returns `[]` when the response has no `watchlist_full` (an account with nothing on its watchlist) and logs a warning once per client; a `watchlist_full` that is not a list throws.

### Close times

A watchlist item's `expected_close_date` is not a UTC instant: it is wall-clock digits marked "Z". In the watchlist response they have not matched the time the site shows (in November 2026 they were an hour ahead of Eastern time; the summer offset is unknown), and they stay at the scheduled close when a late bid extends the lot. For the real close, use `get_lot(item.auction_lot_id)` and its `end_time`.

`get_lot` is one request per lot. For a long watchlist, run a few at a time rather than all at once: a burst can get a 429 (`MacBidUnavailableError`). A lot that no longer exists throws `MacBidNotFoundError`, so you can skip that one item; but if every lot throws it, the endpoint has likely moved, and that should fail loudly rather than be skipped. `LotStatus` sends most numbers as strings (`auction_id: "101336"`), unlike the watchlist, so compare ids with `Number(...)`.

### Starting a sign-in over

A rejected `validation_code` is forgotten, but the `device_id` is kept, so you can retry with the code from the same text message. To request a new code instead, call `resetSession()` (it drops the tokens, `device_id` and code, and keeps the email and password), then call `authenticate()` again.

```typescript
import { MacBidAuthError, MacBidUnavailableError } from "macbid-ts-api";

try {
  const items = await api.get_watchlist();
} catch (error) {
  if (error instanceof MacBidAuthError) {
    // Clear the saved state and ask the user to sign in
  } else if (error instanceof MacBidUnavailableError) {
    // Try again later
  }
}
```

## API

| Method | Description |
|---|---|
| `authenticate(params?)` | Log in or refresh session; returns persistable state |
| `get_watchlist()` | Active watchlist items |
| `get_lot(lotId)` | A lot's live bidding state, with `end_time`: when bidding really ends, as a UTC instant, moved later by bid extensions. `lotId` is the numeric `auction_lot_id`. Needs a login |
| `get_active()` | Active won items (e.g. awaiting pickup) |
| `get_buildings()` | Warehouse buildings |
| `get_locations()` | Pickup locations |
| `get(path, options?)` / `post(path, options?)` | Low-level requests with the session token. They return Mac.Bid's answer as is (`status`, `ok`, `headers`, `text()`, `json()`): no retry of a rejected token, no `MacBidAuthError`, and no throw on 4xx. Headers you pass are added to the session headers |
| `refreshToken()` | Refresh the access token |
| `getAuthState()` | Current persistable state |
| `get_refresh_token_expiration()` | Refresh token expiry |

## Development

```bash
npm install
npm run build
npm run lint
```

## License

MIT

## Releases

Releases are automatic. Pull requests are squash-merged and the PR title must be a [conventional commit](https://www.conventionalcommits.org) (checked in CI). On every merge to `main`, semantic-release picks the next version from it, publishes to npm and creates a GitHub release:

| Title | Release |
| --- | --- |
| `fix: ...` | patch |
| `feat: ...` | minor |
| `feat!: ...` or a `BREAKING CHANGE:` footer | major |
| `docs:`, `chore:`, `ci:`, `test:`, ... | none |

A release starts only after the CI workflow has passed on `main`, and is published with npm provenance. It needs no npm token: the package must list `pkmnct/macbid-ts-api` and the workflow `release.yml` as a [trusted publisher](https://docs.npmjs.com/trusted-publishers) on npmjs.com. The repository must also squash-merge with the PR title as the commit message.

The version in `package.json` is not edited in the repository; the published package carries the real one.
