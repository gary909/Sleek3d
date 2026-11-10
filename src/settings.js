const STORAGE_KEY = 'sleek3d:settings';

export const DEFAULT_SETTINGS = {
  background: '#dde4ec',
  shadows: true,
  grid: true,
  units: 'mm',
  gridWidth: 40,
  gridLength: 40,
};

const UNIT_FACTORS = {
  mm: 1,
  cm: 0.1,
  m: 0.001,
  in: 1 / 25.4,
  ft: 1 / 304.8,
  yd: 1 / 914.4,
};

const UNIT_DECIMALS = {
  mm: 2,
  cm: 2,
  m: 3,
  in: 2,
  ft: 3,
  yd: 3,
};

export function getUnit(settings) {
  return UNIT_FACTORS[settings.units] ? settings.units : 'mm';
}

export function fromMm(value, settings) {
  const factor = UNIT_FACTORS[settings.units];
  return value * (factor === undefined ? 1 : factor);
}

export function toMm(value, settings) {
  const factor = UNIT_FACTORS[settings.units];
  return value / (factor === undefined ? 1 : factor);
}

export function formatLength(value, settings) {
  const decimals = UNIT_DECIMALS[settings.units] ?? 2;
  return fromMm(value, settings).toFixed(decimals);
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      // Migrate legacy binary units ('metric'/'imperial') to a specific unit.
      if (settings.units === 'metric') settings.units = 'mm';
      if (settings.units === 'imperial') settings.units = 'in';
      if (!UNIT_FACTORS[settings.units]) settings.units = DEFAULT_SETTINGS.units;
      return settings;
    }
  } catch {
    // ignore — fall through to defaults
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable — ignore
  }
}