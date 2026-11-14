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

// The account belongs to a client that is SUSPENDED or ARCHIVED (ADR 0016).
export class ClientInactiveError extends Error {
  constructor() {
    super('This client account is not active. Please contact the agency.');
  }
}

// The step "choose a new password" is missing, invalid, expired or already done.
export class InvalidPasswordChangeError extends Error {
  constructor() {
    super('This step has expired. Please sign in again.');
  }
}

// The new password does not follow the password policy.
export class WeakPasswordError extends Error {
  constructor(readonly reason: string) {
    super(`The new password ${reason}`);
  }
}

// The new password is the same as the temporary one.
export class PasswordReusedError extends Error {
  constructor() {
    super('The new password must be different from the temporary password');
  }
}
