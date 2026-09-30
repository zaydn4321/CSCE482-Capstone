import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Keyboard,
  Linking,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Feather, Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { nativePalette } from '@/constants/colors';
import { useLocation } from '@/context/LocationContext';
import { demoPlaces } from '@/services/demoData';
import { formatCoordinates } from '@/services/locationProcessing';
import {
  buildPlaceDetailModel,
  clusterPlaces,
  fitMap,
  inverseMercatorY,
  mercatorY,
  normalizedLongitude,
  type MapCenter,
  type MapPlace,
  type MarkerGroup,
} from '@/services/placesMapModel';
import type { ProcessedPlace } from '@/services/visitProcessor';

type Place = (typeof demoPlaces)[number];
type Tile = { key: string; uri: string; left: number; top: number };

const TILE_SIZE = 256;
const MAX_ZOOM = 17;
const MAX_TILES = 100;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getTiles(center: MapCenter, zoom: number, width: number, height: number): Tile[] {
  if (!width || !height) return [];
  const worldSize = TILE_SIZE * 2 ** zoom;
  const centerX = ((center.lng + 180) / 360) * worldSize;
  const centerY = mercatorY(center.lat) * worldSize;
  const left = centerX - width / 2;
  const top = centerY - height / 2;
  const firstX = Math.floor(left / TILE_SIZE) - 1;
  const lastX = Math.floor((left + width) / TILE_SIZE) + 1;
  const firstY = Math.max(0, Math.floor(top / TILE_SIZE) - 1);
  const lastY = Math.min(2 ** zoom - 1, Math.floor((top + height) / TILE_SIZE) + 1);
  const tiles: Tile[] = [];
  for (let y = firstY; y <= lastY; y += 1) {
    for (let x = firstX; x <= lastX; x += 1) {
      if (tiles.length >= MAX_TILES) return tiles;
      const wrappedX = ((x % 2 ** zoom) + 2 ** zoom) % 2 ** zoom;
      tiles.push({
        key: `${zoom}/${wrappedX}/${y}`,
        uri: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`,
        left: x * TILE_SIZE - left,
        top: y * TILE_SIZE - top,
      });
    }
  }
  return tiles;
}

function formatDuration(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return hours ? `${hours}h ${remaining}m` : `${remaining}m`;
}

function dateLabel(value?: number | string) {
  if (value === undefined || value === null || value === '') return 'Not available';
  if (typeof value === 'string' && !/\b\d{4}\b/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function dateTimeLabel(value: number) {
  return new Date(value).toLocaleString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function MapScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { state, renamePlace } = useLocation();
  const { place: requestedPlace, visit: requestedVisit } = useLocalSearchParams<{ place?: string | string[]; visit?: string | string[] }>();
  const requestedPlaceId = Array.isArray(requestedPlace) ? requestedPlace[0] : requestedPlace;
  const requestedVisitId = Array.isArray(requestedVisit) ? requestedVisit[0] : requestedVisit;
  const demo = state.mode === 'demo';
  const places = useMemo<MapPlace[]>(() => demo
    ? demoPlaces.map(place => ({
      id: place.id,
      lat: place.lat,
      lng: place.lng,
      title: place.name,
      category: place.category,
      visitCount: place.visits,
      displayTime: place.timeSpent,
      firstVisit: place.firstVisited,
      latestVisit: place.lastVisited,
      demo: true,
    }))
    : state.places.map((place: ProcessedPlace, index) => ({
      id: place.id,
      lat: place.lat,
      lng: place.lng,
      title: place.name ?? `Place ${index + 1}`,
      category: place.category,
      visitCount: place.visitCount,
      totalTimeMs: place.totalTimeMs,
      firstVisit: place.firstVisit,
      latestVisit: place.latestVisit,
      demo: false,
    })), [demo, state.places]);
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const [center, setCenter] = useState<MapCenter | null>(null);
  const [zoom, setZoom] = useState(12);
  const [selected, setSelected] = useState<MapPlace | null>(null);
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
  const [expandedCluster, setExpandedCluster] = useState<MapPlace[] | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState('');
  const [tileFailed, setTileFailed] = useState(false);
  const [showStreetMap, setShowStreetMap] = useState(false);
  const gestureStart = useRef<{ center: MapCenter; zoom: number } | null>(null);
  const mapRef = useRef({ center, zoom, width: mapSize.width, height: mapSize.height });
  mapRef.current = { center, zoom, width: mapSize.width, height: mapSize.height };
  const signature = places.map(place => `${place.id}:${place.lat}:${place.lng}`).join('|');
  const visitSignature = state.visits.map(visit => `${visit.id}:${visit.placeId}`).join('|');

  useEffect(() => {
    const fit = fitMap(places, mapSize.width, mapSize.height);
    if (fit) {
      setCenter(fit.center);
      setZoom(fit.zoom);
    } else {
      setCenter(null);
    }
  }, [signature, mapSize.width, mapSize.height]);

  useEffect(() => {
    if (!requestedPlaceId && !requestedVisitId) return;
    if (!state.ready) return;

    if (requestedVisitId) {
      const visit = demo ? undefined : state.visits.find(item =>
        item.id === requestedVisitId && (!requestedPlaceId || item.placeId === requestedPlaceId),
      );
      const match = visit ? places.find(place => place.id === visit.placeId && !place.demo) : undefined;
      if (visit && match) {
        setExpandedCluster(null);
        setEditingName(false);
        setNameError('');
        setSelectedVisitId(visit.id);
        setSelected(match);
        setCenter({ lat: match.lat, lng: match.lng });
        setZoom(current => Math.max(current, 15));
      } else {
        setSelected(null);
        setSelectedVisitId(null);
        setExpandedCluster(null);
        router.replace('/(tabs)/map');
      }
      return;
    }

    const match = places.find(place => place.id === requestedPlaceId);
    if (match) {
      setExpandedCluster(null);
      setEditingName(false);
      setNameError('');
      setSelectedVisitId(null);
      setSelected(match);
    } else {
      setSelected(null);
      setSelectedVisitId(null);
      router.replace('/(tabs)/map');
    }
  }, [requestedPlaceId, requestedVisitId, state.ready, visitSignature, signature, mapSize.width, mapSize.height]);

  useEffect(() => {
    if (selected && !places.some(place => place.id === selected.id)) {
      setSelected(null);
      setSelectedVisitId(null);
    }
    if (expandedCluster && !expandedCluster.some(item => places.some(place => place.id === item.id))) setExpandedCluster(null);
  }, [signature, selected, expandedCluster]);

  const onMapLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setMapSize(current => current.width === width && current.height === height ? current : { width, height });
  };
  const tiles = center && (demo || showStreetMap) ? getTiles(center, zoom, mapSize.width, mapSize.height) : [];
  const groups = center ? clusterPlaces(places, center, zoom, mapSize.width, mapSize.height) : [];
  const maxVisits = places.reduce((max, place) => Math.max(max, place.visitCount), 0);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 5 || Math.abs(gesture.dy) > 5,
    onPanResponderGrant: () => {
      const current = mapRef.current;
      if (current.center) gestureStart.current = { center: current.center, zoom: current.zoom };
    },
    onPanResponderMove: (_event, gesture) => {
      const start = gestureStart.current;
      if (!start || !mapRef.current.width || !mapRef.current.height) return;
      const scale = TILE_SIZE * 2 ** start.zoom;
      const x = ((start.center.lng + 180) / 360) * scale - gesture.dx;
      const y = mercatorY(start.center.lat) * scale - gesture.dy;
      setCenter({
        lng: normalizedLongitude((x / scale) * 360 - 180),
        lat: inverseMercatorY(y / scale),
      });
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: () => { gestureStart.current = null; },
  })).current;

  const zoomAt = (nextZoom: number, point?: { lat: number; lng: number }) => {
    if (!center) return;
    setCenter(point ?? center);
    setZoom(clamp(nextZoom, 3, MAX_ZOOM));
  };
  const openMarker = (group: MarkerGroup) => {
    if (group.places.length === 1) {
      setEditingName(false);
      setNameError('');
      setSelectedVisitId(null);
      setSelected(group.places[0]);
      return;
    }
    if (zoom < MAX_ZOOM) zoomAt(Math.min(MAX_ZOOM, zoom + 2), { lat: group.lat, lng: group.lng });
    else setExpandedCluster(group.places);
  };
  const onTileError = () => setTileFailed(true);
  const closeDetails = () => {
    Keyboard.dismiss();
    setEditingName(false);
    setNameError('');
    setSelected(null);
    setSelectedVisitId(null);
    setExpandedCluster(null);
    if (requestedPlaceId || requestedVisitId) router.replace('/(tabs)/map');
  };
  const activeSelected = selected ? places.find(place => place.id === selected.id) ?? selected : null;
  const selectedVisits = activeSelected ? buildPlaceDetailModel(activeSelected, state.visits).visits : [];
  const selectedVisit = selectedVisitId
    ? state.visits.find(visit => visit.id === selectedVisitId && visit.placeId === activeSelected?.id) ?? null
    : null;
  const savedName = activeSelected && !activeSelected.demo ? state.places.find(place => place.id === activeSelected.id)?.name : undefined;
  const beginRename = () => {
    setNameDraft(savedName ?? '');
    setNameError('');
    setEditingName(true);
  };
  const updateName = async (name: string | null) => {
    if (!activeSelected || activeSelected.demo || nameBusy) return;
    if (name !== null && !name.trim()) {
      setNameError('Enter a name, or use Remove name to restore the default.');
      return;
    }
    setNameBusy(true);
    setNameError('');
    try {
      await renamePlace(activeSelected.id, name);
      Keyboard.dismiss();
      setEditingName(false);
    } catch (error) {
      setNameError(error instanceof Error ? error.message : 'Could not save this name. Try again.');
    } finally {
      setNameBusy(false);
    }
  };

  return (
    <View style={[styles.page, { backgroundColor: colors.background }]}>
      <SafeAreaView edges={['top']} style={styles.topSafe}>
        <View style={[styles.topbar, { borderBottomColor: colors.border }]}>
          <View style={styles.brandRow}>
            <View style={[styles.brandMark, { borderColor: colors.lime }]}><Ionicons name="navigate" size={17} color={colors.lime} /></View>
            <Text style={styles.brandName}>location wrapped<Text style={{ color: colors.lime }}>.</Text></Text>
          </View>
          {demo ? <Text style={[styles.demoBadge, { color: colors.lime, borderColor: `${colors.lime}66` }]}>DEMO MODE</Text> : null}
        </View>
      </SafeAreaView>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 18) + 94 }]}
      >
        <View style={styles.intro}>
          <Text style={[styles.eyebrow, { color: colors.lime }]}>{demo ? 'DEMO / SAMPLE ATLAS' : 'YOUR ATLAS / OBSERVED PLACES'}</Text>
          <Text style={styles.pageTitle}>Your map.</Text>
          <Text style={styles.introCopy}>
            {demo ? 'A closer look at the places in this sample story.' : 'A private atlas of places from your visit history. Only processed places appear here.'}
          </Text>
        </View>

        <View
          style={[styles.mapCanvas, { backgroundColor: colors.map }]}
          onLayout={onMapLayout}
          accessibilityLabel={demo ? 'Geographic demo map with sample place markers' : 'Geographic map of observed places'}
          testID="map-canvas"
          {...panResponder.panHandlers}
        >
          {center ? (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              {tiles.map(tile => (
                <Image
                  key={tile.key}
                  source={{ uri: tile.uri }}
                  onError={onTileError}
                  resizeMode="stretch"
                  style={[styles.tile, { left: tile.left, top: tile.top }]}
                />
              ))}
            </View>
          ) : (
            <View pointerEvents="none" style={styles.noMap}>
              <Ionicons name="navigate-outline" size={25} color={colors.mutedForeground} />
               <Text style={styles.noMapTitle}>{!state.ready ? 'Loading your atlas…' : state.error && state.status === 'unavailable' ? 'Your atlas is unavailable.' : 'Your atlas starts here.'}</Text>
               <Text style={styles.noMapCopy}>{!state.ready ? 'Checking your saved places.' : state.error && state.status === 'unavailable' ? state.error : state.records.length ? 'Location points are saved. Places will appear when those points form meaningful visits.' : 'A geographic view will appear when a visit forms a place.'}</Text>
            </View>
          )}

          {center ? groups.map(group => {
            const isCluster = group.places.length > 1;
            const mostVisited = group.places.some(place => place.visitCount === maxVisits && maxVisits > 1);
            const markerColor = mostVisited ? colors.pink : colors.lime;
            return (
              <Pressable
                key={group.key}
                accessibilityRole="button"
                accessibilityLabel={isCluster
                  ? `${group.places.length} places clustered together. Tap to zoom in.`
                  : `Open ${group.places[0].title}, ${group.places[0].visitCount} visits`}
                testID={isCluster ? `button-map-cluster-${group.key.replace(':', '-')}` : `button-map-marker-${group.places[0].id}`}
                onPress={() => openMarker(group)}
                style={({ pressed }) => [
                  styles.marker,
                  {
                    left: group.point.x,
                    top: group.point.y,
                    width: isCluster ? 42 : 34,
                    height: isCluster ? 42 : 34,
                    marginLeft: isCluster ? -21 : -17,
                    marginTop: isCluster ? -21 : -17,
                    borderRadius: isCluster ? 22 : 18,
                    backgroundColor: isCluster ? nativePalette.ink : markerColor,
                    borderColor: isCluster ? colors.lime : colors.background,
                  },
                  pressed && styles.pressed,
                ]}
              >
                {isCluster
                  ? <Text style={[styles.clusterCount, { color: colors.lime }]}>{group.places.length}</Text>
                  : <Ionicons name="location" size={17} color={colors.background} />}
                {!isCluster && group.places[0].visitCount > 1
                  ? <View style={[styles.repeatDot, { backgroundColor: colors.background }]} />
                  : null}
              </Pressable>
            );
          }) : null}

          <View style={[styles.mapCaption, { backgroundColor: nativePalette.ink }]}>
            <Text style={[styles.captionText, { color: colors.foreground }]}>{demo ? 'SAMPLE PLACES' : 'OBSERVED PLACES'}</Text>
          </View>
          <View style={styles.mapControls}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Zoom in"
              testID="button-map-zoom-in"
              disabled={!center || zoom >= MAX_ZOOM}
              onPress={() => zoomAt(zoom + 1)}
              style={({ pressed }) => [styles.controlButton, { backgroundColor: nativePalette.ink }, pressed && styles.pressed, (!center || zoom >= MAX_ZOOM) && styles.disabled]}
            ><Feather name="plus" size={19} color={colors.foreground} /></Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Zoom out"
              testID="button-map-zoom-out"
              disabled={!center || zoom <= 3}
              onPress={() => zoomAt(zoom - 1)}
              style={({ pressed }) => [styles.controlButton, { backgroundColor: nativePalette.ink }, pressed && styles.pressed, (!center || zoom <= 3) && styles.disabled]}
            ><Feather name="minus" size={19} color={colors.foreground} /></Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fit all places"
              testID="button-map-fit"
              disabled={!places.length}
              onPress={() => {
                const fit = fitMap(places, mapSize.width, mapSize.height);
                if (fit) {
                  setCenter(fit.center);
                  setZoom(fit.zoom);
                }
              }}
              style={({ pressed }) => [styles.controlButton, { backgroundColor: nativePalette.ink }, pressed && styles.pressed, !places.length && styles.disabled]}
            ><Feather name="crosshair" size={17} color={colors.foreground} /></Pressable>
          </View>
          {center && places.length && (demo || showStreetMap) ? (
            <View style={[styles.attribution, { backgroundColor: 'rgba(11,11,20,0.82)' }]}>
              <Text style={styles.attributionText}>© </Text>
              <Pressable accessibilityRole="link" accessibilityLabel="OpenStreetMap attribution" onPress={() => Linking.openURL('https://www.openstreetmap.org/copyright')}>
                <Text style={[styles.attributionText, styles.attributionLink]}>OpenStreetMap</Text>
              </Pressable>
              <Text style={styles.attributionText}> contributors</Text>
            </View>
          ) : null}
           {center && (demo || showStreetMap) && tileFailed ? (
            <View pointerEvents="none" style={[styles.tileNotice, { backgroundColor: 'rgba(11,11,20,0.88)' }]}>
              <Text style={styles.tileNoticeText}>Map tiles may be offline. Place locations are still available.</Text>
            </View>
          ) : null}
        </View>
        {!demo && places.length ? (
          <View style={[styles.privateMapNotice, { borderColor: colors.border }]}>
            <Text style={[styles.privateMapText, { color: colors.mutedForeground }]}>
              {showStreetMap ? 'Street map is on. Map tile requests share the viewed area with OpenStreetMap; your recorded points and visits are not sent.' : 'Place markers are positioned by their real coordinates. Street tiles are off by default to keep your viewed areas private.'}
            </Text>
            <Pressable accessibilityRole="button" testID="button-toggle-street-map" onPress={() => { setTileFailed(false); setShowStreetMap(current => !current); }} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={[styles.privateMapAction, { color: colors.lime }]}>{showStreetMap ? 'Hide street map' : 'Load street map'}</Text>
            </Pressable>
          </View>
        ) : null}
        {places.length ? (
          <View style={styles.legend}>
            <View style={[styles.legendDot, { backgroundColor: colors.pink }]} />
            <Text style={styles.legendText}>Most returned to</Text>
            <View style={[styles.legendDot, styles.legendDotLime, { backgroundColor: colors.lime }]} />
            <Text style={styles.legendText}>Visited place</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{demo ? `${places.length} sample places` : `${places.length} observed places`}</Text>
          {places.length ? places.map((place, index) => (
            <Pressable
              key={place.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${place.title}, ${place.visitCount} visits`}
              testID={demo ? `button-place-${place.id}` : `button-processed-place-${index}`}
              onPress={() => setSelected(place)}
              style={({ pressed }) => [styles.placeRow, { borderBottomColor: colors.border }, pressed && styles.rowPressed]}
            >
              <View style={styles.placeCopy}>
                <Text style={styles.placeName}>{place.title}</Text>
                <Text style={styles.smallMuted}>
                  {place.category ? `${place.category} · ` : ''}{place.visitCount} {place.visitCount === 1 ? 'visit' : 'visits'}
                  {place.demo ? ` · ${place.displayTime}` : ` · ${formatDuration(place.totalTimeMs ?? 0)}`}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
          )) : (
            <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.secondary }]}><Ionicons name="navigate-outline" size={20} color={colors.lime} /></View>
              <Text style={styles.emptyTitle}>{!state.ready ? 'Loading your places…' : 'No observed places yet.'}</Text>
              <Text style={styles.smallMuted}>{!state.ready ? 'Checking saved visit history.' : state.records.length ? 'Your location points are saved, but none formed a meaningful visit yet. Keep tracking when it works for you.' : 'A place appears here after recorded locations form a visit. Sample places are kept separate from your personal history.'}</Text>
            </View>
          )}
        </View>
      </ScrollView>

      <Modal visible={Boolean(selected || expandedCluster)} animationType="slide" transparent onRequestClose={closeDetails} statusBarTranslucent>
        <View style={styles.modalShade}>
          <KeyboardAvoidingView behavior="padding" style={styles.keyboardSheet}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeDetails} accessibilityLabel="Close details" />
            <SafeAreaView edges={['bottom']} style={[styles.detailSheet, { backgroundColor: nativePalette.sheet }]}>
            <View style={styles.sheetHandle} />
            {expandedCluster ? (
              <>
                <View style={styles.sheetHead}>
                  <View style={styles.sheetHeadingText}>
                    <Text style={[styles.eyebrow, { color: colors.lime }]}>NEARBY PLACES</Text>
                    <Text style={styles.sheetTitle}>{expandedCluster.length} places in this area</Text>
                  </View>
                  <Pressable onPress={closeDetails} accessibilityLabel="Close details" testID="button-close-details" style={[styles.closeButton, { backgroundColor: nativePalette.close }]}><Feather name="x" size={18} color={colors.foreground} /></Pressable>
                </View>
                <ScrollView style={styles.clusterList} showsVerticalScrollIndicator={false}>
                  {expandedCluster.map(place => (
                    <Pressable key={place.id} onPress={() => { setExpandedCluster(null); setEditingName(false); setNameError(''); setSelectedVisitId(null); setSelected(place); }} style={[styles.placeRow, { borderBottomColor: colors.border }]}>
                      <View style={styles.placeCopy}>
                        <Text style={styles.placeName}>{place.title}</Text>
                        <Text style={styles.smallMuted}>{place.visitCount} {place.visitCount === 1 ? 'visit' : 'visits'}{place.category ? ` · ${place.category}` : ''}</Text>
                      </View>
                      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : activeSelected ? (
              <>
                <View style={styles.sheetHead}>
                  <View style={styles.sheetHeadingText}>
                    <Text style={[styles.eyebrow, { color: colors.lime }]}>{activeSelected.demo ? 'DEMO PLACE' : 'OBSERVED PLACE'}</Text>
                    <Text style={styles.sheetTitle} testID="text-place-name">{activeSelected.title}</Text>
                    {activeSelected.category ? <Text style={styles.sheetCategory}>{activeSelected.category}</Text> : null}
                  </View>
                  <Pressable onPress={closeDetails} accessibilityLabel="Close details" testID="button-close-details" style={[styles.closeButton, { backgroundColor: nativePalette.close }]}><Feather name="x" size={18} color={colors.foreground} /></Pressable>
                </View>
                {editingName ? (
                  <View style={[styles.nameEditor, { borderTopColor: colors.border }]}>
                    <Text style={styles.historyTitle}>Name this place</Text>
                    <Text style={styles.smallMuted}>Only you can see this name. Its saved coordinates will not change.</Text>
                    <TextInput
                      accessibilityLabel="Place name"
                      testID="input-place-name"
                      value={nameDraft}
                      onChangeText={value => { setNameDraft(value); setNameError(''); }}
                      onSubmitEditing={() => { void updateName(nameDraft); }}
                      placeholder="Home, Work, or another name"
                      placeholderTextColor={colors.mutedForeground}
                      autoCapitalize="words"
                      returnKeyType="done"
                      maxLength={48}
                      editable={!nameBusy}
                      style={[styles.nameInput, { borderColor: colors.border, color: colors.foreground }]}
                    />
                    {nameError ? <Text accessibilityRole="alert" testID="error-place-name" style={[styles.nameError, { color: colors.pink }]}>{nameError}</Text> : null}
                    <View style={styles.nameActions}>
                      <Pressable accessibilityRole="button" testID="button-cancel-name" disabled={nameBusy} onPress={() => { Keyboard.dismiss(); setEditingName(false); setNameError(''); }} style={[styles.nameButton, { borderColor: colors.border }]}>
                        <Text style={[styles.nameButtonText, { color: colors.foreground }]}>Cancel</Text>
                      </Pressable>
                      <Pressable accessibilityRole="button" testID="button-save-name" disabled={nameBusy} onPress={() => { void updateName(nameDraft); }} style={[styles.nameButton, { backgroundColor: colors.lime, opacity: nameBusy ? 0.55 : 1 }]}>
                        <Text style={[styles.nameButtonText, { color: nativePalette.blueInk }]}>{nameBusy ? 'Saving…' : 'Save name'}</Text>
                      </Pressable>
                    </View>
                    {savedName ? <Pressable accessibilityRole="button" testID="button-remove-name" disabled={nameBusy} onPress={() => { void updateName(null); }} style={styles.removeName}><Text style={[styles.privateMapAction, { color: colors.mutedForeground }]}>Remove name</Text></Pressable> : null}
                  </View>
                ) : (
                  <>
                    {!activeSelected.demo ? (
                      <Pressable accessibilityRole="button" accessibilityLabel={savedName ? 'Rename this place' : 'Name this place'} testID="button-rename-place" onPress={beginRename} style={styles.renameAction}>
                        <Feather name="edit-2" size={15} color={colors.lime} />
                        <Text style={[styles.privateMapAction, { color: colors.lime }]}>{savedName ? 'Rename place' : 'Name this place'}</Text>
                      </Pressable>
                    ) : null}
                    <View style={[styles.detailGrid, { borderTopColor: colors.border }]}>
                      <Detail label="Visits" value={String(activeSelected.visitCount)} testID="text-place-visits" />
                      <Detail label="Time spent" value={activeSelected.demo ? activeSelected.displayTime ?? 'Not available' : formatDuration(activeSelected.totalTimeMs ?? 0)} testID="text-place-time" />
                      <Detail label="First visited" value={dateLabel(activeSelected.firstVisit)} testID="text-place-first-visited" />
                      <Detail label="Last visited" value={dateLabel(activeSelected.latestVisit)} testID="text-place-last-visited" />
                      <Detail label="Location" value={formatCoordinates(activeSelected.lat, activeSelected.lng)} />
                    </View>
                    {selectedVisit ? (
                      <View style={[styles.visitHistory, { borderTopColor: colors.border }]} testID="selected-visit-detail">
                        <Text style={styles.historyTitle}>Selected visit</Text>
                        <View style={styles.visitRow}>
                          <Text style={styles.smallMuted}>Arrived</Text>
                          <Text style={styles.visitDate} testID="text-selected-visit-arrival">{dateTimeLabel(selectedVisit.arrivedAt)}</Text>
                        </View>
                        <View style={styles.visitRow}>
                          <Text style={styles.smallMuted}>Departed</Text>
                          <Text style={styles.visitDate} testID="text-selected-visit-departure">{dateTimeLabel(selectedVisit.departedAt)}</Text>
                        </View>
                        <View style={styles.visitRow}>
                          <Text style={styles.smallMuted}>Duration</Text>
                          <Text style={styles.visitDate} testID="text-selected-visit-duration">{formatDuration(selectedVisit.durationMs)}</Text>
                        </View>
                      </View>
                    ) : null}
                    {selectedVisits.length ? (
                      <View style={[styles.visitHistory, { borderTopColor: colors.border }]}>
                        <Text style={styles.historyTitle}>Visit history · {selectedVisits.length}</Text>
                        {selectedVisits.slice(0, 3).map(visit => (
                          <View key={visit.id} style={styles.visitRow}>
                            <Text style={styles.visitDate}>{dateLabel(visit.arrivedAt)}</Text>
                            <Text style={styles.smallMuted}>{formatDuration(visit.durationMs)}</Text>
                          </View>
                        ))}
                        {selectedVisits.length > 3 ? <Text style={styles.smallMuted}>And {selectedVisits.length - 3} earlier visits</Text> : null}
                      </View>
                    ) : null}
                  </>
                )}
              </>
            ) : null}
            </SafeAreaView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

function Detail({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.detailItem}>
      <Text style={styles.smallMuted}>{label}</Text>
      <Text style={styles.detailValue} testID={testID}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  topSafe: { backgroundColor: nativePalette.ink },
  topbar: { minHeight: 57, paddingHorizontal: 19, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandMark: { height: 29, width: 29, borderWidth: 1, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  brandName: { color: nativePalette.white, fontFamily: 'Inter_600SemiBold', fontSize: 16, letterSpacing: -0.5 },
  demoBadge: { borderWidth: 1, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 4, fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.8 },
  content: { paddingHorizontal: 18, paddingTop: 23, gap: 0 },
  intro: { marginBottom: 19 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.55 },
  pageTitle: { color: nativePalette.white, fontFamily: 'Inter_700Bold', fontSize: 36, lineHeight: 40, letterSpacing: -2.2, marginTop: 7 },
  introCopy: { color: nativePalette.foregroundMuted, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, marginTop: 7, maxWidth: 360 },
  mapCanvas: { height: 390, borderRadius: 18, overflow: 'hidden', position: 'relative' },
  tile: { position: 'absolute', width: TILE_SIZE, height: TILE_SIZE },
  noMap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 35 },
  noMapTitle: { color: nativePalette.white, fontFamily: 'Inter_600SemiBold', fontSize: 17, marginTop: 12 },
  noMapCopy: { color: nativePalette.foregroundMuted, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6 },
  marker: { position: 'absolute', alignItems: 'center', justifyContent: 'center', borderWidth: 3, elevation: 5, shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
  clusterCount: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  repeatDot: { width: 6, height: 6, borderRadius: 3, position: 'absolute', right: -1, top: -1, borderWidth: 1, borderColor: nativePalette.ink },
  mapCaption: { position: 'absolute', top: 12, left: 12, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 7 },
  captionText: { fontFamily: 'Inter_700Bold', fontSize: 8, letterSpacing: 1.25 },
  mapControls: { position: 'absolute', right: 12, top: 12, gap: 7 },
  controlButton: { width: 37, height: 37, borderRadius: 10, alignItems: 'center', justifyContent: 'center', elevation: 3 },
  disabled: { opacity: 0.45 },
  attribution: { position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 3 },
  attributionText: { color: '#D7D6DE', fontFamily: 'Inter_400Regular', fontSize: 8 },
  attributionLink: { textDecorationLine: 'underline' },
  tileNotice: { position: 'absolute', left: 10, right: 10, bottom: 30, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 7 },
  tileNoticeText: { color: nativePalette.white, fontFamily: 'Inter_400Regular', fontSize: 10, textAlign: 'center' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingTop: 12, paddingBottom: 4 },
  legendDot: { width: 9, height: 9, borderRadius: 5, marginLeft: 7 },
  legendDotLime: { marginLeft: 11 },
  legendText: { color: nativePalette.foregroundMuted, fontFamily: 'Inter_400Regular', fontSize: 11 },
  privateMapNotice: { borderWidth: 1, borderRadius: 12, marginTop: 12, padding: 14, gap: 10 },
  privateMapText: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
  privateMapAction: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  section: { marginTop: 24 },
  sectionTitle: { color: nativePalette.white, fontFamily: 'Inter_600SemiBold', fontSize: 19, letterSpacing: -0.5, marginBottom: 8 },
  placeRow: { minHeight: 67, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 15 },
  placeCopy: { flex: 1 },
  placeName: { color: nativePalette.white, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  smallMuted: { color: nativePalette.foregroundMuted, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, marginTop: 4 },
  rowPressed: { opacity: 0.72 },
  emptyCard: { borderRadius: 16, padding: 18, marginTop: 8 },
  emptyIcon: { width: 39, height: 39, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { color: nativePalette.white, fontFamily: 'Inter_600SemiBold', fontSize: 16, marginBottom: 4 },
  modalShade: { flex: 1, justifyContent: 'flex-end', backgroundColor: nativePalette.overlay },
  keyboardSheet: { flex: 1, justifyContent: 'flex-end' },
  detailSheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 12, paddingHorizontal: 22, paddingBottom: 18, maxHeight: '82%' },
  sheetHandle: { width: 38, height: 4, backgroundColor: nativePalette.sheetHandle, borderRadius: 3, alignSelf: 'center', marginBottom: 22 },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  sheetHeadingText: { flex: 1 },
  sheetTitle: { color: nativePalette.white, fontFamily: 'Inter_700Bold', fontSize: 28, lineHeight: 33, letterSpacing: -1.5, marginTop: 6, marginBottom: 8 },
  sheetCategory: { color: nativePalette.foregroundMuted, fontFamily: 'Inter_400Regular', fontSize: 13, marginBottom: 15 },
  closeButton: { height: 34, width: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  detailGrid: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 17, paddingBottom: 18, flexDirection: 'row', flexWrap: 'wrap', rowGap: 19 },
  detailItem: { width: '50%', paddingRight: 9 },
  detailValue: { color: nativePalette.white, fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 21, marginTop: 5 },
  visitHistory: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 15, paddingBottom: 8 },
  historyTitle: { color: nativePalette.white, fontFamily: 'Inter_600SemiBold', fontSize: 13, marginBottom: 8 },
  visitRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 28 },
  visitDate: { color: nativePalette.foregroundNote, fontFamily: 'Inter_500Medium', fontSize: 12 },
  renameAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameEditor: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 18, paddingBottom: 12 },
  nameInput: { height: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, fontFamily: 'Inter_500Medium', fontSize: 16, marginTop: 14 },
  nameError: { fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 9 },
  nameActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  nameButton: { flex: 1, minHeight: 46, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center', alignItems: 'center' },
  nameButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  removeName: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', marginTop: 8 },
  clusterList: { maxHeight: 340 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.96 }] },
});