ALTER TABLE fine_classification_attempts ADD COLUMN response_hash TEXT;
ALTER TABLE fine_classification_attempts ADD COLUMN validation_status TEXT NOT NULL DEFAULT 'valid'
  CHECK(validation_status IN ('valid','invalid_json','schema_invalid','taxonomy_invalid','timeout','provider_error'));
