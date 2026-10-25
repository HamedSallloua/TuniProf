// Tunisian mobile numbers (spec 4.1): +216 then 8 digits, the first one being 2, 4, 5 or 9.

const E164_PATTERN = /^\+216[2459]\d{7}$/;

// Arabic-Indic (٠-٩) and Persian (۰-۹) digits, typed on Arabic keyboards.
function toWesternDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Turns what a person typed into E.164 ("+21622345678"), or null if it is not a valid
 * Tunisian mobile number. Accepts "22 345 678", "+216 22 345 678", "00216 22345678",
 * "216-22-345-678" and Arabic digits.
 */
export function normalizePhone(input: string): string | null {
  const digits = toWesternDigits(input).replace(/[\s.\-()]/g, '');
  if (!/^\+?\d+$/.test(digits)) return null;

  let national: string;
  if (digits.startsWith('+216')) national = digits.slice(4);
  else if (digits.startsWith('00216')) national = digits.slice(5);
  else if (digits.startsWith('216') && digits.length === 11)
    national = digits.slice(3);
  else if (!digits.startsWith('+')) national = digits;
  else return null;

  const e164 = `+216${national}`;
  return E164_PATTERN.test(e164) ? e164 : null;
}

export function isValidE164(value: string): boolean {
  return E164_PATTERN.test(value);
}

/** "+21622345678" -> "22 345 678", for screens. */
export function formatNationalPhone(e164: string): string {
  const n = e164.replace(/^\+216/, '');
  return `${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`;
}

/** WhatsApp sends numbers without the "+": "21622345678" -> "+21622345678". */
export function fromWhatsAppNumber(from: string): string | null {
  const digits = from.replace(/\D/g, '');
  return normalizePhone(`+${digits}`);
}
