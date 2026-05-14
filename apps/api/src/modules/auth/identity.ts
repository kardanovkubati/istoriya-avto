export type AuthProvider = "phone" | "telegram" | "max";

export type NormalizedIdentity = {
  provider: AuthProvider;
  providerUserId: string;
};

export function normalizeIdentity(input: {
  provider: AuthProvider;
  providerUserId: string;
}): NormalizedIdentity {
  if (input.provider === "phone") {
    return {
      provider: input.provider,
      providerUserId: normalizePhone(input.providerUserId)
    };
  }

  const providerUserId = input.providerUserId.trim();
  if (providerUserId.length === 0) {
    throw new Error("invalid_identity");
  }

  return {
    provider: input.provider,
    providerUserId
  };
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("8")) {
    return `+7${digits.slice(1)}`;
  }

  if (digits.length === 11 && digits.startsWith("7")) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `+7${digits}`;
  }

  throw new Error("invalid_identity");
}
