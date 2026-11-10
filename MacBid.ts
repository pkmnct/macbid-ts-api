import { randomUUID } from "node:crypto";

export interface AuthInfo {
  email?: string;
  password?: string;
  token?: string;
  token_expiration?: Date;
  user_id?: string;
  refresh_token?: string;
  refresh_token_expiration?: Date;
  validation_code?: string;
  device_id?: string;
  remember_me?: boolean;
}

/** JSON-serializable auth fields safe to persist (no credentials). */
export interface SerializableAuthState {
  token?: string;
  refresh_token?: string;
  token_expiration?: string;
  refresh_token_expiration?: string;
  user_id?: string;
  device_id?: string;
}

export interface WatchlistFull {
  auction_lot_id: number;
  watchlist_date_created: Date;
  id: number;
  auction_id: number;
  closed_date: null;
  buyers_assurance_cost: number | null;
  expected_close_date: Date;
  inventory_id: number;
  date_created: Date;
  lot_number: string;
  listing_url: null;
  title: string;
  is_open: number;
  is_transferrable: number;
  total_bids: number;
  winning_customer_id: null;
  winning_bid_id: null;
  winning_bid_amount: number | null;
  unique_bidders: number;
  product_name: string;
  quantity: number;
  is_pallet: number;
  shipping_height: number | null;
  shipping_width: number | null;
  shipping_length: number | null;
  warehouse_location: string;
  shipping_weight: number | null;
  case_packed_qty: number | null;
  auction_number: string;
  retail_price: number;
  condition_name: ConditionName;
  category: null | string;
  image_url: string;
  auction_type: AuctionType;
}

export enum AuctionType {
  Pallet = "pallet",
  Standard = "standard",
}

export enum ConditionName {
  Damaged = "DAMAGED",
  LikeNew = "LIKE NEW",
  OpenBox = "OPEN BOX",
}

export interface ActiveItem {
  id: number;
  invoice_id: number;
  box_size: string;
  warehouse_location: string;
  is_assisted_removal: number;
  removal_container: string | null;
  product_name: string;
  status: string;
  boxes: number;
  note: string | null;
  current_location_id: number;
  allow_transfers: number;
  allow_shipping: number;
  is_turbo: number;
  free_transfers: number;
  auction_number: string;
  auction_abandon_date: string;
  abandon_date: string | null;
  lot_number: string;
  lot_id: number;
  has_buyer_assurance: number;
  item_price: number;
  cover_image: string;
  grand_total: number;
  date_paid: string;
  transfer_id: number | null;
  start_location_code: string | null;
  dest_location_code: string | null;
  start_location_id: number | null;
  dest_location_id: number | null;
  grouping_id: string;
  auction_lot_deadline: string | null;
  auction_lot_number: string;
}

export interface BuildingLicenseInfo {
  firm_license_label: string;
  firm_license: string | null;
  auctioneer_license: string | null;
  auctioneer_of_record: string | null;
}

export interface Building {
  id: number;
  name: string;
  address: string;
  maps_place_id: string;
  city_state: string;
  zip_code: string;
  state_abbr: string;
  notes: string | null;
  hours: string;
  code: string;
  latitude: number;
  longitude: number;
  region_id: number;
  auction_license: string | null;
  sales_tax: number;
  auctioneer_license: string | null;
  auctioneer_of_record: string | null;
  transfer_destinations: string | null;
  box_sizes: string;
  has_bin_store: number;
  license_info: BuildingLicenseInfo;
}

export interface Location {
  id: number;
  name: string;
  address: string;
  city_state: string;
  zip_code: string;
  can_transfer: number;
  color: string | null;
  notes: string;
  hours: string;
  code: string;
  box_size: string;
  building_id: number;
  region_id: number;
  auction_license: string | null;
  transfer_destinations: string | null;
}

/**
 * What the low-level \`get\` and \`post\` return: the status and headers of
 * Mac.Bid's answer and its body, already read in full.
 */
export interface MacBidApiResponse {
  status: number;
  statusText: string;
  ok: boolean;
  headers: Headers;
  text: () => Promise<string>;
  json: () => Promise<{
    [key: string]: unknown;
  }>;
}

/**
 * Mac.Bid could not be reached, timed out, or answered with a server error.
 * The saved session is not affected, so the same call can simply be retried.
 */
