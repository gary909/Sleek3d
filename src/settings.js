const STORAGE_KEY = 'sleek3d:settings';

export const DEFAULT_SETTINGS = {
  background: '#000000',
  shadows: true,
  grid: true,
  units: 'mm',
  gridWidth: 200,
  gridLength: 200,
  version: 3,
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

export const SNAP_VALUES = [0.1, 0.5, 1, 2];

export function snapLabel(mm, settings) {
  const text = fromMm(mm, settings).toFixed(4).replace(/\.?0+$/, '');
  return `${text} ${getUnit(settings)}`;
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      const settings = { ...DEFAULT_SETTINGS, ...stored };
      // Migrate legacy binary units ('metric'/'imperial') to a specific unit.
      if (settings.units === 'metric') settings.units = 'mm';
      if (settings.units === 'imperial') settings.units = 'in';
      if (!UNIT_FACTORS[settings.units]) settings.units = DEFAULT_SETTINGS.units;
      // v1 wrote the old light background (#dde4ec) whenever any setting changed.
      // Treat that exact value as "not customised" so the new black default
      // applies to existing installs; other colours are kept.
      if (stored.version === undefined) {
        if (settings.background === '#dde4ec') {
          settings.background = DEFAULT_SETTINGS.background;
        }
      }
      // v3 moved the default work area from 40 mm to a 20 cm print bed.
      if ((stored.version || 1) < 3 && settings.gridWidth === 40 && settings.gridLength === 40) {
        settings.gridWidth = DEFAULT_SETTINGS.gridWidth;
        settings.gridLength = DEFAULT_SETTINGS.gridLength;
      }
      settings.version = DEFAULT_SETTINGS.version;
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