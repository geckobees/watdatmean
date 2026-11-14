// Classify known failures without displaying provider messages, source, or credentials.
export function rejectionMessage(status: number, payload: unknown): string {
  if (status === 401 || status === 403)
    return 'The provider rejected the API key or access. Check your key and model permissions.';
  if (status === 429)
    return 'The provider rate limit or quota was reached. Check your account and retry later.';
  if (status >= 500) return 'The provider is temporarily unavailable. Please retry later.';
  const error =
    payload && typeof payload === 'object' && 'error' in payload ? payload.error : undefined;
  const details = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  if (
    details.param === 'reasoning_effort' ||
    (typeof details.message === 'string' && details.message.includes('reasoning_effort'))
  )
    return 'The model rejected the reasoning setting. Choose a compatible model.';
  if (details.code === 'model_not_found' || status === 404)
    return 'The model was not found or is unavailable to your account. Check the configured model ID.';
  if (details.param === 'response_format')
    return 'The model rejected the structured response format. Choose a compatible model.';
  if (details.code === 'context_length_exceeded')
    return 'This request exceeds the model context limit. Select a smaller block of code.';
  if (details.code === 'json_validate_failed')
    return 'The model could not produce the required JSON response. Retry or choose a different model.';
  return `The provider rejected a request setting (HTTP ${status}). Check the configured model and try again.`;
}
