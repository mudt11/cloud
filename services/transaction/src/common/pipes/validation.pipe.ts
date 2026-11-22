import { ValidationPipe, ValidationError } from '@nestjs/common';
import { ValidationException, ErrorDetail } from '../exceptions/app.exception';

/**
 * Maps class-validator constraint names to Document 06 C03 / X02 error detail codes:
 * REQUIRED, INVALID_TYPE, INVALID_FORMAT, OUT_OF_RANGE, UNKNOWN_FIELD, INVALID_VALUE
 */
export function mapConstraintToCode(constraintKey: string): string {
  switch (constraintKey) {
    case 'whitelistValidation':
      return 'UNKNOWN_FIELD';

    case 'isNotEmpty':
    case 'isDefined':
      return 'REQUIRED';

    case 'isString':
    case 'isNumber':
    case 'isBoolean':
    case 'isArray':
    case 'isObject':
    case 'isInt':
      return 'INVALID_TYPE';

    case 'isUuid':
    case 'matches':
    case 'isEmail':
    case 'isIso8601':
    case 'isDateString':
    case 'isUrl':
    case 'isPostalCode':
    case 'isAlphanumeric':
    case 'isAlpha':
      return 'INVALID_FORMAT';

    case 'min':
    case 'max':
    case 'minLength':
    case 'maxLength':
    case 'length':
    case 'arrayMinSize':
    case 'arrayMaxSize':
    case 'minDate':
    case 'maxDate':
      return 'OUT_OF_RANGE';

    case 'isEnum':
    case 'isIn':
      return 'INVALID_VALUE';

    default: {
      const lower = constraintKey.toLowerCase();
      if (lower.includes('empty') || lower.includes('defined'))
        return 'REQUIRED';
      if (lower.includes('type')) return 'INVALID_TYPE';
      if (
        lower.includes('format') ||
        lower.includes('match') ||
        lower.includes('uuid')
      )
        return 'INVALID_FORMAT';
      if (
        lower.includes('min') ||
        lower.includes('max') ||
        lower.includes('range') ||
        lower.includes('length')
      )
        return 'OUT_OF_RANGE';
      if (lower.includes('enum') || lower.includes('in'))
        return 'INVALID_VALUE';
      return 'INVALID_FORMAT';
    }
  }
}

/**
 * Recursively formats ValidationError trees into flat ErrorDetail[]
 */
export function formatValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): ErrorDetail[] {
  const details: ErrorDetail[] = [];

  for (const error of errors) {
    const fieldPath = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;

    if (error.constraints) {
      for (const [constraintKey, message] of Object.entries(
        error.constraints,
      )) {
        details.push({
          field: fieldPath,
          code: mapConstraintToCode(constraintKey),
          message,
        });
      }
    }

    if (error.children && error.children.length > 0) {
      details.push(...formatValidationErrors(error.children, fieldPath));
    }
  }

  return details;
}

export function createGlobalValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors: ValidationError[]) => {
      const details = formatValidationErrors(errors);
      return new ValidationException('Dữ liệu yêu cầu không hợp lệ', details);
    },
  });
}
