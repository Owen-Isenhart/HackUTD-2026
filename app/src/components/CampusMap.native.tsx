import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { Icon, T } from './ui';
import type { CampusMapProps } from './CampusMap.types';
import { c, radius, shadow } from '../theme';

// Real map of UT Dallas (Apple Maps on iOS, Google Maps on Android in Expo Go).
export default function CampusMap({ center, stores, selected, onSelect, position, height }: CampusMapProps) {
  const map = useRef<MapView>(null);
  const focus = stores.find((s) => s.id === selected);
  useEffect(() => {
    if (focus) map.current?.animateToRegion({ latitude: focus.latitude, longitude: focus.longitude, latitudeDelta: 0.006, longitudeDelta: 0.006 }, 350);
  }, [focus]);
  return (
    <View style={[styles.frame, { height }]}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        accessibilityLabel="Map of UT Dallas and nearby stores"
        initialRegion={{ ...center, latitudeDelta: 0.012, longitudeDelta: 0.012 }}
        showsUserLocation={!!position}
        showsPointsOfInterests={false}
        moveOnMarkerPress={false}
      >
        {stores.map((s) => {
          const on = s.id === selected;
          return (
            <Marker key={s.id} identifier={s.id} coordinate={s} onPress={() => onSelect(s.id)} tracksViewChanges={on} zIndex={on ? 20 : s.hasOffer ? 10 : 1}>
              <View style={{ alignItems: 'center' }}>
                <View style={[styles.pin, { backgroundColor: on ? c.primary : s.hasOffer ? c.secondary : c.surfaceLowest }]}>
                  <Icon name={s.icon} size={13} color={on || s.hasOffer ? c.onPrimary : c.secondary} />
                  {on || s.hasOffer ? (
                    <T v="labelSm" numberOfLines={1} style={{ color: c.onPrimary, fontFamily: 'Manrope_600SemiBold', maxWidth: 120 }}>
                      {s.label}
                    </T>
                  ) : null}
                </View>
                <View style={[styles.tail, { backgroundColor: on ? c.primary : s.hasOffer ? c.secondary : c.surfaceLowest }]} />
              </View>
            </Marker>
          );
        })}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: c.surfaceLow },
  pin: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: radius.full, ...shadow.sm },
  tail: { width: 8, height: 8, transform: [{ rotate: '45deg' }], marginTop: -4, borderRadius: 1 },
});
