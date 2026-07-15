/**
 * Extract a human-friendly device description from the User-Agent string.
 * Used by login, MFA verify, and any other route that records device info.
 */
export function extractDeviceInfo(ua: string): string {
  let browser = "Unknown";
  let os = "Unknown";
  if (/Chrome\/(\d+)/.test(ua) && !/Edg/.test(ua)) browser = "Chrome";
  else if (/Firefox\/(\d+)/.test(ua)) browser = "Firefox";
  else if (/Safari\/(\d+)/.test(ua) && !/Chrome/.test(ua)) browser = "Safari";
  else if (/Edg\/(\d+)/.test(ua)) browser = "Edge";
  if (/Windows NT 10/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Linux/.test(ua)) os = "Linux";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad/.test(ua)) os = "iOS";
  return `${browser} on ${os}`;
}
