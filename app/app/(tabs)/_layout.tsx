import React from 'react';
import { Tabs } from 'expo-router';
import { TabBar } from '../../src/components/TabBar';

/**
 * The four destinations from the Stitch mockups: Boards, Orders, Users, Archive.
 *
 * Home, Notifications and Settings are deliberately not tabs. Every mockup puts a gear and a
 * profile in the top app bar instead, and "Home" duplicated Boards — the board list *is* the
 * landing screen. Those three are now stack routes reached from `TopAppBar`.
 *
 * Chrome is drawn per-screen via `TopAppBar` rather than by the navigator, because the bar
 * differs by screen (brand mark vs back arrow, different actions) and the mockups show it
 * scrolling with content on some screens.
 */
export default function TabsLayout(): React.JSX.Element {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="boards" options={{ title: 'Boards' }} />
      <Tabs.Screen name="orders" options={{ title: 'Orders' }} />
      <Tabs.Screen name="users" options={{ title: 'Users' }} />
      <Tabs.Screen name="archive" options={{ title: 'Archive' }} />
    </Tabs>
  );
}
