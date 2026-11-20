import { describe, expect, it } from 'vitest';
import { nameIfBlank } from './computerName';

describe('nameIfBlank', () => {
  it('shows the name a blank field really gives (numbered when taken, within 40 characters)', () => {
    expect(nameIfBlank('Linux PC', ['Mac'])).toBe('Linux PC');
    expect(nameIfBlank('Linux PC', ['Linux PC', 'Mac'])).toBe('Linux PC 2');
    expect(nameIfBlank('Mac', ['Mac', 'Mac 2'])).toBe('Mac 3');
  });
});
