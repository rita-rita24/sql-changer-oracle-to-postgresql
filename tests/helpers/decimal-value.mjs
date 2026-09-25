// Compare database NUMBER/NUMERIC values without JavaScript floating-point loss.
export function decimal(value) {
  const text = String(value);
  const match = text.match(/^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if (!match || !(match[2] || match[3])) return text;
  const exponent = Number(match[4] || 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 10000) return text;
  const digits = match[2] + (match[3] || "");
  const point = match[2].length + exponent;
  const expanded = point < 0 ? `0.${"0".repeat(-point)}${digits}`
    : point >= digits.length ? digits + "0".repeat(point - digits.length)
    : `${digits.slice(0, point) || "0"}.${digits.slice(point)}`;
  const [integer, fraction = ""] = expanded.split(".");
  const whole = integer.replace(/^0+(?=\d)/, "") || "0";
  const fractional = fraction.replace(/0+$/, "");
  return `${match[1] === "-" && (whole !== "0" || fractional) ? "-" : ""}${whole}${fractional ? `.${fractional}` : ""}`;
}
