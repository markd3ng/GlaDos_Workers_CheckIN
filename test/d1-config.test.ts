import { describe, expect, it } from "vitest";

describe("D1 workflow config helpers", () => {
  it("prefers provided database id and patches the D1 binding", async () => {
    const { patchD1Binding, resolveProvidedDatabaseId } = await import("../scripts/d1-config.mjs");
    const config = baseConfig();

    expect(resolveProvidedDatabaseId({ CLOUDFLARE_D1_DATABASE_ID: "11111111-1111-1111-1111-111111111111" })).toBe(
      "11111111-1111-1111-1111-111111111111"
    );
    expect(patchD1Binding(config, "custom-db", "11111111-1111-1111-1111-111111111111").d1_databases[0]).toMatchObject({
      database_name: "custom-db",
      database_id: "11111111-1111-1111-1111-111111111111"
    });
  });

  it("ignores placeholder ids and can find or extract real database ids", async () => {
    const { extractDatabaseId, findDatabaseIdByName, resolveProvidedDatabaseId } = await import("../scripts/d1-config.mjs");

    expect(resolveProvidedDatabaseId({ CLOUDFLARE_D1_DATABASE_ID: "00000000-0000-0000-0000-000000000000" })).toBeUndefined();
    expect(
      findDatabaseIdByName(
        JSON.stringify([{ name: "glados-checkin", uuid: "22222222-2222-2222-2222-222222222222" }]),
        "glados-checkin"
      )
    ).toBe("22222222-2222-2222-2222-222222222222");
    expect(extractDatabaseId("created database 33333333-3333-3333-3333-333333333333")).toBe(
      "33333333-3333-3333-3333-333333333333"
    );
    expect(
      extractDatabaseId(`
[[d1_databases]]
binding = "DB"
database_name = "glados-checkin"
database_id = "44444444-4444-4444-4444-444444444444"
`)
    ).toBe("44444444-4444-4444-4444-444444444444");
  });

  it("uses an environment database name before falling back to wrangler config", async () => {
    const { resolveDatabaseName } = await import("../scripts/d1-config.mjs");

    expect(resolveDatabaseName(baseConfig(), { CLOUDFLARE_D1_DATABASE_NAME: "from-env" })).toBe("from-env");
    expect(resolveDatabaseName(baseConfig(), {})).toBe("glados-checkin");
  });
});

function baseConfig() {
  return {
    d1_databases: [
      {
        binding: "CHECKIN_DB",
        database_name: "glados-checkin",
        database_id: "00000000-0000-0000-0000-000000000000"
      }
    ]
  };
}
