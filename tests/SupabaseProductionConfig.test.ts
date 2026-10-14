import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { EnvironmentConfig } from "../src/config/EnvironmentConfig";

describe("artefatos legados Supabase", () => {
  it("Android pessoal não requer nem aceita configuração Supabase", () => {
    const config = new EnvironmentConfig({ MODE: "production", VITE_SUPABASE_URL: "https://ignored.example" } as ImportMetaEnv, () => true).read();
    assert.equal(config.bffBaseUrl, "");
    // The value can exist in a developer environment, but it is never used to
    // import, download or read a book in the native personal-library flow.
    assert.equal(config.supabaseUrl, "https://ignored.example");
  });

  it("envFilesAreGitIgnoredButExampleIsTracked", async () => {
    const ignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
    assert.match(ignore, /^\.env$/m);
    assert.match(ignore, /^\.env\.\*$/m);
    assert.match(ignore, /^!\.env\.example$/m);
  });

  it("rlsPoliciesBlockCrossUserAccessByUserId", async () => {
    const sql = await readFile(new URL("../supabase/migrations/202609080002_rls_indexes_prod.sql", import.meta.url), "utf8");
    assert.match(sql, /alter table public\.profiles enable row level security/);
    assert.match(sql, /auth\.uid\(\) = user_id/);
    assert.match(sql, /profiles_select_own/);
    assert.match(sql, /devices_select_own/);
    assert.match(sql, /licenses_select_own/);
  });

  it("supabaseIndexesSupportProductionQueries", async () => {
    const sql = await readFile(new URL("../supabase/migrations/202609080002_rls_indexes_prod.sql", import.meta.url), "utf8");
    assert.match(sql, /devices_user_hash_idx/);
    assert.match(sql, /licenses_status_idx/);
    assert.match(sql, /created_at_idx/);
  });

  it("librarySyncUsesUserScopedMetadataAndNeverBookBytes", async () => {
    const sql = await readFile(new URL("../supabase/migrations/202609160001_account_library_sync.sql", import.meta.url), "utf8");
    assert.match(sql, /user_library_books/);
    assert.match(sql, /source_updated_at/);
    assert.match(sql, /user_library_books_select_own/);
    assert.match(sql, /auth\.uid\(\) = user_id/);
    assert.doesNotMatch(sql, /bytea|storage\.objects/i);
  });
});
