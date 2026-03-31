export const CLIENT_LOGO_MAP: Record<string, string> = {
  'nostria': 'logos/clients/nostria.png',
  'nosotros': 'logos/clients/nosotros.png',
  'damus deck': 'logos/clients/damus.png',
  'damus': 'logos/clients/damus.png',
  'amethyst': 'logos/clients/amethyst.svg',
  'primal': 'logos/clients/primal.png',
  'snort': 'logos/clients/snort.png',
  'iris': 'logos/clients/iris.png',
  'coracle': 'logos/clients/coracle.png',
  'nos': 'logos/clients/nos.png',
  'current': 'logos/clients/current.png',
  'satellite': 'logos/clients/satellite.png',
  'habla': 'logos/clients/habla.png',
  'gossip': 'logos/clients/gossip.png',
  'freefrom': 'logos/clients/freefrom.png',
  'habla.news': 'logos/clients/habla.png',
  'nostrudel': 'logos/clients/nostrudel.svg',
  'yakihonne': 'logos/clients/yakihonne.png',
  'lume': 'logos/clients/lume.png',
  'nostur': 'logos/clients/nostur.png',
  'nostore': 'logos/clients/nostore.png',
  'attestr.xyz': 'logos/clients/attestr.xyz.png',
};

export function resolveClientLogo(clientName: string | null | undefined): string | null {
  if (!clientName) return null;

  const normalizedClient = clientName.toLowerCase().trim();
  const exactMatch = CLIENT_LOGO_MAP[normalizedClient];

  if (exactMatch) {
    return exactMatch;
  }

  const prefixMatch = Object.entries(CLIENT_LOGO_MAP).find(([client]) => (
    normalizedClient.startsWith(`${client} `)
    || normalizedClient.startsWith(`${client}/`)
    || normalizedClient.startsWith(`${client}(`)
  ));

  return prefixMatch?.[1] || null;
}
