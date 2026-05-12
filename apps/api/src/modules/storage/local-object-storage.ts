import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import type { ObjectStorage, PutObjectInput, StoredObject } from "./object-storage";

export type LocalObjectStorageOptions = {
  rootDir: string;
};

export class LocalObjectStorage implements ObjectStorage {
  constructor(private readonly options: LocalObjectStorageOptions) {}

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    const extension = normalizeExtension(input.originalFileName);
    const now = new Date();
    const key = `${input.namespace}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}${extension}`;
    const targetPath = join(this.options.rootDir, key);

    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, input.bytes);

    return {
      key,
      sizeBytes: input.bytes.byteLength,
      contentType: input.contentType,
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
      expiresAt: input.expiresAt
    };
  }
}

function normalizeExtension(fileName: string): string {
  const extension = extname(fileName).toLowerCase();
  return extension === ".pdf" ? ".pdf" : ".bin";
}
