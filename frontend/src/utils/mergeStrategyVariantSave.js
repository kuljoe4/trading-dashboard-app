/**
 * Build a complete root config when a single strategy variant is edited.
 * The modal normally submits the full root config. This boundary also handles
 * partial/legacy payloads without allowing an omitted variants array to erase
 * the saved variants on the backend.
 */
export function mergeVariantConfigForSave(currentConfig, submittedConfig, variantIndex) {
  const current = currentConfig && typeof currentConfig === 'object' ? currentConfig : {};
  const submitted = submittedConfig && typeof submittedConfig === 'object' ? submittedConfig : {};
  const currentVariants = Array.isArray(current.strategy_variants) ? current.strategy_variants : [];
  const submittedVariants = Array.isArray(submitted.strategy_variants) ? submitted.strategy_variants : [];

  if (!Number.isInteger(variantIndex) || variantIndex < 0) {
    return { ...current, ...submitted };
  }

  const variants = currentVariants.map((variant, index) => {
    const savedVariant = submittedVariants[index];
    return savedVariant && typeof savedVariant === 'object'
      ? { ...variant, ...savedVariant, strategy_variants: [] }
      : variant;
  });

  // Preserve any newly-added variants present in the submitted root payload.
  for (let index = currentVariants.length; index < submittedVariants.length; index += 1) {
    const variant = submittedVariants[index];
    if (variant && typeof variant === 'object') {
      variants.push({ ...variant, strategy_variants: [] });
    }
  }

  // Legacy/modal payloads may contain only the edited variant's flattened config.
  if (!submittedVariants[variantIndex]) {
    const editedVariant = { ...submitted };
    delete editedVariant.strategy_variants;
    delete editedVariant._presetLoaded;
    delete editedVariant._isMergedRootConfig;
    const existing = variants[variantIndex] || {};
    variants[variantIndex] = {
      ...existing,
      ...editedVariant,
      strategy_label: editedVariant.strategy_label || existing.strategy_label || `Variant ${variantIndex + 1}`,
      strategy_variants: [],
    };
  }

  return {
    ...(submittedVariants.length > 0 ? { ...current, ...submitted } : current),
    strategy_variants: variants,
  };
}
