// Expected authentication failures. Messages are generic on purpose:
// they never reveal whether an email exists.

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid email or password');
  }
}

export class AccountSuspendedError extends Error {
  constructor() {
    super('This account is suspended');
  }
}

export class InvalidSessionError extends Error {
  constructor() {
    super('Session is invalid or expired');
  }
}

// A refresh token that was already used came back: it may have been stolen.
// Same public message as InvalidSessionError.
export class RefreshTokenReuseError extends InvalidSessionError {}
