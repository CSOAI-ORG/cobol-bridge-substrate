import { z } from 'zod';

const VsamMapperSchema = z.object({
  type: z.enum(['IDCAMS', 'COBOL_FD', 'CATALOG', 'MANUAL']).describe('Input type'),
  definition: z.string().min(1).describe('VSAM definition (IDCAMS DEFINE, COBOL FD, etc.)'),
  options: z.object({
    detectPii: z.boolean().optional().default(true),
    generateSchema: z.boolean().optional().default(true)
  }).optional()
});

const PII_PATTERNS = {
  ssn: /SSN|SOCIAL.*SECURITY/i,
  creditCard: /CREDIT.*CARD|CARD.*NUM|CCNUM/i,
  bankAccount: /ACCOUNT.*NUM|BANK.*ACCT/i,
  taxId: /TIN|TAX.*ID|EIN/i,
  personal: /NAME|ADDRESS|PHONE|EMAIL/i
};

function parseIdcamsDefine(defineStatement: string): any {
  const lines = defineStatement.split('\n');
  let fileType = 'UNKNOWN';
  let recordSize = { min: 0, max: 0 };
  let key: any = null;
  let attributes: any = {};

  for (const line of lines) {
    const upper = line.toUpperCase();

    // Determine file type
    if (upper.includes('INDEXED')) fileType = 'KSDS';
    else if (upper.includes('NONINDEXED')) fileType = 'ESDS';
    else if (upper.includes('NUMBERED')) fileType = 'RRDS';
    else if (upper.includes('LINEAR')) fileType = 'LDS';

    // Parse RECORDSIZE
    const recSizeMatch = line.match(/RECORDSIZE\s*\(\s*(\d+)\s+(\d+)\s*\)/i);
    if (recSizeMatch) {
      recordSize = {
        min: parseInt(recSizeMatch[1]),
        max: parseInt(recSizeMatch[2])
      };
    }

    // Parse KEYS
    const keysMatch = line.match(/KEYS\s*\(\s*(\d+)\s+(\d+)\s*\)/i);
    if (keysMatch) {
      key = {
        length: parseInt(keysMatch[1]),
        offset: parseInt(keysMatch[2])
      };
    }

    // Parse other attributes
    if (upper.includes('SHAREOPTIONS')) {
      const shareMatch = line.match(/SHAREOPTIONS\s*\(\s*(\d+)\s+(\d+)\s*\)/i);
      if (shareMatch) {
        attributes.shareOptions = {
          crossRegion: parseInt(shareMatch[1]),
          crossSystem: parseInt(shareMatch[2])
        };
      }
    }

    if (upper.includes('SPEED')) attributes.speed = 'SPEED';
    if (upper.includes('RECOVERY')) attributes.recovery = 'RECOVERY';
    if (upper.includes('UNIQUEKEY')) attributes.uniqueKey = true;
    if (upper.includes('UPGRADE')) attributes.upgrade = true;
  }

  return {
    fileType,
    recordSize,
    key,
    attributes
  };
}

function parseCobolFd(fdStatement: string): any {
  const lines = fdStatement.split('\n');
  const fields: any[] = [];
  let recordLength = 0;

  for (const line of lines) {
    // Parse field definitions
    const fieldMatch = line.match(/(\d+)\s+(\S+)\s+PIC\s+(.+?)(?:\.|$)/i);
    if (fieldMatch) {
      const level = parseInt(fieldMatch[1]);
      const name = fieldMatch[2];
      const pic = fieldMatch[3].trim();

      // Calculate field length from PIC
      let length = 0;
      const picMatch = pic.match(/\((\d+)\)/);
      if (picMatch) {
        length = parseInt(picMatch[1]);
      } else {
        length = pic.replace(/[^9XA]/gi, '').length;
      }

      // Detect PII
      let piiType = null;
      for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
        if (pattern.test(name)) {
          piiType = type;
          break;
        }
      }

      fields.push({
        level,
        name,
        picClause: pic,
        length,
        offset: recordLength,
        piiType,
        isPii: piiType !== null
      });

      recordLength += length;
    }
  }

  return { fields, recordLength };
}

function generateJsonSchema(fields: any[]): any {
  const properties: Record<string, any> = {};
  const required: string[] = [];

  fields.forEach(field => {
    let type = 'string';
    if (field.picClause.includes('9')) {
      type = field.picClause.includes('V') ? 'number' : 'integer';
    }

    properties[field.name] = {
      type,
      description: `${field.picClause}${field.isPii ? ' [PII]' : ''}`,
      maxLength: field.length
    };

    if (field.level <= 5) {
      required.push(field.name);
    }
  });

  return {
    type: 'object',
    properties,
    required
  };
}

export const vsamMapper = {
  name: 'vsam-mapper',
  description: 'Map VSAM file structures (KSDS, ESDS, RRDS, LDS) with field definitions, key analysis, and PII detection',
  schema: VsamMapperSchema.shape,
  handler: async (args: z.infer<typeof VsamMapperSchema>) => {
    try {
      const startTime = Date.now();
      let result: any = {};

      switch (args.type) {
        case 'IDCAMS':
          result = parseIdcamsDefine(args.definition);
          break;
        case 'COBOL_FD':
          result = parseCobolFd(args.definition);
          if (args.options?.generateSchema) {
            result.jsonSchema = generateJsonSchema(result.fields);
          }
          break;
        case 'CATALOG':
          result = {
            fileType: 'KSDS',
            note: 'Catalog entry parsing requires specific format',
            raw: args.definition
          };
          break;
        case 'MANUAL':
          result = {
            fields: [],
            note: 'Manual field specification not yet implemented'
          };
          break;
      }

      const piiFields = result.fields?.filter((f: any) => f.isPii) || [];
      const duration = Date.now() - startTime;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            inputType: args.type,
            vsamInfo: result,
            summary: {
              fileType: result.fileType || 'UNKNOWN',
              totalFields: result.fields?.length || 0,
              piiFields: piiFields.length,
              recordLength: result.recordLength || result.recordSize?.max || 0
            },
            piiAnalysis: piiFields.length > 0 ? {
              fields: piiFields,
              complianceFrameworks: ['GDPR', 'PCI-DSS', 'SOX'],
              recommendations: [
                'Implement field-level encryption for PII',
                'Configure access controls',
                'Enable audit logging'
              ]
            } : null,
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
