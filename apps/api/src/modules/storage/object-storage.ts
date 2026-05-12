export type PutObjectInput = {
  namespace: string;
  bytes: Uint8Array;
  contentType: string;
  originalFileName: string;
  expiresAt: Date;
};

export type StoredObject = {
  key: string;
  sizeBytes: number;
  contentType: string;
  sha256: string;
  expiresAt: Date;
};

export interface ObjectStorage {
  putObject(input: PutObjectInput): Promise<StoredObject>;
}
