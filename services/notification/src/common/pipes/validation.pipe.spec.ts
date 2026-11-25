import { mapConstraintToCode, formatValidationErrors } from './validation.pipe';

describe('ValidationPipe error mapping', () => {
  it('should correctly map all Document 06 error codes', () => {
    expect(mapConstraintToCode('whitelistValidation')).toBe('UNKNOWN_FIELD');
    expect(mapConstraintToCode('isNotEmpty')).toBe('REQUIRED');
    expect(mapConstraintToCode('isDefined')).toBe('REQUIRED');
    expect(mapConstraintToCode('isString')).toBe('INVALID_TYPE');
    expect(mapConstraintToCode('isNumber')).toBe('INVALID_TYPE');
    expect(mapConstraintToCode('isUuid')).toBe('INVALID_FORMAT');
    expect(mapConstraintToCode('matches')).toBe('INVALID_FORMAT');
    expect(mapConstraintToCode('min')).toBe('OUT_OF_RANGE');
    expect(mapConstraintToCode('maxLength')).toBe('OUT_OF_RANGE');
    expect(mapConstraintToCode('isEnum')).toBe('INVALID_VALUE');
    expect(mapConstraintToCode('isIn')).toBe('INVALID_VALUE');
  });

  it('should format nested validation errors with path', () => {
    const mockErrors: any[] = [
      {
        property: 'amount',
        constraints: {
          matches: 'amount must match regex',
        },
      },
      {
        property: 'recipient',
        children: [
          {
            property: 'accountNumber',
            constraints: {
              isNotEmpty: 'accountNumber should not be empty',
            },
          },
        ],
      },
    ];

    const formatted = formatValidationErrors(mockErrors);
    expect(formatted).toEqual([
      {
        field: 'amount',
        code: 'INVALID_FORMAT',
        message: 'amount must match regex',
      },
      {
        field: 'recipient.accountNumber',
        code: 'REQUIRED',
        message: 'accountNumber should not be empty',
      },
    ]);
  });
});
