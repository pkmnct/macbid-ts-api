import fetch, { Response } from "node-fetch";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";

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
  /** True when a 2FA code was sent and we're waiting for the user to provide it */
  pending_2fa?: boolean;
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
  private auth_info: AuthInfo;
  private tokenFilePath?: string;

  constructor(auth_info: AuthInfo, tokenFilePath?: string) {
    this.auth_info = auth_info;
    this.tokenFilePath = tokenFilePath;
    if (tokenFilePath) {
      console.log("MacBid initialized with token file path:", tokenFilePath);
    } else {
      console.log("MacBid initialized without token file path");
    }
    // Don't authenticate in constructor - wait until actually needed
  }

  public authenticate = async () => {
    if (this.auth_info) {
      // If we have a token, use it (will be auto-refreshed if expired)
      if (this.auth_info.token) {
        this.macbid_session_headers["Authorization"] = this.auth_info
          .token as string;
        console.log("Using existing access token");
        // Token will be auto-refreshed by ensureValidToken if needed
        return;
      }
      
      // If we have a refresh token but no access token, try to refresh first
      if (this.auth_info.refresh_token) {
        if (this.isRefreshTokenExpired()) {
          console.log("Refresh token has expired, need to login");
        } else {
          console.log("No access token, attempting to refresh using refresh token");
          try {
            await this.refreshToken();
            console.log("Successfully refreshed token");
            return;
          } catch (error) {
            // If refresh fails, fall through to login
            console.warn("Failed to refresh token, attempting login:", error);
          }
        }
      }
      
      // No valid tokens, need to login
      if (this.auth_info.email && this.auth_info.password) {
        console.log("No valid tokens found, attempting login");
        await this.login(this.auth_info.email, this.auth_info.password);
      } else {
        throw new Error("Invalid auth_info");
      }
    }
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
      this.auth_info.pending_2fa = false;
      await this.saveAuthState();
      console.log("✓ Login successful, tokens saved");
      return true;
    } else {
      console.error("No access token in validation response");
      throw new Error("Login failed: No access token received");
    }
  };

  /**
   * Do the login request
   * @param email - User email
   * @param password - User password
   * @param validation_code - Optional validation code. If not provided, will check auth_info.validation_code
   */
  public login = async (
    email: string,
    password: string,
    validation_code?: string
  ): Promise<boolean> => {
    // Use device_id from: 1) auth_info, 2) environment variable, 3) generate new one
    const device_id = 
      this.auth_info.device_id || 
      process.env.MACBID_DEVICE_ID || 
      randomUUID();
    
    if (!this.auth_info.device_id) {
      this.auth_info.device_id = device_id;
      if (process.env.MACBID_DEVICE_ID) {
        console.log("Using device_id from MACBID_DEVICE_ID environment variable");
      } else {
        console.log("Generated new device_id:", device_id);
      }
    }

    // Get validation code from parameter, auth_info, or env
    const code =
      validation_code ||
      this.auth_info.validation_code ||
      process.env.MACBID_VALIDATION_CODE;

    // If we have a validation code, try to validate it
    // Note: Validation codes expire quickly and are tied to the device_id that requested them
    if (code) {
      console.log("Validation code present, attempting to validate...");
      return await this.validateCode(code, device_id);
    }

    // A code was already sent in a previous session — don't request another one
    if (this.auth_info.pending_2fa) {
      throw new Error(
        "A validation code was already sent for this device.\n" +
        "  1. Check your phone/SMS for the validation code\n" +
        "  2. Add MACBID_VALIDATION_CODE=<code> to your .env file\n" +
        "  3. Restart the application\n" +
        "\nTo request a new code, delete .macbid-tokens.json and restart."
      );
    }

    // No validation code, request one
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
      console.log("✓ Validation code sent to your phone");
      console.log("Please add MACBID_VALIDATION_CODE=<code> to your .env file and restart");
      this.auth_info.pending_2fa = true;
      await this.saveAuthState();
      throw new Error(
        "Validation code sent. Please:\n" +
        "  1. Check your phone/SMS for the validation code\n" +
        "  2. Add MACBID_VALIDATION_CODE=<code> to your .env file\n" +
        "  3. Restart the application\n" +
        "\nThe code will be used automatically on restart."
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

    // Check for error response
    if (resJson["error"]) {
      throw new Error(`Failed to refresh token: ${resJson["error"]}`);
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

      await this.saveAuthState();
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
   * Save auth state to file for persistence across restarts.
   * Persists tokens when available, and always persists device_id / pending_2fa
   * so a 2FA session survives app restarts.
   */
  private saveAuthState = async (): Promise<void> => {
    if (!this.tokenFilePath) {
      console.log("No token file path provided, skipping auth state save");
      return;
    }

    try {
      const tokenData = {
        token: this.auth_info.token,
        refresh_token: this.auth_info.refresh_token,
        token_expiration: this.auth_info.token_expiration?.toISOString(),
        refresh_token_expiration: this.auth_info.refresh_token_expiration?.toISOString(),
        user_id: this.auth_info.user_id,
        device_id: this.auth_info.device_id,
        pending_2fa: this.auth_info.pending_2fa ?? false,
      };

      console.log("Attempting to save auth state to:", this.tokenFilePath);
      await fs.writeFile(this.tokenFilePath, JSON.stringify(tokenData, null, 2), "utf-8");
      console.log("✓ Auth state successfully saved to file:", this.tokenFilePath);
    } catch (error) {
      console.error("✗ Failed to save auth state to", this.tokenFilePath, ":", error);
      throw error;
    }
  };

  /**
   * Load saved auth state from file (tokens, device_id, pending_2fa).
   */
  public static loadTokens = async (tokenFilePath: string): Promise<Partial<AuthInfo> | null> => {
    try {
      const data = await fs.readFile(tokenFilePath, "utf-8");
      const tokenData = JSON.parse(data) as {
        token?: string;
        refresh_token?: string;
        token_expiration?: string;
        refresh_token_expiration?: string;
        user_id?: string;
        device_id?: string;
        pending_2fa?: boolean;
      };

      return {
        token: tokenData.token,
        refresh_token: tokenData.refresh_token,
        token_expiration: tokenData.token_expiration ? new Date(tokenData.token_expiration) : undefined,
        refresh_token_expiration: tokenData.refresh_token_expiration ? new Date(tokenData.refresh_token_expiration) : undefined,
        user_id: tokenData.user_id,
        device_id: tokenData.device_id,
        pending_2fa: tokenData.pending_2fa,
      };
    } catch {
      // File doesn't exist or is invalid, return null
      return null;
    }
  };
}

export default MacBid;
