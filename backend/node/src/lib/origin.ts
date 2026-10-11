export const checkOrigin = (origin: any, allowedOrigins: string[]): boolean => {
  // SENTINEL: Return false early if origin is null, undefined, not a string, or exceeds 512 characters.
  // This mitigates ReDoS risks and prevents runtime crashes from invalid or oversized Origin headers.
  if (!origin || typeof origin !== "string" || origin.length > 512) {
    return false;
  }

  const normalizedOrigin = origin.replace(/\/$/, "");
  return allowedOrigins.some((pattern) => {
    let normalizedPattern = pattern.trim().replace(/\/$/, "");

    // Audit Item: Handle potential quotes from environment variables (e.g., '"http://..."')
    // Sentinel fix: strip quotes even if unbalanced (e.g. from split quoted strings)
    normalizedPattern = normalizedPattern
      .replace(/^['"]/, "")
      .replace(/['"]$/, "");

    let hasProtocol = /^https?:\/\//i.test(normalizedPattern);

    if (normalizedPattern.includes("*")) {
      const regexPattern = normalizedPattern
        .split("*")
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/?#]+");

      const finalRegex = hasProtocol ? `^${regexPattern}$` : `^(https?:\\/\\/)?${regexPattern}$`;
      return new RegExp(finalRegex, "i").test(normalizedOrigin);
    }

    if (hasProtocol) {
      return normalizedPattern.toLowerCase() === normalizedOrigin.toLowerCase();
    } else {
      const originWithoutProtocol = normalizedOrigin.replace(/^https?:\/\//i, '');
      return normalizedPattern.toLowerCase() === originWithoutProtocol.toLowerCase();
    }
  });
};
