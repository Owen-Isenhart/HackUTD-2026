import { readFile, writeFile, rename, rm, chmod } from "node:fs/promises";
import { randomUUID } from "node:crypto";

/** Atomically update only named local runtime settings; never print the content. */
export async function saveRuntimeSettings(settings: Record<string, string>) {
  const path = ".env.deals.runtime.local";
  for (const key of Object.keys(settings))
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key))
      throw new Error("Invalid configuration key");
  const current = await readFile(path, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    },
  );
  const retained = current.split("\n").filter((line) => {
    const key = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=/)?.[1];
    return line.length > 0 && (!key || !(key in settings));
  });
  const content = [
    ...retained,
    ...Object.entries(settings).map(
      ([key, value]) => `${key}=${JSON.stringify(value)}`,
    ),
    "",
  ].join("\n");
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}
