import catalogJson from './catalog.json' with { type: 'json' };
import layoutsJson from './layouts.json' with { type: 'json' };
import { validateContentCatalog, validateContentLayouts } from '../domain/validation.ts';
import type { ValidationResult } from '../domain/types.ts';

function requireValid<T>(result: ValidationResult<T>): T {
  if (!result.ok) throw new Error(result.issues.map(issue => `${issue.path}: ${issue.message}`).join('；'));
  return result.value;
}

export const bundledCatalog = requireValid(validateContentCatalog(catalogJson));
export const bundledLayouts = requireValid(validateContentLayouts(layoutsJson, bundledCatalog));