export class MacBidUnavailableError extends Error {
  override name = "MacBidUnavailableError";
  /**
   * How long Mac.Bid asked callers to wait before retrying (from the
   * Retry-After header), in milliseconds. Undefined when it did not say.
   */
  retryAfterMs?: number;

  constructor(
    message: string,
    options?: ErrorOptions & { retryAfterMs?: number }
  ) {
    super(message, options);
    this.retryAfterMs = options?.retryAfterMs;
  }
}

/**
 * Mac.Bid refused the session (HTTP 401 or 403): the tokens were revoked or
 * are no longer valid, even if they have not reached their expiry time. The
 * client has already dropped them, so discard any saved session and sign in
 * again.
 */
export class MacBidAuthError extends Error {
  override name = "MacBidAuthError";
  /** The HTTP status Mac.Bid answered with. */
  status: number;

  constructor(message: string, options: ErrorOptions & { status: number }) {
    super(message, options);
    this.status = options.status;
  }
}

/** Parse a Retry-After header: delay in seconds, or an HTTP date. */
const parseRetryAfter = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
};

export class MacBid {
  public LOGIN_PAGE_URL = "https://www.mac.bid";
  public API_ROOT = "https://api.macdiscount.com";
  /** Give up on a request to Mac.Bid after this many milliseconds. */
  public REQUEST_TIMEOUT_MS = 30_000;

  private macbid_session_headers: { [key: string]: string } = {
    "Content-Type": "application/json",
  };
  private auth_info: AuthInfo = {};

  private mergeAuthInfo = (params: Partial<AuthInfo>): void => {
    Object.assign(this.auth_info, params);
  };

  /** Returns persistable auth state (tokens and device_id). */
  public getAuthState = (): SerializableAuthState => {
    return MacBid.serializeAuthState(this.auth_info);
  };

  public static serializeAuthState = (
    authInfo: Partial<AuthInfo>
  ): SerializableAuthState => ({
    token: authInfo.token,
    refresh_token: authInfo.refresh_token,
    token_expiration: authInfo.token_expiration?.toISOString(),
    refresh_token_expiration: authInfo.refresh_token_expiration?.toISOString(),
    user_id: authInfo.user_id,
    device_id: authInfo.device_id,
  });

  public static parseAuthState = (
    data: string | SerializableAuthState
  ): Partial<AuthInfo> => {
    const parsed =
      typeof data === "string"
        ? (JSON.parse(data) as SerializableAuthState)
        : data;

    return {
      token: parsed.token,
      refresh_token: parsed.refresh_token,
      token_expiration: parsed.token_expiration
        ? new Date(parsed.token_expiration)
        : undefined,
      refresh_token_expiration: parsed.refresh_token_expiration
        ? new Date(parsed.refresh_token_expiration)
        : undefined,
      user_id: parsed.user_id,
      device_id: parsed.device_id,
    };
  };

  private clearLoginSession = (): void => {
    delete this.auth_info.token;
    delete this.auth_info.refresh_token;
    delete this.auth_info.token_expiration;
    delete this.auth_info.refresh_token_expiration;
    delete this.auth_info.user_id;
    delete this.auth_info.device_id;
    delete this.auth_info.validation_code;
    delete this.macbid_session_headers["Authorization"];
  };

  /**
   * Forget the current login: tokens, device_id and any validation code. Keeps
   * the email and password. Use it to start a sign-in over, e.g. to request a
   * new code, without building a new client.
   */
  public resetSession = (): void => {
    this.clearLoginSession();
  };

  /** device_id saved without tokens means an SMS was sent and we're waiting for the code. */
  private isAwaiting2FA = (): boolean => {
    return !!(
      this.auth_info.device_id &&
      !this.auth_info.token &&
      !this.auth_info.refresh_token
    );
  };

