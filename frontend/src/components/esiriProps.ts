/** Attributes that make an element drivable by eSiri. */
export interface EsiriAttrs {
  'data-esiri-id': string;
  'data-esiri-label': string;
  'data-esiri-sensitive'?: 'true';
  'data-esiri-state'?: string;
  'data-esiri-role'?: string;
}

export function ez(
  id: string,
  label: string,
  opts: { sensitive?: boolean; state?: string; role?: string } = {},
): EsiriAttrs {
  const a: EsiriAttrs = { 'data-esiri-id': id, 'data-esiri-label': label };
  if (opts.sensitive) a['data-esiri-sensitive'] = 'true';
  if (opts.state !== undefined) a['data-esiri-state'] = opts.state;
  if (opts.role) a['data-esiri-role'] = opts.role;
  return a;
}
