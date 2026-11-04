import fs from "node:fs";
import promises from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { createGunzip } from "node:zlib";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expected = JSON.parse(
  await promises.readFile(path.join(root, "database-release.json"), "utf8"),
);
const target =
  process.env.STORYSPRING_DATABASE ||
  path.join(root, "server/data/materials.sqlite");

async function checksum(filename) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

async function prepare() {
  try {
    if ((await checksum(target)) === expected.sqliteSha256) {
      console.log("The verified material database is ready.");
      return;
    }
    throw new Error(
      "The existing database does not match this release. Keep it and choose a new database path.",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  let input;
  const archiveIndex = process.argv.indexOf("--archive");
  if (archiveIndex >= 0) {
    // Local archives support offline setup and reproducible verification.
    if (!process.argv[archiveIndex + 1])
      throw new Error("Supply the local .gz archive path.");
    input = fs.createReadStream(process.argv[archiveIndex + 1]);
  } else {
    const address = process.env.MATERIALS_DOWNLOAD_URL;
    if (!address || new URL(address).protocol !== "https:") {
      throw new Error(
        "Set MATERIALS_DOWNLOAD_URL to the HTTPS download URL of the database release asset.",
      );
    }
    const response = await fetch(address, {
      signal: AbortSignal.timeout(240_000),
    });
    if (!response.ok || !response.body)
      throw new Error(`Database download failed (${response.status}).`);
    input = Readable.fromWeb(response.body);
  }

  await promises.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  const hash = createHash("sha256");
  let bytes = 0;
  const verify = new Transform({
    transform(chunk, encoding, callback) {
      bytes += chunk.length;
      if (bytes > expected.sqliteBytes)
        return callback(new Error("The database exceeds the expected size."));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      input,
      createGunzip(),
      verify,
      fs.createWriteStream(temporary, { flags: "wx" }),
    );
    if (
      bytes !== expected.sqliteBytes ||
      hash.digest("hex") !== expected.sqliteSha256
    ) {
      throw new Error(
        "Database integrity verification failed. The downloaded file was not installed.",
      );
    }
    await promises.rename(temporary, target);
    console.log(`Installed and verified ${expected.records} material records.`);
  } finally {
    // Remove only this invocation's temporary file; preserve any existing database.
    await promises.rm(temporary, { force: true });
  }
}

prepare().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
