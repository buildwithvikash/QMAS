import { Algorithm, hash, verify } from '@node-rs/argon2';

// OWASP-recommended argon2id parameters (19 MiB, 2 iterations).
const OPTIONS = { algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const hashPassword = (plain) => hash(plain, OPTIONS);

export async function verifyPassword(hashed, plain) {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

// Verifying against this keeps the response time the same when the employee code does not exist.
let dummyHash;
export async function burnPasswordCheck(plain) {
  dummyHash ??= await hashPassword('qmas-timing-equaliser-0');
  await verifyPassword(dummyHash, plain);
}

/** Password rules that need user context (the generic rules live in the shared zod schema). */
export function passwordProblems(plain, { employeeCode }) {
  if (employeeCode && plain.toLowerCase().includes(String(employeeCode).toLowerCase())) {
    return 'The password must not contain your employee code.';
  }
  return null;
}
