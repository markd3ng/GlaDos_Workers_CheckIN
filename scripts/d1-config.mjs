import { randomUUID } from "node:crypto";

export const PLACEHOLDER_DATABASE_ID = "00000000-0000-0000-0000-000000000000";

export function stripJsonComments(input) {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

export function parseWranglerConfig(input) {
  return JSON.parse(stripJsonComments(input));
}

export function getPrimaryD1Binding(config) {
  const databases = Array.isArray(config.d1_databases) ? config.d1_databases : [];
  const binding = databases.find((database) => database?.binding === "CHECKIN_DB") ?? databases[0];
  if (!binding) {
    throw new Error("wrangler.jsonc must include a D1 binding named CHECKIN_DB");
  }
  return binding;
}

export function resolveDatabaseName(config, env = process.env) {
  const configuredName = getPrimaryD1Binding(config).database_name;
  return (
    nonEmpty(env.CLOUDFLARE_D1_DATABASE_NAME) ??
    nonEmpty(env.CHECKIN_D1_DATABASE_NAME) ??
    nonEmpty(configuredName) ??
    `glados-checkin-${randomUUID().slice(0, 8)}`
  );
}

export function resolveProvidedDatabaseId(env = process.env) {
  const id = nonEmpty(env.CLOUDFLARE_D1_DATABASE_ID) ?? nonEmpty(env.CHECKIN_D1_DATABASE_ID);
  return id && id !== PLACEHOLDER_DATABASE_ID ? id : undefined;
}

export function findDatabaseIdByName(listOutput, databaseName) {
  const parsed = JSON.parse(listOutput);
  const candidates = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.result)
      ? parsed.result
      : Array.isArray(parsed.results)
        ? parsed.results
        : Array.isArray(parsed.d1_databases)
          ? parsed.d1_databases
          : [];

  const match = candidates.find((database) => database?.name === databaseName || database?.database_name === databaseName);
  return extractDatabaseId(match);
}

export function extractDatabaseId(value) {
  if (!value) {
    return undefined;
  }
  if (typeof value === "string") {
    return value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  }
  return (
    nonEmpty(value.uuid) ??
    nonEmpty(value.id) ??
    nonEmpty(value.database_id) ??
    nonEmpty(value.databaseId) ??
    extractDatabaseId(JSON.stringify(value))
  );
}

export function patchD1Binding(config, databaseName, databaseId) {
  const next = structuredClone(config);
  const binding = getPrimaryD1Binding(next);
  binding.database_name = databaseName;
  binding.database_id = databaseId;
  return next;
}

export function formatConfig(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
