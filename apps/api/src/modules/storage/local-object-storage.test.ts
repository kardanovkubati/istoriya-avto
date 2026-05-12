import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "bun:test";
import { LocalObjectStorage } from "./local-object-storage";

describe("LocalObjectStorage", () => {
  it("stores bytes under a generated private key with metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "istoriya-storage-"));

    try {
      const storage = new LocalObjectStorage({ rootDir: dir });
      const expiresAt = new Date("2026-11-08T12:00:00.000Z");
      const result = await storage.putObject({
        namespace: "report-originals",
        bytes: new Uint8Array([37, 80, 68, 70]),
        contentType: "application/pdf",
        originalFileName: "report.pdf",
        expiresAt
      });

      expect(result.key).toMatch(/^report-originals\/\d{4}\/\d{2}\/[a-f0-9-]+\.pdf$/);
      expect(result.sizeBytes).toBe(4);
      expect(result.contentType).toBe("application/pdf");
      expect(result.expiresAt.toISOString()).toBe(expiresAt.toISOString());
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);

      const storedBytes = await readFile(join(dir, result.key));
      expect([...storedBytes]).toEqual([37, 80, 68, 70]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
