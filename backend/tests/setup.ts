import path from 'node:path';
import dotenv from 'dotenv';

// Load backend/.env the same way src/config does — resolved against this file rather than the
// working directory, so the suite behaves identically whether vitest is launched from the repo
// root or from backend/. Without this, integration tests fall back to default credentials and
// fail to connect for reasons that look nothing like the real cause.
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Ensures backend/src/config's eager env validation never fails under the test runner, even
// if backend/.env is missing (e.g. a clean CI checkout). The unit tests only need config to
// *load*, not to describe a real deployment; the integration suites additionally need a
// reachable database and say so loudly when they do not have one.
process.env.JWT_SECRET ??= 'test-only-secret-not-for-production-use-0123456789';
process.env.NODE_ENV ??= 'test';
