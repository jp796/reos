import { env } from "@/lib/env";

export interface DocumensoRecipientInput {
  name: string;
  email: string;
}

export interface DocumensoSendInput {
  title: string;
  externalId: string;
  fileName: string;
  fileBytes: Uint8Array;
  recipients: DocumensoRecipientInput[];
  subject: string;
  message: string;
  redirectUrl?: string;
}

export interface DocumensoSendResult {
  envelopeId: string;
  recipients: Array<{
    id?: number;
    name?: string;
    email?: string;
    role?: string;
    signingOrder?: number;
    signingUrl?: string;
    token?: string;
  }>;
  rawCreate: unknown;
  rawDistribute: unknown;
}

export class DocumensoService {
  static isConfigured() {
    return !!(env.DOCUMENSO_API_URL && env.DOCUMENSO_API_KEY);
  }

  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    if (!env.DOCUMENSO_API_URL || !env.DOCUMENSO_API_KEY) {
      throw new Error("Documenso is not configured");
    }
    this.baseUrl = env.DOCUMENSO_API_URL.replace(/\/$/, "");
    this.apiKey = env.DOCUMENSO_API_KEY;
  }

  async createAndSend(input: DocumensoSendInput): Promise<DocumensoSendResult> {
    const payload = {
      type: "DOCUMENT",
      title: input.title,
      externalId: input.externalId,
      visibility: "EVERYONE",
      recipients: input.recipients.map((r, index) => ({
        email: r.email,
        name: r.name,
        role: "SIGNER",
        signingOrder: index + 1,
      })),
      meta: {
        subject: input.subject,
        message: input.message,
        ...(input.redirectUrl ? { redirectUrl: input.redirectUrl } : {}),
      },
    };

    const form = new FormData();
    form.append("payload", JSON.stringify(payload));
    const fileBytes = new Uint8Array(input.fileBytes);
    const fileBuffer = fileBytes.buffer.slice(
      fileBytes.byteOffset,
      fileBytes.byteOffset + fileBytes.byteLength,
    );
    form.append(
      "files",
      new Blob([fileBuffer], { type: "application/pdf" }),
      input.fileName,
    );

    const createRes = await fetch(`${this.baseUrl}/envelope/create`, {
      method: "POST",
      headers: { Authorization: this.apiKey },
      body: form,
    });
    const rawCreate = await readJsonOrText(createRes);
    if (!createRes.ok) {
      throw new Error(toProviderError("Documenso create failed", rawCreate));
    }

    const envelopeId = readEnvelopeId(rawCreate);
    if (!envelopeId) throw new Error("Documenso did not return an envelope id");

    const distributeRes = await fetch(`${this.baseUrl}/envelope/distribute`, {
      method: "POST",
      headers: {
        Authorization: this.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        envelopeId,
        meta: {
          subject: input.subject,
          message: input.message,
        },
      }),
    });
    const rawDistribute = await readJsonOrText(distributeRes);
    if (!distributeRes.ok) {
      throw new Error(
        toProviderError("Documenso distribute failed", rawDistribute),
      );
    }

    return {
      envelopeId,
      recipients: readDistributedRecipients(rawDistribute),
      rawCreate,
      rawDistribute,
    };
  }
}

async function readJsonOrText(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function readEnvelopeId(raw: unknown) {
  if (raw && typeof raw === "object" && "id" in raw) {
    const id = (raw as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

function readDistributedRecipients(raw: unknown): DocumensoSendResult["recipients"] {
  if (!raw || typeof raw !== "object" || !("recipients" in raw)) return [];
  const recipients = (raw as { recipients?: unknown }).recipients;
  return Array.isArray(recipients)
    ? recipients.filter((r): r is DocumensoSendResult["recipients"][number] => {
        return !!r && typeof r === "object";
      })
    : [];
}

function toProviderError(prefix: string, raw: unknown) {
  if (typeof raw === "string") return `${prefix}: ${raw.slice(0, 500)}`;
  if (raw && typeof raw === "object") {
    const maybeMessage = (raw as { message?: unknown; error?: unknown }).message ??
      (raw as { message?: unknown; error?: unknown }).error;
    if (typeof maybeMessage === "string") return `${prefix}: ${maybeMessage}`;
    return `${prefix}: ${JSON.stringify(raw).slice(0, 500)}`;
  }
  return prefix;
}
