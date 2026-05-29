import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { getPrimaryD1Binding, parseWranglerConfig } from "./d1-config.mjs";

const config = parseWranglerConfig(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const databaseName = getPrimaryD1Binding(config).database_name;

if (!databaseName) {
  throw new Error("Cannot apply D1 migrations because database_name is missing in wrangler.jsonc");
}

execFileSync("wrangler", ["d1", "migrations", "apply", databaseName, "--remote"], {
  env: process.env,
  stdio: "inherit"
});
