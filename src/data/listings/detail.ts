import { DESIGN_LABEL, isDemoPhoto, type Photo, type PublicListing } from './schema';
import { formatPublicAddress } from './address';
import { publicInvestment } from './investment';
import { formatPricing } from './pricing';
import { coverPhoto } from './card';

/*
  What the individual listing page may show, decided in one place from the public listing only. Nothing here reads a private field, parses prose for
  a number, or calculates a figure. Every optional value is simply absent when it was not approved.
*/

/** The location line under the title, only when the title does not already give both the street and the suburb. Public address fields only. */
export const detailLocation = (l: PublicListing): string | undefined => {
  const t = l.title.toLowerCase();
  return t.includes(l.address.suburb.toLowerCase()) && t.includes(l.address.street.toLowerCase()) ? undefined : formatPublicAddress(l.address);
};

export const designText = (l: PublicListing): string | undefined => {
  const d = l.sda.designCategories ?? [];
  return d.length ? d.map((x) => DESIGN_LABEL[x]).join(', ') : undefined;
};

export interface Row { label: string; value: string }
const m2 = (n: number) => `${n.toLocaleString('en-AU')} m²`;

/**
 * Key property information: the approved physical and SDA facts, in a fixed order, only those that exist. The design category is not repeated here:
 * it is shown prominently in the page header.
 */
export const detailFacts = (l: PublicListing): Row[] => {
  const p = l.property;
  const rows: Row[] = [];
  const add = (label: string, v: string | number | undefined) => { if (v !== undefined && v !== '') rows.push({ label, value: String(v) }); };
  add('Build type', l.sda.buildingType);
  add('Bedrooms', l.sda.bedrooms);
  add('Bathrooms', p?.bathrooms);
  add('Car spaces', p?.carSpaces);
  add('Parking', p?.parking);
  add('Floor area', p?.floorAreaM2 !== undefined ? m2(p.floorAreaM2) : undefined);
  add('Land area', p?.landAreaM2 !== undefined ? m2(p.landAreaM2) : undefined);
  add('Municipality', p?.municipality);
  add('Participant places', l.sda.residentPlaces);
  add('Onsite overnight assistance', l.sda.ooa);
  return rows;
};

export interface InvestmentSection {
  /** The headline figure, when an approved yield exists. */
  yield?: { text: string; label: string; basis: string };
  rows: Row[];
}

/**
 * The optional Investment Details section. Built only from publicInvestment(): approved values, never Victorian income or yield, nothing on a Sold
 * listing. Lease status and occupancy status are separate rows. Provider wording only with its own authorisation. Null means: omit the section.
 */
export const detailInvestment = (l: PublicListing): InvestmentSection | null => {
  const v = publicInvestment(l);
  if (!v) return null;
  const rows: Row[] = [];
  if (v.lease) rows.push({ label: 'Lease status', value: v.lease.label });
  if (v.occupancy) rows.push({ label: 'Occupancy status', value: v.occupancy.label });
  if (v.tenure) rows.push({ label: 'Tenure', value: v.tenure });
  if (v.income) rows.push({ label: `${v.income.label} (${v.income.basis.toLowerCase()})`, value: `$${v.income.amountAud.toLocaleString('en-AU')} per year` });
  if (v.provider) rows.push({ label: 'Provider arrangement', value: v.provider });
  const section: InvestmentSection = { rows };
  if (v.yield) section.yield = { text: v.yield.text, label: v.yield.label, basis: v.yield.basis };
  return rows.length || section.yield ? section : null;
};

/** The pricing line for the enquiry panel: an approved amount, or the existing wording. Never on a Sold listing. */
export const detailPricing = (l: PublicListing): Row | null => {
  if (l.commercialStatus === 'sold') return null;
  const p = formatPricing(l.pricing);
  return { label: p.label, value: p.value ? `${p.value} AUD` : p.label === 'Contact Agent' ? 'Enquire for details' : 'Registrations open' };
};

/** Gallery plan: the main photograph, the thumbnails (everything else, in the approved order) and where the floorplan is. */
export interface GalleryPlan { mainIndex: number; thumbIndexes: number[]; floorplanIndex: number }
export const isFloorplan = (p: Photo): boolean => !isDemoPhoto(p) && p.kind === 'floorplan';
export const galleryPlan = (photos: Photo[]): GalleryPlan => {
  const main = coverPhoto(photos);
  const mainIndex = main ? photos.indexOf(main) : -1;
  return { mainIndex, thumbIndexes: photos.map((_, i) => i).filter((i) => i !== mainIndex), floorplanIndex: photos.findIndex(isFloorplan) };
};
