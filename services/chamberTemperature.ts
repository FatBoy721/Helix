export type TemperatureStatus = {
  temperature?: number;
  target?: number;
};

export type ChamberTemperatureSource = {
  key: string;
  label: 'Cavity' | 'Chamber' | 'Panda Breath';
  data: TemperatureStatus;
};

const MACHINE_CHAMBER_NAME_RE = /(chamber|cavity|enclosure)/i;

function asTemperatureStatus(value: unknown): TemperatureStatus {
  return value && typeof value === 'object' ? value as TemperatureStatus : {};
}

function machineChamberSourceScore(key: string): number {
  const name = key.toLowerCase();

  if (name === 'temperature_sensor cavity') return 100;
  if (name.startsWith('temperature_sensor ') && /cavity/.test(name)) return 95;
  if (name.startsWith('temperature_sensor ') && /chamber|enclosure/.test(name)) return 90;
  if (name.startsWith('heater_generic ') && /chamber|cavity|enclosure/.test(name)) return 70;

  return 0;
}

function machineChamberLabel(key: string): ChamberTemperatureSource['label'] {
  return /cavity/i.test(key) ? 'Cavity' : 'Chamber';
}

function pandaBreathSourceScore(key: string): number {
  const name = key.toLowerCase();

  if (name === 'heater_generic panda_breath') return 100;
  if (name.startsWith('heater_generic ') && /panda|breath/.test(name)) return 90;
  if (name.startsWith('temperature_sensor ') && /panda|breath/.test(name)) return 70;

  return 0;
}

export function findMachineChamberTemperatureSource(
  status: Record<string, unknown>
): ChamberTemperatureSource | null {
  const source = Object.keys(status)
    .map((key) => ({
      key,
      score: machineChamberSourceScore(key),
      data: asTemperatureStatus(status[key]),
    }))
    .filter(
      (item) =>
        item.score > 0 &&
        MACHINE_CHAMBER_NAME_RE.test(item.key) &&
        typeof item.data.temperature === 'number'
    )
    .sort((a, b) => b.score - a.score)[0];

  if (!source) return null;

  return {
    key: source.key,
    label: machineChamberLabel(source.key),
    data: source.data,
  };
}

export function findPandaBreathTemperatureSource(
  status: Record<string, unknown>
): ChamberTemperatureSource | null {
  const source = Object.keys(status)
    .map((key) => ({
      key,
      score: pandaBreathSourceScore(key),
      data: asTemperatureStatus(status[key]),
    }))
    .filter((item) => item.score > 0 && typeof item.data.temperature === 'number')
    .sort((a, b) => b.score - a.score)[0];

  if (!source) return null;

  return {
    key: source.key,
    label: 'Panda Breath',
    data: source.data,
  };
}
