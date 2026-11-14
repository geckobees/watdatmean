// Classify known rejection hints, but never echo provider messages: they can
// contain request code, keys, or other private content.
export function rejectionMessage(status: number, payload: unknown): string {
  if (status === 401 || status === 403)
    return 'API key rejected or model access denied. Configure your provider and key again.';
  if (status === 429)
    return 'Provider quota or rate limit reached. Check billing or wait before retrying.';
  if (status === 400 || status === 404) {
    const error =
      payload && typeof payload === 'object' && 'error' in payload ? payload.error : undefined;
    const data = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
    const hints = ['param', 'code', 'type', 'message']
      .map((key) => (typeof data[key] === 'string' ? data[key].toLowerCase() : ''))
      .join(' ');
    if (hints.includes('reasoning_effort'))
      return 'The provider rejected the reasoning setting for this model. Choose a compatible model.';
    if (hints.includes('model_not_found') || status === 404)
      return 'The requested model was not found or is unavailable to your account. Check your model setting.';
    if (hints.includes('context_length_exceeded'))
      return 'The request exceeded the model’s context limit. Select a smaller block of code.';
    if (hints.includes('json_validate_failed'))
      return 'The model could not produce the required JSON response. Try a smaller selection or a different model.';
    if (hints.includes('response_format') || hints.includes('json_schema'))
      return 'The provider rejected the structured response format for this model. Choose a compatible model.';
    return 'The provider rejected a request setting (HTTP 400). Check your model and provider settings.';
  }
  return `The AI provider returned HTTP ${status}. Please retry later.`;
}
