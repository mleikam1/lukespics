export class ProviderRetryAuthorizationError extends Error {
  constructor(readonly authorizationCause: unknown) {
    super("Sports provider retry authorization failed.");
    this.name = "ProviderRetryAuthorizationError";
  }
}
