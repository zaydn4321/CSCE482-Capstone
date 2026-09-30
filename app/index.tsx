import { LandingScreen } from '@/components/LocationWrapped';
import { useLocation } from '@/context/LocationContext';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

export default function EntryScreen() {
  const { state } = useLocation();
  const colors = useColors();
  useEffect(() => {
    if (state.ready && state.mode !== 'new') router.replace('/(tabs)');
  }, [state.ready, state.mode]);
  if (!state.ready || state.mode !== 'new') {
    return <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}><ActivityIndicator color={colors.lime} /></View>;
  }
  return <LandingScreen />;
}