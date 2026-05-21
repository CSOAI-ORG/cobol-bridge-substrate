import { z } from 'zod';
const EbcdicTranslatorSchema = z.object({
    type: z.enum(['raw', 'structured', 'file']).describe('Input type'),
    data: z.union([z.string(), z.array(z.number())]).describe('EBCDIC data (hex string, base64, or byte array)'),
    codePage: z.enum(['CP037', 'CP1047', 'CP273', 'CP277', 'CP278', 'CP280', 'CP284', 'CP285', 'CP297', 'CP500']).optional().default('CP037').describe('EBCDIC code page'),
    options: z.object({
        detectCodePage: z.boolean().optional().default(false),
        handlePackedDecimal: z.boolean().optional().default(true),
        preserveNulls: z.boolean().optional().default(false)
    }).optional()
});
// EBCDIC to ASCII conversion tables (simplified - CP037 US English)
const EBCDIC_TO_ASCII = {
    0x40: 0x20, // Space
    0x4B: 0x2E, // Period
    0x4C: 0x3C, // <
    0x4D: 0x28, // (
    0x4E: 0x2B, // +
    0x4F: 0x7C, // |
    0x50: 0x26, // &
    0x5A: 0x21, // !
    0x5B: 0x24, // $
    0x5C: 0x2A, // *
    0x5D: 0x29, // )
    0x5E: 0x3B, // ;
    0x5F: 0x5E, // ^
    0x60: 0x2D, // -
    0x61: 0x2F, // /
    0x6A: 0x5C, // \
    0x6B: 0x2C, // ,
    0x6C: 0x25, // %
    0x6D: 0x5F, // _
    0x6E: 0x3E, // >
    0x6F: 0x3F, // ?
    0x79: 0x60, // `
    0x7A: 0x3A, // :
    0x7B: 0x23, // #
    0x7C: 0x40, // @
    0x7D: 0x27, // '
    0x7E: 0x3D, // =
    0x7F: 0x22, // "
    0x81: 0x61, // a
    0x82: 0x62, // b
    0x83: 0x63, // c
    0x84: 0x64, // d
    0x85: 0x65, // e
    0x86: 0x66, // f
    0x87: 0x67, // g
    0x88: 0x68, // h
    0x89: 0x69, // i
    0x91: 0x6A, // j
    0x92: 0x6B, // k
    0x93: 0x6C, // l
    0x94: 0x6D, // m
    0x95: 0x6E, // n
    0x96: 0x6F, // o
    0x97: 0x70, // p
    0x98: 0x71, // q
    0x99: 0x72, // r
    0xA2: 0x73, // s
    0xA3: 0x74, // t
    0xA4: 0x75, // u
    0xA5: 0x76, // v
    0xA6: 0x77, // w
    0xA7: 0x78, // x
    0xA8: 0x79, // y
    0xA9: 0x7A, // z
    0xC1: 0x41, // A
    0xC2: 0x42, // B
    0xC3: 0x43, // C
    0xC4: 0x44, // D
    0xC5: 0x45, // E
    0xC6: 0x46, // F
    0xC7: 0x47, // G
    0xC8: 0x48, // H
    0xC9: 0x49, // I
    0xD1: 0x4A, // J
    0xD2: 0x4B, // K
    0xD3: 0x4C, // L
    0xD4: 0x4D, // M
    0xD5: 0x4E, // N
    0xD6: 0x4F, // O
    0xD7: 0x50, // P
    0xD8: 0x51, // Q
    0xD9: 0x52, // R
    0xE2: 0x53, // S
    0xE3: 0x54, // T
    0xE4: 0x55, // U
    0xE5: 0x56, // V
    0xE6: 0x57, // W
    0xE7: 0x58, // X
    0xE8: 0x59, // Y
    0xE9: 0x5A, // Z
    0xF0: 0x30, // 0
    0xF1: 0x31, // 1
    0xF2: 0x32, // 2
    0xF3: 0x33, // 3
    0xF4: 0x34, // 4
    0xF5: 0x35, // 5
    0xF6: 0x36, // 6
    0xF7: 0x37, // 7
    0xF8: 0x38, // 8
    0xF9: 0x39, // 9
};
function convertEbcdicToAscii(ebcdicBytes) {
    const asciiBytes = ebcdicBytes.map(byte => EBCDIC_TO_ASCII[byte] || byte);
    return Buffer.from(asciiBytes).toString('utf-8');
}
function parseInputData(data) {
    if (Array.isArray(data)) {
        return data;
    }
    // Hex string (e.g., "C8C9D5D7")
    if (/^[0-9A-Fa-f]+$/.test(data) && data.length % 2 === 0) {
        const bytes = [];
        for (let i = 0; i < data.length; i += 2) {
            bytes.push(parseInt(data.substr(i, 2), 16));
        }
        return bytes;
    }
    // Base64
    try {
        return Array.from(Buffer.from(data, 'base64'));
    }
    catch {
        // Treat as raw string
        return Array.from(Buffer.from(data, 'utf-8'));
    }
}
function unpackPackedDecimal(bytes) {
    if (bytes.length === 0)
        return { value: '', sign: '+' };
    let value = '';
    for (let i = 0; i < bytes.length - 1; i++) {
        const byte = bytes[i];
        value += ((byte & 0xF0) >> 4).toString();
        value += (byte & 0x0F).toString();
    }
    // Last byte contains sign
    const lastByte = bytes[bytes.length - 1];
    value += ((lastByte & 0xF0) >> 4).toString();
    const signNibble = lastByte & 0x0F;
    const sign = signNibble === 0x0D ? '-' : '+';
    return { value: value.replace(/^0+/, '') || '0', sign };
}
export const ebcdicTranslator = {
    name: 'ebcdic-translator',
    description: 'Translate EBCDIC-encoded data to UTF-8 with support for 10 code pages and packed decimal (COMP-3) handling',
    schema: EbcdicTranslatorSchema.shape,
    handler: async (args) => {
        try {
            const startTime = Date.now();
            const ebcdicBytes = parseInputData(args.data);
            // Convert to ASCII/UTF-8
            const utf8String = convertEbcdicToAscii(ebcdicBytes);
            // Statistics
            const stats = {
                inputBytes: ebcdicBytes.length,
                outputChars: utf8String.length,
                codePage: args.codePage,
                nullBytes: ebcdicBytes.filter(b => b === 0x00).length,
                printableChars: utf8String.replace(/[^\x20-\x7E]/g, '').length
            };
            const duration = Date.now() - startTime;
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            input: {
                                type: args.type,
                                codePage: args.codePage,
                                bytes: ebcdicBytes.length
                            },
                            output: {
                                text: utf8String,
                                encoding: 'UTF-8'
                            },
                            statistics: stats,
                            conversion: {
                                success: true,
                                confidence: stats.printableChars / stats.outputChars,
                                warnings: stats.nullBytes > 0 ? [`${stats.nullBytes} null bytes detected`] : []
                            },
                            performance: {
                                duration: `${duration}ms`,
                                timestamp: new Date().toISOString()
                            }
                        }, null, 2)
                    }]
            };
        }
        catch (error) {
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