  /**
   * Establish or refresh a session. Pass credentials and any saved tokens / device_id.
   * Omit params on later calls to reuse the current session.
   * Returns persistable auth state; use getAuthState() after API calls that may refresh tokens.
   */
  public authenticate = async (
    params?: Partial<AuthInfo>
  ): Promise<SerializableAuthState> => {
    if (params) {
      this.mergeAuthInfo(params);
    }

    if (this.auth_info.token) {
      this.macbid_session_headers["Authorization"] = this.auth_info.token;
      if (!this.isTokenExpired()) {
        console.log("Using existing access token");
        return this.getAuthState();
      }
      if (this.auth_info.refresh_token && !this.isRefreshTokenExpired()) {
        console.log("Access token expired, refreshing");
        if (await this.tryRefresh()) {
          return this.getAuthState();
        }
      } else {
        this.clearLoginSession();
      }
    } else if (this.auth_info.refresh_token) {
      if (this.isRefreshTokenExpired()) {
        console.log("Refresh token has expired, need to login");
        this.clearLoginSession();
      } else {
        console.log("No access token, attempting to refresh using refresh token");
        if (await this.tryRefresh()) {
          console.log("Successfully refreshed token");
          return this.getAuthState();
        }
      }
    }

    if (this.auth_info.email && this.auth_info.password) {
      console.log("No valid tokens found, attempting login");
      await this.login();
      return this.getAuthState();
    }

    throw new Error("email and password are required to log in");
  };

  private request = async (
    path: string,
    options: RequestInit = {}
  ): Promise<MacBidApiResponse> => {
    // Keep the timeout even when the caller brings its own signal
    const timeout = AbortSignal.timeout(this.REQUEST_TIMEOUT_MS);
    const signal = options.signal
      ? AbortSignal.any([timeout, options.signal])
      : timeout;

    let res: Response;
    let text: string;
    try {
      res = await fetch(this.API_ROOT + path, {
        headers: this.macbid_session_headers,
        ...options,
        signal,
      });
      // Read the body here so a stall or reset mid-body is also reported as
      // MacBidUnavailableError rather than escaping from a later res.json()
      text = await res.text();
    } catch (error) {
      // The caller cancelled this request: that is not an outage
      if (options.signal?.aborted) {
        throw error;
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new MacBidUnavailableError(`Could not reach Mac.Bid: ${reason}`, {
        cause: error,
      });
    }
    // 5xx is an outage; 429 means retry later
    if (res.status >= 500 || res.status === 429) {
      throw new MacBidUnavailableError(
        `Mac.Bid returned HTTP ${res.status} for ${path}`,
        { retryAfterMs: parseRetryAfter(res.headers.get("retry-after")) }
      );
    }
    return {
      status: res.status,
      statusText: res.statusText,
      ok: res.ok,
      headers: res.headers,
      text: async () => text,
      json: async () => JSON.parse(text) as { [key: string]: unknown },
    };
  };

  /**
   * Parse the body of an auth endpoint's answer. A gateway can answer with an
   * empty or HTML body, and that must not hide the HTTP status.
   */
  private readAuthJson = async (
    res: MacBidApiResponse
  ): Promise<{ [key: string]: unknown }> => {
    try {
      return await res.json();
    } catch {
      return {};
    }
  };

  /** A token expiry from an auth answer: seconds since the epoch. */
  private expiryDate = (seconds: unknown, what: string): Date => {
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
      throw new Error(`Mac.Bid answered without a valid ${what}`);
    }
    return new Date(seconds * 1000);
  };

  /** Refresh the access token; false when the refresh token is no good. */
  private tryRefresh = async (): Promise<boolean> => {
    try {
      await this.refreshToken();
      return true;
    } catch (error) {
      // An outage says nothing about the session: keep it and let the caller retry
      if (error instanceof MacBidUnavailableError) {
        throw error;
      }
      console.warn(
        "Failed to refresh token, attempting login:",
        error instanceof Error ? error.message : String(error)
      );
      this.clearLoginSession();
      return false;
    }
  };

  /** The signed-in user's id, for the per-user endpoints. */
  private requireUserId = (): string => {
    const userId = this.auth_info.user_id;
    if (!userId) {
      throw new Error(
        "user_id is not set; authenticate (or restore a saved state that includes it) first"
      );
    }
    return userId;
  };

