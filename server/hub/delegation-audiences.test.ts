import { describe, expect, it } from 'vitest';
import { DelegationAudiences } from './delegation-audiences.ts';

describe('administrator delegation audience map', () => {
  it('accepts explicit empty/no-target configuration and pretty canonical origin maps', () => {
    expect(new DelegationAudiences('{}').forProject('aedilis')).toBeUndefined();
    const config = new DelegationAudiences(' {\n "aedilis": "https://aedilis.example", "Case-Key": "https://other.example:8443"\n} ');
    expect(config.forProject('aedilis')).toBe('https://aedilis.example');
    expect(config.forProject('Case-Key')).toBe('https://other.example:8443');
    expect(config.forProject('case-key')).toBeUndefined();
    expect(config.forProject('unknown')).toBeUndefined();
  });
  it('treats an HTTP origin only as an identifier; Cr remains the final project-specific origin authority', () => {
    expect(new DelegationAudiences('{"cernere-test":"http://localhost:12345"}').forProject('cernere-test')).toBe('http://localhost:12345');
  });
  it('fails fast for missing/malformed/non-map/type/key configuration without echoing input', () => {
    for (const value of [undefined, '', ' ', '{', '[]', 'null', 'true', '"private-value"', '{"a": "https://example.com"}',
      '{"aedilis":null}', '{"aedilis":[]}', '{"aedilis":{"origin":"https://example.com"}}', '{"__proto__":"https://example.com"}',
      ' '.repeat(65537)]) {
      expect(() => new DelegationAudiences(value)).toThrow(/CORPUS_DELEGATION_AUDIENCES/);
    }
  });
  it('rejects duplicate keys even with identical values or escaped spellings', () => {
    for (const value of ['{"aedilis":"https://one.example","aedilis":"https://two.example"}',
      '{"aedilis":"https://one.example","aedilis":"https://one.example"}',
      '{"aedilis":"https://one.example","aedil\\u0069s":"https://two.example"}',
      '{"aedilis":"https:\\/\\/one.example"}']) {
      expect(() => new DelegationAudiences(value)).toThrow(/unique keys and canonical JSON/);
    }
  });
  it('rejects credentials, path/query/fragment, noncanonical origins and non-HTTP schemes', () => {
    for (const origin of ['https://user:private-value@example.com', 'https://example.com/', 'https://example.com/path',
      'https://example.com?value=private-value', 'https://example.com#private-value', 'https://EXAMPLE.com', 'https://example.com:443',
      ' https://example.com', 'javascript:private-value', 'file:///private-value', 'not-an-origin']) {
      let message = '';
      try { new DelegationAudiences(JSON.stringify({ aedilis: origin })); } catch (error) { message = (error as Error).message; }
      expect(message).toContain('CORPUS_DELEGATION_AUDIENCES'); expect(message).not.toContain('private-value');
    }
  });
});
