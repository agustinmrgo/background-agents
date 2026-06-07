import type { Env } from "../types";

type ObjectStoragePutValue = ArrayBuffer | ArrayBufferView | ReadableStream | string;

export type ObjectStoragePutOptions = {
  contentType?: string;
};

export type ObjectStorageRange = {
  offset: number;
  length: number;
};

export type ObjectStorageMetadata = {
  size: number;
  httpEtag: string;
  writeHttpMetadata(headers: Headers): void;
};

export type ObjectStorageObject = ObjectStorageMetadata & {
  body: ReadableStream;
};

export interface ObjectStorage {
  put(key: string, value: ObjectStoragePutValue, options?: ObjectStoragePutOptions): Promise<void>;
  delete(key: string): Promise<void>;
  head(key: string): Promise<ObjectStorageMetadata | null>;
  get(key: string, options?: { range?: ObjectStorageRange }): Promise<ObjectStorageObject | null>;
}

type SupabaseS3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

class S3ObjectMetadata implements ObjectStorageMetadata {
  readonly size: number;
  readonly httpEtag: string;

  constructor(private readonly headers: Headers) {
    this.size = Number(headers.get("content-length") ?? "0");
    this.httpEtag = headers.get("etag") ?? "";
  }

  writeHttpMetadata(headers: Headers): void {
    const contentType = this.headers.get("content-type");
    const cacheControl = this.headers.get("cache-control");
    const contentDisposition = this.headers.get("content-disposition");
    const contentEncoding = this.headers.get("content-encoding");
    const contentLanguage = this.headers.get("content-language");
    const expires = this.headers.get("expires");

    if (contentType) headers.set("Content-Type", contentType);
    if (cacheControl) headers.set("Cache-Control", cacheControl);
    if (contentDisposition) headers.set("Content-Disposition", contentDisposition);
    if (contentEncoding) headers.set("Content-Encoding", contentEncoding);
    if (contentLanguage) headers.set("Content-Language", contentLanguage);
    if (expires) headers.set("Expires", expires);
  }
}

class SupabaseS3ObjectStorage implements ObjectStorage {
  constructor(private readonly config: SupabaseS3Config) {}

  async put(
    key: string,
    value: ObjectStoragePutValue,
    options?: ObjectStoragePutOptions
  ): Promise<void> {
    const body = await toArrayBuffer(value);
    const headers = new Headers();
    if (options?.contentType) headers.set("content-type", options.contentType);

    const response = await this.signedFetch("PUT", key, { headers, body });
    await assertOk(response, "put", key);
  }

  async delete(key: string): Promise<void> {
    const response = await this.signedFetch("DELETE", key);
    await assertOk(response, "delete", key);
  }

  async head(key: string): Promise<ObjectStorageMetadata | null> {
    const response = await this.signedFetch("HEAD", key);
    if (response.status === 404) return null;
    await assertOk(response, "head", key);
    return new S3ObjectMetadata(response.headers);
  }

  async get(
    key: string,
    options?: { range?: ObjectStorageRange }
  ): Promise<ObjectStorageObject | null> {
    const headers = new Headers();
    if (options?.range) {
      const end = options.range.offset + options.range.length - 1;
      headers.set("range", `bytes=${options.range.offset}-${end}`);
    }

    const response = await this.signedFetch("GET", key, { headers });
    if (response.status === 404) return null;
    await assertOk(response, "get", key);
    if (!response.body) throw new Error(`Supabase S3 get returned an empty body for ${key}`);

    return Object.assign(new S3ObjectMetadata(response.headers), { body: response.body });
  }

  private async signedFetch(
    method: "DELETE" | "GET" | "HEAD" | "PUT",
    key: string,
    init: { headers?: Headers; body?: ArrayBuffer } = {}
  ): Promise<Response> {
    const url = this.objectUrl(key);
    const headers = new Headers(init.headers);
    const payloadHash = await sha256Hex(init.body ?? new ArrayBuffer(0));
    const now = new Date();
    const amzDate = toAmzDate(now);

    headers.set("host", url.host);
    headers.set("x-amz-content-sha256", payloadHash);
    headers.set("x-amz-date", amzDate);

    const signedHeaders = [...headers.keys()].map((name) => name.toLowerCase()).sort();
    const canonicalHeaders = signedHeaders
      .map((name) => `${name}:${normalizeHeaderValue(headers.get(name) ?? "")}`)
      .join("\n");
    const credentialDate = amzDate.slice(0, 8);
    const credentialScope = `${credentialDate}/${this.config.region}/s3/aws4_request`;
    const canonicalRequest = [
      method,
      url.pathname,
      url.searchParams.toString(),
      `${canonicalHeaders}\n`,
      signedHeaders.join(";"),
      payloadHash,
    ].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      await sha256Hex(canonicalRequest),
    ].join("\n");
    const signature = await hmacHex(
      await signingKey(this.config.secretAccessKey, credentialDate, this.config.region),
      stringToSign
    );

