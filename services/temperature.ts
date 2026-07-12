export type TemperatureUnit = 'c' | 'f';

export function normalizeTemperatureUnit(raw: unknown): TemperatureUnit {
  return raw === 'f' ? 'f' : 'c';
}

function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9) / 5 + 32;
}

function fahrenheitToCelsius(fahrenheit: number): number {
  return (fahrenheit - 32) * 5 / 9;
}

export function displayTemperature(celsius: number, unit: TemperatureUnit): number {
  return unit === 'f' ? celsiusToFahrenheit(celsius) : celsius;
}

export function inputTemperatureToCelsius(value: string, unit: TemperatureUnit): number {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 0;
  return unit === 'f' ? fahrenheitToCelsius(parsed) : parsed;
}

export function temperatureUnitSymbol(unit: TemperatureUnit): string {
  return unit === 'f' ? '\u00B0F' : '\u00B0C';
}

export function formatTemperature(
  celsius: number | undefined,
  unit: TemperatureUnit,
  digits = 0
): string {
  const value = typeof celsius === 'number' && Number.isFinite(celsius) ? celsius : 0;
  return `${displayTemperature(value, unit).toFixed(digits)}${temperatureUnitSymbol(unit)}`;
}
