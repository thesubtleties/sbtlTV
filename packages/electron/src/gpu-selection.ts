export interface GpuIdentity {
  vendorId?: number;
  deviceId?: number;
  source: 'webgl' | 'active' | 'first' | 'none';
}

interface NormalizedGpuDevice {
  active: boolean;
  vendorId?: number;
  deviceId?: number;
}

function parseGpuId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Number.parseInt(value, value.startsWith('0x') ? 16 : 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizeDevices(value: unknown): NormalizedGpuDevice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((device) => {
    if (!device || typeof device !== 'object') return [];
    const record = device as Record<string, unknown>;
    return [{
      active: record.active === true,
      vendorId: parseGpuId(record.vendorId),
      deviceId: parseGpuId(record.deviceId),
    }];
  });
}

function inferWebGlVendorId(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const renderer = value as Record<string, unknown>;
  const description = [renderer.vendor, renderer.renderer]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toLowerCase();

  if (description.includes('nvidia')) return 0x10de;
  if (description.includes('amd') || description.includes('ati') || description.includes('advanced micro devices')) {
    return 0x1002;
  }
  if (description.includes('intel')) return 0x8086;
  return undefined;
}

export function selectChromiumGpuIdentity(devicesValue: unknown, webGlRenderer: unknown): GpuIdentity {
  const devices = normalizeDevices(devicesValue);
  const webGlVendorId = inferWebGlVendorId(webGlRenderer);
  const webGlDevice = webGlVendorId === undefined
    ? undefined
    : devices.find((device) => device.vendorId === webGlVendorId);
  const selected = webGlDevice ?? devices.find((device) => device.active) ?? devices[0];

  if (!selected) return { source: 'none' };
  return {
    vendorId: selected.vendorId,
    deviceId: selected.deviceId,
    source: webGlDevice ? 'webgl' : selected.active ? 'active' : 'first',
  };
}