  /** GET a path that needs a login and fail clearly if Mac.Bid refuses it. */
  private getJson = async <T>(
    path: string,
    { userSpecific = true }: { userSpecific?: boolean } = {}
  ): Promise<T> => {
    if (userSpecific) {
      this.check_auth();
      await this.ensureValidToken();
    }
    const sentWith = this.macbid_session_headers["Authorization"];
    let res = await this.request(path);
    if (
      userSpecific &&
      (res.status === 401 || res.status === 403) &&
      this.auth_info.refresh_token &&
      !this.isRefreshTokenExpired()
    ) {
      // The access token can be rejected while it still looks valid (revoked,
      // rotated elsewhere, clock skew): get a new one and retry once before
      // giving up on the whole session
      try {
        // A parallel request may already have replaced the token this one was
        // sent with: use that one, and do not refresh (and rotate) again
        if (this.macbid_session_headers["Authorization"] === sentWith) {
          await this.refreshToken();
        }
        res = await this.request(path);
      } catch (error) {
        if (error instanceof MacBidUnavailableError) {
          // Mac.Bid is unreachable: says nothing about the session
          throw error;
        }
        // The refresh was refused too: fall through with the original answer
      }
    }
    if (userSpecific && (res.status === 401 || res.status === 403)) {
      // The session is dead: keeping the tokens would make the next
      // authenticate() reuse them as long as they look unexpired
      this.clearLoginSession();
      throw new MacBidAuthError(
        `Mac.Bid rejected the session (HTTP ${res.status}) for ${path}`,
        { status: res.status }
      );
    }
    if (!res.ok) {
      throw new Error(`Mac.Bid returned HTTP ${res.status} for ${path}`);
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new Error(`Mac.Bid returned a response that is not JSON for ${path}`);
    }
  };

  /** Like getJson, for endpoints that answer with a list. */
  private getJsonArray = async <T>(
    path: string,
    what: string,
    options?: { userSpecific?: boolean }
  ): Promise<T[]> => {
    const body = await this.getJson<unknown>(path, options);
    if (!Array.isArray(body)) {
      throw new Error(
        `Mac.Bid ${what} response is not a list; the API may have changed`
      );
    }
    return body as T[];
  };

  /** The session headers with the caller's headers on top, not instead of them. */
  private withSessionHeaders = (extra?: RequestInit["headers"]): Headers => {
    const headers = new Headers(this.macbid_session_headers);
    new Headers(extra).forEach((value, name) => headers.set(name, value));
    return headers;
  };

  /**
   * Low-level GET with the session's token (refreshed when it has expired). It
   * returns whatever Mac.Bid answers: unlike the \`get_*\` methods it does not
   * retry a rejected token or clear a dead session, and does not throw on 4xx.
   */
  public get = async (
    path: string,
    options?: RequestInit
  ): Promise<MacBidApiResponse> => {
    await this.ensureValidToken();
    return this.request(path, {
      ...options,
      headers: this.withSessionHeaders(options?.headers),
    });
  };

  /** Low-level POST; see \`get\`. Caller headers are added to the session headers. */
  public post = async (
    path: string,
    options?: RequestInit
  ): Promise<MacBidApiResponse> => {
    // Don't refresh token for auth endpoints
    if (!path.includes("/auth/")) {
      await this.ensureValidToken();
    }
    return this.request(path, {
      method: "POST",
      ...options,
      headers: this.withSessionHeaders(options?.headers),
    });
  };

  /**
   * Raise an exception if an endpoint requiring login is called without valid auth
   */
  private check_auth = (): boolean => {
    if (!this.macbid_session_headers["Authorization"]) {
      throw new Error("Not authenticated");
    }
    return true;
  };

