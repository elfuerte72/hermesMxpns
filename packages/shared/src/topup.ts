/** Configured topup tier — a fixed-amount Tribute channel the operator creates. */
export interface TopupTier {
  /** Token value added to the OpenRouter spend cap (USD). */
  amount_usd: number;
  /** Private Telegram channel id (negative) for this tier — @tribute manages membership. */
  channel_id: string;
  /** Tribute subscription link the user opens to pay for this tier. */
  subscribe_url: string;
}

/** Tier as shown to the Mini App — the channel id stays server-side. */
export interface TopupTierView {
  amount_usd: number;
  /** User-facing price including the markup (amount_usd × (1 + markup/100)). */
  price_usd: number;
  subscribe_url: string;
}

export interface TopupRequest {
  deploy_id: string;
  amount_usd: number;
}

export interface TopupResponse {
  ok: true;
  /** New absolute spend cap of the managed OpenRouter key (USD). */
  new_limit_usd: number;
}
