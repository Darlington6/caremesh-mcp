// Side-effect-only module: loads .env into process.env. Deliberately has no imports of its own,
// and must be the *first* import in any module that reads process.env at its own top level —
// ES module imports evaluate before the importing file's own code, regardless of where a
// same-file "load .env" statement is textually placed, so loading it from inside server.ts
// alone is NOT early enough for modules it transitively imports (e.g. bedrock.ts's
// module-level AWS_REGION/BEDROCK_MODEL_ID constants). A module is only ever evaluated once,
// so importing this from multiple files is safe and cheap.
try {
  process.loadEnvFile();
} catch {
  // no .env file present — fine, fall back to whatever's already in the environment
}
