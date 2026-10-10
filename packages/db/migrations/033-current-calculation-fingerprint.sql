-- Recomputed values keep the same input fingerprint, while stale records remain historical evidence.
ALTER TABLE calculations DROP CONSTRAINT calculations_fingerprint_key;
CREATE UNIQUE INDEX calculation_current_fingerprint ON calculations(fingerprint) WHERE validity='current';
