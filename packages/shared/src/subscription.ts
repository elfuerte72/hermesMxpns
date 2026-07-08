export type SubscriptionStatus = 'active' | 'expired' | 'none';

export interface SubscriptionStatusResponse {
  subscription_status: SubscriptionStatus;
  subscription_until: string | null;
}

/**
 * Telegram ChatMember statuses that count as an active channel subscription.
 * `restricted` is still a channel member (with limits), so it stays active.
 * Source: Bot API ChatMember union — creator/administrator/member/restricted/left/kicked.
 */
const ACTIVE_MEMBER_STATUSES = new Set(['creator', 'administrator', 'member', 'restricted']);

/**
 * Map a Telegram `ChatMember.status` to a subscription status. Used by both the
 * `chat_member` update handler (BotService) and the live `getChatMember` check
 * (SubscriptionService) so the mapping stays in one place.
 */
export function membershipStatusToSubscription(chatMemberStatus: string): SubscriptionStatus {
  if (ACTIVE_MEMBER_STATUSES.has(chatMemberStatus)) return 'active';
  if (chatMemberStatus === 'left' || chatMemberStatus === 'kicked') return 'expired';
  return 'none';
}
