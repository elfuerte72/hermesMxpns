export interface TmaUser {
  id: string;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

export interface AuthenticatedUser {
  telegram_id: string;
  username: string | null;
}

export interface ValidateInitResponse {
  user: AuthenticatedUser;
}

export interface ValidateBotTokenRequest {
  bot_token: string;
}

export interface ValidateBotTokenResponse {
  username: string;
  id: number;
}
