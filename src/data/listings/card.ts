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

export interface CardFact { label: string; value: string }

export const cardFacts = (l: PublicListing): CardFact[] => {
  const out: CardFact[] = [];
  const d = l.sda.designCategories ?? [];
  if (d.length) out.push({ label: 'Design category', value: d.map((x) => DESIGN_LABEL[x]).join(', ') });
  if (l.sda.buildingType) out.push({ label: 'Build type', value: l.sda.buildingType });
  if (l.sda.bedrooms) out.push({ label: 'Bedrooms', value: String(l.sda.bedrooms) });
  if (l.property?.bathrooms) out.push({ label: 'Bathrooms', value: String(l.property.bathrooms) });
  if (l.property?.carSpaces !== undefined) out.push({ label: 'Car spaces', value: String(l.property.carSpaces) });
  if (l.sda.residentPlaces) out.push({ label: 'Participant places', value: String(l.sda.residentPlaces) });
  return out.slice(0, 5);
};

export interface CardCommercial {
  /** The approved public amount (Asking Price or Price Guide). Absent for Contact Agent and Sold. */
  price?: { label: string; value: string };
  yield?: { text: string; label: string; basis: string };
  lease?: string;
  occupancy?: string;
}

export const cardCommercial = (l: PublicListing): CardCommercial | null => {
  const c: CardCommercial = {};
  const p = formatPricing(l.pricing);
  // an approved amount is shown exactly as approved, and never on a Sold listing (a sold property is not offered)
  if (p.value && l.commercialStatus !== 'sold') c.price = { label: p.label, value: p.value };
  const v = publicInvestment(l);
  if (!v) return Object.keys(c).length ? c : null;
  if (v.yield) c.yield = { text: v.yield.text, label: v.yield.label, basis: v.yield.basis };
  if (v.lease) c.lease = v.lease.label;
  if (v.occupancy) c.occupancy = v.occupancy.label;
  return Object.keys(c).length ? c : null;
};

export interface CardView { cover?: Photo; facts: CardFact[]; commercial: CardCommercial | null; agency: Agency; sold: boolean }
export const cardView = (l: PublicListing): CardView => ({
  cover: coverPhoto(l.photos), facts: cardFacts(l), commercial: cardCommercial(l), agency: agencyFor(l.marketing?.agency), sold: l.commercialStatus === 'sold',
});
