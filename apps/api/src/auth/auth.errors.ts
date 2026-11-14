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

// Too many wrong passwords: the account is temporarily locked (ADR 0012).
export class AccountLockedError extends Error {
  constructor() {
    super('Too many attempts. Please try again later.');
  }
}

// SUPER_ADMIN must enable two-factor authentication before any login (ADR 0013).
export class TwoFactorSetupRequiredError extends Error {
  constructor() {
    super('Two-factor authentication must be enabled for this account first');
  }
}

// The temporary login step (after the password) is missing, invalid or expired.
export class InvalidLoginChallengeError extends Error {
  constructor() {
    super('This login step has expired. Please sign in again.');
  }
}

// Wrong, reused, or already used authenticator / recovery code.
export class InvalidTwoFactorCodeError extends Error {
  constructor() {
    super('Invalid verification code');
  }
}
