export const checkOrigin = (origin: string, allowedOrigins: string[]): boolean => {
  const normalizedOrigin = origin.replace(/\/$/, "");
  return allowedOrigins.some((pattern) => {
    const normalizedPattern = pattern.replace(/\/$/, "");
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
