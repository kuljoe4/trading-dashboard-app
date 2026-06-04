export const checkOrigin = (origin: string, allowedOrigins: string[]): boolean => {
  const normalizedOrigin = origin.replace(/\/$/, "");
  return allowedOrigins.some((pattern) => {
    let normalizedPattern = pattern.trim().replace(/\/$/, "");

    // Audit Item: Handle potential quotes from environment variables (e.g., '"http://..."')
    if (
      (normalizedPattern.startsWith('"') && normalizedPattern.endsWith('"')) ||
      (normalizedPattern.startsWith("'") && normalizedPattern.endsWith("'"))
    ) {
      normalizedPattern = normalizedPattern.slice(1, -1);
    }

    if (normalizedPattern.includes("*")) {
      const regexPattern = normalizedPattern
        .split("*")
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*");
      return new RegExp(`^${regexPattern}$`).test(normalizedOrigin);
    }
    return normalizedPattern === normalizedOrigin;
  });
};
