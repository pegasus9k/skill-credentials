// Writes the skill reference list into skill_types. Nothing else writes
// that table. Reads simulation/spec/skillTypes.json, checks that every skillId
// is ethers.id(code) and stops on the first mismatch, then inserts or updates
// each skill type and deletes the codes no longer in the file.
//
//   yarn backend:setup      (database settings from backend/.env; DB_NAME=... overrides)
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { ethers } = require("ethers");

const FILE = path.resolve(__dirname, "../simulation/spec/skillTypes.json");

async function main() {
  const { skillTypes } = JSON.parse(fs.readFileSync(FILE, "utf8"));
  for (const t of skillTypes) {
    if (t.skillId !== ethers.id(t.code)) {
      throw new Error(`${t.code}: skillId ${t.skillId} is not ethers.id("${t.code}") = ${ethers.id(t.code)}`);
    }
  }

  const pool = new Pool({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432"),
    database: process.env.DB_NAME || "hei_ecosystem",
    user: process.env.DB_USER || "hei_admin",
    password: process.env.DB_PASSWORD || "hei_local",
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const removed = await client.query("DELETE FROM skill_types WHERE NOT (code = ANY($1))", [skillTypes.map(t => t.code)]);
    for (const t of skillTypes) {
      await client.query(
        `INSERT INTO skill_types (skill_id, code, label, learning_outcomes) VALUES ($1, $2, $3, $4)
         ON CONFLICT (skill_id) DO UPDATE SET code = EXCLUDED.code, label = EXCLUDED.label,
           learning_outcomes = EXCLUDED.learning_outcomes`,
        [t.skillId, t.code, t.label, t.learningOutcomes]
      );
    }
    await client.query("COMMIT");
    const db = (await client.query("SELECT current_database() AS db")).rows[0].db;
    console.log(`skill_types in ${db}: ${skillTypes.length} skill types written, every skill ID checked against ethers.id(code), ${removed.rowCount} removed.`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => {
  console.error("backend:setup failed:", e.message);
  process.exit(1);
});
