import fetch, { Response } from "node-fetch";

export interface AuthInfo {
  email?: string;
  password?: string;
  token?: string;
  user_id?: string;
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
  public LOGIN_PAGE_URL = "https://www.mac.bid/";
  public API_ROOT = "https://api.macdiscount.com/";

  private macbid_session_headers: { [key: string]: string } = {
    "Content-Type": "application/json",
  };
  private auth_info: AuthInfo;

  constructor(auth_info: AuthInfo) {
    this.auth_info = auth_info;
    this.authenticate();
  }

  public authenticate = async () => {
    if (this.auth_info) {
      if (this.auth_info.token) {
        this.macbid_session_headers["Authorization"] = this.auth_info
          .token as string;
      } else {
        if (this.auth_info.email && this.auth_info.password) {
          await this.login(this.auth_info.email, this.auth_info.password);
        } else {
          throw new Error("Invalid auth_info");
        }
      }
    }
  };

  public get = async (path: string): Promise<MacBidApiResponse> =>
    (await fetch(this.API_ROOT + path, {
      headers: this.macbid_session_headers,
    })) as MacBidApiResponse;

  public post = async (
    path: string,
    options?: RequestInit
  ): Promise<MacBidApiResponse> =>
    (await fetch(this.API_ROOT + path, {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      headers: this.macbid_session_headers,
      method: "POST",
      ...options,
    })) as MacBidApiResponse;

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
   * Do the login request
   */
  public login = async (email: string, password: string): Promise<boolean> => {
    const login_params = {
      email: email,
      password: password,
    };

    const res = await this.post("/token", {
      body: JSON.stringify(login_params),
    });

    const resJson = await res.json();
    const token = resJson["token"];
    const user_id = resJson["user_id"];

    if (token) {
      this.auth_info.token = token as string;
      this.auth_info.user_id = user_id as string;
      this.macbid_session_headers["Authorization"] = this.auth_info.token;

      return true;
    } else {
      throw new Error("Login failed");
    }
  };

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
}

export default MacBid;
