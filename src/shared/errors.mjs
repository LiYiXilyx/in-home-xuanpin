export class AppError extends Error {
  constructor(message, { code = 'APP_ERROR', retriable = false, details = {}, cause } = {}) {
    super(message, { cause });
    this.name = new.target.name;
    this.code = code;
    this.retriable = retriable;
    this.details = details;
  }
}

export class ConfigError extends AppError {
  constructor(message, { fieldPath, cause } = {}) {
    super(message, { code: 'CONFIG_INVALID', details: { fieldPath }, cause });
  }
}

export class MigrationError extends AppError {
  constructor(message, { code = 'MIGRATION_FAILED', details = {}, cause } = {}) {
    super(message, { code, details, cause });
  }
}
