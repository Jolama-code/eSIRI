export interface DirectoryUser {
  id: string;
  name: string;
  email: string;
  title: string;
}

export const DIRECTORY: DirectoryUser[] = [
  { id: 'juma-hassan', name: 'Juma Hassan', email: 'juma.hassan@ega.go.tz', title: 'ICT Officer' },
  { id: 'neema-mwakalinga', name: 'Neema Mwakalinga', email: 'neema.mwakalinga@ega.go.tz', title: 'Principal Systems Analyst' },
  { id: 'baraka-temba', name: 'Baraka Temba', email: 'baraka.temba@ega.go.tz', title: 'Network Engineer' },
  { id: 'zawadi-kimaro', name: 'Zawadi Kimaro', email: 'zawadi.kimaro@ega.go.tz', title: 'Records Management Officer' },
  { id: 'daudi-mollel', name: 'Daudi Mollel', email: 'daudi.mollel@ega.go.tz', title: 'Legal Officer' },
  { id: 'rehema-swai', name: 'Rehema Swai', email: 'rehema.swai@ega.go.tz', title: 'Human Resources Officer' },
];

export interface SampleDoc {
  id: string;
  name: string;
  size: number;
}

export const SAMPLE_DOCS: SampleDoc[] = [
  { id: 'meeting-agenda', name: 'Meeting_Agenda.pdf', size: 184_320 },
  { id: 'budget-2026-27', name: 'Budget_2026_27.pptx', size: 2_621_440 },
  { id: 'previous-minutes', name: 'Previous_Minutes.pdf', size: 312_852 },
];

export const CURRENT_USER = { name: 'Rahma Mbuyu', initials: 'RM', email: 'rahma.mbuyu@ega.go.tz' };

export function userById(id: string): DirectoryUser | undefined {
  return DIRECTORY.find((u) => u.id === id);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
