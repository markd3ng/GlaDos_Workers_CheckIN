import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import {
  extractDatabaseId,
  findDatabaseIdByName,
  formatConfig,
  parseWranglerConfig,
  patchD1Binding,
  resolveDatabaseName,
  resolveProvidedDatabaseId
} from "./d1-config.mjs";

const configPath = new URL("../wrangler.jsonc", import.meta.url);
const config = parseWranglerConfig(readFileSync(configPath, "utf8"));
const databaseName = resolveDatabaseName(config);
const databaseId = resolveProvidedDatabaseId() ?? findExistingDatabase(databaseName) ?? createDatabase(databaseName);

writeFileSync(configPath, formatConfig(patchD1Binding(config, databaseName, databaseId)));
console.log(`Prepared D1 database "${databaseName}" (${databaseId})`);

function findExistingDatabase(databaseName) {
  try {
    const output = runWrangler(["d1", "list", "--json"]);
    const databaseId = findDatabaseIdByName(output, databaseName);
    if (databaseId) {
      console.log(`Found existing D1 database "${databaseName}" (${databaseId})`);
    }
    return databaseId;
  } catch (error) {
    console.warn(`Could not list D1 databases: ${error.message}`);
    return undefined;
  }
}

function createDatabase(databaseName) {
  const output = runWrangler(["d1", "create", databaseName]);
  const databaseId = extractDatabaseId(output);
  if (!databaseId) {
    throw new Error(`Could not determine database_id after creating D1 database "${databaseName}"`);
  }
  console.log(`Created D1 database "${databaseName}" (${databaseId})`);
  return databaseId;
}

function runWrangler(args) {
  return execFileSync("wrangler", args, {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
}
