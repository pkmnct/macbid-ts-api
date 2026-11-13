import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, describe, it } from "node:test";
import MacBid, {
  MacBidAuthError,
  MacBidNotFoundError,
  MacBidUnavailableError,
} from "./MacBid.js";

type Handler = (
  req: http.IncomingMessage,
  body: string
) => {
  status: number;
  json?: unknown;
  raw?: string;
  bytes?: Buffer;
  headers?: Record<string, string>;
};

let server: http.Server;
let root: string;
let handlers: Record<string, Handler> = {};
let calls: string[] = [];

before(async () => {
  // The client logs its progress; keep that out of the test report
  console.log = () => undefined;
  console.warn = () => undefined;
  console.error = () => undefined;
  server = http.createServer((req, res) => {
    const key = `${req.method} ${req.url}`;
    calls.push(key);
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const handler = handlers[key];
      const out = handler
        ? handler(req, body)
        : { status: 404, json: { error: "not found" } };
      res.writeHead(out.status, {
        "Content-Type": "application/json",
        ...out.headers,
      });
      res.end(out.bytes ?? out.raw ?? JSON.stringify(out.json ?? {}));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

afterEach(() => {
  handlers = {};
  calls = [];
});

const count = (key: string) => calls.filter((call) => call === key).length;

const future = (seconds: number) => new Date(Date.now() + seconds * 1000);

/** A client with a saved session whose access token looks valid. */
async function signedInClient(token = "old"): Promise<MacBid> {
  const api = new MacBid();
  api.API_ROOT = root;
  await api.authenticate({
    token,
    refresh_token: "refresh-1",
    token_expiration: future(3600),
    refresh_token_expiration: future(86400),
    user_id: "7",
    device_id: "device-1",
  });
  return api;
}

const refreshOk: Handler = () => ({
  status: 200,
  json: {
    access_token: "new",
    refresh_token: "refresh-2",
    expires: Math.floor(Date.now() / 1000) + 3600,
    expiration_refresh: Math.floor(Date.now() / 1000) + 86400,
  },
});

/** Answers 200 only to the access token "new". */
const activeNeedsNewToken: Handler = (req) =>
  req.headers.authorization === "new"
    ? { status: 200, json: [{ id: 1 }] }
    : { status: 401, json: { error: "expired" } };

describe("rejected session", () => {
  it("refreshes once and retries before giving up", async () => {
    handlers["GET /user/7/active"] = activeNeedsNewToken;
    handlers["PUT /auth/refresh-token"] = refreshOk;
    const api = await signedInClient();

    const items = await api.get_active();

    assert.equal(items.length, 1);
    assert.equal(count("PUT /auth/refresh-token"), 1);
    assert.equal(api.getAuthState().token, "new");
  });

  it("shares one refresh between parallel requests", async () => {
    handlers["GET /user/7/active"] = activeNeedsNewToken;
    handlers["PUT /auth/refresh-token"] = refreshOk;
    const api = await signedInClient();

    await Promise.all([api.get_active(), api.get_active(), api.get_active()]);

    assert.equal(count("PUT /auth/refresh-token"), 1);
    assert.equal(api.getAuthState().token, "new");
  });

  it("raises MacBidAuthError and drops the session when the retry fails too", async () => {
    handlers["GET /user/7/active"] = () => ({ status: 403, json: {} });
    handlers["PUT /auth/refresh-token"] = refreshOk;
    const api = await signedInClient();

    await assert.rejects(api.get_active(), (error: unknown) => {
      assert.ok(error instanceof MacBidAuthError);
      assert.equal(error.status, 403);
      return true;
    });
    assert.equal(api.getAuthState().token, undefined);
    assert.equal(api.getAuthState().refresh_token, undefined);
  });

  it("raises MacBidAuthError when the refresh itself is refused", async () => {
    handlers["GET /user/7/active"] = () => ({ status: 401, json: {} });
    handlers["PUT /auth/refresh-token"] = () => ({
      status: 401,
      json: { error: "bad token" },
    });
    const api = await signedInClient();

    await assert.rejects(api.get_active(), MacBidAuthError);
    assert.equal(api.getAuthState().refresh_token, undefined);
  });

  it("raises MacBidAuthError when an expired access token cannot be refreshed", async () => {
    handlers["PUT /auth/refresh-token"] = () => ({
      status: 400,
      json: { error: "invalid" },
    });
    const api = await signedInClient();
    // Let the access token expire, as it would between two polls
    (api as unknown as { auth_info: { token_expiration: Date } }).auth_info.token_expiration =
      future(-60);

    await assert.rejects(api.get_active(), MacBidAuthError);
    assert.equal(api.getAuthState().refresh_token, undefined);
  });

  it("keeps the session when Mac.Bid is down during the retry", async () => {
    handlers["GET /user/7/active"] = () => ({ status: 401, json: {} });
    handlers["PUT /auth/refresh-token"] = () => ({ status: 503, json: {} });
    const api = await signedInClient();

    await assert.rejects(api.get_active(), MacBidUnavailableError);
    assert.equal(api.getAuthState().refresh_token, "refresh-1");
  });
});

describe("public endpoints", () => {
  it("do not clear the session when they answer 403", async () => {
    handlers["GET /buildings"] = () => ({ status: 403, json: {} });
    handlers["GET /locations"] = () => ({ status: 401, json: {} });
    const api = await signedInClient();

    await assert.rejects(api.get_buildings(), (error: unknown) => {
      assert.ok(!(error instanceof MacBidAuthError));
      return true;
    });
    await assert.rejects(api.get_locations(), (error: unknown) => {
      assert.ok(!(error instanceof MacBidAuthError));
      return true;
    });
    assert.equal(api.getAuthState().token, "old");
    assert.equal(count("PUT /auth/refresh-token"), 0);
  });
});

describe("watchlist", () => {
  it("is empty when watchlist_full is missing", async () => {
    handlers["GET /auctions/customer/7/active-auctions"] = () => ({
      status: 200,
      json: {},
    });
    const api = await signedInClient();
    assert.deepEqual(await api.get_watchlist(), []);
  });

  it("fails when watchlist_full is not a list", async () => {
    handlers["GET /auctions/customer/7/active-auctions"] = () => ({
      status: 200,
      json: { watchlist_full: "oops" },
    });
    const api = await signedInClient();
    await assert.rejects(api.get_watchlist(), /not a list/);
  });
});

describe("get_lot", () => {
  // Lot 2230R as Mac.Bid sent it on 13 November 2026, trimmed
  const lot = {
    lot_id: 67826120,
    lot_number: "2230R",
    auction_id: "101336",
    location_id: "25",
    title: "Magnet Maker Machine Kit",
    status: "LIVE",
    is_open: true,
    end_time: "2026-11-17T00:35:59.000Z",
    extension_window: "2026-11-17T00:33:59.000Z",
    current_bid: "130",
    total_bids: "33",
    instant_win_price: null,
  };

  it("returns the lot's live state with the session token", async () => {
    let authorization: string | undefined;
    handlers["GET /map-bid/ddb/lot/67826120"] = (req) => {
      authorization = req.headers.authorization;
      return { status: 200, json: lot };
    };
    const api = await signedInClient();
    assert.deepEqual(await api.get_lot(67826120), lot);
    assert.equal((await api.get_lot("67826120")).end_time, lot.end_time);
    assert.equal(authorization, "old");
  });

  it("refuses an id that is not a plain number, without a request", async () => {
    const api = await signedInClient();
    for (const bad of ["2230R", "../user/me", "0", "", "1.5", -3]) {
      await assert.rejects(api.get_lot(bad), /Not a Mac.Bid lot id/);
    }
    assert.equal(calls.length, 0);
  });

  it("fails when end_time is missing or not an instant", async () => {
    const api = await signedInClient();
    for (const end_time of [
      undefined,
      null,
      "",
      "null",
      "2026-11-16 19:35:59", // no zone: would be read as local time
      "2026-11-16T19:35:59", // the same, ISO style
      "not a dateZ",
      "0Z", // Date.parse: 1 January 2000
      "-1000", // Date.parse: the year 1000, local time
      "Nov 17 2026 00:35:59 -0500",
      "2026-11-17T00:35:59z",
      "2026-11-17T00:35:59+0000",
      "2026-13-45T99:99:99Z", // the right shape, but not a date
    ]) {
      handlers["GET /map-bid/ddb/lot/5"] = () => ({
        status: 200,
        json: { lot_id: 5, end_time },
      });
      await assert.rejects(api.get_lot(5), /no usable end_time/, String(end_time));
    }
    for (const json of [null, [], "x"]) {
      handlers["GET /map-bid/ddb/lot/5"] = () => ({ status: 200, json });
      await assert.rejects(api.get_lot(5), /no usable end_time/);
    }
  });

  it("accepts an end_time with an offset", async () => {
    handlers["GET /map-bid/ddb/lot/5"] = () => ({
      status: 200,
      json: { lot_id: 5, end_time: "2026-11-16T19:35:59-05:00" },
    });
    const api = await signedInClient();
    assert.equal((await api.get_lot(5)).end_time, "2026-11-16T19:35:59-05:00");
  });

  it("needs a login", async () => {
    const api = new MacBid();
    api.API_ROOT = root;
    await assert.rejects(api.get_lot(5), /Not authenticated/);
    assert.equal(count("GET /map-bid/ddb/lot/5"), 0);
  });

  it("raises MacBidNotFoundError for a lot that is gone, keeping the session", async () => {
    handlers["GET /map-bid/ddb/lot/5"] = () => ({
      status: 404,
      json: { message: "Not Found" },
    });
    const api = await signedInClient();
    await assert.rejects(api.get_lot(5), (error: unknown) => {
      assert.ok(error instanceof MacBidNotFoundError);
      assert.equal(error.path, "/map-bid/ddb/lot/5");
      assert.match(error.message, /HTTP 404/);
      return true;
    });
    assert.equal(api.getAuthState().token, "old");
  });

  it("leaves a 404 from the other calls a plain Error (the endpoint may have moved)", async () => {
    const api = await signedInClient();
    const endpoints: [string, () => Promise<unknown>][] = [
      ["GET /auctions/customer/7/active-auctions", api.get_watchlist],
      ["GET /user/7/active", api.get_active],
      ["GET /buildings", api.get_buildings],
      ["GET /locations", api.get_locations],
    ];
    for (const [key, call] of endpoints) {
      handlers[key] = () => ({ status: 404, json: { message: "Not Found" } });
      await assert.rejects(call(), (error: unknown) => {
        assert.ok(!(error instanceof MacBidNotFoundError), key);
        assert.match((error as Error).message, /HTTP 404/);
        return true;
      });
    }
  });

  it("throws a plain Error for other HTTP errors", async () => {
    handlers["GET /map-bid/ddb/lot/5"] = () => ({ status: 418, json: {} });
    const api = await signedInClient();
    await assert.rejects(api.get_lot(5), (error: unknown) => {
      assert.ok(!(error instanceof MacBidNotFoundError));
      assert.match((error as Error).message, /HTTP 418/);
      return true;
    });
  });

  it("refreshes once on a rejected token and retries", async () => {
    handlers["GET /map-bid/ddb/lot/67826120"] = (req) =>
      req.headers.authorization === "new"
        ? { status: 200, json: lot }
        : { status: 401, json: { message: "Unauthorized" } };
    handlers["PUT /auth/refresh-token"] = refreshOk;
    const api = await signedInClient();
    assert.equal((await api.get_lot(67826120)).end_time, lot.end_time);
    assert.equal(count("PUT /auth/refresh-token"), 1);
    assert.equal(count("GET /map-bid/ddb/lot/67826120"), 2);
  });

  it("raises MacBidAuthError and drops the session when the retry is refused too", async () => {
    handlers["GET /map-bid/ddb/lot/5"] = () => ({
      status: 401,
      json: { message: "Unauthorized" },
    });
    handlers["PUT /auth/refresh-token"] = refreshOk;
    const api = await signedInClient();
    await assert.rejects(api.get_lot(5), MacBidAuthError);
    assert.equal(api.getAuthState().token, undefined);
  });
});

describe("sign-in", () => {
  const loginHandlers = () => {
    handlers["POST /auth/auth-validation"] = () => ({
      status: 200,
      json: { message: "Login validation code sent" },
    });
    handlers["PUT /auth/validate-access-code"] = () => ({
      status: 400,
      json: { error: "Invalid code" },
    });
  };

  it("forgets a rejected code but keeps the device_id", async () => {
    loginHandlers();
    const api = new MacBid();
    api.API_ROOT = root;
    const creds = { email: "a@example.test", password: "pw" };

    await assert.rejects(api.authenticate(creds), /Validation code sent/);
    const deviceId = api.getAuthState().device_id;
    assert.ok(deviceId);

    await assert.rejects(
      api.authenticate({ validation_code: "000000" }),
      /Validation failed/
    );
    assert.equal(api.getAuthState().device_id, deviceId);

    // The bad code must not be sent again
    await assert.rejects(api.authenticate(), /already sent/);
    assert.equal(count("PUT /auth/validate-access-code"), 1);
  });

  it("resetSession starts over with a new code request", async () => {
    loginHandlers();
    const api = new MacBid();
    api.API_ROOT = root;
    const creds = { email: "a@example.test", password: "pw" };

    await assert.rejects(api.authenticate(creds), /Validation code sent/);
    const first = api.getAuthState().device_id;

    api.resetSession();
    assert.equal(api.getAuthState().device_id, undefined);

    await assert.rejects(api.authenticate(), /Validation code sent/);
    assert.notEqual(api.getAuthState().device_id, first);
    assert.equal(count("POST /auth/auth-validation"), 2);
  });
});

describe("odd answers from Mac.Bid", () => {
  it("refuses a refresh with a non-JSON body as MacBidAuthError", async () => {
    handlers["GET /user/7/active"] = () => ({ status: 401, json: {} });
    handlers["PUT /auth/refresh-token"] = () => ({
      status: 401,
      raw: "<html>Unauthorized</html>",
    });
    const api = await signedInClient();

    await assert.rejects(api.get_active(), MacBidAuthError);
    assert.equal(api.getAuthState().refresh_token, undefined);
  });

  it("rejects a login answer without a usable expiry", async () => {
    handlers["POST /auth/auth-validation"] = () => ({
      status: 200,
      json: { message: "Login validation code sent" },
    });
    handlers["PUT /auth/validate-access-code"] = () => ({
      status: 200,
      json: { access_token: "t", refresh_token: "r", user_id: 7 },
    });
    const api = new MacBid();
    api.API_ROOT = root;
    await assert.rejects(
      api.authenticate({ email: "a@example.test", password: "pw" }),
      /Validation code sent/
    );
    await assert.rejects(
      api.authenticate({ validation_code: "123456" }),
      /valid expires/
    );
    assert.equal(api.getAuthState().token, undefined);
  });

  it("forgets the code even when the error is not a string", async () => {
    handlers["POST /auth/auth-validation"] = () => ({
      status: 200,
      json: { message: "Login validation code sent" },
    });
    handlers["PUT /auth/validate-access-code"] = () => ({
      status: 400,
      json: { error: { code: 42 } },
    });
    const api = new MacBid();
    api.API_ROOT = root;
    await assert.rejects(
      api.authenticate({ email: "a@example.test", password: "pw" }),
      /Validation code sent/
    );
    await assert.rejects(
      api.authenticate({ validation_code: "000000" }),
      /Validation failed/
    );
    await assert.rejects(api.authenticate(), /already sent/);
    assert.equal(count("PUT /auth/validate-access-code"), 1);
  });

  it("does not log the user out when user_id is missing", async () => {
    const api = new MacBid();
    api.API_ROOT = root;
    await api.authenticate({
      token: "old",
      refresh_token: "refresh-1",
      token_expiration: future(3600),
      refresh_token_expiration: future(86400),
      device_id: "device-1",
    });

    await assert.rejects(api.get_active(), /user_id is not set/);
    assert.equal(api.getAuthState().token, "old");
    assert.equal(calls.length, 0);
  });

  it("serves the public endpoints without a login", async () => {
    handlers["GET /buildings"] = () => ({ status: 200, json: [{ id: 1 }] });
    const api = new MacBid();
    api.API_ROOT = root;
    assert.equal((await api.get_buildings()).length, 1);
  });

  it("keeps the session headers when the caller adds its own", async () => {
    let seen: http.IncomingHttpHeaders = {};
    handlers["POST /things"] = (req) => {
      seen = req.headers;
      return { status: 200, json: {} };
    };
    const api = await signedInClient();
    await api.post("/things", {
      body: "{}",
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(seen.authorization, "old");
    assert.equal(seen["content-type"], "application/json");
  });

  it("leaves the session untouched when a refresh answer has a bad expiry", async () => {
    handlers["PUT /auth/refresh-token"] = () => ({
      status: 200,
      json: {
        access_token: "new",
        refresh_token: "refresh-2",
        expires: Math.floor(Date.now() / 1000) + 3600,
        expiration_refresh: "soon",
      },
    });
    const api = await signedInClient();

    await assert.rejects(api.refreshToken(), /expiration_refresh/);
    const state = api.getAuthState();
    assert.equal(state.token, "old");
    assert.equal(state.refresh_token, "refresh-1");
  });

  it("reports 'Not authenticated' before the user_id check", async () => {
    const api = new MacBid();
    api.API_ROOT = root;
    await assert.rejects(api.get_watchlist(), /Not authenticated/);
    await assert.rejects(api.get_active(), /Not authenticated/);
  });

  it("does not send an expired token to a public endpoint", async () => {
    let auth: string | undefined = "unset";
    handlers["GET /buildings"] = (req) => {
      auth = req.headers.authorization;
      return { status: 200, json: [] };
    };
    const api = await signedInClient();
    (api as unknown as { auth_info: { token_expiration: Date } }).auth_info.token_expiration =
      future(-60);

    await api.get_buildings();
    assert.equal(auth, undefined);
    assert.equal(count("PUT /auth/refresh-token"), 0);
  });

  it("returns the body bytes unchanged", async () => {
    handlers["GET /file"] = () => ({ status: 200, raw: "héllo" });
    const api = await signedInClient();
    const res = await api.get("/file");
    assert.equal(new TextDecoder().decode(await res.arrayBuffer()), "héllo");
    assert.equal(await res.text(), "héllo");
  });
});

describe("response text decoding", () => {
  const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9]); // "café" in ISO-8859-1

  it("uses the charset the response declares", async () => {
    handlers["GET /x"] = () => ({
      status: 200,
      bytes: latin1,
      headers: { "Content-Type": 'text/plain; charset="ISO-8859-1"' },
    });
    const client = await signedInClient();
    const res = await client.get("/x");
    assert.equal(await res.text(), "café");
  });

  it("falls back to UTF-8 for an unknown or missing charset", async () => {
    handlers["GET /x"] = () => ({
      status: 200,
      raw: "café",
      headers: { "Content-Type": "text/plain; charset=nonsense" },
    });
    const client = await signedInClient();
    assert.equal(await (await client.get("/x")).text(), "café");
  });
});
