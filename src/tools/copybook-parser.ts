import { z } from 'zod';

const CopybookParserSchema = z.object({
  copybook: z.string().min(1).describe('COBOL copybook source code'),
  options: z.object({
    detectPii: z.boolean().optional().default(true),
    generateSchema: z.boolean().optional().default(true),
    classifyFields: z.boolean().optional().default(true)
  }).optional()
});

const PII_PATTERNS = {
  ssn: /SSN|SOCIAL.*SECURITY|\b\d{3}-\d{2}-\d{4}\b/i,
  creditCard: /CREDIT.*CARD|CARD.*NUM|CCNUM|\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/i,
  email: /EMAIL|E-MAIL|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/i,
  phone: /PHONE|TEL|MOBILE|\b\d{3}[\s-]?\d{3}[\s-]?\d{4}\b/i,
  bankAccount: /ACCOUNT.*NUM|BANK.*ACCT|ACCT.*NO/i,
  taxId: /TIN|TAX.*ID|EIN|EMPLOYER.*ID/i,
  dob: /BIRTH.*DATE|DOB|DATE.*BIRTH/i,
  address: /ADDRESS|STREET|CITY|STATE|ZIP/i
};

const COMPLIANCE_MAPPINGS: Record<string, string[]> = {
  ssn: ['GDPR', 'CCPA', 'PII'],
  creditCard: ['PCI-DSS', 'GDPR'],
  email: ['GDPR', 'CCPA', 'CAN-SPAM'],
  phone: ['GDPR', 'TCPA'],
  bankAccount: ['PCI-DSS', 'GDPR', 'SOX'],
  taxId: ['GDPR', 'IRS'],
  dob: ['GDPR', 'CCPA', 'COPPA'],
  address: ['GDPR', 'CCPA']
};

function parsePicClause(pic: string): { type: string; length: number; decimals?: number } {
  const match = pic.match(/PIC\s+([9XASV$]+)(?:\((\d+)\))?/i);
  if (!match) return { type: 'UNKNOWN', length: 0 };

  const pattern = match[1];
  const length = parseInt(match[2]) || 1;

  if (pattern.includes('9')) {
    if (pattern.includes('V')) {
      const decimals = (pattern.match(/9/g) || []).length - 1;
      return { type: 'DECIMAL', length, decimals };
    }
    return { type: 'INTEGER', length };
  }
  if (pattern.includes('X')) return { type: 'STRING', length };
  if (pattern.includes('A')) return { type: 'ALPHABETIC', length };
  if (pattern.includes('S')) return { type: 'SIGNED', length };

  return { type: 'UNKNOWN', length };
}

function detectPii(fieldName: string, picClause: string): { isPii: boolean; piiType?: string; confidence: number } {
  const upperName = fieldName.toUpperCase();
  
  for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
    if (pattern.test(upperName) || pattern.test(picClause)) {
      return { isPii: true, piiType: type, confidence: 0.9 };
    }
  }

  // Heuristic detection
  if (upperName.includes('ID') || upperName.includes('NUM')) {
    return { isPii: true, piiType: 'identifier', confidence: 0.5 };
  }

  return { isPii: false, confidence: 0 };
}

function parseCopybook(copybook: string): any {
  const lines = copybook.split('\n');
  const fields: any[] = [];
  let currentLevel = 0;
  let offset = 0;

  for (const line of lines) {
    // Parse COBOL field definition
    const match = line.match(/(\d+)\s+(\S+)\s+(.+?)(?:\.|$)/);
    if (!match) continue;

    const level = parseInt(match[1]);
    const name = match[2];
    const rest = match[3];

    // Parse PIC clause
    const picMatch = rest.match(/PIC\s+([^\.]+)/i);
    const picClause = picMatch ? picMatch[1].trim() : '';

    // Parse OCCURS
    const occursMatch = rest.match(/OCCURS\s+(\d+)/i);
    const occurs = occursMatch ? parseInt(occursMatch[1]) : 1;

    const picInfo = parsePicClause(picClause);
    const piiInfo = detectPii(name, picClause);

    const field = {
      level,
      name,
      picClause: picClause || undefined,
      dataType: picInfo.type,
      length: picInfo.length,
      decimals: picInfo.decimals,
      offset,
      occurs,
      ...piiInfo
    };

    if (piiInfo.isPii) {
      (field as any).compliance = COMPLIANCE_MAPPINGS[piiInfo.piiType!] || ['GDPR'];
      (field as any).governanceTags = ['PII', 'SENSITIVE'];
    }

    fields.push(field);
    offset += picInfo.length * occurs;
  }

  return { fields, totalLength: offset };
}

export const copybookParser = {
  name: 'copybook-parser',
  description: 'Parse COBOL copybook definitions into JSON schemas with PII detection and governance compliance mapping',
  schema: CopybookParserSchema.shape,
  handler: async (args: z.infer<typeof CopybookParserSchema>) => {
    try {
      const startTime = Date.now();
      const parsed = parseCopybook(args.copybook);
      const duration = Date.now() - startTime;

      // Count PII fields
      const piiFields = parsed.fields.filter((f: any) => f.isPii);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            schema: parsed,
            summary: {
              totalFields: parsed.fields.length,
              piiFields: piiFields.length,
              totalLength: parsed.totalLength,
              complianceFrameworks: [...new Set(piiFields.flatMap((f: any) => f.compliance || []))]
            },
            performance: {
              duration: `${duration}ms`,
              timestamp: new Date().toISOString()
            }
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          })
        }],
        isError: true
      };
    }
  }
};
