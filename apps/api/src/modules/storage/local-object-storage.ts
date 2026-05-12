import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ObjectStorage, PutObjectInput, StoredObject } from "./object-storage";

export type LocalObjectStorageOptions = {
  rootDir: string;
};

export class LocalObjectStorage implements ObjectStorage {
  constructor(private readonly options: LocalObjectStorageOptions) {}

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    const namespace = normalizeNamespace(input.namespace);
    const extension = normalizeExtension(input.originalFileName);
    const now = new Date();
    const key = `${namespace}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}${extension}`;
    const rootPath = resolve(this.options.rootDir);
    const targetPath = resolve(rootPath, key);

    if (!isPathInsideRoot(rootPath, targetPath)) {
      throw new Error("Invalid storage namespace.");
    }

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

function normalizeNamespace(namespace: string): string {
  if (namespace === "" || isAbsolute(namespace) || namespace.includes("\\")) {
    throw new Error("Invalid storage namespace.");
  }

  const segments = namespace.split("/");

  if (segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))) {
    throw new Error("Invalid storage namespace.");
  }

  return segments.join("/");
}

function isPathInsideRoot(rootPath: string, targetPath: string): boolean {
  const pathFromRoot = relative(rootPath, targetPath);
  return pathFromRoot !== "" && !pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot);
}
