// Ensures backend/src/config's eager env validation never fails under the test runner, even
// if backend/.env is missing (e.g. a clean CI checkout). Real integration behaviour is covered
// by scripts/smoke.mjs and scripts/smoke-socket.mjs against a fully configured, running server;
// these unit tests only need config to *load*, not to describe a real deployment.
process.env.JWT_SECRET ??= 'test-only-secret-not-for-production-use-0123456789';
process.env.NODE_ENV ??= 'test';
