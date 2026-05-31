export type IpInfoResponse = {
  ip?: string;
  country?: string;
  region?: string;
};

export async function getIpInfo(ipAddress: string) {
  const normalizedIp = ipAddress.trim();

  if (!normalizedIp) {
    return null;
  }

  const response = await fetch(`https://ipinfo.io/${encodeURIComponent(normalizedIp)}/json`);
  const data = (await response.json()) as IpInfoResponse;

  if (!response.ok) {
    throw new Error('IPINFO_REQUEST_FAILED');
  }

  return data;
}