  /**
   * Validate the access code and get tokens
   */
  private validateCode = async (
    code: string,
    device_id: string
  ): Promise<boolean> => {
    console.log("Validating code");

    const validation_params = {
      code: code,
      device_id: device_id,
      new_password: "",
      remember_me: false, // Match the browser behavior
    };

    console.log("Sending validation request to /auth/validate-access-code");

    // Use PUT method like the browser does
    const validation_res = await this.request("/auth/validate-access-code", {
      method: "PUT",
      body: JSON.stringify(validation_params),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const validation_resJson = (await this.readAuthJson(validation_res)) as {
      error?: unknown;
      message?: unknown;
      access_token?: string;
      refresh_token?: string;
      user_id?: number;
      expires?: unknown;
      expiration_refresh?: unknown;
    };

    console.log("Validation response status:", validation_res.status);

    const rawError = validation_resJson["error"] || validation_resJson["message"];
    // The error can come as an object or a number: keep it readable
    const errorMessage =
      typeof rawError === "string"
        ? rawError
        : rawError == null
          ? ""
          : JSON.stringify(rawError);
    const hasError = validation_res.status !== 200 ||
                    !!validation_resJson["error"] ||
                    errorMessage.includes("Missing");

    if (hasError) {
      console.error("Validation failed:", errorMessage || validation_res.status);
      if (errorMessage.toLowerCase().includes("already verified")) {
        this.clearLoginSession();
        throw new Error(
          "Validation code was already used. Clear saved auth state and authenticate again to request a new code."
        );
      }
      // Keep the device_id (the SMS is still good) but forget the rejected code,
      // or every later authenticate() would send it again
      delete this.auth_info.validation_code;
      throw new Error(
        `Validation failed: ${errorMessage || `HTTP ${validation_res.status}`}`
      );
    }

    const access_token = validation_resJson["access_token"] as string;
    const refresh_token = validation_resJson["refresh_token"] as string;
    const user_id = validation_resJson["user_id"] as number;

    if (access_token) {
      const token_expiration = this.expiryDate(
        validation_resJson["expires"],
        "expires"
      );
      const refresh_token_expiration = this.expiryDate(
        validation_resJson["expiration_refresh"],
        "expiration_refresh"
      );
      console.log("Access token received, saving tokens...");
      this.auth_info.token = access_token as string;
      this.auth_info.user_id = String(user_id);
      this.macbid_session_headers["Authorization"] = this.auth_info.token;
      this.auth_info.token_expiration = token_expiration;
      this.auth_info.refresh_token = refresh_token;
      this.auth_info.refresh_token_expiration = refresh_token_expiration;
      delete this.auth_info.validation_code;
      console.log("✓ Login successful");
      return true;
    } else {
      console.error("No access token in validation response");
      throw new Error("Login failed: No access token received");
    }
  };

  /**
   * Do the login request using auth_info fields.
   */
  private login = async (): Promise<boolean> => {
    const email = this.auth_info.email;
    const password = this.auth_info.password;
    if (!email || !password) {
      throw new Error("email and password are required to log in");
    }

    const code = this.auth_info.validation_code;

    if (code) {
      const device_id = this.auth_info.device_id;
      if (!device_id) {
        throw new Error("device_id is required to validate a code");
      }
      console.log("Validation code present, attempting to validate...");
      return await this.validateCode(code, device_id);
    }

    if (this.isAwaiting2FA()) {
      throw new Error(
        "A validation code was already sent for this device_id. Provide validation_code to continue."
      );
    }

    const device_id = randomUUID();
    this.auth_info.device_id = device_id;
    // device_id is needed together with the refresh token, so it is not logged
    console.log("Generated new device_id");

    console.log("No validation code found, requesting new code...");
    const login_params = {
      device_id: device_id,
      email: email,
      password: password,
      ref_code: null,
      ref_r: null,
      remember_me: true,
      utm_campaign: null,
      utm_medium: null,
      utm_source: null,
    };
    
    const res = await this.post("/auth/auth-validation", {
      body: JSON.stringify(login_params),
    });

    const resJson = await this.readAuthJson(res);

    if (resJson["message"] === "Login validation code sent") {
      console.log("✓ Validation code sent");
      throw new Error(
        "Validation code sent. Provide validation_code and authenticate again."
      );
    }
    
    // The body is not logged: it can carry account details
    const reason = resJson["error"] ?? resJson["message"];
    throw new Error(
      `Login failed: ${typeof reason === "string" ? reason : `HTTP ${res.status}`}`
    );
  };

  public get_refresh_token_expiration = (): Date => {
    if (this.auth_info.refresh_token_expiration) {
      return this.auth_info.refresh_token_expiration;
    } else {
      throw new Error("Refresh token expiration not set, make sure to login first.");
    }
  }

  /**
   * Check if the access token is expired or about to expire (within 5 minutes)
   */
  private isTokenExpired = (): boolean => {
    if (!this.auth_info.token_expiration) {
      return true;
    }
    // Refresh if token expires within 5 minutes
    const bufferTime = 5 * 60 * 1000; // 5 minutes in milliseconds
    return Date.now() >= this.auth_info.token_expiration.getTime() - bufferTime;
  }

  /**
   * Check if the refresh token is expired
   */
  private isRefreshTokenExpired = (): boolean => {
    if (!this.auth_info.refresh_token_expiration) {
      return true;
    }
    return Date.now() >= this.auth_info.refresh_token_expiration.getTime();
  }

  /**
   * Refresh the access token using the refresh token
   */
  public refreshToken = (): Promise<boolean> => {
    // Refresh tokens rotate: two refreshes at once would make the second one
    // fail with a token the first has just replaced. Share the one in flight.
    this.refreshing ??= this.doRefreshToken().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  };

  private refreshing: Promise<boolean> | undefined;

  private warnedEmptyWatchlist = false;

  private doRefreshToken = async (): Promise<boolean> => {
    if (!this.auth_info.refresh_token) {
      throw new Error("No refresh token available. Please login again.");
    }

    if (this.isRefreshTokenExpired()) {
      throw new Error("Refresh token has expired. Please login again.");
    }

    if (!this.auth_info.device_id) {
      throw new Error(
        "device_id is required to refresh token. Re-authenticate to obtain one."
      );
    }

    const refresh_params = {
      token: this.auth_info.refresh_token,
      device_id: this.auth_info.device_id,
      remember_me: this.auth_info.remember_me ?? true,
    };

    // Bypass get/post so ensureValidToken is not triggered; the browser uses PUT
    const res = await this.request("/auth/refresh-token", {
      method: "PUT",
      body: JSON.stringify(refresh_params),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const resJson = (await this.readAuthJson(res)) as {
      error?: string;
      access_token?: string;
      refresh_token?: string;
      expires?: unknown;
      expiration_refresh?: unknown;
    };

    if (res.status === 400 || res.status === 401 || res.status === 403) {
      // Mac.Bid does not accept this refresh token: the session is over
      this.clearLoginSession();
      throw new MacBidAuthError(
        `Mac.Bid refused the refresh token (HTTP ${res.status})`,
        { status: res.status }
      );
    }

    if (!res.ok || resJson.error) {
      throw new Error(
        `Failed to refresh token: ${resJson.error || res.status}`
      );
    }

    const access_token = resJson["access_token"] as string;
    const refresh_token = resJson["refresh_token"] as string | undefined;
    const expiration_refresh = resJson["expiration_refresh"];

    if (access_token) {
      const token_expiration = this.expiryDate(resJson["expires"], "expires");
      this.auth_info.token = access_token;
      this.macbid_session_headers["Authorization"] = this.auth_info.token;
      this.auth_info.token_expiration = token_expiration;

      // Update refresh token if a new one is provided
      if (refresh_token) {
        this.auth_info.refresh_token = refresh_token;
      }
      if (expiration_refresh) {
        this.auth_info.refresh_token_expiration = this.expiryDate(
          expiration_refresh,
          "expiration_refresh"
        );
      }

      return true;
    } else {
      throw new Error("Failed to refresh token: no access token in response");
    }
  }

  /**
   * Ensure the access token is valid, refreshing if necessary
   */
  private ensureValidToken = async (): Promise<void> => {
    if (this.isTokenExpired()) {
      await this.refreshToken();
    }
  }

  /**
   * Returns the logged in user's favorites, and all of their (visible) attributes.
   */
  public get_watchlist = async (): Promise<WatchlistFull[]> => {
    const body = await this.getJson<{ watchlist_full?: WatchlistFull[] }>(
      `/auctions/customer/${this.requireUserId()}/active-auctions`
    );
    if (body.watchlist_full == null) {
      // An account with nothing on its watchlist may omit the list. Say so in
      // the log (once per client), so a renamed field would not go unnoticed.
      if (!this.warnedEmptyWatchlist) {
        this.warnedEmptyWatchlist = true;
        console.warn(
          "Mac.Bid watchlist response has no watchlist_full; treating it as empty"
        );
      }
      return [];
    }
    if (!Array.isArray(body.watchlist_full)) {
      throw new Error(
        "Mac.Bid watchlist_full is not a list; the API may have changed"
      );
    }
    return body.watchlist_full;
  };

  /**
   * Returns the logged in user's active won items (e.g. awaiting pickup).
   */
  public get_active = async (): Promise<ActiveItem[]> =>
    this.getJsonArray<ActiveItem>(
      `/user/${this.requireUserId()}/active`,
      "active items"
    );

  /**
   * Returns all Mac.Bid warehouse buildings.
   */
  public get_buildings = async (): Promise<Building[]> =>
    this.getJsonArray<Building>("/buildings", "buildings", {
      userSpecific: false,
    });

  /**
   * Returns all Mac.Bid pickup locations.
   */
  public get_locations = async (): Promise<Location[]> =>
    this.getJsonArray<Location>("/locations", "locations", {
      userSpecific: false,
    });
}

export default MacBid;