    headers.set(
      "authorization",
      `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders.join(
        ";"
      )}, Signature=${signature}`
    );

    return fetch(url, { method, headers, body: init.body });
  }

  private objectUrl(key: string): URL {
    const endpoint = this.config.endpoint.replace(/\/+$/, "");
    const url = new URL(`${endpoint}/${encodeS3Path(this.config.bucket)}/${encodeS3Path(key)}`);
    return url;
  }
}

const memoryBuckets = new Map<string, Map<string, { body: ArrayBuffer; headers: Headers }>>();

class MemoryObjectStorage implements ObjectStorage {
  private readonly objects: Map<string, { body: ArrayBuffer; headers: Headers }>;

  constructor(bucket: string) {
    let objects = memoryBuckets.get(bucket);
    if (!objects) {
      objects = new Map();
      memoryBuckets.set(bucket, objects);
    }
    this.objects = objects;
  }

  async put(
    key: string,
    value: ObjectStoragePutValue,
    options?: ObjectStoragePutOptions
  ): Promise<void> {
    const body = await toArrayBuffer(value);
    const headers = new Headers({
      "content-length": String(body.byteLength),
      etag: `"memory-${body.byteLength}"`,
    });
    if (options?.contentType) headers.set("content-type", options.contentType);
    this.objects.set(key, { body, headers });
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async head(key: string): Promise<ObjectStorageMetadata | null> {
    const object = this.objects.get(key);
    return object ? new S3ObjectMetadata(object.headers) : null;
  }

  async get(
    key: string,
    options?: { range?: ObjectStorageRange }
  ): Promise<ObjectStorageObject | null> {
    const object = this.objects.get(key);
    if (!object) return null;

    const start = options?.range?.offset ?? 0;
    const end = options?.range ? start + options.range.length : object.body.byteLength;
    const body = object.body.slice(start, end);
    const headers = new Headers(object.headers);
    headers.set("content-length", String(body.byteLength));

    return Object.assign(new S3ObjectMetadata(headers), { body: new Response(body).body! });
  }
}

export function createMediaObjectStorage(env: Env): ObjectStorage {
  if (env.SUPABASE_S3_ENDPOINT.startsWith("memory://")) {
    return new MemoryObjectStorage(env.SUPABASE_S3_MEDIA_BUCKET);
  }

  return new SupabaseS3ObjectStorage({
    endpoint: env.SUPABASE_S3_ENDPOINT,
    region: env.SUPABASE_S3_REGION,
    bucket: env.SUPABASE_S3_MEDIA_BUCKET,
    accessKeyId: env.SUPABASE_S3_ACCESS_KEY_ID,
    secretAccessKey: env.SUPABASE_S3_SECRET_ACCESS_KEY,
  });
}

async function toArrayBuffer(value: ObjectStoragePutValue): Promise<ArrayBuffer> {
  if (typeof value === "string") return copyArrayBufferView(new TextEncoder().encode(value));
  if (value instanceof ArrayBuffer) return value;
  if (value instanceof ReadableStream) return new Response(value).arrayBuffer();
  return copyArrayBufferView(value);
}

function copyArrayBufferView(value: ArrayBufferView): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  return copy.buffer;
}

async function assertOk(response: Response, operation: string, key: string): Promise<void> {
  if (response.ok) return;
  const body = await response.text().catch(() => "");
  throw new Error(
    `Supabase S3 ${operation} failed for ${key}: ${response.status} ${response.statusText}${
      body ? ` - ${body.slice(0, 500)}` : ""
    }`
  );
}

function encodeS3Path(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function normalizeHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

async function sha256Hex(value: ArrayBuffer | string): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

async function hmacBytes(key: ArrayBuffer | Uint8Array, value: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value));
  return new Uint8Array(signature);
}

async function hmacHex(key: ArrayBuffer | Uint8Array, value: string): Promise<string> {
  return bytesToHex(await hmacBytes(key, value));
}

async function signingKey(secretAccessKey: string, date: string, region: string): Promise<Uint8Array> {
  const dateKey = await hmacBytes(new TextEncoder().encode(`AWS4${secretAccessKey}`), date);
  const dateRegionKey = await hmacBytes(dateKey, region);
  const dateRegionServiceKey = await hmacBytes(dateRegionKey, "s3");
  return hmacBytes(dateRegionServiceKey, "aws4_request");
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
