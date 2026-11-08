import type { IconName } from './ui';

export type MapPin = { id: string; latitude: number; longitude: number; icon: IconName; label: string; hasOffer: boolean };
export type CampusMapProps = {
  center: { latitude: number; longitude: number };
  stores: MapPin[];
  selected: string | null;
  onSelect: (id: string) => void;
  position: { latitude: number; longitude: number } | null;
  height: number;
};
