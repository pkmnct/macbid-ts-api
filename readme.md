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

## API

| Method | Description |
|---|---|
| `authenticate(params?)` | Log in or refresh session; returns persistable state |
| `get_watchlist()` | Active watchlist items |
| `get(path)` / `post(path, options?)` | Authenticated API requests |
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
