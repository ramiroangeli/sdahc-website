import { DESIGN_LABEL, isDemoPhoto, type Photo, type PublicListing } from './schema';
import { agencyFor, type Agency } from './agencies';
import { publicInvestment } from './investment';
import { formatPricing } from './pricing';

/*
  What a catalogue card may show, decided in one place from the public listing only (no private field can reach it).

  Cover: the first photograph that is not a floorplan. A floorplan is never the cover; with no photograph the card shows the
  "photography to follow" slot. Facts: only values that exist, in a fixed order. Nothing is invented and nothing is a placeholder.
  Commercial: only what publicInvestment() allows (approved, not Victorian income or yield, not Sold). Lease and occupancy are separate facts.
  When there is nothing to show, `commercial` is null and the card has no commercial column at all.
*/
export const coverPhoto = (photos: Photo[]): Photo | undefined => photos.find((p) => isDemoPhoto(p) || p.kind !== 'floorplan');

export interface CardFacts {
  /** SDA design category in words, when verified. */
  design?: string;
  /** Compact facts in a fixed order, only those that exist: House, 3 bed, 3 bath, 2 car, 3 participant places. */
  parts: string[];
}

export const cardFacts = (l: PublicListing): CardFacts => {
  const d = l.sda.designCategories ?? [];
  const parts: string[] = [];
  if (l.sda.buildingType) parts.push(l.sda.buildingType);
  if (l.sda.bedrooms) parts.push(`${l.sda.bedrooms} bed`);
  if (l.property?.bathrooms) parts.push(`${l.property.bathrooms} bath`);
  if (l.property?.carSpaces !== undefined) parts.push(`${l.property.carSpaces} car`);
  if (l.sda.residentPlaces) parts.push(`${l.sda.residentPlaces} participant places`);
  return { design: d.length ? d.map((x) => DESIGN_LABEL[x]).join(', ') : undefined, parts };
};

/** The public location line under the title, only when the title does not already say where the property is. Public address fields only. */
export const cardLocation = (l: PublicListing): string | undefined => {
  const a = l.address;
  return l.title.toLowerCase().includes(a.suburb.toLowerCase()) ? undefined : `${a.suburb} ${a.state} ${a.postcode}`;
};

export interface CardCommercial {
  /** The approved public amount (Asking Price or Price Guide). Absent for Contact Agent and Sold. */
  price?: { label: string; value: string };
  yield?: { text: string; label: string; basis: string };
  /** Separate indicators: lease status and occupancy status are different facts and never inferred from each other. */
  lease?: { label: string; value: string };
  occupancy?: { label: string; value: string };
}

export const cardCommercial = (l: PublicListing): CardCommercial | null => {
  const c: CardCommercial = {};
  const p = formatPricing(l.pricing);
  // an approved amount is shown exactly as approved, and never on a Sold listing (a sold property is not offered)
  if (p.value && l.commercialStatus !== 'sold') c.price = { label: p.label, value: p.value };
  const v = publicInvestment(l);
  if (!v) return Object.keys(c).length ? c : null;
  if (v.yield) c.yield = { text: v.yield.text, label: v.yield.label, basis: v.yield.basis };
  if (v.lease) c.lease = { label: 'Lease', value: v.lease.label };
  if (v.occupancy) c.occupancy = { label: 'Occupancy', value: v.occupancy.label };
  return Object.keys(c).length ? c : null;
};

export interface CardView { cover?: Photo; facts: CardFacts; location?: string; commercial: CardCommercial | null; agency: Agency; sold: boolean }
export const cardView = (l: PublicListing): CardView => ({
  cover: coverPhoto(l.photos), facts: cardFacts(l), location: cardLocation(l), commercial: cardCommercial(l), agency: agencyFor(l.marketing?.agency), sold: l.commercialStatus === 'sold',
});
