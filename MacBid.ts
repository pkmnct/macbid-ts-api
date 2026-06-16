import fetch, { Response } from "node-fetch";
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

export interface MacBidApiResponse extends Response {
  json: () => Promise<{
    [key: string]: unknown;
  }>;
}

export class MacBid {
  public LOGIN_PAGE_URL = "https://www.mac.bid";
  public API_ROOT = "https://api.macdiscount.com";

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
        try {
          await this.refreshToken();
          return this.getAuthState();
        } catch (error) {
          console.warn("Failed to refresh token, attempting login:", error);
          this.clearLoginSession();
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
        try {
          await this.refreshToken();
          console.log("Successfully refreshed token");
          return this.getAuthState();
        } catch (error) {
          console.warn("Failed to refresh token, attempting login:", error);
          this.clearLoginSession();
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

  public get = async (path: string): Promise<MacBidApiResponse> => {
    await this.ensureValidToken();
    return (await fetch(this.API_ROOT + path, {
      headers: this.macbid_session_headers,
    })) as MacBidApiResponse;
  };

  public post = async (
    path: string,
    options?: RequestInit
  ): Promise<MacBidApiResponse> => {
    // Don't refresh token for auth endpoints
    if (!path.includes("/auth/")) {
      await this.ensureValidToken();
    }
    return (await fetch(this.API_ROOT + path, {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      headers: this.macbid_session_headers,
      method: "POST",
      ...options,
    })) as MacBidApiResponse;
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
    console.log("Validating code with device_id:", device_id);

    const validation_params = {
      code: code,
      device_id: device_id,
      new_password: "",
      remember_me: false, // Match the browser behavior
    };

    console.log("Sending validation request to /auth/validate-access-code");

    // Use PUT method like the browser does
    const validation_res = await fetch(this.API_ROOT + "/auth/validate-access-code", {
      method: "PUT",
      body: JSON.stringify(validation_params),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const validation_resJson = (await validation_res.json()) as {
      error?: string;
      message?: string;
      access_token?: string;
      refresh_token?: string;
      user_id?: number;
      expires?: number;
      expiration_refresh?: number;
    };

    console.log("Validation response status:", validation_res.status);

    const errorMessage = validation_resJson["error"] || validation_resJson["message"] || "";
    const hasError = validation_res.status !== 200 || 
                    !!validation_resJson["error"] || 
                    (typeof errorMessage === "string" && errorMessage.includes("Missing"));
    
    if (hasError) {
      console.error("Validation failed:", errorMessage || validation_res.status);
      if (errorMessage.toLowerCase().includes("already verified")) {
        this.clearLoginSession();
        throw new Error(
          "Validation code was already used. Clear saved auth state and authenticate again to request a new code."
        );
      }
      throw new Error(`Validation failed: ${errorMessage || "Unknown error"}`);
    }

    const access_token = validation_resJson["access_token"] as string;
    const refresh_token = validation_resJson["refresh_token"] as string;
    const user_id = validation_resJson["user_id"] as number;
    const expires = validation_resJson["expires"] as number;
    const expiration_refresh = validation_resJson["expiration_refresh"] as number;

    if (access_token) {
      console.log("Access token received, saving tokens...");
      this.auth_info.token = access_token as string;
      this.auth_info.user_id = String(user_id);
      this.macbid_session_headers["Authorization"] = this.auth_info.token;
      this.auth_info.token_expiration = new Date(expires * 1000);
      this.auth_info.refresh_token = refresh_token;
      this.auth_info.refresh_token_expiration = new Date(expiration_refresh * 1000);
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
    console.log("Generated new device_id:", device_id);

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

    const resJson = await res.json();

    if (resJson["message"] === "Login validation code sent") {
      console.log("✓ Validation code sent");
      throw new Error(
        "Validation code sent. Provide validation_code and authenticate again."
      );
    }
    
    console.error("Unexpected login response:", JSON.stringify(resJson, null, 2));
    throw new Error("Login failed");
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
  public refreshToken = async (): Promise<boolean> => {
    if (!this.auth_info.refresh_token) {
      throw new Error("No refresh token available. Please login again.");
    }

    if (this.isRefreshTokenExpired()) {
      throw new Error("Refresh token has expired. Please login again.");
    }

    const refresh_params = {
      refresh_token: this.auth_info.refresh_token,
    };

    // Use fetch directly to avoid triggering ensureValidToken and use PUT method
    const res = await fetch(this.API_ROOT + "/auth/refresh-token", {
      method: "PUT",
      body: JSON.stringify(refresh_params),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const resJson = (await res.json()) as {
      error?: string;
      access_token?: string;
      refresh_token?: string;
      expires?: number;
      expiration_refresh?: number;
    };

    if (!res.ok || resJson.error) {
      throw new Error(
        `Failed to refresh token: ${resJson.error || res.status}`
      );
    }

    const access_token = resJson["access_token"] as string;
    const refresh_token = resJson["refresh_token"] as string | undefined;
    const expires = resJson["expires"] as number;
    const expiration_refresh = resJson["expiration_refresh"] as number | undefined;

    if (access_token) {
      this.auth_info.token = access_token;
      this.macbid_session_headers["Authorization"] = this.auth_info.token;
      this.auth_info.token_expiration = new Date(expires * 1000);

      // Update refresh token if a new one is provided
      if (refresh_token) {
        this.auth_info.refresh_token = refresh_token;
      }
      if (expiration_refresh) {
        this.auth_info.refresh_token_expiration = new Date(expiration_refresh * 1000);
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
    this.check_auth();
    const res = await this.get(
      `/auctions/customer/${this.auth_info["user_id"]}/active-auctions`
    );

    return (await res.json())["watchlist_full"] as WatchlistFull[];
  };

  /**
   * Returns the logged in user's active won items (e.g. awaiting pickup).
   */
  public get_active = async (): Promise<ActiveItem[]> => {
    this.check_auth();
    const res = await this.get(`/user/${this.auth_info["user_id"]}/active`);

    return (await res.json()) as unknown as ActiveItem[];
  };

  /**
   * Returns all Mac.Bid warehouse buildings.
   */
  public get_buildings = async (): Promise<Building[]> => {
    this.check_auth();
    const res = await this.get("/buildings");

    return (await res.json()) as unknown as Building[];
  };

  /**
   * Returns all Mac.Bid pickup locations.
   */
  public get_locations = async (): Promise<Location[]> => {
    this.check_auth();
    const res = await this.get("/locations");

    return (await res.json()) as unknown as Location[];
  };
}

export default MacBid;
