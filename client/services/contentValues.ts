/** SenseNet represents even single-value Choice fields as arrays. */
export function singleChoice(value: string | string[] | undefined): string | undefined {
  if (!Array.isArray(value)) return value;
  if (value.length > 1) throw new Error('Unexpected multiple values in a single Choice field');
  return value[0];
}
