import { ApiError } from './api';

const LLM_KEY_ERROR_MESSAGES: Record<string, string> = {
  invalid_key: 'Ключ не подошёл — провайдер его отклонил',
  no_balance: 'На ключе нет средств или исчерпан лимит запросов',
  model_unavailable: 'Модель недоступна на этом провайдере',
  provider_incompatible: 'Провайдер не поддерживает функции, нужные агенту',
  provider_unreachable: 'Провайдер сейчас недоступен, попробуйте позже',
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Что-то пошло не так';
}

export function llmKeyErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.code && LLM_KEY_ERROR_MESSAGES[err.code]) {
    return LLM_KEY_ERROR_MESSAGES[err.code];
  }
  return errorMessage(err);
}
