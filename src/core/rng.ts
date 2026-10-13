// The seeded PRNG lives in src/config/rng.ts (pure integer maths, so config tables such as the
// campaign builder can draw from it too). Core code and tests keep importing it from here.

export { Rng, hashString, rngFor, splitmix32, xmur3 } from '../config/rng.ts';
